"""Remove unsafe papers now; retry storage/CDN cleanup across API restarts."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlparse

import boto3
from botocore.config import Config
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.config import get_settings
from app.db.session import async_session_factory
from app.models.image_cleanup import ImageCleanup
from app.repositories import paper as paper_repo
from app.schemas.ws import PaperDeletedMessage
from app.services import s3
from app.ws.orb import connection_manager

logger = logging.getLogger(__name__)


async def remove_unsafe_paper(paper_id, orb_id, file_extension):
  async with async_session_factory() as session:
    # Persist the cleanup and remove the visible record in the same transaction.
    await session.execute(insert(ImageCleanup).values(
      paper_id=paper_id, orb_id=orb_id, file_extension=file_extension,
      storage_deleted=False, broadcast_sent=False,
      next_attempt=datetime.now(timezone.utc),
    ).on_conflict_do_nothing(index_elements=['paper_id']))
    await paper_repo.delete_paper(session, paper_id)
    await session.commit()
  await process_cleanup(paper_id)


def invalidate_image(job):
  settings = get_settings()
  if settings.local_file_storage:
    return True
  if not settings.cloudfront_distribution_id:
    raise ValueError('APP_CLOUDFRONT_DISTRIBUTION_ID is required for moderation cleanup')
  client = boto3.client('cloudfront',
    aws_access_key_id=settings.aws_access_key_id,
    aws_secret_access_key=settings.aws_secret_access_key,
    config=Config(connect_timeout=5, read_timeout=20, retries={'total_max_attempts': 1}),
  )
  path = urlparse(s3.get_cdn_url(s3.get_s3_key(job.orb_id, job.paper_id, job.file_extension))).path
  response = client.create_invalidation(
    DistributionId=settings.cloudfront_distribution_id,
    InvalidationBatch={
      'CallerReference': 'moderation-' + job.paper_id,
      'Paths': {'Quantity': 1, 'Items': [quote(path, safe='/%')]},
    },
  )
  # Repeating this exact request returns the original invalidation, not a new one.
  return response['Invalidation']['Status'] == 'Completed'


async def process_cleanup(paper_id=None):
  async with async_session_factory() as session:
    query = select(ImageCleanup).where(ImageCleanup.next_attempt <= datetime.now(timezone.utc))
    if paper_id is not None:
      query = query.where(ImageCleanup.paper_id == paper_id)
    job = (await session.execute(query.order_by(ImageCleanup.next_attempt).limit(1)
                                .with_for_update(skip_locked=True))).scalar_one_or_none()
    if job is None:
      return False
    # Only this cleanup row is locked; concurrent API workers skip it.
    errors = []
    if not job.broadcast_sent:
      try:
        message = PaperDeletedMessage(orb_id=job.orb_id, paper_id=job.paper_id, reason='nsfw_violation')
        await connection_manager.broadcast_to_orb(job.orb_id, message.model_dump(mode='json'))
        job.broadcast_sent = True
      except Exception as error:
        errors.append(str(error))
    complete = False
    try:
      if not job.storage_deleted:
        await s3.delete_image(job.orb_id, job.paper_id, job.file_extension, strict=True)
        job.storage_deleted = True
      complete = await asyncio.to_thread(invalidate_image, job)
    except Exception as error:
      errors.append(str(error))
    if complete and job.broadcast_sent:
      await session.delete(job)
    else:
      job.next_attempt = datetime.now(timezone.utc) + timedelta(minutes=1)
      job.last_error = '; '.join(errors) or None
      if errors:
        logger.error('Image cleanup pending for %s: %s', job.paper_id, job.last_error)
    await session.commit()
    return True


async def cleanup_loop():
  while True:
    try:
      if await process_cleanup():
        continue
    except Exception:
      logger.exception('Image cleanup worker failed; retrying')
    await asyncio.sleep(10)

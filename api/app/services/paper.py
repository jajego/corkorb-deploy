import logging
import re
from typing import Dict, List, Optional
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper import Paper
from app.repositories import orb as orb_repo, paper as paper_repo
from app.schemas.paper import PaperCreate, PaperData, PaperResponse, PaperUpdate, PinData

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}


def paper_to_response(paper: Paper) -> PaperResponse:
  """Serialize both legacy nested and current flat pin formats."""
  pin_position = paper.pin_position or {}
  position = pin_position.get("position")
  if not isinstance(position, dict):
    position = {key: value for key, value in pin_position.items() if key not in {"color", "normal"}}

  return PaperResponse(
    id=paper.id,
    orb_id=paper.orb_id,
    user_id=paper.user_id,
    username=paper.username,
    source_url=paper.source_url,
    created_at=paper.created_at,
    uploaded=paper.uploaded,
    validated=paper.validated,
    data=PaperData(**paper.data) if paper.data else None,
    pin=PinData(
      position=position,
      color=pin_position.get("color", "#ff4d4f"),
      normal=pin_position.get("normal"),
    ),
  )


def image_extension(source_url: str | None) -> str:
  """Return the stored image extension, including legacy data URLs."""
  if not source_url:
    return "jpg"
  if source_url.startswith("data:"):
    match = re.search(r"data:image/(\w+);", source_url)
    return IMAGE_EXTENSIONS.get(match.group(1).lower(), "jpg") if match else "jpg"
  path = urlparse(source_url).path
  return path.rsplit(".", 1)[-1].lower() if "." in path else "jpg"


async def delete_uploaded_image(paper: Paper) -> None:
  if not paper.uploaded:
    return

  from app.services import s3 as s3_service

  try:
    await s3_service.delete_image(paper.orb_id, paper.id, image_extension(paper.source_url))
    logger.info("Deleted image from S3 for paper %s", paper.id)
  except Exception as error:
    logger.warning("Failed to delete image from S3 for paper %s: %s", paper.id, error)


async def evict_oldest_paper(session: AsyncSession, orb_id: str, max_papers: int) -> None:
  if await orb_repo.count_papers_for_orb(session, orb_id) < max_papers:
    return

  oldest = await paper_repo.get_oldest_paper_for_orb(session, orb_id)
  if not oldest:
    return

  await delete_uploaded_image(oldest)
  await paper_repo.delete_paper(session, oldest.id)
  logger.info("Evicted oldest paper %s to make room for a new paper", oldest.id)


async def get_paper(session: AsyncSession, paper_id: str) -> Optional[PaperResponse]:
  """Get a paper by ID."""
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    return None

  return paper_to_response(paper)


async def get_papers_for_orb(session: AsyncSession, orb_id: str) -> List[PaperResponse]:
  """Get all papers for an orb."""
  papers = await paper_repo.get_papers_by_orb_id(session, orb_id)
  return [paper_to_response(paper) for paper in papers]


async def create_paper(
  session: AsyncSession,
  orb_id: str,
  data: PaperCreate,
  *,
  paper_id: Optional[str] = None,
  uploaded: bool = False,
  validated: bool = False,
) -> PaperResponse:
  """
  Create a new paper for an orb, enforcing max_papers limit.
  
  Uses distributed locking (Redis) for multi-instance deployments, with fallback
  to row-level locking (database) for single-instance deployments.
  """
  from app.utils.distributed_lock import acquire_lock
  from app.db.redis import get_redis
  
  # Try to use Redis distributed lock (for multi-instance)
  redis_client = await get_redis()
  lock_key = f"orb:{orb_id}:paper_creation"
  
  if redis_client:
    # Use Redis distributed lock
    async with acquire_lock(lock_key, timeout=10.0, retry_interval=0.1, max_retries=50):
      orb = await orb_repo.get_orb_by_id(session, orb_id, lock=False)
      if not orb:
        raise ValueError(f"Orb {orb_id} not found")
      
      await evict_oldest_paper(session, orb_id, orb.max_papers)
  else:
    # Fallback to row-level locking (single-instance)
    orb = await orb_repo.get_orb_by_id(session, orb_id, lock=True)
    if not orb:
      raise ValueError(f"Orb {orb_id} not found")
    
    await evict_oldest_paper(session, orb_id, orb.max_papers)

  # Prepare data dict for storage
  data_dict: Optional[Dict] = None
  if data.data:
    data_dict = data.data.model_dump(exclude_none=True)

  # Prepare pin_position (required)
  if not data.pin:
    raise ValueError("Pin data is required to create a paper")
  pin_position = {**data.pin.position, "color": data.pin.color, "normal": data.pin.normal}

  # Create paper with embedded pin
  paper = await paper_repo.create_paper(
    session,
    orb_id=orb_id,
    user_id=data.user_id,
    username=data.username,
    source_url=data.source_url,
    pin_position=pin_position,
    data=data_dict,
    uploaded=uploaded,
    validated=validated,
    paper_id=paper_id,
  )
  await orb_repo.record_orb_contribution(session, orb_id, data.user_id)

  await session.commit()
  await session.refresh(paper)

  return paper_to_response(paper)


async def delete_paper(session: AsyncSession, paper_id: str) -> bool:
  """
  Delete a paper. Returns True if deleted, False if not found.
  
  Also deletes the associated image from S3 if it was uploaded.
  """
  # Get paper first to extract orb_id and file info
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    return False
  
  await delete_uploaded_image(paper)
  
  # Delete from database
  deleted = await paper_repo.delete_paper(session, paper_id)
  if deleted:
    await session.commit()
  return deleted


async def update_paper(session: AsyncSession, paper_id: str, data: PaperUpdate) -> Optional[PaperResponse]:
  """Update a paper's metadata."""
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    return None

  if data.source_url is not None:
    paper.source_url = data.source_url
  if data.uploaded is not None:
    paper.uploaded = data.uploaded
  if data.validated is not None:
    paper.validated = data.validated
  if data.data is not None:
    paper.data = data.data.model_dump(exclude_none=True)

  # Handle pin updates (replace existing pin if provided)
  if data.pin is not None:
    paper.pin_position = {**data.pin.position, "color": data.pin.color, "normal": data.pin.normal}

  await session.flush()
  await session.refresh(paper)

  await session.commit()
  return paper_to_response(paper)

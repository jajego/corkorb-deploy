from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from botocore.exceptions import ClientError

from tests.conftest import TestSessionLocal
from app.models.image_cleanup import ImageCleanup
from app.models.paper import Paper
from app.models.orb import Orb
from app.services import image_cleanup as cleanup, s3


@pytest.mark.asyncio
@pytest.mark.parametrize('cdn_result', [False, RuntimeError('CloudFront unavailable')])
async def test_unsafe_removal_survives_storage_failure_and_retries(db_session, monkeypatch, cdn_result):
  monkeypatch.setattr(cleanup, 'async_session_factory', TestSessionLocal)
  monkeypatch.setattr(s3, 'get_settings', lambda: SimpleNamespace(local_file_storage=False, aws_s3_bucket_name='test'))
  client = Mock()
  client.delete_object.side_effect = [ClientError({'Error': {'Code': 'AccessDenied', 'Message': 'denied'}}, 'DeleteObject'), {}]
  monkeypatch.setattr(s3, 'get_s3_client', lambda: client)
  broadcast = AsyncMock()
  monkeypatch.setattr(cleanup.connection_manager, 'broadcast_to_orb', broadcast)
  invalidate = Mock(side_effect=[cdn_result, True])
  monkeypatch.setattr(cleanup, 'invalidate_image', invalidate)
  db_session.add(Orb(id='orb', max_papers=30))
  db_session.add(Paper(id='paper', orb_id='orb', user_id='user', source_url='https://cdn/orb/paper.gif', uploaded=True, pin_position={}))
  await db_session.commit()

  # Exercise the real moderation deletion entry point, not a mocked delete function.
  from app.workers.rekognition_async import delete_unsafe_paper
  await delete_unsafe_paper('paper', 'orb', 'gif', [])
  async with TestSessionLocal() as session:
    assert await session.get(Paper, 'paper') is None
    job = await session.get(ImageCleanup, 'paper')
    assert not job.storage_deleted
    assert 'AccessDenied' in job.last_error
  broadcast.assert_awaited_once()
  invalidate.assert_not_called()

  # Fresh sessions simulate a worker restart. CloudFront is still pending on pass 2.
  for complete in (False, True):
    async with TestSessionLocal() as session:
      job = await session.get(ImageCleanup, 'paper')
      job.next_attempt = datetime.now(timezone.utc)
      await session.commit()
    assert await cleanup.process_cleanup()
    async with TestSessionLocal() as session:
      job = await session.get(ImageCleanup, 'paper')
      assert (job is None) == complete
      if job:
        assert job.storage_deleted
  assert client.delete_object.call_count == 2  # One failed attempt, one success, no double delete.
  client.delete_object.assert_called_with(Bucket='test', Key='orb/paper.gif')


def test_cloudfront_exact_path_and_stable_request(monkeypatch):
  settings = SimpleNamespace(local_file_storage=False, cloudfront_distribution_id='dist',
    aws_access_key_id='test', aws_secret_access_key='test', cdn_base_url='https://cdn.example')
  monkeypatch.setattr(cleanup, 'get_settings', lambda: settings)
  monkeypatch.setattr(s3, 'get_settings', lambda: settings)
  client = Mock()
  client.create_invalidation.side_effect = [
    {'Invalidation': {'Status': 'InProgress'}}, {'Invalidation': {'Status': 'Completed'}}]
  monkeypatch.setattr(cleanup.boto3, 'client', lambda *args, **kwargs: client)
  job = SimpleNamespace(orb_id='orb', paper_id='paper', file_extension='gif')
  assert not cleanup.invalidate_image(job)
  assert cleanup.invalidate_image(job)
  assert client.create_invalidation.call_args_list[0] == client.create_invalidation.call_args_list[1]
  client.create_invalidation.assert_called_with(DistributionId='dist', InvalidationBatch={
    'CallerReference': 'moderation-paper', 'Paths': {'Quantity': 1, 'Items': ['/orb/paper.gif']}})

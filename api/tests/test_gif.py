import io
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from PIL import Image
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers
from botocore.exceptions import ClientError

from app.services.gif import gif_moderation_images, validate_gif
from app.workers import rekognition_async as worker
from app.routes import paper as route
from app.schemas.paper import PaperResponse


def make_gif(size=(4, 4), count=3):
  frames = [Image.new('RGB', size, (i % 256, 0, 0)) for i in range(count)]
  buffer = io.BytesIO()
  frames[0].save(buffer, format='GIF', save_all=True, append_images=frames[1:], duration=40, loop=0)
  return buffer.getvalue()


def test_validation_and_every_frame_conversion():
  content = make_gif()
  validate_gif(content)
  frames = list(gif_moderation_images(content))
  assert len(frames) == 3
  for i, frame in enumerate(frames):
    with Image.open(io.BytesIO(frame['Bytes'])) as image:
      assert image.format == 'PNG'
      assert image.getpixel((0, 0)) == (i, 0, 0)


def test_long_gif_samples_eight_frames_including_endpoints():
  frames = list(gif_moderation_images(make_gif(count=120)))
  assert len(frames) == 8
  colors = [Image.open(io.BytesIO(frame['Bytes'])).getpixel((0, 0))[0] for frame in frames]
  assert colors == [0, 17, 34, 51, 68, 85, 102, 119]


@pytest.mark.asyncio
async def test_retries_resume_without_exceeding_call_budget(monkeypatch):
  monkeypatch.setattr(worker, 'get_settings', lambda: SimpleNamespace(
    local_file_storage=False, aws_s3_bucket_name='test', rekognition_min_confidence=80))
  s3 = Mock()
  s3.get_object.side_effect = lambda **kwargs: {'Body': io.BytesIO(make_gif(count=120))}
  monkeypatch.setattr(worker.s3_service, 'get_s3_client', lambda: s3)
  monkeypatch.setattr(worker.s3_service, 'get_s3_uri_for_rekognition', lambda *args: {})
  seen = []
  def detect(**kwargs):
    seen.append(Image.open(io.BytesIO(kwargs['Image']['Bytes'])).getpixel((0, 0))[0])
    if len(seen) == 2:
      raise ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'retry'}}, 'DetectModerationLabels')
    return {'ModerationLabels': []}
  client = Mock()
  client.detect_moderation_labels.side_effect = detect
  monkeypatch.setattr(worker, 'get_rekognition_client', lambda: client)
  monkeypatch.setattr(worker.asyncio, 'sleep', AsyncMock())
  validated = AsyncMock()
  monkeypatch.setattr(worker, 'mark_paper_validated', validated)
  await worker.check_image_safety_async('paper', 'orb', 'gif')
  assert seen == [0, 17, 17, 34, 51, 68, 85, 102]
  validated.assert_not_awaited()  # The final sample did not fit the total attempt budget.


def test_moderation_admission_is_bounded(monkeypatch):
  monkeypatch.setattr(worker, '_pending_moderations', 0)
  assert all(worker.reserve_moderation_slot() for _ in range(16))
  assert not worker.reserve_moderation_slot()
  worker.release_moderation_slot()
  assert worker.reserve_moderation_slot()


@pytest.mark.asyncio
async def test_busy_moderation_rejects_upload_before_storage(monkeypatch):
  monkeypatch.setattr(route, 'get_settings', lambda: SimpleNamespace(local_file_storage=False))
  monkeypatch.setattr(worker, '_pending_moderations', 16)
  upload = AsyncMock()
  monkeypatch.setattr(route.s3_service, 'upload_image', upload)
  with pytest.raises(HTTPException) as error:
    await route.create_paper_with_image(
      orb_id='orb', file=UploadFile(io.BytesIO(make_gif()), filename='test.gif'),
      pin='{}', session=object(), user_info={'user_id': 'user'},
    )
  assert error.value.status_code == 429
  upload.assert_not_called()


@pytest.mark.parametrize('content', [b'GIF89a', b'not an image', make_gif((1025, 1)), make_gif(count=121), make_gif((1024, 1024), 33)],
                         ids=['truncated', 'invalid', 'dimensions', 'frame-count', 'pixel-budget'])
def test_rejects_invalid_or_excessive_gifs(content):
  with pytest.raises(ValueError):
    validate_gif(content)


@pytest.mark.asyncio
@pytest.mark.parametrize('unsafe', [False, True])
async def test_moderation_checks_later_frames(monkeypatch, unsafe):
  settings = SimpleNamespace(local_file_storage=False, aws_s3_bucket_name='test', rekognition_min_confidence=80)
  monkeypatch.setattr(worker, 'get_settings', lambda: settings)
  s3 = Mock()
  s3.get_object.return_value = {'Body': io.BytesIO(make_gif())}
  monkeypatch.setattr(worker.s3_service, 'get_s3_client', lambda: s3)
  monkeypatch.setattr(worker.s3_service, 'get_s3_uri_for_rekognition', lambda *args: {'S3Object': {}})
  rekognition = Mock()
  rekognition.detect_moderation_labels.side_effect = [
    {'ModerationLabels': []},
    {'ModerationLabels': []},
    {'ModerationLabels': [{'Name': 'Violence', 'Confidence': 99}] if unsafe else []},
  ]
  monkeypatch.setattr(worker, 'get_rekognition_client', lambda: rekognition)
  validated, deleted = AsyncMock(), AsyncMock()
  monkeypatch.setattr(worker, 'mark_paper_validated', validated)
  monkeypatch.setattr(worker, 'delete_unsafe_paper', deleted)
  await worker.check_image_safety_async('paper', 'orb', 'gif', max_retries=1)
  assert rekognition.detect_moderation_labels.call_count == 3
  assert validated.await_count == (0 if unsafe else 1)
  assert deleted.await_count == (1 if unsafe else 0)


@pytest.mark.asyncio
@pytest.mark.parametrize('valid', [False, True])
async def test_upload_route_preserves_gif_or_rejects_before_storage(monkeypatch, valid):
  # Exercise production admission/cleanup even when the local .env skips AWS.
  monkeypatch.setattr(route, 'get_settings', lambda: SimpleNamespace(local_file_storage=False))
  monkeypatch.setattr(worker, '_pending_moderations', 0)
  content = make_gif() if valid else b'GIF89a'
  upload = AsyncMock(return_value='https://cdn.example/orb/paper.gif')
  monkeypatch.setattr(route.s3_service, 'upload_image', upload)
  monkeypatch.setattr(route, 'require_orb_access', AsyncMock())
  monkeypatch.setattr(route.connection_manager, 'broadcast_to_orb', AsyncMock())
  moderation = AsyncMock()
  monkeypatch.setattr(worker, 'check_image_safety_async', moderation)
  response = PaperResponse(
    id='paper', orb_id='orb', user_id='user', created_at=datetime.now(timezone.utc),
    source_url='https://cdn.example/orb/paper.gif', uploaded=True, validated=False,
    pin={'position': {'x': 0, 'y': 0, 'z': 1}, 'color': '#ff0000'},
  )
  monkeypatch.setattr(route.paper_service, 'create_paper', AsyncMock(return_value=response))
  file = UploadFile(io.BytesIO(content), filename='animated.gif', headers=Headers({'content-type': 'image/gif'}))
  kwargs = dict(orb_id='orb', file=file, pin=json.dumps({'position': {'x': 0, 'y': 0, 'z': 1}, 'color': '#ff0000'}),
                data=None, username=None, session=object(), user_info={'user_id': 'user'})
  if not valid:
    with pytest.raises(HTTPException) as error:
      await route.create_paper_with_image(**kwargs)
    assert error.value.status_code == 400
    upload.assert_not_called()
  else:
    result = await route.create_paper_with_image(**kwargs)
    assert result.source_url.endswith('.gif')
    assert upload.call_args.kwargs['file_content'] == content
    assert upload.call_args.kwargs['content_type'] == 'image/gif'
    await asyncio.sleep(0)
    await asyncio.sleep(0)  # Run the background task's slot-release callback.
    moderation.assert_awaited_once()
  assert worker._pending_moderations == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('extension', ['jpg', 'png', 'webp'])
@pytest.mark.parametrize('unsafe', [False, True])
async def test_static_image_moderation_still_works(monkeypatch, extension, unsafe):
  monkeypatch.setattr(worker, 'get_settings', lambda: SimpleNamespace(
    local_file_storage=False, aws_s3_bucket_name='test', rekognition_min_confidence=80))
  uri = {'S3Object': {'Bucket': 'test', 'Name': 'orb/paper.' + extension}}
  monkeypatch.setattr(worker.s3_service, 'get_s3_uri_for_rekognition', lambda *args: uri)
  buffer = io.BytesIO()
  Image.new('RGBA', (4, 4), (255, 0, 0, 128)).save(buffer, format='WEBP')
  s3 = Mock()
  s3.get_object.return_value = {'Body': io.BytesIO(buffer.getvalue())}
  monkeypatch.setattr(worker.s3_service, 'get_s3_client', lambda: s3)
  client = Mock()
  client.detect_moderation_labels.return_value = {
    'ModerationLabels': [{'Name': 'Violence', 'Confidence': 99}] if unsafe else []}
  monkeypatch.setattr(worker, 'get_rekognition_client', lambda: client)
  validated, deleted = AsyncMock(), AsyncMock()
  monkeypatch.setattr(worker, 'mark_paper_validated', validated)
  monkeypatch.setattr(worker, 'delete_unsafe_paper', deleted)
  await worker.check_image_safety_async('paper', 'orb', extension, max_retries=1)
  assert client.detect_moderation_labels.call_count == 1
  sent = client.detect_moderation_labels.call_args.kwargs['Image']
  if extension == 'webp':
    assert Image.open(io.BytesIO(sent['Bytes'])).format == 'PNG'
  else:
    assert sent == uri
    s3.get_object.assert_not_called()
  assert validated.await_count == (0 if unsafe else 1)
  assert deleted.await_count == (1 if unsafe else 0)


@pytest.mark.asyncio
async def test_only_two_moderation_scans_run_concurrently(monkeypatch):
  monkeypatch.setattr(worker, 'get_settings', lambda: SimpleNamespace(local_file_storage=False))
  monkeypatch.setattr(worker.s3_service, 'get_s3_uri_for_rekognition', lambda *args: {})
  monkeypatch.setattr(worker, '_moderation_workers', asyncio.Semaphore(2))
  monkeypatch.setattr(worker, 'mark_paper_validated', AsyncMock())
  active = peak = 0
  async def fake_thread_call(function):
    nonlocal active, peak
    active += 1
    peak = max(peak, active)
    await asyncio.sleep(0.01)
    active -= 1
    return []
  monkeypatch.setattr(worker.asyncio, 'to_thread', fake_thread_call)
  await asyncio.gather(*(worker.check_image_safety_async(str(i), 'orb', 'jpg') for i in range(8)))
  assert peak == 2
  assert worker.mark_paper_validated.await_count == 8

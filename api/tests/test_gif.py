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
    moderation.assert_awaited_once()

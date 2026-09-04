import pytest
from types import SimpleNamespace

from app.services import s3 as s3_service


@pytest.mark.asyncio
async def test_local_image_round_trip(monkeypatch, tmp_path):
  monkeypatch.setattr(s3_service, "LOCAL_UPLOAD_DIR", tmp_path)
  monkeypatch.setattr(
    s3_service,
    "get_settings",
    lambda: SimpleNamespace(local_file_storage=True, port=8000),
  )

  url = await s3_service.upload_image(b"image-bytes", "test-orb", "paper-1", "png", "image/png")

  assert url.endswith("/local-images/test-orb/paper-1.png")
  assert (tmp_path / "test-orb" / "paper-1.png").read_bytes() == b"image-bytes"
  assert await s3_service.delete_image("test-orb", "paper-1", "png") is True
  assert not (tmp_path / "test-orb" / "paper-1.png").exists()

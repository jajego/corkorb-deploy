from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.paper import image_extension, paper_to_response


def test_image_extension_preserves_supported_storage_formats():
  assert image_extension("https://cdn.example/orb/paper.webp?cache=1") == "webp"
  assert image_extension("data:image/jpeg;base64,abc") == "jpg"
  assert image_extension(None) == "jpg"


def test_paper_to_response_preserves_legacy_nested_pins():
  paper = SimpleNamespace(
    id="paper-1", orb_id="orb-1", user_id="user-1", username="jamie",
    source_url="https://cdn.example/orb/paper.png", created_at=datetime.now(timezone.utc),
    uploaded=True, validated=False, data={},
    pin_position={"position": {"x": 1, "y": 2, "z": 3}, "color": "#123456"},
  )

  response = paper_to_response(paper)

  assert response.pin.position == {"x": 1.0, "y": 2.0, "z": 3.0}
  assert response.pin.color == "#123456"
  assert response.pin.normal is None


def test_paper_to_response_keeps_flat_pin_normals_out_of_position():
  paper = SimpleNamespace(
    id="paper-2", orb_id="orb-1", user_id="user-1", username=None,
    source_url="https://cdn.example/orb/paper.webp", created_at=datetime.now(timezone.utc),
    uploaded=True, validated=True, data={},
    pin_position={
      "x": 1, "y": 2, "z": 3, "color": "#abcdef",
      "normal": {"x": 0, "y": 0, "z": 1},
    },
  )

  response = paper_to_response(paper)

  assert response.pin.position == {"x": 1.0, "y": 2.0, "z": 3.0}
  assert response.pin.normal == {"x": 0.0, "y": 0.0, "z": 1.0}

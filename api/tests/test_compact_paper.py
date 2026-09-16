from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.services.paper import paper_to_response


def paper(data):
  return SimpleNamespace(id='paper', orb_id='orb', user_id='user', username=None,
    source_url='https://example.com/image.png', created_at=datetime.now(timezone.utc),
    uploaded=True, validated=True, pin_position={'x': 0, 'y': 0, 'z': 1}, data=data)


def metadata():
  return dict(center={'x': 0, 'y': 0, 'z': 1.01},
    quaternion={'x': 0, 'y': 0, 'z': 0, 'w': 1},
    basisRight={'x': 1, 'y': 0, 'z': 0}, basisUp={'x': 0, 'y': 1, 'z': 0},
    scale=0.3, aspect=1.5, rotation=0, layerOffset=0.002,
    positions=[0.123456789] * 5043, normals=[0.987654321] * 5043)


def test_response_omits_reconstructable_arrays_without_mutating_storage():
  data = metadata()
  original = deepcopy(data)
  response = paper_to_response(paper(data))
  assert response.data.positions is None and response.data.normals is None
  assert response.data.center == data['center']
  assert response.data.layerOffset == data['layerOffset']
  assert data == original
  assert len(response.model_dump_json()) < 1500


@pytest.mark.parametrize('missing', ['center', 'quaternion', 'basisRight', 'basisUp', 'scale', 'aspect', 'rotation', 'layerOffset'])
def test_legacy_incomplete_metadata_keeps_geometry(missing):
  data = metadata()
  del data[missing]
  response = paper_to_response(paper(data))
  assert response.data.positions == data['positions']
  assert response.data.normals == data['normals']


def test_partial_vector_keeps_legacy_geometry():
  data = metadata()
  del data['center']['z']
  assert paper_to_response(paper(data)).data.positions == data['positions']

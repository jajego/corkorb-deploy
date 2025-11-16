import pytest
from datetime import datetime, timezone

from app.models.orb import Orb
from app.models.paper import Paper
from app.schemas.orb import OrbCreate, OrbUpdate
from app.schemas.paper import PaperCreate, PaperData
from app.schemas.pin import PinCreate
from app.services import orb as orb_service, paper as paper_service


@pytest.mark.asyncio
async def test_create_and_get_orb(db_session):
  """Test creating and retrieving an orb."""
  create_data = OrbCreate(max_papers=30)
  created = await orb_service.create_orb(db_session, create_data)
  assert created.id is not None
  assert created.max_papers == 30

  retrieved = await orb_service.get_orb(db_session, created.id)
  assert retrieved is not None
  assert retrieved.id == created.id
  assert retrieved.max_papers == 30


@pytest.mark.asyncio
async def test_delete_orb(db_session):
  """Test deleting an orb."""
  create_data = OrbCreate()
  created = await orb_service.create_orb(db_session, create_data)
  orb_id = created.id

  deleted = await orb_service.delete_orb(db_session, orb_id)
  assert deleted is True

  retrieved = await orb_service.get_orb(db_session, orb_id)
  assert retrieved is None


@pytest.mark.asyncio
async def test_create_paper_with_eviction(db_session):
  """Test that creating papers beyond max_papers evicts the oldest."""
  # Create orb with max_papers=2
  orb = await orb_service.create_orb(db_session, OrbCreate(max_papers=2))
  orb_id = orb.id

  # Create 3 papers
  pin_data = PinCreate(position={"x": 1.0, "y": 2.0, "z": 3.0}, color="#ff0000")
  paper1 = await paper_service.create_paper(
    db_session,
    orb_id,
    PaperCreate(
      user_id="user1",
      source_url="https://example.com/img1.jpg",
      data=PaperData(scale=0.5),
      pin=pin_data,
    ),
  )

  paper2 = await paper_service.create_paper(
    db_session,
    orb_id,
    PaperCreate(
      user_id="user2",
      source_url="https://example.com/img2.jpg",
      data=PaperData(scale=0.6),
      pin=pin_data,
    ),
  )

  # Third paper should evict paper1
  paper3 = await paper_service.create_paper(
    db_session,
    orb_id,
    PaperCreate(
      user_id="user3",
      source_url="https://example.com/img3.jpg",
      data=PaperData(scale=0.7),
      pin=pin_data,
    ),
  )

  # Verify paper1 is gone
  papers = await paper_service.get_papers_for_orb(db_session, orb_id)
  paper_ids = [p.id for p in papers]
  assert paper1.id not in paper_ids
  assert paper2.id in paper_ids
  assert paper3.id in paper_ids


@pytest.mark.asyncio
async def test_create_paper_with_pin(db_session):
  """Test creating a paper with a pin."""
  orb = await orb_service.create_orb(db_session, OrbCreate())
  orb_id = orb.id

  pin_data = PinCreate(position={"x": 1.0, "y": 2.0, "z": 3.0}, color="#ff0000")
  paper = await paper_service.create_paper(
    db_session,
    orb_id,
    PaperCreate(
      user_id="user1",
      source_url="https://example.com/img.jpg",
      data=PaperData(scale=0.5, rotation=0.1),
      pin=pin_data,
    ),
  )

  assert paper.pin is not None
  assert paper.pin.position["x"] == 1.0
  assert paper.pin.color == "#ff0000"


@pytest.mark.asyncio
async def test_delete_paper(db_session):
  """Test deleting a paper."""
  orb = await orb_service.create_orb(db_session, OrbCreate())
  orb_id = orb.id

  pin_data = PinCreate(position={"x": 1.0, "y": 2.0, "z": 3.0}, color="#ff0000")
  paper = await paper_service.create_paper(
    db_session,
    orb_id,
    PaperCreate(user_id="user1", source_url="https://example.com/img.jpg", pin=pin_data),
  )

  deleted = await paper_service.delete_paper(db_session, paper.id)
  assert deleted is True

  retrieved = await paper_service.get_paper(db_session, paper.id)
  assert retrieved is None


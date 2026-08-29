import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orb import Orb
from app.repositories import orb as orb_repo
from app.schemas.orb import OrbCreate, OrbResponse, OrbUpdate

logger = logging.getLogger(__name__)


async def get_orb(session: AsyncSession, orb_id: str) -> Optional[OrbResponse]:
  """Get an orb by ID."""
  orb = await orb_repo.get_orb_by_id(session, orb_id)
  if not orb:
    return None
  # Construct response manually (papers is not an attribute on Orb model, it's a relationship)
  # Note: This function doesn't include papers - use the route handler for that
  return OrbResponse(
    id=orb.id,
    created_at=orb.created_at,
    updated_at=orb.updated_at,
    last_accessed=orb.last_accessed,
    max_papers=orb.max_papers,
    shape=orb.shape,
    papers=None,  # Not fetched here - route handler fetches papers separately
  )


async def create_orb(session: AsyncSession, data: OrbCreate) -> OrbResponse:
  """Create a new orb."""
  orb = await orb_repo.create_orb(session, max_papers=data.max_papers, shape=data.shape)
  await session.commit()
  # Construct response manually (papers is not an attribute on Orb model, it's a relationship)
  # New orbs have no papers, so we can use an empty list
  return OrbResponse(
    id=orb.id,
    created_at=orb.created_at,
    updated_at=orb.updated_at,
    last_accessed=orb.last_accessed,
    max_papers=orb.max_papers,
    shape=orb.shape,
    papers=[],  # New orb has no papers
  )


async def delete_orb(session: AsyncSession, orb_id: str) -> bool:
  """
  Delete an orb. Returns True if deleted, False if not found.
  
  Also deletes all associated images from S3 before deleting the orb.
  """
  # Check if orb exists
  orb = await orb_repo.get_orb_by_id(session, orb_id)
  if not orb:
    return False
  
  # Delete all images from S3 for this orb
  from app.services import s3 as s3_service
  try:
    deleted_count = await s3_service.delete_all_orb_images(orb_id)
    logger.info(f"Deleted {deleted_count} images from S3 for orb {orb_id}")
  except Exception as e:
    logger.warning(f"Failed to delete images from S3 for orb {orb_id}: {e}")
    # Continue with database deletion even if S3 deletion fails
  
  # Delete orb from database (CASCADE will delete all papers)
  deleted = await orb_repo.delete_orb(session, orb_id)
  if deleted:
    await session.commit()
  return deleted


async def update_orb(session: AsyncSession, orb_id: str, data: OrbUpdate) -> Optional[OrbResponse]:
  """Update an orb's metadata."""
  orb = await orb_repo.get_orb_by_id(session, orb_id)
  if not orb:
    return None

  if data.last_accessed is not None:
    orb = await orb_repo.update_orb_last_accessed(session, orb_id, data.last_accessed)
  else:
    orb.last_accessed = datetime.now(timezone.utc)
    await session.flush()
    await session.refresh(orb)

  await session.commit()
  # Construct response manually (papers is not an attribute on Orb model, it's a relationship)
  # For update, we don't need to fetch papers (not typically used in update responses)
  return OrbResponse(
    id=orb.id,
    created_at=orb.created_at,
    updated_at=orb.updated_at,
    last_accessed=orb.last_accessed,
    max_papers=orb.max_papers,
    shape=orb.shape,
    papers=None,  # Not included in update responses
  )


async def touch_orb(session: AsyncSession, orb_id: str) -> bool:
  """Update last_accessed timestamp for an orb. Returns True if orb exists."""
  orb = await orb_repo.update_orb_last_accessed(session, orb_id, datetime.now(timezone.utc))
  if orb:
    await session.commit()
    return True
  return False




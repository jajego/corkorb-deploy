from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orb import Orb
from app.utils.passphrase import generate_unique_passphrase


async def get_orb_by_id(session: AsyncSession, orb_id: str, lock: bool = False) -> Optional[Orb]:
  """
  Fetch an orb by ID.
  
  Args:
    session: Database session
    orb_id: Orb ID to fetch
    lock: If True, use SELECT FOR UPDATE to lock the row
  """
  query = select(Orb).where(Orb.id == orb_id)
  if lock:
    query = query.with_for_update()
  result = await session.execute(query)
  return result.scalar_one_or_none()


async def create_orb(session: AsyncSession, max_papers: int = 50, orb_id: Optional[str] = None) -> Orb:
  """
  Create a new orb with a unique passphrase ID.
  
  Args:
    session: Database session
    max_papers: Maximum number of papers allowed on the orb
    orb_id: Optional specific ID to use (if provided and unique)
  
  Returns:
    The created Orb
  """
  # If orb_id is provided, check if it's unique
  if orb_id:
    existing = await get_orb_by_id(session, orb_id)
    if existing:
      raise ValueError(f"Orb ID '{orb_id}' already exists")
    orb = Orb(id=orb_id, max_papers=max_papers)
  else:
    # Generate a unique passphrase
    # First, get all existing orb IDs to check against
    # Use scalars() for async SQLAlchemy
    result = await session.execute(select(Orb.id))
    existing_ids = [row[0] for row in result]
    
    # Generate unique passphrase
    passphrase = generate_unique_passphrase(existing_ids)
    orb = Orb(id=passphrase, max_papers=max_papers)
  
  session.add(orb)
  await session.flush()
  await session.refresh(orb)
  return orb


async def delete_orb(session: AsyncSession, orb_id: str) -> bool:
  """Delete an orb by ID. Returns True if deleted, False if not found."""
  orb = await get_orb_by_id(session, orb_id)
  if not orb:
    return False
  await session.delete(orb)
  await session.flush()
  return True


async def update_orb_last_accessed(session: AsyncSession, orb_id: str, timestamp: datetime) -> Optional[Orb]:
  """Update the last_accessed timestamp for an orb."""
  orb = await get_orb_by_id(session, orb_id)
  if not orb:
    return None
  orb.last_accessed = timestamp
  await session.flush()
  await session.refresh(orb)
  return orb


async def count_papers_for_orb(session: AsyncSession, orb_id: str) -> int:
  """Count the number of papers attached to an orb."""
  from app.models.paper import Paper
  result = await session.execute(select(Paper).where(Paper.orb_id == orb_id))
  papers = result.scalars().all()
  return len(papers)




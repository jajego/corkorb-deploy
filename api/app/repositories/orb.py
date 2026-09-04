from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orb import Orb, OrbContributor
from app.models.paper import Paper
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


async def create_orb(
  session: AsyncSession,
  max_papers: int = 50,
  shape: str = "sphere",
  orb_id: Optional[str] = None,
  owner_user_id: Optional[str] = None,
) -> Orb:
  """
  Create a new orb with a unique passphrase ID.
  
  Args:
    session: Database session
    max_papers: Maximum number of papers allowed on the orb
    shape: Cork surface shape
    orb_id: Optional specific ID to use (if provided and unique)
  
  Returns:
    The created Orb
  """
  # If orb_id is provided, check if it's unique
  if orb_id:
    existing = await get_orb_by_id(session, orb_id)
    if existing:
      raise ValueError(f"Orb ID '{orb_id}' already exists")
    orb = Orb(id=orb_id, max_papers=max_papers, shape=shape, owner_user_id=owner_user_id)
  else:
    # Generate a unique passphrase
    # First, get all existing orb IDs to check against
    # Use scalars() for async SQLAlchemy
    result = await session.execute(select(Orb.id))
    existing_ids = [row[0] for row in result]
    
    # Generate unique passphrase
    passphrase = generate_unique_passphrase(existing_ids)
    orb = Orb(id=passphrase, max_papers=max_papers, shape=shape, owner_user_id=owner_user_id)
  
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


async def record_orb_contribution(session: AsyncSession, orb_id: str, user_id: str) -> None:
  """Record a user's first contribution without duplicating subsequent uploads."""
  if user_id.startswith("user:anonymous"):
    return

  values = {"user_id": user_id, "orb_id": orb_id, "contributed_at": datetime.now(timezone.utc)}
  bind = session.get_bind()
  if bind.dialect.name == "postgresql":
    await session.execute(
      postgres_insert(OrbContributor)
      .values(**values)
      .on_conflict_do_nothing(index_elements=["user_id", "orb_id"])
    )
    return

  # SQLite is only used by the test suite.
  if not await session.get(OrbContributor, (user_id, orb_id)):
    session.add(OrbContributor(**values))


async def get_user_orb_rows(session: AsyncSession, user_id: str) -> list[tuple[Orb, int, bool]]:
  """Return a user's owned/contributed corks and paper counts in one query."""
  paper_count = (
    select(func.count(Paper.id))
    .where(Paper.orb_id == Orb.id)
    .correlate(Orb)
    .scalar_subquery()
  )
  contribution = and_(
    OrbContributor.orb_id == Orb.id,
    OrbContributor.user_id == user_id,
  )
  result = await session.execute(
    select(
      Orb,
      paper_count,
      OrbContributor.user_id.is_not(None),
    )
    .outerjoin(OrbContributor, contribution)
    .where(or_(Orb.owner_user_id == user_id, OrbContributor.user_id.is_not(None)))
    .order_by(func.coalesce(Orb.last_accessed, Orb.created_at).desc())
  )
  return [(orb, int(paper_count), bool(contributed)) for orb, paper_count, contributed in result.all()]




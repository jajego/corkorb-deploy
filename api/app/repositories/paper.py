from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper import Paper


async def get_paper_by_id(session: AsyncSession, paper_id: str) -> Optional[Paper]:
  """Fetch a paper by ID."""
  result = await session.execute(select(Paper).where(Paper.id == paper_id))
  return result.scalar_one_or_none()


async def get_papers_by_orb_id(session: AsyncSession, orb_id: str) -> List[Paper]:
  """Fetch all papers for an orb."""
  result = await session.execute(
    select(Paper).where(Paper.orb_id == orb_id).order_by(Paper.created_at)
  )
  return list(result.scalars().all())


async def create_paper(
  session: AsyncSession,
  orb_id: str,
  user_id: str,
  source_url: str,
  pin_position: Dict,
  data: Optional[Dict] = None,
  uploaded: bool = False,
  validated: bool = False,
  username: Optional[str] = None,
  paper_id: Optional[str] = None,
) -> Paper:
  """Create a new paper with embedded pin."""
  paper = Paper(
    orb_id=orb_id,
    user_id=user_id,
    username=username,
    source_url=source_url,
    pin_position=pin_position,
    data=data or {},
    uploaded=uploaded,
    validated=validated,
  )
  if paper_id:
    paper.id = paper_id
  session.add(paper)
  await session.flush()
  await session.refresh(paper)
  return paper


async def delete_paper(session: AsyncSession, paper_id: str) -> bool:
  """Delete a paper by ID. Returns True if deleted, False if not found."""
  paper = await get_paper_by_id(session, paper_id)
  if not paper:
    return False
  await session.delete(paper)
  await session.flush()
  return True


async def get_oldest_paper_for_orb(session: AsyncSession, orb_id: str) -> Optional[Paper]:
  """Get the oldest paper for an orb (by created_at)."""
  result = await session.execute(
    select(Paper).where(Paper.orb_id == orb_id).order_by(Paper.created_at).limit(1)
  )
  return result.scalar_one_or_none()




"""Authorization utilities for orb and paper operations."""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import orb as orb_repo, paper as paper_repo

logger = logging.getLogger(__name__)


class AuthorizationError(Exception):
  """Authorization error."""
  pass


async def check_paper_ownership(session: AsyncSession, paper_id: str, user_id: str) -> bool:
  """
  Check if user owns a paper.
  
  Args:
    session: Database session
    paper_id: Paper ID to check
    user_id: User ID to check
    
  Returns:
    bool: True if user owns the paper, False otherwise
    
  Raises:
    AuthorizationError: If paper not found
  """
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    raise AuthorizationError(f"Paper {paper_id} not found")
  
  if paper.user_id != user_id:
    logger.warning(f"User {user_id} attempted to access paper {paper_id} owned by {paper.user_id}")
    return False
  
  return True


async def check_orb_access(session: AsyncSession, orb_id: str, user_id: str) -> bool:
  """
  Check if user has access to an orb.
  
  Currently, orbs are shared (no ownership) - any authenticated user can access.
  In the future, this can be extended to support:
  - Orb ownership
  - Orb permissions
  - Orb sharing
  
  Args:
    session: Database session
    orb_id: Orb ID to check
    user_id: User ID to check
    
  Returns:
    bool: True if user has access, False otherwise
    
  Raises:
    AuthorizationError: If orb not found
  """
  orb = await orb_repo.get_orb_by_id(session, orb_id)
  if not orb:
    raise AuthorizationError(f"Orb {orb_id} not found")
  
  # Currently, orbs are shared (no ownership)
  # Any authenticated user can access any orb
  # In the future, add ownership checks here
  return True


async def require_orb_access_and_get_orb(session: AsyncSession, orb_id: str, user_id: str):
  """
  Require that user has access to an orb and return the orb.
  
  This is more efficient than calling require_orb_access and get_orb_by_id separately,
  as it only queries the database once.
  
  Args:
    session: Database session
    orb_id: Orb ID to check
    user_id: User ID to check
    
  Returns:
    Orb: The orb object
    
  Raises:
    AuthorizationError: If user doesn't have access or orb not found
  """
  orb = await orb_repo.get_orb_by_id(session, orb_id)
  if not orb:
    raise AuthorizationError(f"Orb {orb_id} not found")
  
  # Currently, orbs are shared (no ownership)
  # Any authenticated user can access any orb
  # In the future, add ownership checks here
  return orb


async def check_orb_ownership(session: AsyncSession, orb_id: str, user_id: str) -> bool:
  """
  Check if user owns an orb.
  
  Currently, orbs don't have owners (shared).
  This function is kept for future implementation.
  
  Args:
    session: Database session
    orb_id: Orb ID to check
    user_id: User ID to check
    
  Returns:
    bool: True if user owns the orb, False otherwise
    
  Raises:
    AuthorizationError: If orb not found
  """
  orb = await orb_repo.get_orb_by_id(session, orb_id)
  if not orb:
    raise AuthorizationError(f"Orb {orb_id} not found")
  
  # Currently, orbs don't have owners (shared)
  # In the future, add user_id field to Orb model and check here
  # For now, return False (no ownership)
  logger.debug(f"Orb {orb_id} ownership check: orbs are shared (no ownership)")
  return False


async def require_paper_ownership(session: AsyncSession, paper_id: str, user_id: str):
  """
  Require that user owns a paper.
  
  Args:
    session: Database session
    paper_id: Paper ID to check
    user_id: User ID to check
    
  Raises:
    AuthorizationError: If user doesn't own the paper
  """
  if not await check_paper_ownership(session, paper_id, user_id):
    raise AuthorizationError(f"User {user_id} does not own paper {paper_id}")


async def require_orb_access(session: AsyncSession, orb_id: str, user_id: str):
  """
  Require that user has access to an orb.
  
  Args:
    session: Database session
    orb_id: Orb ID to check
    user_id: User ID to check
    
  Raises:
    AuthorizationError: If user doesn't have access
  """
  if not await check_orb_access(session, orb_id, user_id):
    raise AuthorizationError(f"User {user_id} does not have access to orb {orb_id}")


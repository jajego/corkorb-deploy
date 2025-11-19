"""Message handlers for WebSocket operations."""

import json
import logging
from typing import Any, Dict, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.orb import OrbResponse
from app.schemas.paper import PaperResponse
from app.schemas.ws import (
  CreateOrbMessage,
  CreatePaperMessage,
  DeleteOrbMessage,
  DeletePaperMessage,
  ErrorMessage,
  GetStateMessage,
  OrbCreatedMessage,
  OrbDeletedMessage,
  PaperCreatedMessage,
  PaperDeletedMessage,
  StateMessage,
  SuccessMessage,
)
from app.services import orb as orb_service, paper as paper_service
from app.utils.authorization import AuthorizationError, require_orb_access, require_paper_ownership

logger = logging.getLogger(__name__)


async def handle_create_orb(
  session: AsyncSession, message: CreateOrbMessage, user_id: str
) -> tuple[OrbCreatedMessage, Dict[str, Any]]:
  """Handle create_orb message."""
  try:
    orb = await orb_service.create_orb(session, message.data)
    await session.commit()
    
    response = OrbCreatedMessage(orb=orb.model_dump(mode='json'))
    broadcast_data = response.model_dump(mode='json')
    return response, broadcast_data
  except Exception as e:
    await session.rollback()
    raise ValueError(f"Failed to create orb: {str(e)}")


async def handle_delete_orb(
  session: AsyncSession, message: DeleteOrbMessage, user_id: str
) -> tuple[OrbDeletedMessage, Dict[str, Any]]:
  """Handle delete_orb message."""
  try:
    await require_orb_access(session, message.orb_id, user_id)
    
    deleted = await orb_service.delete_orb(session, message.orb_id)
    if not deleted:
      await session.rollback()
      raise ValueError(f"Orb {message.orb_id} not found")
    
    await session.commit()
    
    response = OrbDeletedMessage(orb_id=message.orb_id)
    broadcast_data = response.model_dump(mode='json')
    return response, broadcast_data
  except AuthorizationError as e:
    await session.rollback()
    raise ValueError(f"Authorization failed: {str(e)}")
  except ValueError:
    raise
  except Exception as e:
    await session.rollback()
    raise ValueError(f"Failed to delete orb: {str(e)}")


async def handle_create_paper(
  session: AsyncSession, message: CreatePaperMessage, user_id: str, username: Optional[str] = None
) -> tuple[PaperCreatedMessage, Dict[str, Any]]:
  """Handle create_paper message."""
  try:
    await require_orb_access(session, message.orb_id, user_id)
    
    if message.data.user_id != user_id:
      logger.warning(f"User {user_id} attempted to create paper with user_id {message.data.user_id}. Overriding with authenticated user_id.")
      message.data.user_id = user_id
    
    # Use username from message data if provided, otherwise fall back to JWT token username
    if not message.data.username and username:
      message.data.username = username
    
    paper = await paper_service.create_paper(session, message.orb_id, message.data)
    await session.commit()
    
    response = PaperCreatedMessage(orb_id=message.orb_id, paper=paper.model_dump(mode='json'))
    broadcast_data = response.model_dump(mode='json')
    return response, broadcast_data
  except AuthorizationError as e:
    await session.rollback()
    raise ValueError(f"Authorization failed: {str(e)}")
  except ValueError:
    await session.rollback()
    raise
  except Exception as e:
    await session.rollback()
    raise ValueError(f"Failed to create paper: {str(e)}")


async def handle_delete_paper(
  session: AsyncSession, message: DeletePaperMessage, user_id: str
) -> tuple[PaperDeletedMessage, Dict[str, Any]]:
  """Handle delete_paper message."""
  try:
    await require_orb_access(session, message.orb_id, user_id)
    
    deleted = await paper_service.delete_paper(session, message.paper_id)
    if not deleted:
      await session.rollback()
      raise ValueError(f"Paper {message.paper_id} not found")
    
    await session.commit()
    
    response = PaperDeletedMessage(
      orb_id=message.orb_id, 
      paper_id=message.paper_id,
      reason="user_deleted"
    )
    broadcast_data = response.model_dump(mode='json')
    return response, broadcast_data
  except AuthorizationError as e:
    await session.rollback()
    raise ValueError(f"Authorization failed: {str(e)}")
  except ValueError:
    raise
  except Exception as e:
    await session.rollback()
    raise ValueError(f"Failed to delete paper: {str(e)}")


async def handle_get_state(
  session: AsyncSession, message: GetStateMessage, user_id: str, connection_manager
) -> StateMessage:
  """Handle get_state message."""
  try:
    from datetime import datetime, timezone
    from app.utils.authorization import require_orb_access_and_get_orb
    
    orb = await require_orb_access_and_get_orb(session, message.orb_id, user_id)
    
    orb.last_accessed = datetime.now(timezone.utc)
    await session.flush()
    
    papers = await paper_service.get_papers_for_orb(session, message.orb_id)
    papers_data = [paper.model_dump(mode='json') for paper in papers]
    
    # Get connected users count from connection manager
    all_users = connection_manager.get_users_in_orb(message.orb_id)
    connected_count = len(all_users)
    anonymous_count = sum(1 for uid in all_users if uid.startswith('user:anonymous:'))
    # Get usernames for non-anonymous users
    usernames = []
    for user_id in all_users:
      if not user_id.startswith('user:anonymous:'):
        username = connection_manager.get_username_by_user_id(user_id)
        if username:
          usernames.append(username)
    
    await session.commit()
    
    response = StateMessage(
      orb_id=message.orb_id, 
      papers=papers_data,
      connected_users_count=connected_count,
      anonymous_users_count=anonymous_count,
      usernames=usernames
    )
    return response
  except AuthorizationError as e:
    raise ValueError(f"Authorization failed: {str(e)}")
  except Exception as e:
    raise ValueError(f"Failed to get state: {str(e)}")


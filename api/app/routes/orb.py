"""REST API routes for orb operations."""

import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.orb import OrbCreate, OrbResponse
from app.services import orb as orb_service, paper as paper_service
from app.utils.auth import get_current_user_id, get_optional_user_id

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/orbs", response_model=OrbResponse, status_code=status.HTTP_201_CREATED)
async def create_orb(
    data: OrbCreate,
    session: Annotated[AsyncSession, Depends(get_session)],
    user_id: Annotated[str, Depends(get_current_user_id)],
):
    """
    Create a new orb.
    
    Returns the created orb with its passphrase ID.
    """
    logger.info(f"[CREATE_ORB] Starting orb creation for user: {user_id}, shape: {data.shape}")
    
    try:
        logger.info(f"[CREATE_ORB] Calling orb_service.create_orb...")
        orb = await orb_service.create_orb(session, data)
        logger.info(f"[CREATE_ORB] Successfully created orb: {orb.id}")
        return orb
    except ValueError as e:
        logger.error(f"[CREATE_ORB] ValueError: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"[CREATE_ORB] Unexpected error: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create orb: {str(e)}",
        )


@router.get("/orbs/{orb_id}", response_model=OrbResponse)
async def get_orb(
    orb_id: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    include_papers: bool = True,
    user_id: Annotated[Optional[str], Depends(get_optional_user_id)] = None,
):
    """
    Get an orb by ID.
    
    Allows anonymous access for viewing orbs.
    Updates the last_accessed timestamp when the orb is accessed (only for authenticated users).
    Includes papers by default; metadata-only callers can skip the paper payload.
    Returns 404 if the orb doesn't exist.
    """
    # Check if orb exists
    from app.repositories import orb as orb_repo
    orb = await orb_repo.get_orb_by_id(session, orb_id)
    if not orb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orb not found")
    
    # Update last_accessed timestamp only if user is authenticated
    if user_id:
        touched = await orb_service.touch_orb(session, orb_id)
        if not touched:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Orb not found")
    
    papers = (
        await paper_service.get_papers_for_orb(session, orb_id)
        if include_papers
        else None
    )
    
    # Construct response manually (papers is not an attribute on Orb model, it's a relationship)
    return OrbResponse(
        id=orb.id,
        created_at=orb.created_at,
        updated_at=orb.updated_at,
        last_accessed=orb.last_accessed,
        max_papers=orb.max_papers,
        shape=orb.shape,
        papers=papers,
    )


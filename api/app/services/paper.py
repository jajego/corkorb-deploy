import logging
from typing import Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.paper import Paper
from app.repositories import orb as orb_repo, paper as paper_repo
from app.schemas.paper import PaperCreate, PaperData, PaperResponse, PaperUpdate, PinData
from app.schemas.pin import PinCreate

logger = logging.getLogger(__name__)


async def get_paper(session: AsyncSession, paper_id: str) -> Optional[PaperResponse]:
  """Get a paper by ID."""
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    return None

  # Extract pin data from embedded pin_position
  # Handle both formats: {'position': {'x': 0.0, 'y': 0.0, 'z': 0.0}, 'color': '...'} 
  # and {'x': 0.0, 'y': 0.0, 'z': 0.0, 'color': '...'}
  if "position" in paper.pin_position and isinstance(paper.pin_position["position"], dict):
    # Nested format: {'position': {'x': 0.0, 'y': 0.0, 'z': 0.0}, 'color': '...'}
    position = paper.pin_position["position"]
    color = paper.pin_position.get("color", "#ff4d4f")
  else:
    # Flat format: {'x': 0.0, 'y': 0.0, 'z': 0.0, 'color': '...'}
    position = {k: v for k, v in paper.pin_position.items() if k != "color"}
    color = paper.pin_position.get("color", "#ff4d4f")
  pin_data = PinData(position=position, color=color)
  
  paper_dict = {
    "id": paper.id,
    "orb_id": paper.orb_id,
    "user_id": paper.user_id,
    "username": paper.username,
    "source_url": paper.source_url,
    "created_at": paper.created_at,
    "uploaded": paper.uploaded,
    "validated": paper.validated,
    "data": PaperData(**paper.data) if paper.data else None,
    "pin": pin_data,
  }
  return PaperResponse(**paper_dict)


async def get_papers_for_orb(session: AsyncSession, orb_id: str) -> List[PaperResponse]:
  """Get all papers for an orb."""
  papers = await paper_repo.get_papers_by_orb_id(session, orb_id)
  result = []
  for paper in papers:
    # Extract pin data from embedded pin_position
    position = {k: v for k, v in paper.pin_position.items() if k != "color"}
    color = paper.pin_position.get("color", "#ff4d4f")
    pin_data = PinData(position=position, color=color)
    
    paper_dict = {
      "id": paper.id,
      "orb_id": paper.orb_id,
      "user_id": paper.user_id,
      "username": paper.username,
      "source_url": paper.source_url,
      "created_at": paper.created_at,
      "uploaded": paper.uploaded,
      "validated": paper.validated,
      "data": PaperData(**paper.data) if paper.data else None,
      "pin": pin_data,
    }
    result.append(PaperResponse(**paper_dict))
  return result


async def create_paper(session: AsyncSession, orb_id: str, data: PaperCreate) -> PaperResponse:
  """
  Create a new paper for an orb, enforcing max_papers limit.
  
  Uses distributed locking (Redis) for multi-instance deployments, with fallback
  to row-level locking (database) for single-instance deployments.
  """
  from app.utils.distributed_lock import acquire_lock
  from app.db.redis import get_redis
  
  # Try to use Redis distributed lock (for multi-instance)
  redis_client = await get_redis()
  lock_key = f"orb:{orb_id}:paper_creation"
  
  if redis_client:
    # Use Redis distributed lock
    async with acquire_lock(lock_key, timeout=10.0, retry_interval=0.1, max_retries=50):
      orb = await orb_repo.get_orb_by_id(session, orb_id, lock=False)
      if not orb:
        raise ValueError(f"Orb {orb_id} not found")
      
      # Check paper count and evict oldest if needed
      count = await orb_repo.count_papers_for_orb(session, orb_id)
      if count >= orb.max_papers:
        oldest = await paper_repo.get_oldest_paper_for_orb(session, orb_id)
        if oldest:
          # Delete from S3 if paper was uploaded
          if oldest.uploaded:
            import re
            from urllib.parse import urlparse
            from app.services import s3 as s3_service
            
            # Extract file extension from source_url
            file_extension = "jpg"  # default
            if oldest.source_url:
              if oldest.source_url.startswith("data:"):
                match = re.search(r"data:image/(\w+);", oldest.source_url)
                if match:
                  ext = match.group(1).lower()
                  ext_map = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}
                  file_extension = ext_map.get(ext, "jpg")
              else:
                parsed = urlparse(oldest.source_url)
                path = parsed.path
                if "." in path:
                  file_extension = path.split(".")[-1].lower()
            
            # Delete from S3
            try:
              await s3_service.delete_image(oldest.orb_id, oldest.id, file_extension)
              logger.info(f"Evicted paper {oldest.id}: deleted image from S3")
            except Exception as e:
              logger.warning(f"Failed to delete evicted paper image from S3: {e}")
              # Continue with database deletion even if S3 deletion fails
          
          # Delete from database
          await paper_repo.delete_paper(session, oldest.id)
          logger.info(f"Evicted oldest paper {oldest.id} to make room for new paper")
  else:
    # Fallback to row-level locking (single-instance)
    orb = await orb_repo.get_orb_by_id(session, orb_id, lock=True)
    if not orb:
      raise ValueError(f"Orb {orb_id} not found")
    
    # Check paper count and evict oldest if needed
    # This is safe from race conditions due to the row lock
    count = await orb_repo.count_papers_for_orb(session, orb_id)
    if count >= orb.max_papers:
      oldest = await paper_repo.get_oldest_paper_for_orb(session, orb_id)
      if oldest:
        # Delete from S3 if paper was uploaded
        if oldest.uploaded:
          import re
          from urllib.parse import urlparse
          from app.services import s3 as s3_service
          
          # Extract file extension from source_url
          file_extension = "jpg"  # default
          if oldest.source_url:
            if oldest.source_url.startswith("data:"):
              match = re.search(r"data:image/(\w+);", oldest.source_url)
              if match:
                ext = match.group(1).lower()
                ext_map = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}
                file_extension = ext_map.get(ext, "jpg")
            else:
              parsed = urlparse(oldest.source_url)
              path = parsed.path
              if "." in path:
                file_extension = path.split(".")[-1].lower()
          
          # Delete from S3
          try:
            await s3_service.delete_image(oldest.orb_id, oldest.id, file_extension)
            logger.info(f"Evicted paper {oldest.id}: deleted image from S3")
          except Exception as e:
            logger.warning(f"Failed to delete evicted paper image from S3: {e}")
            # Continue with database deletion even if S3 deletion fails
        
        # Delete from database
        await paper_repo.delete_paper(session, oldest.id)
        logger.info(f"Evicted oldest paper {oldest.id} to make room for new paper")

  # Prepare data dict for storage
  data_dict: Optional[Dict] = None
  if data.data:
    data_dict = data.data.model_dump(exclude_none=True)

  # Prepare pin_position (required)
  if not data.pin:
    raise ValueError("Pin data is required to create a paper")
  pin_position = {**data.pin.position, "color": data.pin.color}

  # Create paper with embedded pin
  paper = await paper_repo.create_paper(
    session,
    orb_id=orb_id,
    user_id=data.user_id,
    username=data.username,
    source_url=data.source_url,
    pin_position=pin_position,
    data=data_dict,
    uploaded=False,
    validated=False,
  )

  await session.commit()
  await session.refresh(paper)

  # Extract pin data for response
  position = {k: v for k, v in paper.pin_position.items() if k != "color"}
  color = paper.pin_position.get("color", "#ff4d4f")
  pin_data = PinData(position=position, color=color)
  
  # Convert data dict to PaperData if it exists and is a dict
  paper_data_obj = None
  if paper.data:
    try:
      if isinstance(paper.data, dict):
        paper_data_obj = PaperData(**paper.data)
      else:
        paper_data_obj = paper.data
    except Exception:
      # If PaperData validation fails, just pass the dict as-is
      paper_data_obj = paper.data if isinstance(paper.data, dict) else None
  
  paper_dict = {
    "id": paper.id,
    "orb_id": paper.orb_id,
    "user_id": paper.user_id,
    "source_url": paper.source_url,
    "created_at": paper.created_at,
    "uploaded": paper.uploaded,
    "validated": paper.validated,
    "data": paper_data_obj,
    "pin": pin_data,
  }
  return PaperResponse(**paper_dict)


async def delete_paper(session: AsyncSession, paper_id: str) -> bool:
  """
  Delete a paper. Returns True if deleted, False if not found.
  
  Also deletes the associated image from S3 if it was uploaded.
  """
  # Get paper first to extract orb_id and file info
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    return False
  
  # Delete from S3 if paper was uploaded
  if paper.uploaded:
    # Extract file extension from source_url (CDN URL or blob data URL)
    import re
    from urllib.parse import urlparse
    
    # Try to extract extension from URL
    file_extension = "jpg"  # default
    if paper.source_url:
      # Check if it's a CDN URL or blob data URL
      if paper.source_url.startswith("data:"):
        # Blob data URL: data:image/jpeg;base64,...
        match = re.search(r"data:image/(\w+);", paper.source_url)
        if match:
          ext = match.group(1).lower()
          # Map MIME types to extensions
          ext_map = {"jpeg": "jpg", "jpg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}
          file_extension = ext_map.get(ext, "jpg")
      else:
        # CDN URL: https://cdn.example.com/orb_id/paper_id.jpg
        parsed = urlparse(paper.source_url)
        path = parsed.path
        if "." in path:
          file_extension = path.split(".")[-1].lower()
    
    # Delete from S3
    from app.services import s3 as s3_service
    try:
      await s3_service.delete_image(paper.orb_id, paper_id, file_extension)
      logger.info(f"Deleted image from S3 for paper {paper_id}")
    except Exception as e:
      logger.warning(f"Failed to delete image from S3 for paper {paper_id}: {e}")
      # Continue with database deletion even if S3 deletion fails
  
  # Delete from database
  deleted = await paper_repo.delete_paper(session, paper_id)
  if deleted:
    await session.commit()
  return deleted


async def update_paper(session: AsyncSession, paper_id: str, data: PaperUpdate) -> Optional[PaperResponse]:
  """Update a paper's metadata."""
  paper = await paper_repo.get_paper_by_id(session, paper_id)
  if not paper:
    return None

  if data.source_url is not None:
    paper.source_url = data.source_url
  if data.uploaded is not None:
    paper.uploaded = data.uploaded
  if data.validated is not None:
    paper.validated = data.validated
  if data.data is not None:
    paper.data = data.data.model_dump(exclude_none=True)

  # Handle pin updates (replace existing pin if provided)
  if data.pin is not None:
    paper.pin_position = {**data.pin.position, "color": data.pin.color}

  await session.flush()
  await session.refresh(paper)

  # Extract pin data for response
  position = {k: v for k, v in paper.pin_position.items() if k != "color"}
  color = paper.pin_position.get("color", "#ff4d4f")
  pin_data = PinData(position=position, color=color)
  
  paper_dict = {
    "id": paper.id,
    "orb_id": paper.orb_id,
    "user_id": paper.user_id,
    "username": paper.username,
    "source_url": paper.source_url,
    "created_at": paper.created_at,
    "uploaded": paper.uploaded,
    "validated": paper.validated,
    "data": PaperData(**paper.data) if paper.data else None,
    "pin": pin_data,
  }
  await session.commit()
  return PaperResponse(**paper_dict)


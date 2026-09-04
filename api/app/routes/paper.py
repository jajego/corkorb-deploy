"""REST API routes for paper operations."""

import json
import logging
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.schemas.paper import PaperCreate, PaperData, PaperResponse
from app.schemas.pin import PinCreate
from app.schemas.ws import PaperCreatedMessage
from app.services import paper as paper_service, s3 as s3_service
from app.utils.auth import get_current_user_info
from app.utils.authorization import require_orb_access
from app.ws.orb import connection_manager

logger = logging.getLogger(__name__)
router = APIRouter()

# Maximum file size: 10MB (increased to support iPhone photos and other high-quality images)
# Client-side compression typically reduces file size, but some images may compress poorly
MAX_FILE_SIZE = 10 * 1024 * 1024

# Allowed image MIME types
ALLOWED_MIME_TYPES = {
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
}

def validate_image_file(file: UploadFile) -> tuple[str, str]:
  """
  Validate uploaded image file.
  
  Returns:
    tuple[str, str]: (file_extension, content_type)
    
  Raises:
    HTTPException: If file is invalid
  """
  # Check file size (if available on UploadFile - may not be reliable for streaming)
  # We'll also check after reading to be safe
  if hasattr(file, "size") and file.size and file.size > MAX_FILE_SIZE:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=f"File size ({file.size / 1024 / 1024:.2f}MB) exceeds maximum of {MAX_FILE_SIZE / 1024 / 1024}MB"
    )
  
  # Get file extension from filename (more reliable than content_type)
  filename = file.filename or ""
  file_extension = ""
  if "." in filename:
    file_extension = filename.rsplit(".", 1)[-1].lower()
  
  # Map extensions to content types
  extension_to_mime = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
  }
  
  # Check if extension is valid
  if not file_extension or file_extension not in extension_to_mime:
    raise HTTPException(
      status_code=status.HTTP_400_BAD_REQUEST,
      detail=f"Invalid file type. Allowed types: JPEG, PNG, GIF, WebP"
    )
  
  # Use content_type from file if available, otherwise infer from extension
  content_type = file.content_type
  if not content_type or content_type not in ALLOWED_MIME_TYPES:
    content_type = extension_to_mime.get(file_extension, "image/jpeg")
  
  return file_extension, content_type


@router.post(
  "/orbs/{orb_id}/papers",
  response_model=PaperResponse,
  status_code=status.HTTP_201_CREATED
)
async def create_paper_with_image(
  orb_id: str,
  file: Annotated[UploadFile, File(...)],
  pin: Annotated[str, Form(...)],
  data: Annotated[Optional[str], Form()] = None,
  username: Annotated[Optional[str], Form()] = None,
  session: Annotated[AsyncSession, Depends(get_session)] = None,
  user_info: Annotated[dict, Depends(get_current_user_info)] = None,
):
  """
  Create a new paper with image upload.
  
  Flow:
  1. Validate file (type, size)
  2. Read file content
  3. Generate paper ID
  4. Upload to S3 synchronously (gets CDN URL immediately)
  5. Create Paper record with CDN URL (uploaded=True, validated=False)
  6. Trigger async Rekognition check (fire-and-forget)
  7. Broadcast paper_created WebSocket message with CDN URL
  8. Return Paper with CDN URL
  
  Performance optimizations:
  - No blob URLs in responses (reduces message size from ~2.67MB to ~100 bytes)
  - Frontend uploader uses local file for instant feedback
  - Other users receive CDN URL via WebSocket (already uploaded, fast to load)
  - CDN URL sent immediately after S3 upload (no waiting for Rekognition)
  """
  try:
    file_extension, content_type = validate_image_file(file)
    file_content = await file.read()
    
    # Check file size again (after reading - this is the definitive check)
    actual_size = len(file_content)
    if actual_size > MAX_FILE_SIZE:
      raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"File size ({actual_size / 1024 / 1024:.2f}MB) exceeds maximum of {MAX_FILE_SIZE / 1024 / 1024}MB. Please use a smaller image or compress it more."
      )
    
    # 3. Extract user info
    user_id = user_info["user_id"]
    # Prefer username from form data (frontend has direct access to Clerk user), 
    # fall back to JWT token username if available
    paper_username = username or user_info.get("username")
    
    await require_orb_access(session, orb_id, user_id)
    
    # 5. Parse pin and data from JSON strings
    try:
      pin_data = PinCreate(**json.loads(pin))
    except (json.JSONDecodeError, ValueError) as e:
      raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Invalid pin data: {str(e)}"
      )
    
    paper_data: Optional[PaperData] = None
    if data:
      try:
        paper_data = PaperData(**json.loads(data))
      except (json.JSONDecodeError, ValueError) as e:
        raise HTTPException(
          status_code=status.HTTP_400_BAD_REQUEST,
          detail=f"Invalid paper data: {str(e)}"
        )
    
    # 6. Generate paper ID first (needed for S3 key)
    from uuid import uuid4
    paper_id = uuid4().hex
    
    # 7. Upload to S3 before creating the database record.
    try:
      cdn_url = await s3_service.upload_image(
        file_content=file_content,
        orb_id=orb_id,
        paper_id=paper_id,  # Use generated ID
        file_extension=file_extension,
        content_type=content_type,
      )
    except ValueError as e:
      logger.error(f"S3 upload failed: {e}")
      raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Failed to upload image to S3: {str(e)}"
      )
    
    # 8. Create Paper record with CDN URL directly.
    # Note: Frontend uploader will use their local file for instant feedback
    # Other users will receive CDN URL via WebSocket (already uploaded to S3)
    paper = await paper_service.create_paper(
      session,
      orb_id,
      PaperCreate(
        user_id=user_id,
        username=paper_username,
        source_url=cdn_url,
        pin=pin_data,
        data=paper_data,
      ),
      paper_id=paper_id,
      uploaded=True,
    )
    
    logger.info(f"Created paper {paper.id} for orb {orb_id} with CDN URL (username: {paper_username})")
    
    # 9. Trigger async Rekognition check (fire-and-forget, no Redis needed)
    import asyncio
    from app.workers.rekognition_async import check_image_safety_async

    asyncio.create_task(
      check_image_safety_async(
        paper_id=paper.id,
        orb_id=orb_id,
        file_extension=file_extension,
      )
    )
    logger.info(f"Started Rekognition check for paper {paper.id} (background task)")
    
    # 8. Broadcast paper_created WebSocket message with CDN URL
    # CDN URL is already available (uploaded to S3 synchronously)
    # Other users will load from CDN (fast, cached, optimized)
    paper_dict = paper.model_dump(mode='json')
    # Use CDN URL (already uploaded to S3, no need for blob URL)
    # Frontend uploader uses their local file for instant feedback

    message = PaperCreatedMessage(orb_id=orb_id, paper=paper_dict)
    await connection_manager.broadcast_to_orb(orb_id, message.model_dump(mode='json'))

    logger.info(f"Broadcasted paper_created message for paper {paper.id} to orb {orb_id} with CDN URL")
    
    return paper
    
  except HTTPException:
    raise
  except ValueError as e:
    logger.error(f"ValueError creating paper: {e}")
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
  except Exception as e:
    logger.error(f"Unexpected error creating paper: {e}", exc_info=True)
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail=f"Failed to create paper: {str(e)}"
    )


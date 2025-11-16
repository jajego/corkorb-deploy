"""Rekognition worker tasks for NSFW/CSAM detection."""

import logging
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from app.config import get_settings
from app.db.session import async_session_factory
from app.schemas.ws import PaperDeletedMessage
from app.services import paper as paper_service, s3 as s3_service
from app.ws.connection_manager import ConnectionManager
from app.ws.orb import connection_manager

from .celery_app import celery_app

logger = logging.getLogger(__name__)

# Unsafe labels that trigger deletion
UNSAFE_LABELS = {
  "Explicit Nudity",
  "Violence",
  "Graphic Violence",
  "Visually Disturbing",
  "Rude Gestures",
}

# CSAM-specific labels (if available)
CSAM_LABELS = {
  "Suggestive",
  # Note: AWS Rekognition doesn't have direct CSAM detection in standard API
  # For production CSAM detection, you may need AWS Rekognition Custom Labels
  # or specialized services. This is a placeholder.
}


def get_rekognition_client():
  """
  Get or create Rekognition client.
  
  Uses the S3 bucket's region (Rekognition must be in same region as S3).
  """
  settings = get_settings()
  
  if not settings.aws_access_key_id or not settings.aws_secret_access_key:
    raise ValueError("AWS credentials not configured")
  
  # Get S3 bucket region (Rekognition must be in same region)
  s3_client = s3_service.get_s3_client()
  try:
    bucket_location = s3_client.get_bucket_location(Bucket=settings.aws_s3_bucket_name)
    # us-east-1 returns None, other regions return the region name
    rekognition_region = bucket_location.get('LocationConstraint') or 'us-east-1'
  except Exception as e:
    logger.warning(f"Could not determine S3 bucket region: {e}. Using configured region: {settings.aws_region}")
    rekognition_region = settings.aws_region
  
  return boto3.client(
    "rekognition",
    aws_access_key_id=settings.aws_access_key_id,
    aws_secret_access_key=settings.aws_secret_access_key,
    region_name=rekognition_region,
  )


@celery_app.task(name="check_image_safety", bind=True, max_retries=3)
def check_image_safety(
  self,
  paper_id: str,
  orb_id: str,
  file_extension: str,
):
  """
  Check image for NSFW/CSAM content using AWS Rekognition.
  
  Args:
    paper_id: Paper ID
    orb_id: Orb ID
    file_extension: File extension (e.g., 'jpg', 'png')
    
  Returns:
    dict: Result with 'safe' boolean and 'labels' list
  """
  settings = get_settings()
  
  try:
    # Get S3 URI for Rekognition
    s3_uri = s3_service.get_s3_uri_for_rekognition(orb_id, paper_id, file_extension)
    
    logger.info(f"Checking image safety for paper {paper_id} using Rekognition")
    
    # Call Rekognition API
    rekognition = get_rekognition_client()
    response = rekognition.detect_moderation_labels(
      Image=s3_uri,
      MinConfidence=settings.rekognition_min_confidence,
    )
    
    moderation_labels = response.get("ModerationLabels", [])
    
    # Check for unsafe labels
    unsafe_found = []
    for label in moderation_labels:
      label_name = label.get("Name", "")
      confidence = label.get("Confidence", 0)
      
      if label_name in UNSAFE_LABELS and confidence >= settings.rekognition_min_confidence:
        unsafe_found.append({
          "name": label_name,
          "confidence": confidence,
        })
    
    is_unsafe = len(unsafe_found) > 0
    
    if is_unsafe:
      logger.warning(
        f"Unsafe content detected in paper {paper_id}: {unsafe_found}"
      )
      
      # Delete from S3 and database
      delete_unsafe_paper(paper_id, orb_id, file_extension, unsafe_found)
      
      return {
        "safe": False,
        "labels": unsafe_found,
        "deleted": True,
      }
    else:
      logger.info(f"Image {paper_id} passed safety check")
      
      # Mark as validated
      mark_paper_validated(paper_id)
      
      return {
        "safe": True,
        "labels": [],
        "deleted": False,
      }
      
  except ClientError as e:
    error_code = e.response["Error"]["Code"]
    error_message = e.response["Error"]["Message"]
    logger.error(
      f"Rekognition API error for paper {paper_id}: {error_code} - {error_message}"
    )
    
    # Retry on transient errors
    if error_code in ["ThrottlingException", "ServiceUnavailableException"]:
      logger.warning(f"Retrying Rekognition check for paper {paper_id} (attempt {self.request.retries + 1})")
      raise self.retry(exc=e, countdown=60 * (self.request.retries + 1))  # Exponential backoff
    
    # Don't retry on permanent errors - mark for manual review
    logger.error(f"Permanent Rekognition error for paper {paper_id}, marking for manual review")
    return {
      "safe": None,  # Unknown - needs manual review
      "error": error_message,
      "deleted": False,
    }
    
  except Exception as e:
    logger.error(f"Unexpected error checking image safety for paper {paper_id}: {e}", exc_info=True)
    
    # Retry on unexpected errors (might be transient)
    if self.request.retries < self.max_retries:
      logger.warning(f"Retrying Rekognition check for paper {paper_id} (attempt {self.request.retries + 1})")
      raise self.retry(exc=e, countdown=60 * (self.request.retries + 1))
    
    # Max retries reached - mark for manual review
    logger.error(f"Max retries reached for paper {paper_id}, marking for manual review")
    return {
      "safe": None,
      "error": str(e),
      "deleted": False,
    }


def delete_unsafe_paper(
  paper_id: str,
  orb_id: str,
  file_extension: str,
  unsafe_labels: list,
):
  """
  Delete unsafe paper from S3 and database, then broadcast deletion.
  
  This runs synchronously within the Celery task.
  """
  import asyncio
  
  async def _delete():
    async with async_session_factory() as session:
      try:
        # 1. Delete from S3
        deleted = await s3_service.delete_image(orb_id, paper_id, file_extension)
        if deleted:
          logger.info(f"Deleted unsafe image from S3: {orb_id}/{paper_id}.{file_extension}")
        else:
          logger.warning(f"Image not found in S3 (may have been deleted already): {orb_id}/{paper_id}.{file_extension}")
        
        # 2. Delete from database
        deleted_db = await paper_service.delete_paper(session, paper_id)
        if deleted_db:
          logger.info(f"Deleted unsafe paper {paper_id} from database")
        else:
          logger.warning(f"Paper {paper_id} not found in database (may have been deleted already)")
        
        # 3. Broadcast paper_deleted message
        message = PaperDeletedMessage(orb_id=orb_id, paper_id=paper_id)
        await connection_manager.broadcast_to_orb(
          orb_id,
          message.model_dump(mode="json")
        )
        logger.info(f"Broadcasted paper_deleted message for unsafe paper {paper_id}")
        
      except Exception as e:
        logger.error(f"Error deleting unsafe paper {paper_id}: {e}", exc_info=True)
        # Don't raise - we've already logged the error
  
  # Run async function in sync context
  try:
    loop = asyncio.get_event_loop()
  except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
  
  loop.run_until_complete(_delete())


def mark_paper_validated(paper_id: str):
  """
  Mark paper as validated (safe).
  
  This runs synchronously within the Celery task.
  """
  import asyncio
  
  async def _validate():
    from app.schemas.paper import PaperUpdate
    
    async with async_session_factory() as session:
      try:
        paper_update = PaperUpdate(validated=True)
        await paper_service.update_paper(session, paper_id, paper_update)
        logger.info(f"Marked paper {paper_id} as validated")
      except Exception as e:
        logger.error(f"Error marking paper {paper_id} as validated: {e}", exc_info=True)
        # Don't raise - validation is not critical
  
  # Run async function in sync context
  try:
    loop = asyncio.get_event_loop()
  except RuntimeError:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
  
  loop.run_until_complete(_validate())


"""Async Rekognition tasks (no Celery/Redis required)."""

import asyncio
import io
import logging
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from PIL import Image

from app.config import get_settings
from app.db.session import async_session_factory
from app.schemas.paper import PaperUpdate
from app.schemas.ws import PaperDeletedMessage
from app.services import paper as paper_service, s3 as s3_service
from app.ws.orb import connection_manager

logger = logging.getLogger(__name__)

# Unsafe labels that trigger deletion
UNSAFE_LABELS = {
  "Explicit Nudity",
  "Violence",
  "Graphic Violence",
  "Visually Disturbing",
  "Rude Gestures",
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


async def check_image_safety_async(
  paper_id: str,
  orb_id: str,
  file_extension: str,
  max_retries: int = 3,
):
  """
  Check image for NSFW/CSAM content using AWS Rekognition (async, no Celery).
  
  Args:
    paper_id: Paper ID
    orb_id: Orb ID
    file_extension: File extension (e.g., 'jpg', 'png')
    max_retries: Maximum number of retries on transient errors
  """
  settings = get_settings()
  
  for attempt in range(max_retries):
    try:
      # Get S3 URI for Rekognition
      s3_uri = s3_service.get_s3_uri_for_rekognition(orb_id, paper_id, file_extension)
      
      logger.info(f"Checking image safety for paper {paper_id} using Rekognition (attempt {attempt + 1})")
      
      # Rekognition doesn't support WebP - convert to PNG if needed
      rekognition_image = s3_uri
      if file_extension.lower() == 'webp':
        logger.info(f"Converting WebP to PNG for Rekognition (paper {paper_id})")
        
        # Download WebP from S3
        s3_client = s3_service.get_s3_client()
        def _download_webp():
          response = s3_client.get_object(
            Bucket=settings.aws_s3_bucket_name,
            Key=s3_service.get_s3_key(orb_id, paper_id, file_extension)
          )
          return response['Body'].read()
        
        webp_bytes = await asyncio.to_thread(_download_webp)
        
        # Convert WebP to PNG in memory
        def _convert_webp_to_png():
          img = Image.open(io.BytesIO(webp_bytes))
          png_buffer = io.BytesIO()
          img.save(png_buffer, format='PNG')
          return png_buffer.getvalue()
        
        png_bytes = await asyncio.to_thread(_convert_webp_to_png)
        
        # Use bytes API for Rekognition (WebP converted to PNG)
        rekognition_image = {'Bytes': png_bytes}
      else:
        # Use S3 URI for supported formats (JPEG, PNG, GIF)
        rekognition_image = s3_uri
      
      # Call Rekognition API (run in thread pool since boto3 is sync)
      def _detect_moderation():
        rekognition = get_rekognition_client()
        return rekognition.detect_moderation_labels(
          Image=rekognition_image,
          MinConfidence=settings.rekognition_min_confidence,
        )
      
      response = await asyncio.to_thread(_detect_moderation)
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
        await delete_unsafe_paper(paper_id, orb_id, file_extension, unsafe_found)
        return
      else:
        logger.info(f"Image {paper_id} passed safety check")
        
        # Mark as validated
        await mark_paper_validated(paper_id)
        return
        
    except ClientError as e:
      error_code = e.response["Error"]["Code"]
      error_message = e.response["Error"]["Message"]
      
      if error_code in ["ThrottlingException", "ServiceUnavailableException"]:
        # Retry on transient errors
        if attempt < max_retries - 1:
          wait_time = 60 * (attempt + 1)  # Exponential backoff
          logger.warning(
            f"Rekognition transient error for paper {paper_id}: {error_code}. "
            f"Retrying in {wait_time} seconds (attempt {attempt + 2}/{max_retries})"
          )
          await asyncio.sleep(wait_time)
          continue
        else:
          logger.error(
            f"Max retries reached for paper {paper_id}. "
            f"Last error: {error_code} - {error_message}"
          )
          # Mark for manual review (don't delete, but log error)
          return
      else:
        # Permanent error - don't retry
        logger.error(
          f"Permanent Rekognition error for paper {paper_id}: {error_code} - {error_message}"
        )
        # Mark for manual review
        return
        
    except Exception as e:
      logger.error(
        f"Unexpected error checking image safety for paper {paper_id}: {e}",
        exc_info=True
      )
      
      # Retry on unexpected errors (might be transient)
      if attempt < max_retries - 1:
        wait_time = 60 * (attempt + 1)
        logger.warning(
          f"Retrying Rekognition check for paper {paper_id} in {wait_time} seconds "
          f"(attempt {attempt + 2}/{max_retries})"
        )
        await asyncio.sleep(wait_time)
        continue
      else:
        logger.error(f"Max retries reached for paper {paper_id}, marking for manual review")
        return


async def delete_unsafe_paper(
  paper_id: str,
  orb_id: str,
  file_extension: str,
  unsafe_labels: list,
):
  """Delete unsafe paper from S3 and database, then broadcast deletion."""
  try:
    # 1. Delete from S3
    deleted = await s3_service.delete_image(orb_id, paper_id, file_extension)
    if deleted:
      logger.info(f"Deleted unsafe image from S3: {orb_id}/{paper_id}.{file_extension}")
    else:
      logger.warning(
        f"Image not found in S3 (may have been deleted already): "
        f"{orb_id}/{paper_id}.{file_extension}"
      )
    
    # 2. Delete from database
    async with async_session_factory() as session:
      deleted_db = await paper_service.delete_paper(session, paper_id)
      if deleted_db:
        logger.info(f"Deleted unsafe paper {paper_id} from database")
      else:
        logger.warning(
          f"Paper {paper_id} not found in database (may have been deleted already)"
        )
      
      # 3. Broadcast paper_deleted message with NSFW reason
      message = PaperDeletedMessage(
        orb_id=orb_id, 
        paper_id=paper_id,
        reason="nsfw_violation"
      )
      await connection_manager.broadcast_to_orb(
        orb_id,
        message.model_dump(mode="json")
      )
      logger.info(f"Broadcasted paper_deleted message for unsafe paper {paper_id} (reason: nsfw_violation)")
      
  except Exception as e:
    logger.error(f"Error deleting unsafe paper {paper_id}: {e}", exc_info=True)
    # Don't raise - we've already logged the error


async def mark_paper_validated(paper_id: str):
  """Mark paper as validated (safe)."""
  try:
    async with async_session_factory() as session:
      paper_update = PaperUpdate(validated=True)
      await paper_service.update_paper(session, paper_id, paper_update)
      logger.info(f"Marked paper {paper_id} as validated")
  except Exception as e:
    logger.error(f"Error marking paper {paper_id} as validated: {e}", exc_info=True)
    # Don't raise - validation is not critical


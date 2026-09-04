"""S3 service for uploading, deleting, and managing images in AWS S3."""

import asyncio
import shutil
from pathlib import Path
from typing import Optional
from urllib.parse import urljoin

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

from app.config import get_settings
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Cached S3 client (similar to Redis pattern)
_s3_client: Optional[boto3.client] = None
LOCAL_UPLOAD_DIR = Path(__file__).resolve().parents[2] / ".local_uploads"


def get_s3_client() -> boto3.client:
  """
  Get or create a cached S3 client.
  
  Returns:
    boto3.client: Configured S3 client
    
  Raises:
    ValueError: If AWS credentials are not configured
  """
  global _s3_client
  
  if _s3_client is None:
    settings = get_settings()
    
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
      raise ValueError("AWS credentials not configured. Set APP_AWS_ACCESS_KEY_ID and APP_AWS_SECRET_ACCESS_KEY")
    
    if not settings.aws_s3_bucket_name:
      raise ValueError("S3 bucket name not configured. Set APP_AWS_S3_BUCKET_NAME")
    
    try:
      _s3_client = boto3.client(
        's3',
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        region_name=settings.aws_region
      )
      logger.info("S3 client initialized successfully")
    except NoCredentialsError:
      raise ValueError("AWS credentials not found or invalid")
    except Exception as e:
      logger.error(f"Failed to initialize S3 client: {e}")
      raise
  
  return _s3_client


def get_s3_key(orb_id: str, paper_id: str, file_extension: str) -> str:
  """
  Construct S3 key for a paper image.
  
  Args:
    orb_id: The orb ID
    paper_id: The paper ID
    file_extension: File extension (e.g., 'jpg', 'png', 'gif')
    
  Returns:
    str: S3 key (e.g., 'cosmic-starry-orb/abc123def456.jpg')
  """
  # Remove leading dot from extension if present
  ext = file_extension.lstrip('.')
  return f"{orb_id}/{paper_id}.{ext}"


def get_cdn_url(s3_key: str) -> str:
  """
  Convert S3 key to CDN URL.
  
  Args:
    s3_key: S3 key (e.g., 'cosmic-starry-orb/abc123def456.jpg')
    
  Returns:
    str: CDN URL (e.g., 'https://dbchcb0zppb90.cloudfront.net/cosmic-starry-orb/abc123def456.jpg')
  """
  settings = get_settings()
  
  if not settings.cdn_base_url:
    raise ValueError("CDN base URL not configured. Set APP_CDN_BASE_URL")
  
  # Ensure CDN URL doesn't have trailing slash
  base_url = settings.cdn_base_url.rstrip('/')
  
  # Join base URL with S3 key
  return urljoin(base_url + '/', s3_key)


async def upload_image(
  file_content: bytes,
  orb_id: str,
  paper_id: str,
  file_extension: str,
  content_type: Optional[str] = None
) -> str:
  """
  Upload an image to S3 and return the CDN URL.
  
  Args:
    file_content: Image file content as bytes
    orb_id: The orb ID
    paper_id: The paper ID
    file_extension: File extension (e.g., 'jpg', 'png', 'gif')
    content_type: Optional MIME type (e.g., 'image/jpeg'). Auto-detected if not provided.
    
  Returns:
    str: CDN URL for the uploaded image
    
  Raises:
    ValueError: If upload fails
  """
  settings = get_settings()
  s3_key = get_s3_key(orb_id, paper_id, file_extension)

  if settings.local_file_storage:
    destination = LOCAL_UPLOAD_DIR / s3_key
    await asyncio.to_thread(destination.parent.mkdir, parents=True, exist_ok=True)
    await asyncio.to_thread(destination.write_bytes, file_content)
    return f"http://127.0.0.1:{settings.port}/local-images/{s3_key}"

  s3_client = get_s3_client()
  
  # Auto-detect content type if not provided
  if not content_type:
    content_type_map = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
    }
    ext = file_extension.lstrip('.').lower()
    content_type = content_type_map.get(ext, 'application/octet-stream')
  
  def _upload():
    """Synchronous upload function to run in thread pool."""
    # Note: ACL is not used if bucket has ACLs disabled (modern S3 buckets)
    # Public access should be configured via bucket policy instead
    s3_client.put_object(
      Bucket=settings.aws_s3_bucket_name,
      Key=s3_key,
      Body=file_content,
      ContentType=content_type,
    )
  
  try:
    # Run blocking S3 operation in thread pool
    await asyncio.to_thread(_upload)
    
    logger.info(f"Uploaded image to S3: {s3_key}")
    
    # Return CDN URL
    cdn_url = get_cdn_url(s3_key)
    return cdn_url
    
  except ClientError as e:
    error_code = e.response['Error']['Code']
    error_message = e.response['Error']['Message']
    logger.error(f"S3 upload failed: {error_code} - {error_message}")
    raise ValueError(f"Failed to upload image to S3: {error_message}")
  except Exception as e:
    logger.error(f"Unexpected error during S3 upload: {e}")
    raise ValueError(f"Failed to upload image: {str(e)}")


async def delete_image(orb_id: str, paper_id: str, file_extension: str) -> bool:
  """
  Delete an image from S3.
  
  Args:
    orb_id: The orb ID
    paper_id: The paper ID
    file_extension: File extension (e.g., 'jpg', 'png', 'gif')
    
  Returns:
    bool: True if deleted, False if not found
    
  Note:
    This is idempotent - safe to call multiple times.
  """
  settings = get_settings()
  s3_key = get_s3_key(orb_id, paper_id, file_extension)

  if settings.local_file_storage:
    local_path = LOCAL_UPLOAD_DIR / s3_key
    existed = local_path.exists()
    await asyncio.to_thread(local_path.unlink, missing_ok=True)
    return existed

  s3_client = get_s3_client()
  
  def _delete():
    """Synchronous delete function to run in thread pool."""
    s3_client.delete_object(
      Bucket=settings.aws_s3_bucket_name,
      Key=s3_key
    )
  
  try:
    # Run blocking S3 operation in thread pool
    await asyncio.to_thread(_delete)
    logger.info(f"Deleted image from S3: {s3_key}")
    return True
    
  except ClientError as e:
    error_code = e.response['Error']['Code']
    if error_code == 'NoSuchKey':
      logger.warning(f"Image not found in S3: {s3_key}")
      return False
    else:
      error_message = e.response['Error']['Message']
      logger.error(f"S3 deletion failed: {error_code} - {error_message}")
      # Don't raise - deletion failures shouldn't break the flow
      return False
  except Exception as e:
    logger.error(f"Unexpected error during S3 deletion: {e}")
    # Don't raise - deletion failures shouldn't break the flow
    return False


async def delete_all_orb_images(orb_id: str) -> int:
  """
  Delete all images for an orb from S3.
  
  Args:
    orb_id: The orb ID
    
  Returns:
    int: Number of images deleted
  """
  settings = get_settings()
  prefix = f"{orb_id}/"
  deleted_count = 0

  if settings.local_file_storage:
    orb_directory = LOCAL_UPLOAD_DIR / orb_id
    if not orb_directory.exists():
      return 0
    deleted_count = sum(1 for path in orb_directory.iterdir() if path.is_file())
    await asyncio.to_thread(shutil.rmtree, orb_directory)
    return deleted_count

  s3_client = get_s3_client()
  
  def _list_and_delete():
    """Synchronous list and delete function to run in thread pool."""
    # List all objects with the orb prefix
    paginator = s3_client.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=settings.aws_s3_bucket_name, Prefix=prefix)
    
    # Collect all keys to delete
    keys_to_delete = []
    for page in pages:
      if 'Contents' in page:
        for obj in page['Contents']:
          keys_to_delete.append({'Key': obj['Key']})
    
    if not keys_to_delete:
      logger.info(f"No images found for orb: {orb_id}")
      return 0
    
    # Delete in batches (S3 allows up to 1000 objects per delete request)
    batch_size = 1000
    count = 0
    for i in range(0, len(keys_to_delete), batch_size):
      batch = keys_to_delete[i:i + batch_size]
      response = s3_client.delete_objects(
        Bucket=settings.aws_s3_bucket_name,
        Delete={'Objects': batch, 'Quiet': True}
      )
      
      # Count successful deletions
      if 'Deleted' in response:
        count += len(response['Deleted'])
      
      # Log errors but continue
      if 'Errors' in response:
        for error in response['Errors']:
          logger.warning(f"Failed to delete {error['Key']}: {error['Message']}")
    
    return count
  
  try:
    # Run blocking S3 operations in thread pool
    deleted_count = await asyncio.to_thread(_list_and_delete)
    logger.info(f"Deleted {deleted_count} images for orb: {orb_id}")
    return deleted_count
    
  except ClientError as e:
    error_code = e.response['Error']['Code']
    error_message = e.response['Error']['Message']
    logger.error(f"S3 batch deletion failed: {error_code} - {error_message}")
    return deleted_count
  except Exception as e:
    logger.error(f"Unexpected error during S3 batch deletion: {e}")
    return deleted_count


def get_s3_uri_for_rekognition(orb_id: str, paper_id: str, file_extension: str) -> dict:
  """
  Get S3 URI dict for AWS Rekognition API.
  
  Rekognition can read directly from S3 using this format.
  
  Args:
    orb_id: The orb ID
    paper_id: The paper ID
    file_extension: File extension (e.g., 'jpg', 'png', 'gif')
    
  Returns:
    dict: S3 URI dict for Rekognition API
      {
        'S3Object': {
          'Bucket': 'corkorb',
          'Name': 'cosmic-starry-orb/abc123def456.jpg'
        }
      }
  """
  settings = get_settings()
  s3_key = get_s3_key(orb_id, paper_id, file_extension)
  
  return {
    'S3Object': {
      'Bucket': settings.aws_s3_bucket_name,
      'Name': s3_key
    }
  }


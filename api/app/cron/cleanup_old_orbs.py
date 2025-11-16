"""
Cron job script to delete orbs that haven't been accessed in 2 weeks.

This script should be run daily (e.g., at 3 AM UTC) via Railway's cron job feature.
It finds all orbs where last_accessed is older than 14 days and deletes them,
including all associated papers and S3 images.
"""

import asyncio
import sys
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import async_session_factory
from app.models.orb import Orb
from app.services import orb as orb_service
from app.utils.logging import get_logger

logger = get_logger(__name__)

# Orbs older than this will be deleted
RETENTION_DAYS = 14


async def cleanup_old_orbs() -> int:
  """
  Delete orbs that haven't been accessed in RETENTION_DAYS.
  
  Returns:
    Number of orbs deleted
  """
  cutoff_date = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
  deleted_count = 0
  error_count = 0
  
  logger.info(f"Starting cleanup of orbs older than {RETENTION_DAYS} days (cutoff: {cutoff_date.isoformat()})")
  
  async with async_session_factory() as session:
    try:
      # Find orbs that need to be deleted:
      # 1. last_accessed is older than cutoff_date, OR
      # 2. last_accessed is NULL and created_at is older than cutoff_date
      query = select(Orb).where(
        (
          (Orb.last_accessed.isnot(None)) & (Orb.last_accessed < cutoff_date)
        ) | (
          (Orb.last_accessed.is_(None)) & (Orb.created_at < cutoff_date)
        )
      )
      
      result = await session.execute(query)
      old_orbs = result.scalars().all()
      
      logger.info(f"Found {len(old_orbs)} orbs to delete")
      
      for orb in old_orbs:
        try:
          orb_age = (
            (datetime.now(timezone.utc) - orb.last_accessed).days 
            if orb.last_accessed 
            else (datetime.now(timezone.utc) - orb.created_at).days
          )
          
          logger.info(
            f"Deleting orb {orb.id} "
            f"(last_accessed: {orb.last_accessed}, "
            f"created_at: {orb.created_at}, "
            f"age: {orb_age} days)"
          )
          
          # Use the service layer which handles S3 cleanup
          deleted = await orb_service.delete_orb(session, orb.id)
          
          if deleted:
            deleted_count += 1
            logger.info(f"Successfully deleted orb {orb.id}")
          else:
            logger.warning(f"Failed to delete orb {orb.id} (not found or already deleted)")
            error_count += 1
          
          # Commit after each deletion to avoid long transactions
          await session.commit()
          
        except Exception as e:
          logger.error(f"Error deleting orb {orb.id}: {e}", exc_info=True)
          await session.rollback()
          error_count += 1
      
    except Exception as e:
      logger.error(f"Error during cleanup: {e}", exc_info=True)
      error_count += 1
  
  logger.info(
    f"Cleanup completed: {deleted_count} orbs deleted, {error_count} errors"
  )
  
  return deleted_count


async def main():
  """Main entry point for the cron job."""
  try:
    deleted = await cleanup_old_orbs()
    logger.info(f"Cron job completed successfully. Deleted {deleted} orbs.")
    sys.exit(0)
  except Exception as e:
    logger.error(f"Cron job failed: {e}", exc_info=True)
    sys.exit(1)


if __name__ == "__main__":
  asyncio.run(main())


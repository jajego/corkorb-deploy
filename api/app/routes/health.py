"""Health check endpoints for monitoring and deployment."""

import logging
from typing import Dict

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import text

from app.db.redis import get_redis
from app.db.session import async_session_factory

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", summary="Basic health check")
async def health_check():
  """Basic health check endpoint."""
  return {"status": "ok"}


@router.get("/db", summary="Database health check")
async def health_check_db():
  """Check database connectivity."""
  try:
    async with async_session_factory() as session:
      result = await session.execute(text("SELECT 1"))
      result.scalar()
    return {"status": "ok", "service": "database"}
  except Exception as e:
    logger.error(f"Database health check failed: {e}")
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail=f"Database unavailable: {str(e)}"
    )


@router.get("/redis", summary="Redis health check")
async def health_check_redis():
  """Check Redis connectivity."""
  try:
    redis_client = await get_redis()
    if not redis_client:
      return {
        "status": "degraded",
        "service": "redis",
        "message": "Redis unavailable (degraded mode)"
      }
    
    # Test Redis connection
    await redis_client.ping()
    return {"status": "ok", "service": "redis"}
  except Exception as e:
    logger.warning(f"Redis health check failed: {e}")
    return {
      "status": "degraded",
      "service": "redis",
      "message": f"Redis unavailable: {str(e)} (degraded mode)"
    }


@router.get("/full", summary="Full health check")
async def health_check_full():
  """Comprehensive health check for all services."""
  health_status: Dict[str, Dict] = {
    "status": "ok",
    "services": {}
  }
  
  # Check database
  try:
    async with async_session_factory() as session:
      result = await session.execute(text("SELECT 1"))
      result.scalar()
    health_status["services"]["database"] = {"status": "ok"}
  except Exception as e:
    logger.error(f"Database health check failed: {e}")
    health_status["status"] = "degraded"
    health_status["services"]["database"] = {
      "status": "error",
      "error": str(e)
    }
  
  # Check Redis
  try:
    redis_client = await get_redis()
    if redis_client:
      await redis_client.ping()
      health_status["services"]["redis"] = {"status": "ok"}
    else:
      health_status["services"]["redis"] = {
        "status": "degraded",
        "message": "Redis unavailable (degraded mode)"
      }
  except Exception as e:
    logger.warning(f"Redis health check failed: {e}")
    health_status["services"]["redis"] = {
      "status": "degraded",
      "message": f"Redis unavailable: {str(e)} (degraded mode)"
    }
  
  # Return appropriate status code
  if health_status["status"] == "ok":
    return health_status
  else:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail=health_status
    )


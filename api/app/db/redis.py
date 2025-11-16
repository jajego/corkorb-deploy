"""Redis client and connection management."""

import asyncio
import logging
import time
from typing import Optional

import redis.asyncio as redis
from redis.asyncio import Redis
from redis.exceptions import ConnectionError as RedisConnectionError, RedisError

from app.config import get_settings

logger = logging.getLogger(__name__)

_settings = get_settings()
_redis_client: Optional[Redis] = None

# Cache for Redis unavailability (to avoid repeated connection attempts)
_redis_unavailable: bool = False
_redis_last_attempt: Optional[float] = None
_redis_retry_interval: float = 60.0  # Retry connection every 60 seconds


async def get_redis() -> Optional[Redis]:
  """
  Get Redis client instance.
  Returns None if Redis is unavailable (graceful degradation).
  
  Caches unavailability state to avoid repeated connection attempts that block for 2 seconds.
  """
  global _redis_client, _redis_unavailable, _redis_last_attempt
  
  # If Redis is known to be unavailable and we recently tried, skip connection attempt
  if _redis_unavailable and _redis_last_attempt:
    time_since_last_attempt = time.time() - _redis_last_attempt
    if time_since_last_attempt < _redis_retry_interval:
      # Skip connection attempt to avoid blocking
      return None
  
  if _redis_client is None:
    try:
      # Reduce timeout to fail faster (1 second instead of 2)
      _redis_client = await redis.from_url(
        _settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
        socket_connect_timeout=1,  # Reduced from 2 to 1 second
        socket_timeout=1,  # Reduced from 2 to 1 second
        health_check_interval=30,
      )
      # Test connection with a short timeout
      await asyncio.wait_for(_redis_client.ping(), timeout=1.0)
      logger.info("Redis connected successfully")
      _redis_unavailable = False
      _redis_last_attempt = None
    except (RedisConnectionError, RedisError, asyncio.TimeoutError, Exception) as e:
      logger.warning(f"Redis unavailable: {e}. Continuing without Redis (degraded mode).")
      _redis_client = None
      _redis_unavailable = True
      _redis_last_attempt = time.time()
      return None
  
  # Check if connection is still alive (with timeout)
  try:
    await asyncio.wait_for(_redis_client.ping(), timeout=0.5)  # Quick health check
    return _redis_client
  except (RedisConnectionError, RedisError, asyncio.TimeoutError) as e:
    logger.warning(f"Redis connection lost: {e}. Marking as unavailable.")
    _redis_client = None
    _redis_unavailable = True
    _redis_last_attempt = time.time()
    return None


async def close_redis():
  """Close Redis connection."""
  global _redis_client
  if _redis_client:
    try:
      await _redis_client.aclose()
      logger.info("Redis connection closed")
    except Exception as e:
      logger.error(f"Error closing Redis connection: {e}")
    finally:
      _redis_client = None


def is_redis_available() -> bool:
  """Check if Redis client is available."""
  return _redis_client is not None


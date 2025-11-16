"""Distributed locking using Redis for multi-instance conflict resolution."""

import logging
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from redis.exceptions import RedisError

from app.db.redis import get_redis

logger = logging.getLogger(__name__)


class DistributedLock:
  """Distributed lock using Redis."""
  
  def __init__(self, key: str, timeout: float = 10.0, retry_interval: float = 0.1, max_retries: int = 10):
    """
    Args:
      key: Lock key (e.g., "orb:123:paper_creation")
      timeout: Lock timeout in seconds (auto-releases after this time)
      retry_interval: Interval between retry attempts in seconds
      max_retries: Maximum number of retry attempts
    """
    self.key = f"lock:{key}"
    self.timeout = timeout
    self.retry_interval = retry_interval
    self.max_retries = max_retries
    self.lock_value: Optional[str] = None
  
  async def acquire(self) -> bool:
    """
    Acquire the lock.
    Returns True if acquired, False if failed after max retries.
    """
    redis_client = await get_redis()
    if not redis_client:
      # Redis unavailable - return False (cannot acquire lock)
      logger.warning(f"Redis unavailable, cannot acquire lock: {self.key}")
      return False
    
    self.lock_value = str(uuid.uuid4())
    
    for attempt in range(self.max_retries):
      try:
        # Try to set the lock (SET key value NX EX timeout)
        # NX: Only set if key doesn't exist
        # EX: Set expiration in seconds
        acquired = await redis_client.set(
          self.key,
          self.lock_value,
          nx=True,
          ex=int(self.timeout)
        )
        
        if acquired:
          logger.debug(f"Lock acquired: {self.key} (attempt {attempt + 1})")
          return True
        
        # Lock is held by another process, wait and retry
        if attempt < self.max_retries - 1:
          import asyncio
          await asyncio.sleep(self.retry_interval)
        
      except RedisError as e:
        logger.error(f"Redis error while acquiring lock {self.key}: {e}")
        return False
    
    logger.warning(f"Failed to acquire lock {self.key} after {self.max_retries} attempts")
    return False
  
  async def release(self) -> bool:
    """
    Release the lock.
    Returns True if released, False if failed.
    """
    if not self.lock_value:
      return False
    
    redis_client = await get_redis()
    if not redis_client:
      logger.warning(f"Redis unavailable, cannot release lock: {self.key}")
      return False
    
    try:
      # Lua script to ensure we only delete our own lock
      # This prevents deleting a lock that was acquired by another process
      # after our lock expired
      script = """
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
      """
      result = await redis_client.eval(script, 1, self.key, self.lock_value)
      released = result == 1
      
      if released:
        logger.debug(f"Lock released: {self.key}")
      else:
        logger.warning(f"Lock not released (may have expired): {self.key}")
      
      self.lock_value = None
      return released
      
    except RedisError as e:
      logger.error(f"Redis error while releasing lock {self.key}: {e}")
      return False
  
  async def __aenter__(self):
    """Async context manager entry."""
    acquired = await self.acquire()
    if not acquired:
      raise RuntimeError(f"Failed to acquire lock: {self.key}")
    return self
  
  async def __aexit__(self, exc_type, exc_val, exc_tb):
    """Async context manager exit."""
    await self.release()
    return False


@asynccontextmanager
async def acquire_lock(key: str, timeout: float = 10.0, retry_interval: float = 0.1, max_retries: int = 10):
  """
  Context manager for acquiring a distributed lock.
  
  Usage:
    async with acquire_lock("orb:123:paper_creation"):
      # Critical section
      pass
  """
  lock = DistributedLock(key, timeout, retry_interval, max_retries)
  try:
    acquired = await lock.acquire()
    if not acquired:
      raise RuntimeError(f"Failed to acquire lock: {key}")
    yield lock
  finally:
    await lock.release()


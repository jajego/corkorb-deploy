"""Message rate limiting for WebSocket connections."""

import time
from collections import defaultdict
from typing import Dict, Optional, Tuple


class RateLimiter:
  """Rate limiter for WebSocket messages per connection."""
  
  def __init__(self, max_messages_per_second: float = 10.0):
    """
    Args:
      max_messages_per_second: Maximum messages allowed per second per connection
    """
    self.max_messages_per_second = max_messages_per_second
    self.min_interval = 1.0 / max_messages_per_second
    # connection_id -> list of timestamps (sliding window)
    self.message_timestamps: Dict[str, list[float]] = defaultdict(list)
    # Maximum window size (keep last 2 seconds of messages)
    self.window_size = 2.0
  
  def _cleanup_old_timestamps(self, connection_id: str, now: float):
    """Remove timestamps outside the window."""
    cutoff = now - self.window_size
    self.message_timestamps[connection_id] = [
      ts for ts in self.message_timestamps[connection_id] if ts > cutoff
    ]
  
  def check_rate_limit(self, connection_id: str) -> Tuple[bool, Optional[float]]:
    """
    Check if connection has exceeded rate limit.
    
    Args:
      connection_id: Unique identifier for the connection
      
    Returns:
      Tuple of (allowed, retry_after_seconds)
      - allowed: True if message is allowed, False if rate limited
      - retry_after_seconds: Seconds to wait before next message (if rate limited)
    """
    now = time.time()
    self._cleanup_old_timestamps(connection_id, now)
    
    timestamps = self.message_timestamps[connection_id]
    
    # Check if we've exceeded the rate limit
    if len(timestamps) >= self.max_messages_per_second * self.window_size:
      # Rate limited - calculate retry after
      oldest_timestamp = min(timestamps)
      retry_after = self.min_interval - (now - oldest_timestamp)
      return False, max(0, retry_after)
    
    # Allow message and record timestamp
    timestamps.append(now)
    return True, None
  
  def remove_connection(self, connection_id: str):
    """Remove connection from rate limiter (on disconnect)."""
    self.message_timestamps.pop(connection_id, None)


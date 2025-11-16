"""WebSocket heartbeat/ping-pong mechanism for dead connection detection."""

import asyncio
import logging
import time
from typing import Optional

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# Heartbeat configuration
HEARTBEAT_INTERVAL = 30.0  # Check for inactivity every 30 seconds
HEARTBEAT_TIMEOUT = 300.0  # Close connection after 5 minutes (300 seconds) of total inactivity
PING_MESSAGE = {"type": "ping"}


class HeartbeatManager:
  """Manages heartbeat/ping-pong for WebSocket connections.
  
  Tracks last activity time (any message from client) and only closes connection
  if there's been no activity for HEARTBEAT_TIMEOUT seconds.
  """
  
  def __init__(self, websocket: WebSocket, connection_id: str):
    """
    Args:
      websocket: WebSocket connection
      connection_id: Unique identifier for this connection
    """
    self.websocket = websocket
    self.connection_id = connection_id
    self.last_activity: float = time.time()  # Track last activity time (any message from client)
    self.last_ping_time: Optional[float] = None  # Track when we last sent a ping
    self.heartbeat_task: Optional[asyncio.Task] = None
    self.is_running = False
  
  async def start(self):
    """Start heartbeat mechanism."""
    if self.is_running:
      return
    self.is_running = True
    self.last_activity = time.time()
    self.heartbeat_task = asyncio.create_task(self._heartbeat_loop())
    logger.debug(f"Heartbeat started for connection {self.connection_id}")
  
  async def stop(self):
    """Stop heartbeat mechanism."""
    self.is_running = False
    if self.heartbeat_task:
      self.heartbeat_task.cancel()
      try:
        await self.heartbeat_task
      except asyncio.CancelledError:
        pass
    logger.debug(f"Heartbeat stopped for connection {self.connection_id}")
  
  def record_activity(self):
    """Record that activity was received from the client (any message, including pong)."""
    self.last_activity = time.time()
    logger.debug(f"Activity recorded for connection {self.connection_id} (last activity: {self.last_activity:.1f})")
  
  def record_pong(self):
    """Record that a pong was received (also counts as activity)."""
    self.record_activity()
  
  async def _heartbeat_loop(self):
    """Main heartbeat loop - checks for inactivity and sends pings periodically."""
    try:
      while self.is_running:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        
        if not self.is_running:
          break
        
        # Check if there's been any activity recently
        now = time.time()
        time_since_activity = now - self.last_activity
        
        # If no activity for HEARTBEAT_TIMEOUT, close connection
        if time_since_activity >= HEARTBEAT_TIMEOUT:
          logger.warning(
            f"Connection {self.connection_id} timed out due to inactivity "
            f"(no activity for {time_since_activity:.1f}s, timeout: {HEARTBEAT_TIMEOUT}s)"
          )
          await self._close_connection("Inactivity timeout")
          break
        
        # Send ping periodically to help detect dead connections
        # But don't close connection if pong isn't received - only close if there's no activity at all
        try:
          await self.websocket.send_json(PING_MESSAGE)
          self.last_ping_time = time.time()
          logger.debug(f"Sent ping to connection {self.connection_id} (last activity: {time_since_activity:.1f}s ago)")
        except Exception as e:
          logger.warning(f"Failed to send ping to connection {self.connection_id}: {e}")
          # If we can't send ping, connection is likely dead - close it
          await self._close_connection("Failed to send ping")
          break
          
    except asyncio.CancelledError:
      logger.debug(f"Heartbeat loop cancelled for connection {self.connection_id}")
    except Exception as e:
      logger.error(f"Error in heartbeat loop for connection {self.connection_id}: {e}", exc_info=True)
  
  async def _close_connection(self, reason: str):
    """Close the connection due to heartbeat failure."""
    try:
      await self.websocket.close(code=1000, reason=reason)
    except Exception as e:
      logger.debug(f"Error closing connection {self.connection_id}: {e}")


def is_ping_message(message: dict) -> bool:
  """Check if message is a ping message."""
  return message.get("type") == "ping"


def is_pong_message(message: dict) -> bool:
  """Check if message is a pong message."""
  return message.get("type") == "pong"


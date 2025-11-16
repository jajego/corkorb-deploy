"""Connection manager for WebSocket connections with optional Redis support."""

import asyncio
import json
import logging
from collections import defaultdict
from typing import Dict, Optional, Set

from fastapi import WebSocket
from redis.exceptions import RedisError

from app.db.redis import get_redis

logger = logging.getLogger(__name__)


class ConnectionManager:
  """Manages WebSocket connections per orb with connection limits."""

  def __init__(self, max_connections_per_orb: int = 50):
    self.max_connections_per_orb = max_connections_per_orb
    self.connections: Dict[str, Set[WebSocket]] = defaultdict(set)
    self.websocket_to_orb: Dict[WebSocket, str] = {}
    self.websocket_to_user: Dict[WebSocket, str] = {}
    self.websocket_to_username: Dict[WebSocket, Optional[str]] = {}
    # Optimized lookup: user_id -> username (for O(1) lookups)
    self.user_id_to_username: Dict[str, Optional[str]] = {}

  async def connect(self, websocket: WebSocket, orb_id: str, user_id: str, username: Optional[str] = None) -> bool:
    redis_client = await get_redis()
    
    if redis_client:
      try:
        connection_count_key = f"orb:{orb_id}:connections:count"
        count = await redis_client.get(connection_count_key)
        current_count = int(count) if count else 0
        
        if current_count >= self.max_connections_per_orb:
          logger.debug(f"Connection limit reached for orb {orb_id} (Redis count: {current_count})")
          return False
        
        await redis_client.incr(connection_count_key)
        await redis_client.expire(connection_count_key, 3600)
      except RedisError as e:
        logger.warning(f"Redis error during connect: {e}. Falling back to local tracking.")
        redis_client = None
    
    orb_connections = self.connections[orb_id]
    current_count = len(orb_connections)
    logger.info(f"[CONNECT] Adding connection for user {user_id} to orb {orb_id}. Current connections in orb: {current_count}")
    if len(orb_connections) >= self.max_connections_per_orb:
      logger.warning(f"[CONNECT] Connection limit reached for orb {orb_id} (current: {current_count}, max: {self.max_connections_per_orb})")
      return False
    orb_connections.add(websocket)
    self.websocket_to_orb[websocket] = orb_id
    self.websocket_to_user[websocket] = user_id
    self.websocket_to_username[websocket] = username
    # Update optimized lookup
    self.user_id_to_username[user_id] = username
    logger.info(f"[CONNECT] Successfully added connection. Orb {orb_id} now has {len(orb_connections)} connections. Users: {[self.websocket_to_user.get(ws) for ws in orb_connections]}")
    
    return True

  async def disconnect(self, websocket: WebSocket) -> Optional[str]:
    orb_id = self.websocket_to_orb.pop(websocket, None)
    if orb_id:
      self.connections[orb_id].discard(websocket)
      if not self.connections[orb_id]:
        del self.connections[orb_id]
      user_id = self.websocket_to_user.pop(websocket, None)
      self.websocket_to_username.pop(websocket, None)
      # Clean up optimized lookup (only if no other connections for this user)
      if user_id:
        # Check if user has any other connections in any orb
        has_other_connections = any(
          user_id == self.websocket_to_user.get(ws) 
          for ws_set in self.connections.values() 
          for ws in ws_set
        )
        if not has_other_connections:
          self.user_id_to_username.pop(user_id, None)
      
      redis_client = await get_redis()
      if redis_client:
        try:
          connection_count_key = f"orb:{orb_id}:connections:count"
          await redis_client.decr(connection_count_key)
          count = await redis_client.get(connection_count_key)
          if count and int(count) < 0:
            await redis_client.set(connection_count_key, 0)
        except RedisError as e:
          logger.warning(f"Redis error during disconnect: {e}")
    
    return orb_id

  def get_orb_connections(self, orb_id: str) -> Set[WebSocket]:
    """Get all connections for an orb."""
    connections = self.connections.get(orb_id, set()).copy()
    logger.info(f"[DEBUG] get_orb_connections for {orb_id}: connections set has {len(connections)} items")
    return connections

  def get_user_id(self, websocket: WebSocket) -> str | None:
    """Get the user ID for a WebSocket connection."""
    return self.websocket_to_user.get(websocket)

  def get_username(self, websocket: WebSocket) -> Optional[str]:
    """Get the username for a WebSocket connection."""
    return self.websocket_to_username.get(websocket)
  
  def get_username_by_user_id(self, user_id: str) -> Optional[str]:
    """Get the username for a user ID (O(1) lookup)."""
    return self.user_id_to_username.get(user_id)

  async def get_connection_count(self, orb_id: str) -> int:
    redis_client = await get_redis()
    if redis_client:
      try:
        connection_count_key = f"orb:{orb_id}:connections:count"
        count = await redis_client.get(connection_count_key)
        return int(count) if count else 0
      except RedisError as e:
        logger.warning(f"Redis error getting connection count: {e}")
    
    return len(self.connections.get(orb_id, set()))

  async def broadcast_to_orb(self, orb_id: str, message: dict, exclude: WebSocket | None = None):
    connections = self.get_orb_connections(orb_id)
    disconnected = set()
    message_type = message.get('type', 'unknown')
    
    async def send_to_connection(conn: WebSocket):
      """Send message to a single connection, return True if successful."""
      try:
        # Try to send the message
        await conn.send_json(message)
        return True
      except Exception as e:
        # Log at warning level for critical messages (deletions, creations)
        log_level = logger.warning if message_type in ('paper_deleted', 'paper_created', 'paper_texture_ready') else logger.debug
        log_level(f"Failed to broadcast {message_type} to connection in orb {orb_id}: {e}")
        disconnected.add(conn)
        return False
    
    # Filter out the excluded connection and any connections that might be stale
    valid_connections = [conn for conn in connections if conn != exclude]
    
    if not valid_connections:
      logger.debug(f"No connections to broadcast {message_type} to in orb {orb_id} (excluded: {exclude is not None})")
    else:
      # Send to all connections in parallel
      send_tasks = [send_to_connection(conn) for conn in valid_connections]
      
      results = await asyncio.gather(*send_tasks, return_exceptions=True)
      successful_broadcasts = sum(1 for r in results if r is True)
      failed_broadcasts = len(results) - successful_broadcasts
      
      # Handle any unexpected exceptions
      for result in results:
        if isinstance(result, Exception):
          logger.warning(f"Unexpected error during broadcast {message_type} to orb {orb_id}: {result}", exc_info=True)
      
      # Log broadcast results at appropriate level for critical messages
      if message_type in ('paper_deleted', 'paper_created', 'paper_texture_ready'):
        if failed_broadcasts > 0:
          logger.warning(
            f"Broadcast {message_type} to orb {orb_id}: {successful_broadcasts} successful, {failed_broadcasts} failed "
            f"(total connections: {len(connections)}, attempted: {len(valid_connections)})"
          )
        elif successful_broadcasts > 0:
          logger.info(
            f"Broadcast {message_type} to orb {orb_id}: {successful_broadcasts} successful "
            f"(total connections: {len(connections)})"
          )
        else:
          logger.debug(f"Broadcast {message_type} to orb {orb_id}: no connections to broadcast to")
      else:
        if successful_broadcasts > 0 or failed_broadcasts > 0:
          logger.debug(f"Broadcast {message_type} to orb {orb_id}: {successful_broadcasts} successful, {failed_broadcasts} failed")
    
    # Clean up disconnected connections aggressively
    for connection in disconnected:
      try:
        orb_id_for_disconnect = await self.disconnect(connection)
        if orb_id_for_disconnect:
          logger.debug(f"Cleaned up disconnected connection in orb {orb_id_for_disconnect}")
      except Exception as e:
        logger.warning(f"Error during connection cleanup in orb {orb_id}: {e}", exc_info=True)
    
    # Also publish to Redis for cross-instance broadcasting (if Redis is available)
    redis_client = await get_redis()
    if redis_client:
      try:
        channel = f"orb:{orb_id}:broadcast"
        await redis_client.publish(channel, json.dumps(message))
        logger.debug(f"Published {message_type} to Redis channel {channel}")
      except RedisError as e:
        logger.warning(f"Redis error during broadcast {message_type} to orb {orb_id}: {e}")

  def get_users_in_orb(self, orb_id: str) -> Set[str]:
    connections = self.get_orb_connections(orb_id)
    logger.info(f"[DEBUG] get_users_in_orb for {orb_id}: found {len(connections)} connections")
    users = {self.websocket_to_user.get(ws) for ws in connections if self.websocket_to_user.get(ws)}
    logger.info(f"[DEBUG] get_users_in_orb for {orb_id}: found {len(users)} users: {users}")
    return users


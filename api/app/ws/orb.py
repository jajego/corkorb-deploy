"""WebSocket gateway for real-time collaborative orb editing."""

import asyncio
import json
import logging
import uuid
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, WebSocketException, status

from app.db.session import async_session_factory
from app.schemas.ws import (
  ClientMessage,
  ConnectedUsersCountMessage,
  CreateOrbMessage,
  CreatePaperMessage,
  DeleteOrbMessage,
  DeletePaperMessage,
  ErrorMessage,
  GetStateMessage,
  PongMessage,
  SuccessMessage,
  UpdateViewCenterMessage,
  UserJoinedMessage,
  UserLeftMessage,
  ViewCenterUpdateMessage,
)
from app.utils.rate_limiter import RateLimiter
from app.ws.auth import authenticate_websocket
from app.ws.connection_manager import ConnectionManager
from app.ws.handlers import (
  handle_create_orb,
  handle_create_paper,
  handle_delete_orb,
  handle_delete_paper,
  handle_get_state,
)
from app.ws.heartbeat import HeartbeatManager, is_pong_message
from app.ws.presence import PresenceTracker, ViewCenterThrottler

logger = logging.getLogger(__name__)

router = APIRouter()

connection_manager = ConnectionManager(max_connections_per_orb=50)

presence_tracker = PresenceTracker(min_update_distance=0.0001)
view_center_throttler = ViewCenterThrottler(max_updates_per_second=20.0)
rate_limiter = RateLimiter(max_messages_per_second=10.0)


def parse_client_message(data: dict) -> ClientMessage:
  """Parse and validate client message."""
  msg_type = data.get("type")
  
  if msg_type == "create_orb":
    return CreateOrbMessage(**data)
  elif msg_type == "delete_orb":
    return DeleteOrbMessage(**data)
  elif msg_type == "create_paper":
    return CreatePaperMessage(**data)
  elif msg_type == "delete_paper":
    return DeletePaperMessage(**data)
  elif msg_type == "get_state":
    return GetStateMessage(**data)
  elif msg_type == "update_view_center":
    return UpdateViewCenterMessage(**data)
  else:
    raise ValueError(f"Unknown message type: {msg_type}")


async def send_error(websocket: WebSocket, error: str, error_code: str | None = None, request_id: str | None = None):
  error_msg = ErrorMessage(error=error, error_code=error_code, request_id=request_id)
  await websocket.send_json(error_msg.model_dump())


async def send_success(websocket: WebSocket, data: dict, request_id: str | None = None):
  success_msg = SuccessMessage(data=data, request_id=request_id)
  await websocket.send_json(success_msg.model_dump(mode='json'))


@router.websocket("/ws/orb/{orb_id}")
async def orb_websocket(websocket: WebSocket, orb_id: str):
  connection_id = str(uuid.uuid4())
  heartbeat_manager: HeartbeatManager | None = None
  try:
    user_info = await authenticate_websocket(websocket, connection_id)
    user_id = user_info["user_id"]
    username = user_info.get("username")
  except WebSocketException:
    await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="Authentication failed")
    return
  except Exception as e:
    logger.error(f"Authentication error: {e}")
    await websocket.close(code=status.WS_1011_INTERNAL_ERROR, reason="Authentication error")
    return
  
  connected = await connection_manager.connect(websocket, orb_id, user_id, username)
  if not connected:
    await websocket.close(
      code=status.WS_1008_POLICY_VIOLATION,
      reason=f"Connection limit reached for orb {orb_id} (max {connection_manager.max_connections_per_orb})"
    )
    return
  
  try:
    await websocket.accept()
    logger.info(f"WebSocket connected: user={user_id}, orb={orb_id}, connection_id={connection_id}")
    
    heartbeat_manager = HeartbeatManager(websocket, connection_id)
    await heartbeat_manager.start()
    try:
      # Send the user their own user_id so they can add themselves to connectedUsers
      # This ensures the count includes themselves
      own_join_message = UserJoinedMessage(orb_id=orb_id, user_id=user_id, username=username)
      await websocket.send_json(own_join_message.model_dump())
      logger.info(f"[USER_JOIN] Sent own user_joined message to user {user_id} (username: {username})")
      
      # Get all users in orb (includes the new user)
      all_users = connection_manager.get_users_in_orb(orb_id)
      # Exclude the new user from the list (they already received their own user_joined message)
      existing_users = {uid for uid in all_users if uid != user_id}
      logger.info(f"[USER_JOIN] New user {user_id} connecting. Total users in orb: {len(all_users)}, existing users: {len(existing_users)}, existing_user_ids: {existing_users}")
      
      # Send user_joined messages for all existing users to the new user
      for existing_user_id in existing_users:
        try:
          existing_username = connection_manager.get_username_by_user_id(existing_user_id)
          user_join_message = UserJoinedMessage(orb_id=orb_id, user_id=existing_user_id, username=existing_username)
          await websocket.send_json(user_join_message.model_dump())
          logger.info(f"[USER_JOIN] Sent user_joined for existing user {existing_user_id} to new user {user_id}")
        except (RuntimeError, WebSocketDisconnect) as e:
          logger.warning(f"WebSocket closed while sending user_joined event: {e}")
          raise
      
      # Broadcast the new user's join to all other users
      join_message = UserJoinedMessage(orb_id=orb_id, user_id=user_id, username=username)
      await connection_manager.broadcast_to_orb(orb_id, join_message.model_dump(), exclude=websocket)
      logger.info(f"[USER_JOIN] Broadcast user_joined for new user {user_id} (username: {username}) to all other users in orb {orb_id}")
      
      # Broadcast updated user count to all users (including the new user)
      all_users_after_join = connection_manager.get_users_in_orb(orb_id)
      connected_count = len(all_users_after_join)
      anonymous_count = sum(1 for uid in all_users_after_join if uid.startswith('user:anonymous:'))
      # Get usernames for non-anonymous users
      usernames = []
      for user_id in all_users_after_join:
        if not user_id.startswith('user:anonymous:'):
          username = connection_manager.get_username_by_user_id(user_id)
          if username:
            usernames.append(username)
      count_message = ConnectedUsersCountMessage(
        orb_id=orb_id,
        connected_users_count=connected_count,
        anonymous_users_count=anonymous_count,
        usernames=usernames
      )
      await connection_manager.broadcast_to_orb(orb_id, count_message.model_dump())
      logger.info(f"[USER_COUNT] Broadcast updated count: {connected_count} total ({anonymous_count} anonymous) for orb {orb_id}")
    except (RuntimeError, WebSocketDisconnect) as e:
      logger.warning(f"WebSocket closed during initialization: {e}")
      if heartbeat_manager:
        await heartbeat_manager.stop()
      await connection_manager.disconnect(websocket)
      rate_limiter.remove_connection(connection_id)
      return
  except Exception as e:
    logger.error(f"Failed to accept WebSocket: {e}", exc_info=True)
    try:
      if heartbeat_manager:
        await heartbeat_manager.stop()
      await connection_manager.disconnect(websocket)
      rate_limiter.remove_connection(connection_id)
    except Exception as cleanup_error:
      logger.error(f"Error during WebSocket cleanup: {cleanup_error}")
    return
  
  try:
    while True:
      try:
        raw_data = await websocket.receive_json()
      except RuntimeError as e:
        if "not connected" in str(e) or "accept" in str(e).lower():
          logger.warning(f"WebSocket not connected for user {user_id} on orb {orb_id}: {e}")
          break
        raise
      except json.JSONDecodeError:
        await send_error(websocket, "Invalid JSON", "invalid_json")
        continue
      except WebSocketDisconnect:
        break
      
      if heartbeat_manager:
        heartbeat_manager.record_activity()
      
      if is_pong_message(raw_data):
        continue
      allowed, retry_after = rate_limiter.check_rate_limit(connection_id)
      if not allowed:
        await send_error(
          websocket,
          f"Rate limit exceeded. Please wait {retry_after:.2f} seconds.",
          "rate_limit_exceeded"
        )
        continue
      
      request_id = raw_data.get("request_id")
      
      try:
        message = parse_client_message(raw_data)
      except ValueError as e:
        await send_error(websocket, str(e), "invalid_message", request_id)
        continue
      except Exception as e:
        logger.error(f"Message parsing error: {e}")
        await send_error(websocket, "Failed to parse message", "parse_error", request_id)
        continue
      async with async_session_factory() as session:
        try:
          if isinstance(message, CreateOrbMessage):
            response, broadcast_data = await handle_create_orb(session, message, user_id)
            await send_success(websocket, broadcast_data, request_id)
            
          elif isinstance(message, DeleteOrbMessage):
            response, broadcast_data = await handle_delete_orb(session, message, user_id)
            await send_success(websocket, broadcast_data, request_id)
            await connection_manager.broadcast_to_orb(message.orb_id, broadcast_data, exclude=websocket)
            
          elif isinstance(message, CreatePaperMessage):
            if message.orb_id != orb_id:
              await send_error(websocket, "orb_id mismatch", "orb_mismatch", request_id)
              continue
            
            response, broadcast_data = await handle_create_paper(session, message, user_id, username)
            await send_success(websocket, broadcast_data, request_id)
            await connection_manager.broadcast_to_orb(orb_id, broadcast_data, exclude=websocket)
            
          elif isinstance(message, DeletePaperMessage):
            if message.orb_id != orb_id:
              await send_error(websocket, "orb_id mismatch", "orb_mismatch", request_id)
              continue
            
            try:
              response, broadcast_data = await handle_delete_paper(session, message, user_id)
              await send_success(websocket, broadcast_data, request_id)
              # Broadcast deletion to all other users in the orb
              await connection_manager.broadcast_to_orb(orb_id, broadcast_data, exclude=websocket)
              logger.info(f"Successfully deleted paper {message.paper_id} for orb {orb_id} and broadcasted to other users")
            except Exception as e:
              # Log deletion errors but don't fail silently
              logger.error(f"Error during paper deletion for paper {message.paper_id} in orb {orb_id}: {e}", exc_info=True)
              raise
            
          elif isinstance(message, GetStateMessage):
            if message.orb_id != orb_id:
              await send_error(websocket, "orb_id mismatch", "orb_mismatch", request_id)
              continue
            
            response = await handle_get_state(session, message, user_id, connection_manager)
            await websocket.send_json(response.model_dump(mode='json'))
            
          elif isinstance(message, UpdateViewCenterMessage):
            if message.orb_id != orb_id:
              await send_error(websocket, "orb_id mismatch", "orb_mismatch", request_id)
              continue
            
            if not view_center_throttler.should_update(user_id):
              continue
            
            should_broadcast = presence_tracker.update_view_center(
              orb_id, user_id, message.view_center
            )
            
            if should_broadcast:
              update_message = ViewCenterUpdateMessage(
                orb_id=orb_id,
                user_id=user_id,
                view_center=presence_tracker.view_centers[orb_id][user_id]
              )
              await connection_manager.broadcast_to_orb(
                orb_id, update_message.model_dump(), exclude=websocket
              )
            
          else:
            await send_error(websocket, f"Unhandled message type: {message.type}", "unhandled", request_id)
            
        except ValueError as e:
          await send_error(websocket, str(e), "business_error", request_id)
          logger.warning(f"Business error for user {user_id} on orb {orb_id}: {e}")
        except Exception as e:
          logger.error(f"Error handling message for user {user_id} on orb {orb_id}: {e}", exc_info=True)
          await send_error(websocket, "Internal server error", "internal_error", request_id)
  
  except WebSocketDisconnect:
    logger.info(f"WebSocket disconnected: user={user_id}, orb={orb_id}, connection_id={connection_id}")
  except Exception as e:
    logger.error(f"WebSocket error for user {user_id} on orb {orb_id}: {e}", exc_info=True)
  finally:
    if heartbeat_manager:
      await heartbeat_manager.stop()
    
    # Get username before disconnect (it's still in the dict)
    username = connection_manager.get_username(websocket)
    disconnected_orb_id = await connection_manager.disconnect(websocket)
    rate_limiter.remove_connection(connection_id)
    
    if disconnected_orb_id:
      presence_tracker.remove_user(disconnected_orb_id, user_id)
      
      leave_message = UserLeftMessage(orb_id=disconnected_orb_id, user_id=user_id, username=username)
      await connection_manager.broadcast_to_orb(
        disconnected_orb_id, leave_message.model_dump()
      )
      
      # Broadcast updated user count after user leaves
      all_users_after_leave = connection_manager.get_users_in_orb(disconnected_orb_id)
      connected_count = len(all_users_after_leave)
      anonymous_count = sum(1 for uid in all_users_after_leave if uid.startswith('user:anonymous:'))
      # Get usernames for non-anonymous users
      usernames = []
      for user_id in all_users_after_leave:
        if not user_id.startswith('user:anonymous:'):
          username = connection_manager.get_username_by_user_id(user_id)
          if username:
            usernames.append(username)
      count_message = ConnectedUsersCountMessage(
        orb_id=disconnected_orb_id,
        connected_users_count=connected_count,
        anonymous_users_count=anonymous_count,
        usernames=usernames
      )
      await connection_manager.broadcast_to_orb(disconnected_orb_id, count_message.model_dump())
      logger.info(f"[USER_COUNT] Broadcast updated count: {connected_count} total ({anonymous_count} anonymous) for orb {disconnected_orb_id}")
      
      logger.info(f"Cleaned up connection: user={user_id} (username: {username}), orb={disconnected_orb_id}, connection_id={connection_id}")

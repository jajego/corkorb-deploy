"""Authentication utilities for WebSocket connections."""

import logging
from typing import Optional

from fastapi import WebSocket, WebSocketException, status

from app.config import get_settings
from app.utils.auth import AuthError, extract_token_from_header, extract_token_from_query, verify_clerk_token

logger = logging.getLogger(__name__)

_settings = get_settings()


async def authenticate_websocket(websocket: WebSocket, connection_id: str | None = None) -> dict:
  """
  Authenticate WebSocket connection and extract user information from Clerk JWT token.
  
  Token can be provided in:
  1. Query parameter: `?token=<jwt_token>`
  2. Authorization header: `Authorization: Bearer <jwt_token>`
  
  Args:
    websocket: WebSocket connection
    connection_id: Unique connection ID for anonymous users (required if no token provided)
  
  Returns:
    dict: User information containing:
      - user_id: The authenticated user's ID (Clerk user ID, or unique anonymous ID if no token)
      - username: User's username (if available in JWT token)
      - email: User's email (if available)
    
  Raises:
    WebSocketException: If authentication fails
  """
  # Check for token in query params
  token = extract_token_from_query(websocket.query_params.get("token"))
  
  # Check for username in query params (frontend passes it directly via useUser())
  # This is more reliable than extracting from JWT token, which may not include username
  username_from_query = websocket.query_params.get("username")
  
  # Check for token in headers (if not in query params)
  if not token:
    authorization = websocket.headers.get("authorization") or websocket.headers.get("Authorization")
    token = extract_token_from_header(authorization)
  
  # If no token provided, allow anonymous access (viewing only)
  # Use connection_id to create unique user_id for each anonymous connection
  if not token:
    if not connection_id:
      # Fallback: generate a connection ID if not provided (shouldn't happen, but handle gracefully)
      import uuid
      connection_id = str(uuid.uuid4())
      logger.warning("Anonymous connection without connection_id - generated fallback ID")
    anonymous_user_id = f"user:anonymous:{connection_id}"
    logger.info(f"[ANONYMOUS] WebSocket connection without authentication token - allowing anonymous access with ID: {anonymous_user_id}, connection_id: {connection_id}")
    return {"user_id": anonymous_user_id, "username": username_from_query, "email": None}
  
  # Verify token
  try:
    user_info = await verify_clerk_token(token)
    # Prefer username from query parameter (frontend has direct access via useUser())
    # Fall back to JWT token username if not provided in query
    final_username = username_from_query or user_info.get("username")
    logger.debug(f"WebSocket authenticated: user_id={user_info['user_id']}, username={final_username} (from query: {username_from_query is not None}, from JWT: {user_info.get('username') is not None})")
    return {
      "user_id": user_info["user_id"],
      "username": final_username,
      "email": user_info.get("email"),
    }
  except AuthError as e:
    logger.warning(f"WebSocket authentication failed: {e}")
    raise WebSocketException(
      code=status.WS_1008_POLICY_VIOLATION,
      reason=f"Authentication failed: {str(e)}"
    )
  except Exception as e:
    logger.error(f"WebSocket authentication error: {e}", exc_info=True)
    raise WebSocketException(
      code=status.WS_1011_INTERNAL_ERROR,
      reason="Authentication error"
    )


def get_user_id_from_websocket(websocket: WebSocket) -> Optional[str]:
  """
  Extract user_id from WebSocket connection.
  This is a helper that can be used after authentication.
  
  Note: After authentication, user_id is stored in the connection manager.
  This function is kept for backward compatibility.
  """
  # User ID is stored in connection manager after authentication
  # This function is kept for backward compatibility
  return None


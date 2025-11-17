"""WebSocket message schemas for real-time collaboration."""

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field

from .orb import OrbCreate
from .paper import PaperCreate


# Base message structure
class WSMessage(BaseModel):
  """Base WebSocket message."""
  type: str = Field(..., description="Message type")
  request_id: Optional[str] = Field(None, description="Optional request ID for correlation")


# Client -> Server messages
class CreateOrbMessage(WSMessage):
  """Create a new orb."""
  type: Literal["create_orb"] = "create_orb"
  data: OrbCreate


class DeleteOrbMessage(WSMessage):
  """Delete an orb."""
  type: Literal["delete_orb"] = "delete_orb"
  orb_id: str


class CreatePaperMessage(WSMessage):
  """Create a new paper."""
  type: Literal["create_paper"] = "create_paper"
  orb_id: str
  data: PaperCreate


class DeletePaperMessage(WSMessage):
  """Delete a paper."""
  type: Literal["delete_paper"] = "delete_paper"
  orb_id: str
  paper_id: str


class GetStateMessage(WSMessage):
  """Request current orb state."""
  type: Literal["get_state"] = "get_state"
  orb_id: str


class UpdateViewCenterMessage(WSMessage):
  """Update user's view center (camera position)."""
  type: Literal["update_view_center"] = "update_view_center"
  orb_id: str
  view_center: Dict[str, float] = Field(
    ...,
    description="Spherical coordinates matching THREE.Spherical: {radius: 1.6-6.0, phi: 0.001-π-0.001, theta: any (will be normalized)}"
  )


# Server -> Client messages
class SuccessMessage(WSMessage):
  """Operation succeeded."""
  type: Literal["success"] = "success"
  request_id: Optional[str] = None
  data: Dict[str, Any] = Field(default_factory=dict)


class ErrorMessage(WSMessage):
  """Operation failed."""
  type: Literal["error"] = "error"
  request_id: Optional[str] = None
  error: str = Field(..., description="Error message")
  error_code: Optional[str] = Field(None, description="Error code for client handling")


class OrbCreatedMessage(WSMessage):
  """Orb was created."""
  type: Literal["orb_created"] = "orb_created"
  orb: Dict[str, Any]


class OrbDeletedMessage(WSMessage):
  """Orb was deleted."""
  type: Literal["orb_deleted"] = "orb_deleted"
  orb_id: str


class PaperCreatedMessage(WSMessage):
  """Paper was created."""
  type: Literal["paper_created"] = "paper_created"
  orb_id: str
  paper: Dict[str, Any]


class PaperDeletedMessage(WSMessage):
  """Paper was deleted."""
  type: Literal["paper_deleted"] = "paper_deleted"
  orb_id: str
  paper_id: str
  reason: Optional[str] = Field(None, description="Reason for deletion (e.g., 'nsfw_violation', 'user_deleted')")


class StateMessage(WSMessage):
  """Current orb state."""
  type: Literal["state"] = "state"
  orb_id: str
  papers: list[Dict[str, Any]] = Field(default_factory=list)
  connected_users_count: int = Field(default=0, description="Number of connected users")
  anonymous_users_count: int = Field(default=0, description="Number of anonymous users")


class UserJoinedMessage(WSMessage):
  """User joined the orb."""
  type: Literal["user_joined"] = "user_joined"
  orb_id: str
  user_id: str
  username: Optional[str] = Field(None, description="User's username (optional for backward compatibility)")


class UserLeftMessage(WSMessage):
  """User left the orb."""
  type: Literal["user_left"] = "user_left"
  orb_id: str
  user_id: str
  username: Optional[str] = Field(None, description="User's username (optional for backward compatibility)")


class ViewCenterUpdateMessage(WSMessage):
  """User's view center updated."""
  type: Literal["view_center_update"] = "view_center_update"
  orb_id: str
  user_id: str
  view_center: Dict[str, float] = Field(
    ...,
    description="Spherical coordinates (quantized, theta normalized to 0-2π): {radius, phi, theta}"
  )


class PingMessage(WSMessage):
  """Ping message (server -> client for heartbeat)."""
  type: Literal["ping"] = "ping"


class PongMessage(WSMessage):
  """Pong message (client -> server in response to ping)."""
  type: Literal["pong"] = "pong"


class ConnectedUsersCountMessage(WSMessage):
  """Update on connected users count."""
  type: Literal["connected_users_count"] = "connected_users_count"
  orb_id: str
  connected_users_count: int = Field(..., description="Total number of connected users")
  anonymous_users_count: int = Field(..., description="Number of anonymous users")


# Union type for client messages (excluding ping/pong which are handled separately)
ClientMessage = CreateOrbMessage | DeleteOrbMessage | CreatePaperMessage | DeletePaperMessage | GetStateMessage | UpdateViewCenterMessage


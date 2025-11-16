from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from .pin import PinCreate


class PinData(BaseModel):
  """Embedded pin data (no id needed since it's part of Paper)."""
  position: Dict[str, float] = Field(..., description="3D position as {x, y, z}")
  color: str = Field(..., description="Hex color string")


class PaperData(BaseModel):
  """Geometry and transform data for a paper on the orb."""
  center: Optional[Dict[str, float]] = Field(None, description="Center position {x, y, z}")
  quaternion: Optional[Dict[str, float]] = Field(None, description="Rotation quaternion {x, y, z, w}")
  basisRight: Optional[Dict[str, float]] = Field(None, description="Right basis vector {x, y, z}")
  basisUp: Optional[Dict[str, float]] = Field(None, description="Up basis vector {x, y, z}")
  positions: Optional[List[float]] = Field(None, description="Vertex positions array")
  normals: Optional[List[float]] = Field(None, description="Vertex normals array")
  scale: Optional[float] = Field(None, description="Paper scale factor")
  aspect: Optional[float] = Field(None, description="Aspect ratio (width/height)")
  rotation: Optional[float] = Field(None, description="Rotation angle in radians")
  layerOffset: Optional[float] = Field(None, description="Z-stacking offset")


class PaperBase(BaseModel):
  user_id: str = Field(..., min_length=1, max_length=64)
  username: Optional[str] = Field(None, min_length=1, max_length=64, description="User's username")
  source_url: str = Field(..., description="URL to the image asset")
  data: Optional[PaperData] = Field(None, description="Geometry/transform metadata")


class PaperCreate(PaperBase):
  pin: Optional[PinCreate] = Field(None, description="Pin data (optional, but required for paper placement)")


class PaperResponse(PaperBase):
  id: str
  orb_id: str
  created_at: datetime
  uploaded: bool
  validated: bool
  pin: PinData

  class Config:
    from_attributes = True


class PaperUpdate(BaseModel):
  source_url: Optional[str] = None
  uploaded: Optional[bool] = None
  validated: Optional[bool] = None
  data: Optional[PaperData] = None
  pin: Optional[PinCreate] = None


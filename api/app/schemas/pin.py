from datetime import datetime
from typing import Dict

from pydantic import BaseModel, Field


class PinCreate(BaseModel):
  position: Dict[str, float] = Field(..., description="3D position as {x, y, z}")
  color: str = Field(..., description="Hex color string")


class PinResponse(BaseModel):
  id: str
  paper_id: str
  position: Dict[str, float]
  created_at: datetime

  class Config:
    from_attributes = True




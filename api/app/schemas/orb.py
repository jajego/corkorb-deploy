from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from .paper import PaperResponse


class OrbBase(BaseModel):
  max_papers: int = Field(default=50, ge=1, le=100)
  shape: Literal["sphere", "cube", "pyramid"] = "sphere"


class OrbCreate(OrbBase):
  pass


class OrbResponse(OrbBase):
  id: str
  created_at: datetime
  updated_at: datetime
  last_accessed: Optional[datetime] = None
  papers: Optional[List[PaperResponse]] = Field(None, description="Papers in this orb (included in GET requests)")

  class Config:
    from_attributes = True


class OrbUpdate(BaseModel):
  last_accessed: Optional[datetime] = None


class OrbSummary(BaseModel):
  id: str
  shape: Literal["sphere", "cube", "pyramid"]
  paper_count: int
  max_papers: int
  expires_at: datetime


class UserOrbsResponse(BaseModel):
  created: List[OrbSummary]
  contributed: List[OrbSummary]




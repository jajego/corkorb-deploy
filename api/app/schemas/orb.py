from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from .paper import PaperResponse


class OrbBase(BaseModel):
  max_papers: int = Field(default=50, ge=1, le=100)


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




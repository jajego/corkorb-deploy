from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
  from .paper import Paper


class Orb(Base):
  __tablename__ = "orbs"

  # ID is now a passphrase (e.g., "cosmic-orb", "starry-sphere")
  # Max length set to 64 to accommodate passphrases and suffixes
  id: Mapped[str] = mapped_column(String(64), primary_key=True)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
  updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
  last_accessed: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
  max_papers: Mapped[int] = mapped_column(Integer, default=50)
  shape: Mapped[str] = mapped_column(String(16), default="sphere", server_default="sphere")

  papers: Mapped[List["Paper"]] = relationship("Paper", back_populates="orb", cascade="all, delete-orphan")

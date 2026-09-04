from datetime import datetime
from typing import TYPE_CHECKING, List

from sqlalchemy import DateTime, ForeignKey, Integer, String
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
  owner_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

  papers: Mapped[List["Paper"]] = relationship("Paper", back_populates="orb", cascade="all, delete-orphan")
  contributors: Mapped[List["OrbContributor"]] = relationship(
    "OrbContributor", back_populates="orb", cascade="all, delete-orphan"
  )


class OrbContributor(Base):
  __tablename__ = "orb_contributors"

  user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
  orb_id: Mapped[str] = mapped_column(
    ForeignKey("orbs.id", ondelete="CASCADE"), primary_key=True, index=True
  )
  contributed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

  orb: Mapped[Orb] = relationship("Orb", back_populates="contributors")

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Dict, Optional
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
  from .orb import Orb


class Paper(Base):
  __tablename__ = "papers"

  id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: uuid4().hex)
  orb_id: Mapped[str] = mapped_column(ForeignKey("orbs.id", ondelete="CASCADE"))
  user_id: Mapped[str] = mapped_column(String(64))
  username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
  source_url: Mapped[str] = mapped_column(Text)
  created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
  uploaded: Mapped[bool] = mapped_column(Boolean, default=False)
  validated: Mapped[bool] = mapped_column(Boolean, default=False)
  data: Mapped[Optional[Dict[str, Optional[float]]]] = mapped_column(JSONB, default=dict)
  pin_position: Mapped[Dict] = mapped_column(JSONB, nullable=False)

  orb: Mapped["Orb"] = relationship("Orb", back_populates="papers")


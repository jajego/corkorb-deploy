from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ImageCleanup(Base):
  """Independent of papers/orbs so deletion cannot cascade away pending work."""
  __tablename__ = 'image_cleanup'
  paper_id: Mapped[str] = mapped_column(String(64), primary_key=True)
  orb_id: Mapped[str] = mapped_column(String(255))
  file_extension: Mapped[str] = mapped_column(String(16))
  storage_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
  broadcast_sent: Mapped[bool] = mapped_column(Boolean, default=False)
  next_attempt: Mapped[datetime] = mapped_column(DateTime(timezone=True))
  last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

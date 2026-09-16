from datetime import date

from sqlalchemy import Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class UsageCounter(Base):
  __tablename__ = 'usage_counters'
  scope: Mapped[str] = mapped_column(String(128), primary_key=True)
  period: Mapped[date] = mapped_column(Date, primary_key=True)
  used: Mapped[int] = mapped_column(Integer, nullable=False)

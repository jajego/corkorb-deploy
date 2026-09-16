"""Atomic, persistent quotas shared by every process using this database."""
from datetime import date, datetime, timezone
from dataclasses import dataclass

from sqlalchemy import create_engine, text

from app.config import get_settings

UPLOADS_PER_DAY = 50
REKOGNITION_PER_MONTH = 4000
engine = create_engine(get_settings().database_url, pool_pre_ping=True)


class MonthlyModerationLimit(Exception):
  pass


def consume(connection, scope, period, limit, amount=1):
  if not 1 <= amount <= limit:
    raise ValueError('Invalid quota reservation size')
  # The conflicting row is locked by PostgreSQL. The predicate and increment are atomic.
  result = connection.execute(text('''
    INSERT INTO usage_counters (scope, period, used) VALUES (:scope, :period, :amount)
    ON CONFLICT (scope, period) DO UPDATE SET used = usage_counters.used + :amount
    WHERE usage_counters.used + :amount <= :limit
    RETURNING used
  '''), {'scope': scope, 'period': period, 'limit': limit, 'amount': amount})
  return result.scalar_one_or_none() is not None


def reserve_upload(user_id: str) -> bool:
  with engine.begin() as connection:
    return consume(connection, 'upload:' + user_id, datetime.now(timezone.utc).date(), UPLOADS_PER_DAY)


def detect_moderation(client, **kwargs):
  # Commit before the network call. Failed/uncertain calls still consume budget.
  with engine.begin() as connection:
    period = datetime.now(timezone.utc).date().replace(day=1)
    if not consume(connection, 'rekognition', period, REKOGNITION_PER_MONTH):
      raise MonthlyModerationLimit('Monthly Rekognition limit reached (4000 attempts).')
  return client.detect_moderation_labels(**kwargs)


def reserve_moderation_calls(amount, minimum=None):
  period = datetime.now(timezone.utc).date().replace(day=1)
  with engine.begin() as connection:
    for count in range(amount, (minimum or amount) - 1, -1):
      if consume(connection, 'rekognition', period, REKOGNITION_PER_MONTH, count):
        return ModerationReservation(period, count)
    raise MonthlyModerationLimit('Not enough monthly moderation budget. Please try again later or next month (UTC).')


def release_moderation_calls(period, amount):
  if amount:
    with engine.begin() as connection:
      connection.execute(text('''UPDATE usage_counters SET used = used - :amount
        WHERE scope = 'rekognition' AND period = :period AND used >= :amount'''),
        {'period': period, 'amount': amount})


@dataclass
class ModerationReservation:
  period: date
  remaining: int

  def detect(self, client, **kwargs):
    if self.remaining <= 0 or datetime.now(timezone.utc).date().replace(day=1) != self.period:
      raise MonthlyModerationLimit('Reserved moderation budget exhausted or expired.')
    self.remaining -= 1
    return client.detect_moderation_labels(**kwargs)

  def close(self):
    release_moderation_calls(self.period, self.remaining)
    self.remaining = 0

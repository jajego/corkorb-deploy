from concurrent.futures import ThreadPoolExecutor
from datetime import date
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine, text

from app.models.usage import UsageCounter
from app.services import usage


@pytest.fixture
def quota_engine(tmp_path, monkeypatch):
  engine = create_engine('sqlite:///' + str(tmp_path / 'usage.db'), connect_args={'timeout': 30})
  UsageCounter.__table__.create(engine)
  monkeypatch.setattr(usage, 'engine', engine)
  yield engine
  engine.dispose()


def test_daily_quota_is_atomic_and_scoped(quota_engine):
  def attempt(_):
    return usage.reserve_upload('test-user')
  with ThreadPoolExecutor(max_workers=12) as pool:
    assert sum(pool.map(attempt, range(80))) == 50
  assert usage.reserve_upload('another-user')
  with quota_engine.begin() as connection:
    assert usage.consume(connection, 'upload:test-user', date(2000, 1, 1), 50)


def test_monthly_quota_counts_failures_and_blocks_network(quota_engine):
  from datetime import datetime, timezone
  period = datetime.now(timezone.utc).date().replace(day=1)
  with quota_engine.begin() as connection:
    connection.execute(text('INSERT INTO usage_counters VALUES (:scope, :period, 3999)'),
                       {'scope': 'rekognition', 'period': period})
  client = Mock()
  client.detect_moderation_labels.side_effect = RuntimeError('network failed')
  with pytest.raises(RuntimeError):
    usage.detect_moderation(client, Image={})
  with pytest.raises(usage.MonthlyModerationLimit):
    usage.detect_moderation(client, Image={})
  assert client.detect_moderation_labels.call_count == 1
  with quota_engine.begin() as connection:
    assert usage.consume(connection, 'rekognition', date(2000, 1, 1), 4000)


@pytest.mark.asyncio
@pytest.mark.parametrize('initial_usage, expected_calls', [(3998, 2), (3999, 1)])
async def test_static_retry_claims_capacity_only_when_needed(quota_engine, monkeypatch, initial_usage, expected_calls):
  from datetime import datetime, timezone
  from types import SimpleNamespace
  from unittest.mock import AsyncMock
  from botocore.exceptions import ClientError
  from app.workers import rekognition_async as worker

  period = datetime.now(timezone.utc).date().replace(day=1)
  with quota_engine.begin() as connection:
    connection.execute(text('INSERT INTO usage_counters VALUES (:scope, :period, :used)'),
                       {'scope': 'rekognition', 'period': period, 'used': initial_usage})
  budget = usage.reserve_moderation_calls(1)
  with quota_engine.connect() as connection:
    assert connection.execute(text("SELECT used FROM usage_counters")).scalar_one() == initial_usage + 1
  client = Mock()
  client.detect_moderation_labels.side_effect = [
    ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'retry'}}, 'DetectModerationLabels'),
    {'ModerationLabels': []},
  ]
  monkeypatch.setattr(worker, 'get_settings', lambda: SimpleNamespace(local_file_storage=False, rekognition_min_confidence=80))
  monkeypatch.setattr(worker, 'get_rekognition_client', lambda: client)
  monkeypatch.setattr(worker.s3_service, 'get_s3_uri_for_rekognition', lambda *args: {})
  monkeypatch.setattr(worker.asyncio, 'sleep', AsyncMock())
  validated = AsyncMock()
  monkeypatch.setattr(worker, 'mark_paper_validated', validated)
  await worker.check_image_safety_async('paper', 'orb', 'png', reservation=budget)
  assert client.detect_moderation_labels.call_count == expected_calls
  assert validated.await_count == expected_calls - 1
  with quota_engine.connect() as connection:
    assert connection.execute(text("SELECT used FROM usage_counters")).scalar_one() == 4000


def test_database_failure_never_calls_aws(monkeypatch):
  engine = Mock()
  engine.begin.side_effect = RuntimeError('database unavailable')
  monkeypatch.setattr(usage, 'engine', engine)
  client = Mock()
  with pytest.raises(RuntimeError):
    usage.detect_moderation(client, Image={})
  client.detect_moderation_labels.assert_not_called()


def test_monthly_budget_is_atomic_under_concurrent_calls(quota_engine):
  from datetime import datetime, timezone
  period = datetime.now(timezone.utc).date().replace(day=1)
  with quota_engine.begin() as connection:
    connection.execute(text('INSERT INTO usage_counters VALUES (:scope, :period, 3990)'),
                       {'scope': 'rekognition', 'period': period})
  client = Mock()
  def attempt(_):
    try:
      usage.detect_moderation(client, Image={})
      return True
    except usage.MonthlyModerationLimit:
      return False
  with ThreadPoolExecutor(max_workers=12) as pool:
    assert sum(pool.map(attempt, range(40))) == 10
  assert client.detect_moderation_labels.call_count == 10


def test_reservation_accounts_for_inflight_and_returns_unused_calls(quota_engine):
  from datetime import datetime, timezone
  period = datetime.now(timezone.utc).date().replace(day=1)
  with quota_engine.begin() as connection:
    connection.execute(text('INSERT INTO usage_counters VALUES (:scope, :period, 3992)'),
                       {'scope': 'rekognition', 'period': period})
  budget = usage.reserve_moderation_calls(8)
  with pytest.raises(usage.MonthlyModerationLimit):
    usage.reserve_moderation_calls(1)
  client = Mock()
  budget.detect(client, Image={})
  budget.close()
  budget.close()  # Closing twice must not refund twice.
  with quota_engine.connect() as connection:
    assert connection.execute(text("SELECT used FROM usage_counters WHERE scope='rekognition'")).scalar_one() == 3993
  with pytest.raises(usage.MonthlyModerationLimit):
    budget.detect(client, Image={})
  assert client.detect_moderation_labels.call_count == 1

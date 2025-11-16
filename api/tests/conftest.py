import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.dialects.sqlite import JSON as SQLiteJSON
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.dialects.postgresql import JSONB

from app.db.base import Base


# In-memory SQLite for testing (faster than Postgres for unit tests)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
  TEST_DATABASE_URL,
  connect_args={"check_same_thread": False},
  poolclass=StaticPool,
  echo=False,
)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


# Patch JSONB to use JSON for SQLite
@event.listens_for(Base.metadata, "before_create")
def receive_before_create(target, connection, **kw):
  """Replace JSONB with JSON for SQLite compatibility."""
  if connection.dialect.name == "sqlite":
    for table in target.tables.values():
      for column in table.columns:
        if isinstance(column.type, JSONB):
          column.type = SQLiteJSON()


@pytest_asyncio.fixture(scope="function")
async def db_session():
  """Create a fresh database session for each test."""
  # Create tables
  async with test_engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)

  # Create session
  async with TestSessionLocal() as session:
    try:
      yield session
    finally:
      await session.rollback()
      await session.close()

  # Drop tables
  async with test_engine.begin() as conn:
    await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(scope="function")
async def override_get_session(db_session):
  """Override the dependency to use the test session."""
  async def _get_session():
    yield db_session
  return _get_session


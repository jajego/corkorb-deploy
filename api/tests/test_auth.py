import pytest
from starlette.requests import Request

from app.utils import auth


@pytest.mark.asyncio
async def test_get_current_user_id_returns_verified_token_subject(monkeypatch):
  async def verify_token(token: str) -> dict:
    assert token == "test-token"
    return {"user_id": "user_new", "username": None, "email": None}

  monkeypatch.setattr(auth, "verify_clerk_token", verify_token)
  request = Request({
    "type": "http",
    "method": "GET",
    "scheme": "http",
    "path": "/api/me/orbs",
    "root_path": "",
    "query_string": b"",
    "headers": [(b"authorization", b"Bearer test-token")],
    "server": ("testserver", 80),
    "client": ("testclient", 50000),
  })

  assert await auth.get_current_user_id(request) == "user_new"

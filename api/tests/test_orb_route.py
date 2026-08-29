from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.repositories import orb as orb_repo
from app.routes import orb as orb_route


@pytest.mark.asyncio
async def test_get_orb_can_skip_paper_payload(monkeypatch):
    now = datetime.now(timezone.utc)
    orb = SimpleNamespace(
        id="quick-cork",
        created_at=now,
        updated_at=now,
        last_accessed=None,
        max_papers=50,
        shape="cube",
    )

    async def get_orb_by_id(_session, _orb_id):
        return orb

    async def unexpected_paper_fetch(_session, _orb_id):
        raise AssertionError("metadata requests must not fetch papers")

    monkeypatch.setattr(orb_repo, "get_orb_by_id", get_orb_by_id)
    monkeypatch.setattr(orb_route.paper_service, "get_papers_for_orb", unexpected_paper_fetch)

    response = await orb_route.get_orb(
        orb_id=orb.id,
        session=object(),
        include_papers=False,
        user_id=None,
    )

    assert response.shape == "cube"
    assert response.papers is None

# CorkOrb API

FastAPI-based backend that manages orbs, papers, pins, and realtime websocket updates.

## Getting Started

```bash
# from project root
cd api
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install --upgrade pip
pip install -r requirements.txt

# run dev server
uvicorn app.main:app --reload
```

The server will start on http://127.0.0.1:8000 by default.

## Project Layout

- `app/config.py` – environment configuration & settings
- `app/main.py` – FastAPI application factory and router wiring
- `app/routes/` – HTTP endpoints (per resource module)
- `app/ws/` – websocket handlers
- `app/models/` – SQLAlchemy ORM models
- `app/schemas/` – Pydantic request/response schemas
- `app/db/` – database session management & base metadata
- `app/services/` – business logic / orchestration layer
- `app/repositories/` – data access helpers
- `app/workers/` – background workers (stubs)
- `app/utils/` – shared utilities (logging, id helpers, etc.)
- `tests/` – unit/integration tests
- `alembic/` – database migration scripts

Copy `env.example` to `.env` and adjust values before running locally.

### Database Migrations

```bash
alembic upgrade head  # apply latest migrations
alembic revision --autogenerate -m "describe change"  # create new migration
```

## Next Steps

1. Define SQLAlchemy models & Alembic migrations.
2. Implement REST endpoints for orbs/papers.
3. Add websocket gateway for realtime updates.
4. Integrate Redis/Postgres connections via `app/config.py`.



# CorkOrb API

The FastAPI service owns orb and paper persistence, authenticated REST uploads, WebSocket collaboration, S3 image lifecycle, and asynchronous Rekognition moderation. See the [repository README](../README.md) for the full local setup, environment-variable reference, AWS/CloudFront CORS configuration, and deployment guide.

```powershell
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item env.example .env
alembic upgrade head
python run_local.py
```

Run the backend checks with:

```powershell
python -m pytest tests -q
python -m compileall app
```

Railway runs `python -m alembic upgrade head` through the checked-in pre-deploy command. The API service starts with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; the separate cleanup job, when enabled, runs `python -m app.cron.cleanup_old_orbs`.

`GET /api/me/orbs` returns the authenticated user's created and contributed corks, including paper counts and expiration timestamps, without extending their lifetime.

With `APP_LOCAL_FILE_STORAGE=true`, uploaded images are served from `.local_uploads` so AWS is not required for local development. The setting defaults to false, leaving deployed environments on S3 and Rekognition.

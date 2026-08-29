# CorkOrb

CorkOrb is a shared 3D corkboard: people pin images to a sphere, cube, or square pyramid and see updates in real time. Papers curve around spheres and wrap across polygon edges. The frontend is a React/Vite app rendered with React Three Fiber; the FastAPI backend stores cork and paper metadata in PostgreSQL, coordinates connections through Redis, stores images in private S3 behind CloudFront, and moderates uploads asynchronously with Rekognition.

## Architecture

- `src/` — React 19, TypeScript, Clerk authentication, Three.js scene and WebSocket client.
- `api/app/` — FastAPI routes, SQLAlchemy services/repositories, WebSocket gateway, S3 integration, and async moderation worker.
- PostgreSQL — persisted orbs, papers, placement geometry, and pins.
- Redis — distributed paper-creation lock and cross-instance WebSocket broadcasts.
- S3 + CloudFront — private image objects and CDN delivery.

Paper geometry (`positions` and `normals`) remains persisted and sent for compatibility, including projected cube and pyramid stickers. It is potentially the largest part of a paper payload; do not compact it without proving deterministic reconstruction from the stored placement inputs and supporting old records.

## Local setup

Prerequisites: Node.js 20+, Python 3.11–3.13, PostgreSQL, and Redis. Clerk and AWS are required for authenticated uploads.

```powershell
# frontend
npm install
$env:VITE_CLERK_PUBLISHABLE_KEY = "pk_test_..."
$env:VITE_API_BASE_URL = "http://localhost:8000"
npm run dev

# backend (a second terminal)
cd api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

The frontend runs on `http://localhost:5173`; the API defaults to `http://localhost:8000`.

## Configuration

Use the `APP_*` names below for new deployments. The backend deliberately accepts the listed unprefixed aliases for existing Railway services; do not remove an alias until every deployment has migrated.

| Purpose | Canonical name | Legacy alias |
| --- | --- | --- |
| Database | `APP_DATABASE_URL` | `DATABASE_URL` |
| Redis | `APP_REDIS_URL` | `REDIS_URL` |
| Clerk secret | `APP_CLERK_SECRET_KEY` | `CLERK_SECRET_KEY` |
| Clerk publishable key | `APP_CLERK_PUBLISHABLE_KEY` | `CLERK_PUBLISHABLE_KEY` |
| AWS access key | `APP_AWS_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` |
| AWS secret key | `APP_AWS_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` |
| AWS region | `APP_AWS_REGION` | `AWS_REGION` |
| S3 bucket | `APP_AWS_S3_BUCKET_NAME` | `AWS_S3_BUCKET_NAME` |
| CloudFront base URL | `APP_CDN_BASE_URL` | `CDN_BASE_URL` |
| Rekognition threshold | `APP_REKOGNITION_MIN_CONFIDENCE` | `REKOGNITION_MIN_CONFIDENCE` |

Also set `APP_ENV`, `APP_DEBUG`, and `APP_ALLOWED_ORIGINS_RAW` (a comma-separated list). The frontend requires `VITE_CLERK_PUBLISHABLE_KEY`; `VITE_API_BASE_URL` is optional locally and required when the API is not localhost.

Never commit `.env` files or AWS keys. Use Railway/Vercel environment settings and an IAM principal restricted to this bucket and the Rekognition action the worker needs. Production startup rejects missing Clerk, database, S3, CDN, and AWS credentials.

## Images, CloudFront, and moderation

The API validates an image, uploads it to S3 first, then creates the database record, broadcasts a `paper_created` event, and starts asynchronous Rekognition moderation. Unsafe images are deleted from S3 and the database and emit `paper_deleted` with `nsfw_violation`.

Keep the bucket private and use CloudFront Origin Access Control. For browser texture loading, configure all of the following:

1. S3 bucket CORS allowing the deployed frontend origin and `GET`, `HEAD`, and `OPTIONS`.
2. CloudFront's managed **`CORS-S3Origin`** origin-request policy.
3. CloudFront's managed **`CORS-and-SecurityHeadersPolicy`** response-headers policy.

If an upload succeeds but the image fails after refresh, verify the CloudFront URL resolves, invalidate only when necessary, then inspect the response for `Access-Control-Allow-Origin` matching the frontend origin. A working upload response alone does not prove that CloudFront can serve the image to a WebGL texture.

## Migrations and checks

```powershell
# from the repository root
npm run lint
npm run build
npm test

# from api
python -m pytest tests -q
python -m compileall app
```

Apply existing schema changes with `cd api; alembic upgrade head`. Create a migration only for a backwards-compatible, reviewed schema change.

## Deployment

Vercel builds the frontend with `npm run build` and serves `dist` (see `vercel.json`). Set `VITE_API_BASE_URL` to the public Railway API URL and configure Clerk's allowed origins/redirect URLs for `https://corkorb.com`.

Railway builds the backend from `api/requirements.txt`. The checked-in `api/railway.json` applies migrations as a pre-deploy command, so a failed migration prevents the new application version from starting. Set the API service start command to:

```sh
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Run the cleanup cron separately with `python -m app.cron.cleanup_old_orbs` if it is enabled. Keep PostgreSQL, Redis, the API, and the moderation-capable AWS credentials available to the backend service; no CloudFront, S3, or production-data mutation is performed by this repository setup.

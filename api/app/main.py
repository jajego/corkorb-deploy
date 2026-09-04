import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routes import health, orb, paper
from .ws import orb as orb_ws
from .ws.connection_manager import start_redis_subscriber, stop_redis_subscriber
from .services.s3 import LOCAL_UPLOAD_DIR

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
  settings = get_settings()
  
  # Validate required configuration in production
  if settings.env != "local" and not settings.debug:
    required_settings = []
    if not settings.clerk_secret_key:
      required_settings.append("APP_CLERK_SECRET_KEY")
    if not settings.clerk_publishable_key:
      required_settings.append("APP_CLERK_PUBLISHABLE_KEY")
    if not settings.database_url or settings.database_url.startswith("postgresql+psycopg://postgres:postgres@localhost"):
      required_settings.append("APP_DATABASE_URL")
    if not settings.aws_access_key_id:
      required_settings.append("APP_AWS_ACCESS_KEY_ID")
    if not settings.aws_secret_access_key:
      required_settings.append("APP_AWS_SECRET_ACCESS_KEY")
    if not settings.aws_s3_bucket_name:
      required_settings.append("APP_AWS_S3_BUCKET_NAME")
    if not settings.cdn_base_url:
      required_settings.append("APP_CDN_BASE_URL")
    
    if required_settings:
      missing = ", ".join(required_settings)
      raise ValueError(
        f"Missing required environment variables for production: {missing}. "
        f"Please set these in your environment configuration."
      )
  
  app = FastAPI(title=settings.name, debug=settings.debug, version="0.1.0")

  # CORS
  app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
  )

  if settings.local_file_storage:
    LOCAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/local-images", StaticFiles(directory=LOCAL_UPLOAD_DIR), name="local-images")

  # Keep normal request paths quiet; failures retain method, path, and status.
  @app.middleware("http")
  async def log_requests(request: Request, call_next):
    # Skip logging for WebSocket upgrade requests (they're handled separately)
    if request.headers.get("upgrade", "").lower() == "websocket":
      return await call_next(request)
    
    try:
      response = await call_next(request)
      if response.status_code >= 500:
        logger.error("Request failed: %s %s (%s)", request.method, request.url.path, response.status_code)
      elif response.status_code >= 400:
        logger.warning("Request rejected: %s %s (%s)", request.method, request.url.path, response.status_code)
      return response
    except Exception:
      logger.exception("Request crashed: %s %s", request.method, request.url.path)
      raise

  # routers
  app.include_router(health.router, prefix="/health", tags=["health"])
  app.include_router(orb.router, prefix="/api", tags=["orbs"])
  app.include_router(paper.router, prefix="/api", tags=["papers"])
  app.include_router(orb_ws.router)

  # Startup: Start Redis pub/sub subscriber for cross-instance broadcasting
  @app.on_event("startup")
  async def startup_event():
    try:
      await start_redis_subscriber(orb_ws.connection_manager)
      logger.info("Application startup complete")
    except Exception as e:
      logger.error(f"Error during application startup: {e}", exc_info=True)
      # Don't raise - allow app to start even if Redis subscriber fails
      # The subscriber will retry automatically

  # Shutdown: Stop Redis pub/sub subscriber
  @app.on_event("shutdown")
  async def shutdown_event():
    await stop_redis_subscriber()
    logger.info("Application shutdown complete")

  logger.info("FastAPI app created successfully")
  return app


app = create_app()

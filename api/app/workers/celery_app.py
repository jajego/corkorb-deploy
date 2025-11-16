"""Celery application configuration."""

import os
from celery import Celery

from app.config import get_settings

settings = get_settings()

# Create Celery app
celery_app = Celery(
  "corkorb",
  broker=settings.redis_url,  # Use Redis as message broker
  backend=settings.redis_url,  # Use Redis as result backend
  include=["app.workers.rekognition"],  # Include task modules
)

# Celery configuration
celery_app.conf.update(
  task_serializer="json",
  accept_content=["json"],
  result_serializer="json",
  timezone="UTC",
  enable_utc=True,
  task_track_started=True,
  task_time_limit=30,  # 30 second timeout per task
  task_soft_time_limit=25,  # 25 second soft timeout
  worker_prefetch_multiplier=1,  # Process one task at a time
  worker_max_tasks_per_child=50,  # Restart worker after 50 tasks (memory management)
)


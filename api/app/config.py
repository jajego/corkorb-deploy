from functools import lru_cache
from typing import List, Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")

  name: str = "CorkOrb API"
  env: str = "local"
  debug: bool = True
  host: str = "0.0.0.0"
  port: int = 8000
  allowed_origins_raw: str | List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

  # database / caches
  database_url: str = Field(
    default="postgresql+psycopg://postgres:postgres@localhost:5432/corkorb",
    validation_alias=AliasChoices("APP_DATABASE_URL", "DATABASE_URL"),
  )
  redis_url: str = Field(
    default="redis://localhost:6379/0",
    validation_alias=AliasChoices("APP_REDIS_URL", "REDIS_URL"),
  )

  # Clerk authentication
  clerk_secret_key: str = Field(
    default="",
    validation_alias=AliasChoices("APP_CLERK_SECRET_KEY", "CLERK_SECRET_KEY"),
    description="Clerk secret key for JWT verification"
  )
  clerk_publishable_key: str = Field(
    default="",
    validation_alias=AliasChoices("APP_CLERK_PUBLISHABLE_KEY", "CLERK_PUBLISHABLE_KEY"),
    description="Clerk publishable key (for frontend)"
  )
  
  # Legacy auth placeholders (for backward compatibility)
  jwt_algorithm: str = "RS256"
  jwt_public_key_path: str = "./keys/jwt_public.pem"
  
  # AWS S3 Configuration
  aws_access_key_id: str = Field(
    default="",
    validation_alias=AliasChoices("APP_AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"),
    description="AWS access key ID for S3 uploads"
  )
  aws_secret_access_key: str = Field(
    default="",
    validation_alias=AliasChoices("APP_AWS_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY"),
    description="AWS secret access key for S3 uploads"
  )
  aws_region: str = Field(
    default="us-east-1",
    validation_alias=AliasChoices("APP_AWS_REGION", "AWS_REGION"),
    description="AWS region for S3 bucket"
  )
  aws_s3_bucket_name: str = Field(
    default="",
    validation_alias=AliasChoices("APP_AWS_S3_BUCKET_NAME", "AWS_S3_BUCKET_NAME"),
    description="S3 bucket name for image storage"
  )
  cdn_base_url: str = Field(
    default="",
    validation_alias=AliasChoices("APP_CDN_BASE_URL", "CDN_BASE_URL"),
    description="CDN base URL for serving images"
  )
  
  # AWS Rekognition Configuration
  rekognition_min_confidence: float = Field(
    default=50.0,
    validation_alias=AliasChoices("APP_REKOGNITION_MIN_CONFIDENCE", "REKOGNITION_MIN_CONFIDENCE"),
    description="Minimum confidence threshold for Rekognition moderation labels (0-100)"
  )


  @property
  def allowed_origins(self) -> List[str]:
    if isinstance(self.allowed_origins_raw, str):
      return [origin.strip() for origin in self.allowed_origins_raw.split(",") if origin.strip()]
    return list(self.allowed_origins_raw)


@lru_cache
def get_settings() -> Settings:
  return Settings()


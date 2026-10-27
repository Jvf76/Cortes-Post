from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "sqlite:///./cortes.db"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "development-only-change-me-please-32chars"
    token_encryption_key: str | None = None
    app_base_url: str = "http://localhost:8000"
    frontend_url: str = "http://localhost:3000"
    cookie_secure: bool = False
    storage_dir: Path = Path("./storage")
    max_upload_bytes: int = 2 * 1024**3
    max_source_duration_seconds: int = 3600
    max_rendered_clips: int = 3
    youtube_client_id: str | None = None
    youtube_client_secret: str | None = None
    youtube_redirect_uri: str = "http://localhost:8000/api/accounts/youtube/callback"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"
    whisper_model: str = "small"
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    subtitle_font: str = "DejaVu Sans"
    media_timeout_seconds: int = 900
    media_cpu_seconds: int = 900
    media_memory_bytes: int = 4 * 1024**3
    retention_days: int = 7
    youtube_import_timeout_seconds: int = 900
    youtube_metadata_timeout_seconds: int = 120
    youtube_max_height: int = 1080
    celery_task_always_eager: bool = False
    session_days: int = 14

    @property
    def youtube_configured(self) -> bool:
        return bool(self.youtube_client_id and self.youtube_client_secret and self.token_encryption_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()

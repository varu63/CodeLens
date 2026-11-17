"""Environment-backed settings for the ml-service.

Every value has a safe local default so the service starts with no .env file.
The model names are fixed by the project spec and must not be swapped.
"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Fixed models
    embed_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    code_embed_model: str = "microsoft/unixcoder-base"
    llm_model: str = "qwen2.5-coder:1.5b"
    ollama_url: str = "http://localhost:11434"

    # Offline-trained artifacts, loaded once at startup
    risk_model_path: str = "models/bug_risk.joblib"
    vuln_model_path: str = "models/vuln_classifier.joblib"

    # Hard budget per stage (seconds)
    stage_timeout_seconds: float = 60.0

    # Snapshot limits
    snapshot_max_files: int = 5000
    snapshot_max_file_mb: float = 1.0
    snapshot_max_seconds: float = 60.0

    redis_url: str = "redis://localhost:6379"
    ml_service_key: str = ""

    @property
    def snapshot_max_file_bytes(self) -> int:
        return int(self.snapshot_max_file_mb * 1024 * 1024)


settings = Settings()

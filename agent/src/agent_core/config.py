"""Configuration loaded from environment variables / .env (12-factor)."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Webapp (NestJS)
    webapp_base_url: str = "http://localhost:3000"
    webapp_agent_token: str | None = None
    webapp_default_user_id: str = "local-dev"

    # Which OpenAI-compatible provider the model layer uses by default
    # ("deepseek" or "ark"). Switching providers is a one-line config change.
    model_provider: str = "deepseek"

    # Volcengine Ark (Doubao), OpenAI-compatible
    ark_api_key: str | None = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_model: str = "doubao-lite-4k"

    # DeepSeek, OpenAI-compatible
    deepseek_api_key: str | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-chat"

    # Runtime
    checkpoint_dir: str = "data/checkpoints"
    log_level: str = "INFO"


def get_settings() -> Settings:
    return Settings()


def ensure_dirs(s: Settings) -> None:
    Path(s.checkpoint_dir).mkdir(parents=True, exist_ok=True)

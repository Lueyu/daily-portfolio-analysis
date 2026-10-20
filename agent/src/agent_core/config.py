"""Configuration loaded from environment variables / .env (12-factor).

Model layout: both tiers go through the Volcengine Ark OpenAI-compatible
endpoint. The distinction is *role*, not vendor:

  - ``flash``: cheap and fast, the default for routine pipeline steps.
  - ``pro``:   stronger, reserved for high-stakes decisions (ratings, sizing).

Routing which tier a task uses is a one-line choice on the caller side; the
provider construction is identical for both.
"""

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

    # Volcengine Ark, OpenAI-compatible root, shared by both tiers.
    model_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    # Default tier for model calls: "flash" (cheap/fast) or "pro" (stronger).
    default_tier: str = "flash"

    # Flash tier: routine, cheap, fast.
    flash_api_key: str | None = None
    flash_model: str = "deepseek-v4-1-flash-260910"

    # Pro tier: high-stakes decisions.
    pro_api_key: str | None = None
    pro_model: str = "deepseek-v4-pro-260425"

    # Pricing per 1,000,000 tokens. Left at 0.0 on purpose: fill in the real
    # Ark prices via .env so the cost report reflects your account. A cost of
    # 0.0 is displayed as "price unset" rather than a fabricated number.
    flash_cost_per_mtok_input: float = 0.0
    flash_cost_per_mtok_output: float = 0.0
    pro_cost_per_mtok_input: float = 0.0
    pro_cost_per_mtok_output: float = 0.0

    # Retry / fallback policy.
    max_retries: int = 3            # total attempts for a retryable error
    fallback_to_flash: bool = True  # degrade pro -> flash when pro is unavailable

    # Runtime
    checkpoint_dir: str = "data/checkpoints"
    log_level: str = "INFO"


def get_settings() -> Settings:
    return Settings()


def ensure_dirs(s: Settings) -> None:
    Path(s.checkpoint_dir).mkdir(parents=True, exist_ok=True)

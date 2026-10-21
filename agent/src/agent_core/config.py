"""Configuration loaded from environment variables / .env (12-factor).

Model layout: both tiers go through the Volcengine Ark OpenAI-compatible
endpoint. The distinction is *role*, not vendor:

  - ``flash``: cheap and fast, the default for routine pipeline steps.
  - ``pro``:   stronger, reserved for high-stakes decisions (ratings, sizing).

Routing which tier a task uses is a one-line choice on the caller side; the
provider construction is identical for both.
"""

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Agent package root. config.py lives at agent/src/agent_core/config.py, so
# parents[2] = agent/. Every path that used to be relative to cwd is anchored
# here: the Nest dev console spawns the agent with the webapp root as cwd (so
# the coder can edit webapp files), and a relative ".env" would then be looked
# up in the webapp root and fail to find the model API keys.
AGENT_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = AGENT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
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

    # Pro tier: high-stakes decisions. Use the GA (general availability)
    # snapshot; dated non-GA snapshots like *-260425 are not directly callable
    # (they require an ep-* endpoint) and return InvalidEndpointOrModel.
    pro_api_key: str | None = None
    pro_model: str = "deepseek-v4-pro-ga-260813"

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

    # Runtime. Anchored to the package root so a non-agent cwd does not scatter
    # checkpoints into the webapp tree.
    checkpoint_dir: str = str(AGENT_ROOT / "data" / "checkpoints")
    log_level: str = "INFO"

    # Coder persona (C2).
    # Work products live under agent/data/coder no matter where the process was
    # launched from (the Nest console spawns the agent with the webapp root as
    # cwd so it can edit webapp files).
    coder_data_dir: str = str(AGENT_ROOT / "data" / "coder")
    # Webapp root the coding agent operates on = the monorepo root, one level
    # above the agent package.
    webapp_workdir: str = str(AGENT_ROOT.parent)

    @field_validator("checkpoint_dir", "coder_data_dir")
    @classmethod
    def _anchor_data_dirs(cls, value: str) -> str:
        """Resolve relative data paths against the agent package root.

        The .env can still spell these as "data/..." (a relative path); such
        values must mean *inside the agent package*, not relative to whatever
        cwd the process was spawned with. Absolute paths pass through unchanged.
        """
        path = Path(value)
        if not path.is_absolute():
            path = AGENT_ROOT / path
        return str(path)


@lru_cache(maxsize=None)
def get_settings() -> Settings:
    return Settings()


def ensure_dirs(s: Settings) -> None:
    Path(s.checkpoint_dir).mkdir(parents=True, exist_ok=True)
    Path(s.coder_data_dir).mkdir(parents=True, exist_ok=True)

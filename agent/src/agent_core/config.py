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
from typing import Literal

from pydantic import Field, field_validator
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
    # Connection tests and live model calls use the same transport policy.
    # Opt in explicitly for environment/system proxies and custom CA env vars.
    model_trust_env: bool = False
    # Per-attempt HTTP timeout, independent of the unbounded task loop.
    model_request_timeout_seconds: float = Field(default=180.0, ge=5, le=600)
    # Default tier for model calls: "flash" (cheap/fast) or "pro" (stronger).
    default_tier: str = "flash"

    # Flash tier: routine, cheap, fast.
    flash_api_key: str | None = None
    flash_model: str = "deepseek-v4-1-flash-260910"
    flash_supports_images: bool = False

    # Pro tier: high-stakes decisions. Use the GA (general availability)
    # snapshot; dated non-GA snapshots like *-260425 are not directly callable
    # (they require an ep-* endpoint) and return InvalidEndpointOrModel.
    pro_api_key: str | None = None
    pro_model: str = "deepseek-v4-pro-ga-260813"
    pro_supports_images: bool = False

    # Coding is a separate profile. Inherit the stronger existing tier unless
    # an operator selects another model; an outage must not silently downgrade.
    coder_model_tier: Literal["flash", "pro"] = "pro"
    coder_model: str | None = None
    coder_base_url: str | None = None
    coder_api_key: str | None = Field(default=None, repr=False)
    coder_api_key_env: str | None = None
    coder_context_window: int | None = Field(default=None, ge=4096)
    coder_max_output_tokens: int = Field(default=8192, ge=256, le=65536)
    coder_supports_images: bool | None = None
    coder_allow_fallback: bool = False
    coder_vision_model: str | None = None
    coder_vision_base_url: str | None = None
    coder_vision_api_key: str | None = Field(default=None, repr=False)
    coder_vision_api_key_env: str | None = None
    coder_vision_context_window: int = Field(default=128_000, ge=4096)
    coder_vision_max_output_tokens: int = Field(default=2048, ge=256, le=65536)
    coder_vision_supports_images: bool = False

    # Operator-owned integrations. These files never live inside a task copy.
    coder_mcp_config: str | None = None
    coder_settings_path: str = str(Path.home() / '.coding-agent' / 'operator-settings.json')
    coder_mcp_credentials: dict[str, str] = Field(default_factory=dict, repr=False, exclude=True)
    coder_mcp_servers: dict | None = Field(default=None, repr=False, exclude=True)
    coder_skills_dir: str | None = None
    coder_network_mode: Literal["offline", "allowlist"] = "allowlist"
    coder_network_allowed_hosts: list[str] = Field(default_factory=lambda: [
        "registry.npmjs.org", "pypi.org", "files.pythonhosted.org",
        "github.com", "api.github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
        "release-assets.githubusercontent.com", "nodejs.org", "docs.python.org", "developer.mozilla.org",
        "react.dev", "vite.dev", "typescriptlang.org", "www.typescriptlang.org", "docs.npmjs.com",
        "developer.chrome.com", "playwright.dev",
    ])
    coder_max_workers: int = Field(default=3, ge=1, le=8)
    coder_max_worker_depth: int = Field(default=1, ge=0, le=3)
    coder_context_bytes: int = Field(default=192_000, ge=16_000, le=2_000_000)

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
    # Unset means continuous work. Set a positive value only when a caller
    # explicitly wants a finite run; per-tool timeouts remain independent.
    coder_max_iterations: int | None = Field(default=None, gt=0)
    coder_max_model_calls: int | None = Field(default=None, gt=0)
    coder_wallclock_seconds: int | None = Field(default=None, gt=0)
    coder_max_probes: int | None = Field(default=None, gt=0)
    # Webapp root the coding agent operates on = the monorepo root, one level
    # above the agent package.
    webapp_workdir: str = str(AGENT_ROOT.parent)

    # Environment probes for the coder. A localhost-only whitelist; the model
    # can never supply arbitrary hosts. Used to diagnose "service not running"
    # (e.g. PostgreSQL down -> block with the start-db instruction).
    probe_pg_host: str = "127.0.0.1"
    probe_pg_port: int = 5432
    probe_backend_url: str = "http://localhost:3000"
    probe_frontend_url: str = "http://localhost:8080"
    probe_timeout_seconds: float = 2.0

    # Coder execution sandbox (P0b). When enabled, reproduction/verification run
    # in an isolated git worktree; the main checkout is touched only after a
    # human approves the patch. The isolated E2E script name and its timeout are
    # constants in safety.py / tools.py (single source of truth), so they are
    # not duplicated here.
    coder_sandbox_enabled: bool = True
    coder_worktree_dir: str = str(AGENT_ROOT / "data" / "coder" / "worktrees")
    coder_link_dependencies: bool = True
    coder_copy_env_files: bool = True
    # New tasks use the actual container runtime; legacy task artifacts stay readable.
    coder_runtime_image: str = "coding-agent-runtime:local"
    coder_docker_command: list[str] | None = None

    @field_validator("checkpoint_dir", "coder_data_dir", "coder_worktree_dir")
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
    from .operator_settings import apply_operator_settings
    return apply_operator_settings(Settings())


def ensure_dirs(s: Settings) -> None:
    Path(s.checkpoint_dir).mkdir(parents=True, exist_ok=True)
    Path(s.coder_data_dir).mkdir(parents=True, exist_ok=True)
    Path(s.coder_worktree_dir).mkdir(parents=True, exist_ok=True)

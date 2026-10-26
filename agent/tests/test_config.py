"""Configuration loading must be independent of the process working directory.

The Nest dev console spawns the agent with the webapp root as its cwd (so the
coder can edit webapp files). If the dotenv path or data directories were
relative to cwd, the spawned process would look for ``.env`` in the webapp root
and fail to find ``FLASH_API_KEY`` -- the inner loop then crashes on the first
model call while the UI just shows "new". These tests pin every path to the
agent package root.
"""

from pathlib import Path

import pytest

from agent_core import config
from agent_core.config import AGENT_ROOT, ENV_FILE, Settings


def test_agent_root_points_to_agent_package():
    assert (AGENT_ROOT / "pyproject.toml").exists()
    assert (AGENT_ROOT / "src" / "agent_core" / "config.py").exists()


def test_env_file_is_absolute_and_anchored_to_agent_root():
    assert ENV_FILE.is_absolute()
    assert ENV_FILE.name == ".env"
    assert ENV_FILE.parent == AGENT_ROOT


def test_packaged_env_loads_regardless_of_cwd(tmp_path, monkeypatch):
    """Anchored .env must still be read when cwd is an unrelated directory."""
    if not ENV_FILE.exists():
        pytest.skip("agent/.env not present (e.g. CI without local secrets)")
    monkeypatch.chdir(tmp_path)
    settings = Settings()
    # Locally the packaged .env configures at least one tier's key.
    assert settings.flash_api_key or settings.pro_api_key


def test_data_dirs_are_absolute_and_under_agent_root(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings()
    for value in (settings.coder_data_dir, settings.checkpoint_dir):
        p = Path(value)
        assert p.is_absolute(), f"{value} must be absolute, not cwd-relative"
        assert AGENT_ROOT in p.parents


def test_real_environment_overrides_dotenv(monkeypatch):
    """Explicit environment variables must keep winning over the .env file."""
    monkeypatch.setenv("FLASH_MODEL", "forced-from-env")
    monkeypatch.delenv("FLASH_API_KEY", raising=False)
    settings = Settings()
    assert settings.flash_model == "forced-from-env"
    # Restore module-level helper purity for other tests.
    config.get_settings.cache_clear()


def test_probe_defaults_target_localhost(tmp_path, monkeypatch):
    """The environment probe whitelist defaults to local services only."""
    monkeypatch.chdir(tmp_path)
    settings = Settings(_env_file=None)
    assert settings.probe_pg_host == "127.0.0.1"
    assert settings.probe_pg_port == 5432
    assert settings.probe_backend_url == "http://localhost:3000"
    assert settings.probe_frontend_url == "http://localhost:8080"
    assert settings.probe_timeout_seconds == 2.0


def test_sandbox_defaults(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    settings = Settings(_env_file=None)
    assert settings.coder_sandbox_enabled is True
    assert settings.coder_link_dependencies is True
    assert settings.coder_copy_env_files is True
    wt = Path(settings.coder_worktree_dir)
    assert wt.is_absolute()
    assert AGENT_ROOT in wt.parents


def test_sandbox_can_be_disabled(monkeypatch):
    monkeypatch.setenv("CODER_SANDBOX_ENABLED", "false")
    config.get_settings.cache_clear()
    try:
        s = Settings(_env_file=None)
        assert s.coder_sandbox_enabled is False
    finally:
        config.get_settings.cache_clear()


def test_coder_budget_defaults_are_unlimited():
    settings = Settings(_env_file=None)
    assert settings.coder_max_iterations is None
    assert settings.coder_max_model_calls is None
    assert settings.coder_wallclock_seconds is None
    assert settings.coder_max_probes is None


def test_model_network_policy_defaults_to_explicit_direct_connection(monkeypatch):
    monkeypatch.delenv('MODEL_TRUST_ENV', raising=False)
    assert Settings(_env_file=None).model_trust_env is False
    monkeypatch.setenv('MODEL_TRUST_ENV', 'true')
    assert Settings(_env_file=None).model_trust_env is True


def test_model_timeout_is_finite_and_configurable(monkeypatch):
    from pydantic import ValidationError
    monkeypatch.delenv('MODEL_REQUEST_TIMEOUT_SECONDS', raising=False)
    assert Settings(_env_file=None).model_request_timeout_seconds == 180
    monkeypatch.setenv('MODEL_REQUEST_TIMEOUT_SECONDS', '240')
    assert Settings(_env_file=None).model_request_timeout_seconds == 240
    for value in [0, float('inf'), 601]:
        with pytest.raises(ValidationError):
            Settings(_env_file=None, model_request_timeout_seconds=value)


def test_coder_budget_accepts_explicit_limits(monkeypatch):
    monkeypatch.setenv("CODER_MAX_ITERATIONS", "12")
    monkeypatch.setenv("CODER_MAX_MODEL_CALLS", "30")
    monkeypatch.setenv("CODER_WALLCLOCK_SECONDS", "600")
    monkeypatch.setenv("CODER_MAX_PROBES", "8")
    settings = Settings(_env_file=None)
    assert settings.coder_max_iterations == 12
    assert settings.coder_max_model_calls == 30
    assert settings.coder_wallclock_seconds == 600
    assert settings.coder_max_probes == 8

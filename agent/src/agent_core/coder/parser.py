"""Parse model actions into a closed, validated set of step objects.

Validation and dispatch are owned by the tool registry (registry.py). This
module defines the concrete step models and builds the default registry. An
unknown action, malformed payload or missing field raises ValueError; the
harness re-prompts rather than executing garbage.

The read-only exploration family (read_file/list_dir/glob/grep/probe_env)
shares the ReadOnlyStep marker base so the harness can route it through one
budgeted observation path.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from .models import CheckKind, Text
from .registry import Phase, ToolKind, ToolRegistry, ToolSpec


class ReadOnlyStep(BaseModel):
    """Marker base for every side-effect-free exploration tool."""

    model_config = ConfigDict(extra="forbid")


class ReadFileStep(ReadOnlyStep):
    path: Text


class ListDirStep(ReadOnlyStep):
    path: str = "."


class GlobStep(ReadOnlyStep):
    pattern: Text
    path: str = "."


class GrepStep(ReadOnlyStep):
    pattern: Text
    path: str = "."
    glob_include: str | None = None
    max_results: int = 100


class ProbeEnvStep(ReadOnlyStep):
    # Names of configured targets; None/empty means all configured targets.
    # The execution layer whitelists these against the configured localhost
    # set, so the model can never name an arbitrary host.
    targets: list[str] | None = None


class RunCheckStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: CheckKind


class ApplyPatchStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    diff: Text
    hypothesis: str = ""


class FinishStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: Text


class BlockedStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: Text


def _run_check(payload: dict) -> RunCheckStep:
    """Map the JSON 'check' name to the CheckKind enum, refusing free-form paths."""
    check = payload.get("check")
    if not isinstance(check, str) or ".." in check:
        raise ValueError("run_check requires a whitelisted check kind")
    try:
        return RunCheckStep(kind=CheckKind(check))
    except ValueError as exc:
        raise ValueError(f"unknown check kind: {check!r}") from exc


def build_default_registry() -> ToolRegistry:
    """Register every tool available to the coder."""
    reg = ToolRegistry()
    both = frozenset({Phase.REPRODUCE, Phase.DIAGNOSE})
    diagnose_only = frozenset({Phase.DIAGNOSE})

    # Read-only exploration (available in both phases).
    reg.register(ToolSpec("read_file", ToolKind.READ_ONLY, ReadFileStep, both))
    reg.register(ToolSpec("list_dir", ToolKind.READ_ONLY, ListDirStep, both))
    reg.register(ToolSpec("glob", ToolKind.READ_ONLY, GlobStep, both))
    reg.register(ToolSpec("grep", ToolKind.READ_ONLY, GrepStep, both))
    reg.register(ToolSpec("probe_env", ToolKind.READ_ONLY, ProbeEnvStep, both))
    # Verification: run an allow-listed check.
    reg.register(ToolSpec(
        "run_check", ToolKind.VERIFY, RunCheckStep, both,
        from_payload=_run_check))
    # Proposing a change or finishing is only allowed after reproduction.
    reg.register(ToolSpec(
        "apply_patch", ToolKind.PATCH, ApplyPatchStep, diagnose_only))
    reg.register(ToolSpec(
        "finish", ToolKind.TERMINAL, FinishStep, diagnose_only))
    reg.register(ToolSpec(
        "blocked", ToolKind.TERMINAL, BlockedStep, both))
    return reg


_DEFAULT_REGISTRY = build_default_registry()


def parse_agent_step(text: str) -> BaseModel:
    """Validate raw model text via the default registry."""
    return _DEFAULT_REGISTRY.parse(text)

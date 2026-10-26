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

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import CheckKind, Text
from .registry import GateKind, ToolKind, ToolRegistry, ToolSpec


class ReadOnlyStep(BaseModel):
    """Marker base for every side-effect-free exploration tool."""

    model_config = ConfigDict(extra="forbid")


class ReadFileStep(ReadOnlyStep):
    path: Text
    start_line: int = Field(default=1, ge=1, description="First line, 1-based.")
    max_lines: int = Field(default=80, ge=1, le=200)
    start_column: int = Field(
        default=1, ge=1,
        description="First character column on start_line, 1-based; follow NEXT for long lines.",
    )


class ListDirStep(ReadOnlyStep):
    path: str = "."


class GlobStep(ReadOnlyStep):
    pattern: Text
    path: str = "."


class GrepStep(ReadOnlyStep):
    pattern: Text
    path: str = Field(default=".", description="A file or directory relative to the workspace.")
    glob_include: str | None = Field(
        default=None,
        description="Optional fnmatch pattern for basename or path relative to the search directory.",
    )
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
    diff: str = Field(min_length=1)
    hypothesis: str = ""

    @field_validator("diff")
    @classmethod
    def preserve_nonempty_diff(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("diff must not be blank")
        return value


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
    """Register every tool available to the coder, with its capability gate."""
    reg = ToolRegistry()

    # Read-only exploration: always available.
    reg.register(ToolSpec("read_file", ToolKind.READ_ONLY, ReadFileStep,
                          GateKind.ALWAYS, description=(
                              "Read a numbered UTF-8 file page. Follow NEXT start_line/start_column "
                              "to read remaining content; max_lines defaults to 80.")))
    reg.register(ToolSpec("list_dir", ToolKind.READ_ONLY, ListDirStep,
                          GateKind.ALWAYS, description="List a directory (non-recursive)."))
    reg.register(ToolSpec("glob", ToolKind.READ_ONLY, GlobStep,
                          GateKind.ALWAYS, description="Find files matching a pattern."))
    reg.register(ToolSpec("grep", ToolKind.READ_ONLY, GrepStep,
                          GateKind.ALWAYS, description=(
                              "Search one file or a directory with a Python regular expression. "
                              "Results show matching lines; use read_file with start_line for context. "
                              "Truncated results require a narrower path/pattern.")))
    reg.register(ToolSpec("probe_env", ToolKind.READ_ONLY, ProbeEnvStep,
                          GateKind.ALWAYS, description="Check configured localhost services."))
    # Verification: always available; the model must run checks before patching.
    reg.register(ToolSpec(
        "run_check", ToolKind.VERIFY, RunCheckStep, GateKind.ALWAYS,
        from_payload=_run_check,
        parameters={
            "type": "object",
            "properties": {
                "check": {
                    "type": "string",
                    "enum": [c.value for c in CheckKind],
                    "description": "Which allow-listed verification command to run.",
                },
            },
            "required": ["check"],
            "additionalProperties": False,
        },
        description="Run one allow-listed verification check (unit/e2e/typecheck/lint)."))
    # Patching only after a red test was observed; finishing only after green.
    reg.register(ToolSpec(
        "apply_patch", ToolKind.PATCH, ApplyPatchStep, GateKind.NEEDS_RED,
        description="Propose a unified diff. It is applied and checked in the sandbox."))
    reg.register(ToolSpec(
        "finish", ToolKind.TERMINAL, FinishStep, GateKind.NEEDS_GREEN,
        description="Finish after the fix is verified green."))
    reg.register(ToolSpec(
        "blocked", ToolKind.TERMINAL, BlockedStep, GateKind.ALWAYS,
        description="Stop and report a blocker with its reason."))
    return reg


_DEFAULT_REGISTRY = build_default_registry()


def parse_agent_step(text: str) -> BaseModel:
    """Validate raw model text via the default registry."""
    return _DEFAULT_REGISTRY.parse(text)

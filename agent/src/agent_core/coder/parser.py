"""Parse model actions into a closed, validated set of step objects.

The model may only propose one of five actions. Anything else (unknown action,
malformed payload, a relative check script, missing required fields) raises
ValueError and the harness re-prompts rather than executing garbage.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict

from ..models import parse_json
from .models import CheckKind


class ActionType(str, Enum):
    READ_FILE = "read_file"
    RUN_CHECK = "run_check"
    APPLY_PATCH = "apply_patch"
    FINISH = "finish"
    BLOCKED = "blocked"


class ReadFileStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str


class RunCheckStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: CheckKind


class ApplyPatchStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    diff: str
    hypothesis: str = ""


class FinishStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary: str


class BlockedStep(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str


def parse_agent_step(text: str) -> BaseModel:
    """Validate raw model text and return the matching typed step."""
    data = parse_json(text)
    if not isinstance(data, dict):
        raise ValueError("model action must be a JSON object")
    action = data.get("action")
    payload = data.get("params", data)

    if action == ActionType.READ_FILE.value:
        path = payload.get("path")
        if not isinstance(path, str) or not path.strip():
            raise ValueError("read_file requires a non-empty path")
        return ReadFileStep(path=path.strip())

    if action == ActionType.RUN_CHECK.value:
        check = payload.get("check")
        if not isinstance(check, str) or ".." in check:
            raise ValueError("run_check requires a whitelisted check kind")
        try:
            kind = CheckKind(check)
        except ValueError as exc:
            raise ValueError(f"unknown check kind: {check!r}") from exc
        return RunCheckStep(kind=kind)

    if action == ActionType.APPLY_PATCH.value:
        diff = payload.get("diff")
        if not isinstance(diff, str) or not diff.strip():
            raise ValueError("apply_patch requires a non-empty diff")
        return ApplyPatchStep(
            diff=diff, hypothesis=str(payload.get("hypothesis", "") or "")
        )

    if action == ActionType.FINISH.value:
        summary = payload.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            raise ValueError("finish requires a summary")
        return FinishStep(summary=summary.strip())

    if action == ActionType.BLOCKED.value:
        reason = payload.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("blocked requires a reason")
        return BlockedStep(reason=reason.strip())

    raise ValueError(f"unsupported action: {action!r}")

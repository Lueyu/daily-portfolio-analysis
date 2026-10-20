"""Data models and the dev-task state machine for the coder persona (C2).

Plain pydantic models so tasks serialise to JSON work products and can be
replayed. The state machine is a pure, table-driven transition map: the harness
may only move between adjacent, explicitly allowed states, which makes the
loop impossible to skip (e.g. you cannot go NEW -> VERIFIED without first
reproducing the failure).
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class TaskStatus(str, Enum):
    NEW = "new"
    REPRODUCED = "reproduced"
    DIAGNOSED = "diagnosed"
    PATCHED = "patched"
    VERIFYING = "verifying"
    AWAITING_APPROVAL = "awaiting_approval"
    VERIFIED = "verified"
    BLOCKED = "blocked"


class CheckKind(str, Enum):
    """The four whitelisted verification commands (see safety.py)."""

    UNIT = "unit"
    E2E = "e2e"
    TYPECHECK = "typecheck"
    LINT = "lint"


# Allowed forward edges. Every active state can go BLOCKED (added below).
_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.NEW: {TaskStatus.REPRODUCED},
    TaskStatus.REPRODUCED: {TaskStatus.DIAGNOSED},
    TaskStatus.DIAGNOSED: {TaskStatus.PATCHED},
    TaskStatus.PATCHED: {TaskStatus.VERIFYING},
    TaskStatus.VERIFYING: {TaskStatus.AWAITING_APPROVAL, TaskStatus.DIAGNOSED},
    TaskStatus.AWAITING_APPROVAL: {TaskStatus.VERIFIED, TaskStatus.DIAGNOSED},
    TaskStatus.VERIFIED: set(),
    TaskStatus.BLOCKED: set(),
}
_ACTIVE = {
    TaskStatus.NEW,
    TaskStatus.REPRODUCED,
    TaskStatus.DIAGNOSED,
    TaskStatus.PATCHED,
    TaskStatus.VERIFYING,
    TaskStatus.AWAITING_APPROVAL,
}
for _s in _ACTIVE:
    _TRANSITIONS[_s].add(TaskStatus.BLOCKED)


def can_transition(src: TaskStatus, dst: TaskStatus) -> bool:
    """Return True only when the state machine allows src -> dst."""
    return dst in _TRANSITIONS.get(src, set())


class BudgetConfig(BaseModel):
    """Hard caps for one dev-task (defaults from the design spec, section 5.3)."""

    max_iterations: int = 8
    max_model_calls: int = 40
    wallclock_seconds: int = 1800


class AcceptanceCriterion(BaseModel):
    """A fixed, pre-written success condition. It must not be relaxed mid-task."""

    model_config = ConfigDict(extra="forbid")

    id: Text
    description: Text
    check: CheckKind
    # Optional Vitest file/name hint for the reproduction test.
    target: str | None = None


class DevTask(BaseModel):
    """The mutable work item that flows through the state machine."""

    model_config = ConfigDict(extra="forbid")

    id: Text
    title: Text
    problem: Text
    acceptance: list[AcceptanceCriterion] = Field(min_length=1)
    workdir: Text
    branch: str = ""
    status: TaskStatus = TaskStatus.NEW
    red_seen: bool = False
    # Counters used by the retry discipline (budget.py).
    diagnosis_rethink_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def transition(self, dst: TaskStatus) -> None:
        """Move to dst, raising if the transition is not allowed."""
        if not can_transition(self.status, dst):
            raise ValueError(f"illegal transition {self.status.value} -> {dst.value}")
        self.status = dst
        self.updated_at = datetime.now(timezone.utc)


class CommandResult(BaseModel):
    """Result of running one controlled subprocess."""

    model_config = ConfigDict(extra="forbid")

    argv: list[str]
    returncode: int
    stdout: str = ""
    stderr: str = ""
    duration_ms: int = 0

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class TestOutcome(BaseModel):
    """Parsed result of a verification check (unit/e2e/typecheck/lint)."""

    model_config = ConfigDict(extra="forbid")

    check: CheckKind
    passed: bool
    total: int = 0
    failed: list[str] = []
    summary: str = ""
    raw_tail: str = ""
    argv: list[str] = []


class Patch(BaseModel):
    """A proposed unified diff. It is only applied after human approval."""

    model_config = ConfigDict(extra="forbid")

    patch_id: str
    diff: str
    target_files: list[str] = []
    hypothesis: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Iteration(BaseModel):
    """One replayable record of what the agent tried in a round."""

    model_config = ConfigDict(extra="forbid")

    index: int
    phase: str
    hypothesis: str = ""
    action: str = ""
    model_calls: int = 0
    observations: list[str] = []
    decision: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

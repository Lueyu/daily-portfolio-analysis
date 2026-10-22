"""Capability gates for the gated ReAct loop.

The gates are the *only* authority that decides which tools the model may see
in a given turn. The model never unlocks tools for itself; the harness updates
the gates from deterministic evidence (a red test, a sandboxed green run).

Gate invariants (the safety properties of the whole loop):
  * ``apply_patch`` is visible only after a failing reproduction test ran.
  * ``finish``    is visible only after the sandboxed verification set passed.
  * ``verify_state == passed`` can only be set by the harness after it applied
    the patch, ran the fixed check set in the sandbox, and reverted the sandbox.
    A free-form ``run_check`` the model runs never sets it.

Gate state persists on the task so a process restart resumes correctly.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from .models import DevTask, TaskStatus
from .registry import GateKind


class VerifyState(str, Enum):
    NONE = "none"
    RUNNING = "running"
    FAILED = "failed"
    PASSED = "passed"


@dataclass
class GateState:
    red_seen: bool = False
    sandbox_dirty: bool = False           # a patch was written, not yet verified
    verify_state: VerifyState = VerifyState.NONE
    finish_requested: bool = False

    def is_visible(self, gate: GateKind) -> bool:
        if gate == GateKind.ALWAYS:
            return True
        if gate == GateKind.NEEDS_RED:
            # Once a verification is running or failed, the model must re-check
            # before proposing another patch; the harness feeds the failure
            # back and then resets the change to reopen the gate.
            return self.red_seen and self.verify_state in (
                VerifyState.NONE, VerifyState.PASSED)
        if gate == GateKind.NEEDS_GREEN:
            return self.verify_state == VerifyState.PASSED
        return False

    def record_red(self) -> None:
        self.red_seen = True

    def record_write(self) -> None:
        self.sandbox_dirty = True

    def begin_verify(self) -> None:
        self.verify_state = VerifyState.RUNNING

    def record_verify(self, passed: bool) -> None:
        self.verify_state = VerifyState.PASSED if passed else VerifyState.FAILED

    def reset_change(self) -> None:
        """Forget the current candidate change after a failed verification.

        Keeps ``red_seen`` so the model may immediately propose another patch.
        """
        self.sandbox_dirty = False
        self.verify_state = VerifyState.NONE

    @classmethod
    def from_task(cls, task: DevTask) -> GateState:
        try:
            vs = VerifyState(task.verify_state)
        except ValueError:
            vs = VerifyState.NONE
        return cls(
            red_seen=task.red_seen,
            sandbox_dirty=task.sandbox_dirty,
            verify_state=vs,
        )

    def apply_to(self, task: DevTask) -> None:
        task.red_seen = self.red_seen
        task.sandbox_dirty = self.sandbox_dirty
        task.verify_state = self.verify_state.value


def visible_tools(specs, gate: GateState) -> list[str]:
    """Return the names of tools the gate currently exposes.

    Accepts either a ToolRegistry or an iterable of ToolSpec.
    """
    if hasattr(specs, "names"):
        specs = [specs.get(n) for n in specs.names()]
    return sorted(s.name for s in specs if gate.is_visible(s.gate))


def derive_milestone(gate: GateState) -> TaskStatus:
    """Derive the externally-visible 8-state machine status from the gate.

    The gate state is finer-grained than the original milestones; this maps it
    back so persistence and the web UI keep their existing meaning.
    """
    if gate.verify_state == VerifyState.PASSED:
        return TaskStatus.AWAITING_APPROVAL
    if gate.verify_state == VerifyState.RUNNING:
        return TaskStatus.VERIFYING
    if gate.sandbox_dirty:
        return TaskStatus.PATCHED
    if gate.red_seen:
        return TaskStatus.REPRODUCED
    return TaskStatus.NEW

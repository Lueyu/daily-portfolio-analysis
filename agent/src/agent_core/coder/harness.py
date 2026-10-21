"""L1 inner-loop orchestration for the coder persona (spec section 5).

The harness is a state-machine driver. It:
  1. reproduces the failure (must see a red check before anything else),
  2. asks for a root-cause hypothesis + patch (read-only probes allowed),
  3. rejects test-weakening patches,
  4. pauses for approval, then applies the patch and runs the fixed check set,
  5. on failure rolls the patch back and feeds the evidence back,
  6. enforces the budget and the "same hypothesis fails twice" rule.

The model is behind ChatPort (only a chat() method); tests inject a scripted
chat, production injects ChatService. The repository is touched only through
ControlledTools, which is itself sandboxed. The current phase is owned by the
state machine, not reported by the model, so the model cannot skip a gate.
"""

from __future__ import annotations

import re
from typing import Protocol

from ..models import ChatRequest, ChatResponse, ModelTask
from .budget import BudgetGuard
from .models import (
    BudgetConfig,
    CheckKind,
    DevTask,
    Iteration,
    Patch,
    TaskStatus,
)
from .parser import (
    ApplyPatchStep,
    BlockedStep,
    GlobStep,
    GrepStep,
    ListDirStep,
    ProbeEnvStep,
    ReadFileStep,
    ReadOnlyStep,
    RunCheckStep,
    parse_agent_step,
)
from .prompts import diagnose_prompt, reproduce_prompt
from .safety import SafetyViolation, scan_test_cheating
from .task_store import TaskStore
from .tools import ControlledTools


class ChatPort(Protocol):
    def chat(self, request: ChatRequest) -> ChatResponse: ...


class _Stop(Exception):
    """Internal control-flow signal to end the run with a recorded reason."""

    def __init__(self, reason: str, blocked: bool = True):
        super().__init__(reason)
        self.reason = reason
        self.blocked = blocked


def _target_files(diff: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"^\+\+\+ b/(.+)$", diff, re.M)))


def _checks_for(task: DevTask) -> list[CheckKind]:
    """Unit regression always; typecheck + lint always; e2e only if required."""
    kinds = [CheckKind.UNIT]
    if any(c.check == CheckKind.E2E for c in task.acceptance):
        kinds.append(CheckKind.E2E)
    kinds += [CheckKind.TYPECHECK, CheckKind.LINT]
    ordered: list[CheckKind] = []
    for k in kinds:
        if k not in ordered:
            ordered.append(k)
    return ordered


class CoderHarness:
    def __init__(self, task: DevTask, chat: ChatPort, tools: ControlledTools,
                 store: TaskStore, *, verify_cwd=None,
                 budget: BudgetGuard | None = None, max_probes: int = 10):
        self.task = task
        self.chat = chat
        self.tools = tools
        self.store = store
        self.verify_cwd = verify_cwd
        self.budget = budget or BudgetGuard(BudgetConfig())
        # A real investigation (data source -> config -> client -> tests) reads
        # several files; six was too tight and killed legitimate work.
        self.max_probes = max_probes
        # Warn before the hard cap so the model has a clear last chance to
        # actually run a check or declare itself blocked instead of looping.
        self.probe_warning = max(1, max_probes - 2)
        self._latest_patch: Patch | None = None
        self._last_failure = ""
        self._probes = 0

    # -- public entry point ------------------------------------------------
    def run(self, *, auto_approve: bool) -> DevTask:
        try:
            if self.task.status == TaskStatus.NEW:
                self._reproduce()
            active = {
                TaskStatus.REPRODUCED,
                TaskStatus.DIAGNOSED,
                TaskStatus.VERIFYING,
                TaskStatus.AWAITING_APPROVAL,
            }
            while self.task.status in active:
                if self.task.status == TaskStatus.AWAITING_APPROVAL:
                    if not auto_approve:
                        return self._save()          # pause for human
                    self._apply_and_verify()
                    continue
                self._produce_patch()                # -> AWAITING_APPROVAL
                if not auto_approve:
                    return self._save()
        except _Stop as stop:
            if stop.blocked:
                self._block(stop.reason)
        return self._save()

    # -- phase 1: reproduction --------------------------------------------
    def _reproduce(self) -> None:
        already_green = 0
        messages = [
            {"role": "user",
             "content": reproduce_prompt(self.task.problem, self.task.acceptance)}
        ]
        evidence = ""
        while True:
            if evidence:
                messages = messages + [{"role": "user", "content": evidence}]
            _, step = self._ask(messages, ModelTask.EXTRACT)
            if isinstance(step, ReadOnlyStep):
                evidence += self._observe(step, phase="reproduce")
            elif isinstance(step, RunCheckStep):
                outcome = self.tools.run_check(step.kind, cwd=self.verify_cwd)
                if outcome.passed:
                    already_green += 1
                    evidence += (
                        "The check already passed; a red reproduction is mandatory. "
                        "Run a different test that actually fails.\n"
                    )
                    if already_green >= 2:
                        raise _Stop("could not reproduce the failure")
                else:
                    self._last_failure = outcome.raw_tail
                    self.task.red_seen = True
                    self.task.transition(TaskStatus.REPRODUCED)
                    self._iter("reproduce",
                               decision="red reproduction confirmed",
                               observations=[outcome.raw_tail[:500]])
                    return
            elif isinstance(step, BlockedStep):
                raise _Stop(step.reason or "model blocked during reproduction")
            else:
                # apply_patch / finish are not allowed before a red test.
                evidence += (
                    "Reproduction first: call run_check on the failing test "
                    "before proposing any patch.\n"
                )

    # -- phase 2: diagnosis + patch ---------------------------------------
    def _produce_patch(self) -> None:
        if self.task.status == TaskStatus.REPRODUCED:
            self.task.transition(TaskStatus.DIAGNOSED)
        cheat_strikes = 0
        while self.task.status == TaskStatus.DIAGNOSED:
            observations = [self._last_failure[:500]] if self._last_failure else []
            prompt = diagnose_prompt(
                self._last_failure or "(no prior output)", observations
            )
            messages = [{"role": "user", "content": prompt}]
            _, step = self._ask(messages, ModelTask.PLAN)
            if isinstance(step, ReadOnlyStep):
                self._last_failure += self._observe(step, phase="diagnose")
                continue
            if isinstance(step, BlockedStep):
                raise _Stop(step.reason or "model blocked during diagnosis")
            if not isinstance(step, ApplyPatchStep):
                self._last_failure += (
                    f"\n[expected apply_patch, got {type(step).__name__}]"
                )
                continue
            hits = scan_test_cheating(step.diff or "")
            if hits:
                cheat_strikes += 1
                self._last_failure += (
                    "\nYour patch weakens the tests and was REJECTED: "
                    + "; ".join(hits) + ". Resend a clean patch."
                )
                self._iter("patch", decision="rejected test-weakening patch",
                           observations=hits)
                if cheat_strikes >= 2:
                    raise _Stop("repeated test-weakening patches")
                continue
            self._accept_patch(step.hypothesis or "unlabelled", step.diff)
            return

    def _accept_patch(self, hypothesis: str, diff: str) -> None:
        self.budget.set_hypothesis(hypothesis)
        self._latest_patch = Patch(
            patch_id=f"patch-{self.budget.iterations + 1:03d}",
            diff=diff, target_files=_target_files(diff), hypothesis=hypothesis,
        )
        self.store.save_patch(self.task.id, self._latest_patch)
        self.task.transition(TaskStatus.PATCHED)
        self.task.transition(TaskStatus.VERIFYING)
        self.task.transition(TaskStatus.AWAITING_APPROVAL)
        self._iter("patch", hypothesis=hypothesis, action="apply_patch",
                   decision="patch proposed; awaiting approval",
                   observations=[f"files: {self._latest_patch.target_files}"])
        self._save()

    # -- phase 3: apply + verify ------------------------------------------
    def _apply_and_verify(self) -> None:
        patch = self._latest_patch
        if patch is None:
            raise _Stop("no patch to verify")
        applied = self.tools.git_apply(patch.diff, cwd=self.verify_cwd)
        if not applied.ok:
            self._rollback_state(applied.stderr)
            return
        results = [(k, self.tools.run_check(k, cwd=self.verify_cwd))
                   for k in _checks_for(self.task)]
        failed = [(k, o) for k, o in results if not o.passed]
        self.budget.tick_iteration()
        obs = [f"{k.value}: {'PASS' if o.passed else 'FAIL'}" for k, o in results]
        if not failed:
            self.task.transition(TaskStatus.VERIFIED)
            self._iter("verify", hypothesis=patch.hypothesis,
                       decision="all checks green", observations=obs)
            return
        # Roll the patch back, then route the failure back to diagnosis.
        self.tools.git_apply(patch.diff, cwd=self.verify_cwd, reverse=True)
        evidence = "\n".join(o.raw_tail for _, o in failed)[:3000]
        self._iter("verify", hypothesis=patch.hypothesis,
                   decision="checks failed; rolled back", observations=obs)
        self._latest_patch = None
        self._last_failure = evidence
        self.task.transition(TaskStatus.DIAGNOSED)
        if self.budget.note_hypothesis_failure(patch.hypothesis):
            if self.budget.note_rethink():
                raise _Stop("repeated unsuccessful diagnosis; escalated to human")

    def _rollback_state(self, stderr: str) -> None:
        self._latest_patch = None
        self._last_failure = f"patch did not apply cleanly:\n{stderr}"
        self.task.transition(TaskStatus.DIAGNOSED)

    # -- helpers -----------------------------------------------------------
    def _ask(self, messages, task_kind):
        """One model round. Malformed JSON is re-asked once (still budgeted)."""
        for _ in range(2):
            tripped, reason = self.budget.exhausted()
            if tripped:
                raise _Stop(reason)
            self.budget.tick_model_call()
            resp = self.chat.chat(
                ChatRequest(messages=messages, task=task_kind, json_mode=True)
            )
            try:
                return resp, parse_agent_step(resp.content)
            except ValueError as exc:
                messages = messages + [{
                    "role": "user",
                    "content": (f"Your reply was not a valid JSON action ({exc}). "
                                "Resend exactly one JSON object, no prose."),
                }]
        raise _Stop("model repeatedly returned malformed JSON")

    def _observe(self, step: ReadOnlyStep, *, phase: str) -> str:
        """Run one read-only tool, count it against the shared probe budget,
        and leave a trace. Every read-only action shares one budget so the
        model cannot dodge the cap by switching tools."""
        self._probes += 1
        if self._probes > self.max_probes:
            raise _Stop("too many read-only probes without progress")
        label, target, fn = self._dispatch_readonly(step)
        try:
            body = fn()
            status = "ok"
        except (FileNotFoundError, ValueError, OSError, SafetyViolation) as exc:
            # A bad guess (missing path, invalid regex, denied probe target) is
            # feedback, not a fatal error: surface it so the model self-corrects.
            body = (f"{label.upper()} FAILED for {target}: {exc}. "
                    "Choose valid input.")
            status = "failed"
        result = f"\n{body}\n"
        # Leave a trace (including a short output snippet) so the UI can show
        # exactly what the agent inspected and what it found.
        self._iter(
            phase, action=label,
            decision=f"probe {self._probes}/{self.max_probes}: {target} ({status})",
            observations=[f"{target}: {status}", body[:300]])
        # Near the hard cap, give one explicit last chance instead of silently
        # killing the run: reproduce with a check, or block with a human checklist.
        if self._probes >= self.probe_warning:
            result += (
                "\n[PROBE BUDGET WARNING] You have run many read-only probes "
                "without reproducing a failing check. Your next action MUST be "
                "either:\n"
                "- run_check to actually reproduce the failure, or\n"
                "- blocked if no test can reproduce it (e.g. a local service or "
                "database is down). Call probe_env first; if a service is DOWN the "
                "reason MUST name the service and how to start it (for PostgreSQL "
                "run scripts/db/start-db.ps1). Also state whether data is seeded/"
                "migrated and which config the app points at.\n"
                "Do not run another read-only probe.\n"
            )
        return result

    def _dispatch_readonly(self, step: ReadOnlyStep) -> tuple[str, str, object]:
        """Map a read-only step to (action label, target desc, result thunk)."""
        cwd = self.verify_cwd
        if isinstance(step, ReadFileStep):
            return ("read_file", step.path,
                    lambda: f"FILE {step.path}:\n"
                            + self.tools.read_file(step.path, cwd=cwd)[:4000])
        if isinstance(step, ListDirStep):
            return ("list_dir", step.path,
                    lambda: f"LIST {step.path}:\n"
                            + self.tools.list_dir(step.path, cwd=cwd))
        if isinstance(step, GlobStep):
            return ("glob", step.pattern,
                    lambda: f"GLOB {step.pattern}:\n"
                            + self.tools.glob(step.pattern, step.path, cwd=cwd))
        if isinstance(step, GrepStep):
            return ("grep", step.pattern,
                    lambda: f"GREP {step.pattern}:\n"
                            + self.tools.grep(step.pattern, step.path,
                                              step.glob_include, step.max_results,
                                              cwd=cwd))
        if isinstance(step, ProbeEnvStep):
            return ("probe_env", "env",
                    lambda: "ENVIRONMENT:\n"
                            + self.tools.probe_env(step.targets, cwd=cwd))
        raise ValueError(f"unsupported read-only step: {type(step).__name__}")

    def _iter(self, phase, *, hypothesis="", action="", decision="",
              observations=None) -> None:
        n = len(self.store.read_iterations(self.task.id)) + 1
        self.store.append_iteration(self.task.id, Iteration(
            index=n, phase=phase, hypothesis=hypothesis, action=action,
            model_calls=self.budget.model_calls,
            observations=observations or [], decision=decision))

    def _block(self, reason: str) -> DevTask:
        self._iter("block", decision=reason)
        if self.task.status != TaskStatus.VERIFIED:
            try:
                self.task.transition(TaskStatus.BLOCKED)
            except ValueError:
                pass
        return self._save()

    def _save(self) -> DevTask:
        self.store.save(self.task)
        return self.task

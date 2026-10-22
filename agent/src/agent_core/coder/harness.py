"""Gated ReAct orchestration for the coder persona.

ReactLoop owns model turns and action routing. CoderHarness implements its
executor interface and owns deterministic work: controlled tools, sandbox
verification, task persistence, approval, and landing on the main checkout.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Protocol

from ..models import ChatRequest, ChatResponse
from .budget import BudgetGuard
from .gates import GateState, VerifyState
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
    FinishStep,
    GlobStep,
    GrepStep,
    ListDirStep,
    ProbeEnvStep,
    ReadFileStep,
    ReadOnlyStep,
    RunCheckStep,
    build_default_registry,
)
from .prompts import reproduce_prompt
from .react_loop import LoopSignal, ReactLoop, StepResult
from .safety import SafetyViolation, scan_test_cheating
from .sandbox import SandboxPort
from .task_store import TaskStore
from .tools import ControlledTools


class ChatPort(Protocol):
    def chat(self, request: ChatRequest) -> ChatResponse: ...


class _Stop(Exception):
    def __init__(self, reason: str, blocked: bool = True):
        super().__init__(reason)
        self.reason = reason
        self.blocked = blocked


def _target_files(diff: str) -> list[str]:
    return list(dict.fromkeys(re.findall(r"^\+\+\+ b/(.+)$", diff, re.M)))


def _checks_for(task: DevTask) -> list[CheckKind]:
    kinds = [CheckKind.UNIT]
    if any(c.check == CheckKind.E2E for c in task.acceptance):
        kinds.append(CheckKind.E2E)
    kinds += [CheckKind.TYPECHECK, CheckKind.LINT]
    ordered: list[CheckKind] = []
    for kind in kinds:
        if kind not in ordered:
            ordered.append(kind)
    return ordered


class CoderHarness:
    def __init__(
        self,
        task: DevTask,
        chat: ChatPort,
        tools: ControlledTools,
        store: TaskStore,
        *,
        verify_cwd=None,
        sandbox: SandboxPort | None = None,
        budget: BudgetGuard | None = None,
        max_probes: int = 10,
        supports_tools: bool = True,
    ):
        self.task = task
        self.chat = chat
        self.tools = tools
        self.store = store
        self.main_cwd = Path(verify_cwd) if verify_cwd else tools.workdir
        self.sandbox = sandbox
        self.budget = budget or BudgetGuard(BudgetConfig())
        self.max_probes = max_probes
        self.probe_warning = max(1, max_probes - 2)
        self.registry = build_default_registry()
        self.supports_tools = supports_tools
        self._latest_patch: Patch | None = None
        self._last_failure = ""
        self._probes = 0
        self._already_green = 0
        self._cheat_strikes = 0

    def _work_cwd(self) -> Path:
        if self.sandbox is None:
            return self.main_cwd
        self.sandbox.ensure()
        return self.sandbox.path

    def run(self, *, auto_approve: bool) -> DevTask:
        try:
            # An approval can be resumed in a new process. A completed or
            # blocked task is terminal and must never call the model again.
            if self.task.status in (TaskStatus.VERIFIED, TaskStatus.BLOCKED):
                self._teardown_sandbox()
                return self._save()
            if self.task.status == TaskStatus.AWAITING_APPROVAL:
                if not auto_approve:
                    return self._save()
                if self.sandbox is not None:
                    self._land_to_main()
                else:
                    self._apply_and_verify_legacy(self._load_required_patch())
            else:
                gate = GateState.from_task(self.task)
                loop = ReactLoop(
                    task=self.task,
                    chat=self.chat,
                    registry=self.registry,
                    executor=self,
                    budget=self.budget,
                    supports_tools=self.supports_tools,
                    gate=gate,
                    max_probes=self.max_probes,
                )
                signal, reason = loop.run()
                gate.apply_to(self.task)
                if signal == LoopSignal.FINISH:
                    self._await_approval()
                    if auto_approve:
                        if self.sandbox is not None:
                            self._land_to_main()
                        else:
                            self._apply_and_verify_legacy(self._load_required_patch())
                elif signal == LoopSignal.BLOCKED:
                    self._block(reason)
        except _Stop as stop:
            if stop.blocked:
                self._block(stop.reason)

        if self.task.status in (TaskStatus.VERIFIED, TaskStatus.BLOCKED):
            self._teardown_sandbox()
        return self._save()

    def _load_required_patch(self) -> Patch:
        patch = self._latest_patch or self._load_latest_patch()
        if patch is None:
            raise _Stop("no patch to apply")
        return patch

    def _await_approval(self) -> None:
        """Park a green candidate for a human review before landing."""
        self.task.set_status(TaskStatus.AWAITING_APPROVAL)
        self._iter("verify", action="finish",
                   decision="checks green; awaiting approval",
                   observations=["sandbox reverted to clean HEAD"])
        self._save()

    # -- ToolExecutor implementation --------------------------------------
    def initial_prompt(self) -> str:
        return reproduce_prompt(self.task.problem, self.task.acceptance)

    def execute(self, step, gate: GateState) -> StepResult:
        if isinstance(step, ReadOnlyStep):
            return self._exec_readonly(step)
        if isinstance(step, RunCheckStep):
            return self._exec_run_check(step, gate)
        if isinstance(step, ApplyPatchStep):
            return self._exec_apply_patch(step, gate)
        if isinstance(step, FinishStep):
            gate.finish_requested = True
            return StepResult(
                observation="补丁已通过验收，等待人工审批。",
                signal=LoopSignal.FINISH,
                reason=step.summary,
            )
        if isinstance(step, BlockedStep):
            return StepResult(
                observation="已标记为受阻。",
                signal=LoopSignal.BLOCKED,
                reason=step.reason or "model blocked",
            )
        return StepResult(observation=f"未识别的步骤 {type(step).__name__}")

    def _exec_readonly(self, step: ReadOnlyStep) -> StepResult:
        self._probes += 1
        if self._probes > self.max_probes:
            return StepResult(
                observation="只读探针过多且没有进展。",
                signal=LoopSignal.BLOCKED,
                reason="too many read-only probes without progress",
            )
        label, target, fn = self._dispatch_readonly(step, self._work_cwd())
        try:
            body = fn()
            status = "ok"
        except (FileNotFoundError, ValueError, OSError, SafetyViolation) as exc:
            body = f"{label.upper()} FAILED for {target}: {exc}. Choose valid input."
            status = "failed"
        self._iter(
            "react",
            action=label,
            decision=f"probe {self._probes}/{self.max_probes}: {target} ({status})",
            observations=[f"{target}: {status}", body[:300]],
        )
        return StepResult(observation=f"\n{body}\n", action=label)

    def _exec_run_check(self, step: RunCheckStep, gate: GateState) -> StepResult:
        outcome = self.tools.run_check(
            step.kind,
            cwd=self._work_cwd(),
            sandboxed=self.sandbox is not None,
        )
        if not gate.red_seen:
            if outcome.passed:
                self._already_green += 1
                if self._already_green >= 2:
                    return StepResult(
                        observation="连续两次检查都已通过，无法复现失败。",
                        signal=LoopSignal.BLOCKED,
                        reason="could not reproduce the failure",
                    )
                return StepResult(
                    observation="检查已经通过；红灯复现是必须的，请运行一个真正失败的测试。"
                )
            self._last_failure = outcome.raw_tail
            gate.record_red()
            gate.apply_to(self.task)
            self.task.set_status(TaskStatus.REPRODUCED)
            self._iter("react", action="run_check",
                       decision="red reproduction confirmed",
                       observations=[outcome.raw_tail[:500]])
            self._save()
            return StepResult(
                observation=f"复现成功（红灯）：\n{outcome.raw_tail[:3000]}",
                made_progress=True,
            )
        return StepResult(
            observation=(f"run_check {step.kind.value}: "
                         f"{'PASS' if outcome.passed else 'FAIL'}\n"
                         f"{outcome.raw_tail[:3000]}"),
        )

    def _exec_apply_patch(self, step: ApplyPatchStep, gate: GateState) -> StepResult:
        hits = scan_test_cheating(step.diff or "")
        if hits:
            self._cheat_strikes += 1
            self._iter("react", action="apply_patch",
                       decision="rejected test-weakening patch", observations=hits)
            if self._cheat_strikes >= 2:
                return StepResult(
                    observation="重复弱化测试。",
                    signal=LoopSignal.BLOCKED,
                    reason="repeated test-weakening patches",
                )
            return StepResult(
                observation="补丁弱化了测试，已拒绝：" + "; ".join(hits)
                            + "。请重发干净的补丁。"
            )

        hypothesis = step.hypothesis or "unlabelled"
        self.budget.set_hypothesis(hypothesis)
        patch = Patch(
            patch_id=f"patch-{self.budget.iterations + 1:03d}",
            diff=step.diff,
            target_files=_target_files(step.diff),
            hypothesis=hypothesis,
        )
        self._latest_patch = patch
        self.store.save_patch(self.task.id, patch)
        gate.record_write()
        gate.begin_verify()
        gate.apply_to(self.task)
        self.task.set_status(TaskStatus.VERIFYING)
        self._iter("react", hypothesis=hypothesis, action="apply_patch",
                   decision="patch proposed",
                   observations=[f"files: {patch.target_files}"])
        self._save()

        if self.sandbox is None:
            # The legacy path cannot verify until the approved patch reaches
            # the main checkout. Keep its historical approval flow.
            gate.record_verify(True)
            gate.apply_to(self.task)
            return StepResult(
                observation="补丁已提交（无沙箱，将在落地时验证）。现在可 finish。",
                made_progress=True,
            )

        result = self._sandbox_verify_once(patch, gate)
        gate.apply_to(self.task)
        self._save()
        return result

    def _sandbox_verify_once(self, patch: Patch, gate: GateState) -> StepResult:
        cwd = self._work_cwd()
        applied = self.sandbox.apply(patch.diff)
        if not applied.ok:
            reverted = self.sandbox.revert(patch.diff)
            self._latest_patch = None
            self._iter("verify", hypothesis=patch.hypothesis,
                       decision="patch did not apply in sandbox",
                       observations=[applied.stderr[:500]])
            if not reverted.ok:
                gate.record_verify(False)
                return StepResult(
                    observation=("补丁无法应用且沙箱回滚失败：\n"
                                 + reverted.stderr[:1500]),
                    signal=LoopSignal.BLOCKED,
                    reason="sandbox rollback failed after patch apply error",
                )
            gate.reset_change()
            self.task.set_status(TaskStatus.DIAGNOSED)
            return StepResult(
                observation=f"补丁无法应用，沙箱已清理：\n{applied.stderr[:2000]}",
                made_progress=True,
            )

        results = [
            (kind, self.tools.run_check(kind, cwd=cwd, sandboxed=True))
            for kind in _checks_for(self.task)
        ]
        reverted = self.sandbox.revert(patch.diff)
        labels = [f"{kind.value}: {'PASS' if outcome.passed else 'FAIL'}"
                  for kind, outcome in results]
        if not reverted.ok:
            gate.record_verify(False)
            self._iter("verify", hypothesis=patch.hypothesis,
                       decision="sandbox rollback failed after verification",
                       observations=labels + [reverted.stderr[:500]])
            return StepResult(
                observation=("验收完成，但沙箱补丁回滚失败，任务停止以免在脏沙箱继续：\n"
                             + reverted.stderr[:1500]),
                signal=LoopSignal.BLOCKED,
                reason="sandbox rollback failed after verification",
            )

        failed = [(kind, outcome) for kind, outcome in results if not outcome.passed]
        if not failed:
            gate.record_verify(True)
            self._iter("verify", hypothesis=patch.hypothesis,
                       decision="sandbox checks green; reverted; ready to finish",
                       observations=labels)
            return StepResult(
                observation="沙箱验收全部通过：\n" + "\n".join(labels)
                            + "\n沙箱已还原到干净 HEAD。现在可以 finish。",
                made_progress=True,
            )

        gate.record_verify(False)
        evidence = "\n".join(outcome.raw_tail for _, outcome in failed)[:3000]
        self._iter("verify", hypothesis=patch.hypothesis,
                   decision="sandbox checks failed; reverted", observations=labels)
        escalate = self.budget.note_hypothesis_failure(patch.hypothesis)
        if escalate and self.budget.note_rethink():
            return StepResult(
                observation=evidence,
                signal=LoopSignal.BLOCKED,
                reason="repeated unsuccessful diagnosis; escalated to human",
            )

        # Verification has finished and the sandbox is clean. Persist the
        # diagnosed state before the next model turn so apply_patch reopens.
        gate.reset_change()
        self.task.set_status(TaskStatus.DIAGNOSED)
        self._latest_patch = None
        return StepResult(
            observation=("沙箱验收失败，沙箱已还原：\n" + "\n".join(labels)
                        + "\n失败证据：\n" + evidence
                        + "\n请定位根因后重发 apply_patch。"),
            made_progress=True,
        )

    # -- human-approved landing on the main checkout ----------------------
    def _land_to_main(self) -> None:
        patch = self._load_required_patch()
        if self.sandbox is None:
            self._apply_and_verify_legacy(patch)
            return

        applied = self.tools.git_apply(patch.diff, cwd=self.main_cwd)
        if not applied.ok:
            self._iter("landing", decision="patch failed to apply to main",
                       observations=[applied.stderr[:500]])
            self._save()
            raise _Stop("approved patch did not apply to main: "
                        + applied.stderr[:300])
        outcome = self.tools.run_check(CheckKind.UNIT, cwd=self.main_cwd)
        if outcome.passed:
            self.task.set_status(TaskStatus.VERIFIED)
            self._iter("landing", hypothesis=patch.hypothesis,
                       decision="applied to main; unit green",
                       observations=["unit: PASS"])
            self._save()
            return

        self.tools.git_apply(patch.diff, cwd=self.main_cwd, reverse=True)
        self._iter("landing", hypothesis=patch.hypothesis,
                   decision="main unit failed; rolled back",
                   observations=[outcome.raw_tail[:500]])
        self._latest_patch = None
        self._last_failure = outcome.raw_tail
        self.task.sandbox_dirty = False
        self.task.verify_state = VerifyState.NONE.value
        self.task.set_status(TaskStatus.DIAGNOSED)
        self._save()
        if self.budget.note_hypothesis_failure(patch.hypothesis) \
                and self.budget.note_rethink():
            raise _Stop("approved patch repeatedly failed on main; human")

    def _apply_and_verify_legacy(self, patch: Patch) -> None:
        applied = self.tools.git_apply(patch.diff, cwd=self.main_cwd)
        if not applied.ok:
            self._rollback_state(applied.stderr)
            return
        results = [
            (kind, self.tools.run_check(kind, cwd=self.main_cwd))
            for kind in _checks_for(self.task)
        ]
        failed = [(kind, outcome) for kind, outcome in results if not outcome.passed]
        labels = [f"{kind.value}: {'PASS' if outcome.passed else 'FAIL'}"
                  for kind, outcome in results]
        if not failed:
            self.task.set_status(TaskStatus.VERIFIED)
            self._iter("landing", hypothesis=patch.hypothesis,
                       decision="all checks green", observations=labels)
            return
        self.tools.git_apply(patch.diff, cwd=self.main_cwd, reverse=True)
        self._latest_patch = None
        self.task.sandbox_dirty = False
        self.task.verify_state = VerifyState.NONE.value
        self.task.set_status(TaskStatus.DIAGNOSED)
        self._iter("landing", hypothesis=patch.hypothesis,
                   decision="legacy checks failed; rolled back", observations=labels)

    def _rollback_state(self, stderr: str) -> None:
        self._latest_patch = None
        self._last_failure = f"patch did not apply cleanly:\n{stderr}"
        self.task.sandbox_dirty = False
        self.task.verify_state = VerifyState.NONE.value
        self.task.set_status(TaskStatus.DIAGNOSED)

    # -- persistence and sandbox helpers ----------------------------------
    def _load_latest_patch(self) -> Patch | None:
        try:
            return self.store.latest_patch(self.task.id)
        except FileNotFoundError:
            return None

    def _teardown_sandbox(self) -> None:
        if self.sandbox is None:
            return
        try:
            self.sandbox.teardown()
        except OSError as exc:
            self._iter("landing", decision="sandbox teardown warning",
                       observations=[str(exc)[:300]])

    def _dispatch_readonly(
        self, step: ReadOnlyStep, cwd: Path
    ) -> tuple[str, str, object]:
        """Map a read-only step to (action label, target desc, result thunk)."""
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
            self.task.set_status(TaskStatus.BLOCKED)
        return self._save()

    def _save(self) -> DevTask:
        self.store.save(self.task)
        return self.task

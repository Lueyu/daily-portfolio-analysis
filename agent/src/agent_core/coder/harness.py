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
    ReadOnlyStep,
    RunCheckStep,
    build_default_registry,
)
from .prompts import reproduce_prompt
from .react_loop import LoopSignal, ReactLoop, StepResult
from .read_tools import dispatch_readonly
from .safety import SafetyViolation, scan_test_cheating
from .sandbox import SandboxPort
from .task_store import TaskStore
from .tools import ControlledTools

_RESUMABLE_BUDGET_REASONS = {
    "iteration budget reached",
    "model call budget reached",
    "wall-clock time budget reached",
    "too many read-only probes without progress",
}


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
        max_probes: int | None = None,
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
        self.registry = build_default_registry()
        self.supports_tools = supports_tools
        self._latest_patch: Patch | None = None
        self._last_failure = ""
        self._probes = 0
        self._already_green = 0
        self._cheat_strikes = 0
        self._resume_evidence = ""

    def _work_cwd(self) -> Path:
        if self.sandbox is None:
            return self.main_cwd
        self.sandbox.ensure()
        return self.sandbox.path

    def run(self, *, auto_approve: bool, resume_budget: bool = False) -> DevTask:
        if resume_budget:
            self._resume_budget_block()
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
                if gate.verify_state == VerifyState.RUNNING:
                    self._resume_interrupted_verification(gate)
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

    def _resume_budget_block(self) -> None:
        """Explicitly reopen only an automatic cap stop, preserving its audit trail."""
        history = self.store.read_iterations(self.task.id)
        last = history[-1] if history else None
        if self.task.status != TaskStatus.BLOCKED or last is None \
                or last.phase != "block" or last.decision not in _RESUMABLE_BUDGET_REASONS:
            raise ValueError("--resume-budget requires a task blocked by an automatic budget")
        # The old sandbox was torn down. Require fresh evidence before reopening
        # either write or finish capabilities on the current checkout.
        self.task.red_seen = False
        self.task.sandbox_dirty = False
        self.task.verify_state = VerifyState.NONE.value
        self._latest_patch = None
        self._last_failure = ""
        self._probes = 0
        self._already_green = 0
        self._cheat_strikes = 0
        self.task.set_status(TaskStatus.NEW)
        self._iter("resume", action="resume_budget",
                   decision="resumed automatic budget stop; revalidate current checkout",
                   observations=[last.decision])
        self._save()

    def _load_required_patch(self) -> Patch:
        patch = self._latest_patch or self._load_latest_patch()
        if patch is None:
            raise _Stop("no patch to apply")
        return patch

    def _resume_interrupted_verification(self, gate: GateState) -> None:
        """Revalidate a persisted candidate after its previous process stopped."""
        patch = self._load_required_patch()
        self._latest_patch = patch
        self._iter("resume", action="resume_verification",
                   decision="resuming interrupted verification",
                   observations=[f"saved candidate: {patch.patch_id}"])
        if self.sandbox is None:
            # Legacy runs have not applied anything before approval. Reopen
            # diagnosis; do not manufacture successful verification evidence.
            gate.reset_change()
            gate.apply_to(self.task)
            self.task.set_status(TaskStatus.DIAGNOSED if gate.red_seen else TaskStatus.NEW)
            self._resume_evidence = "上次候选处理被中断，尚无完整验证结果。请重新检查并提交候选补丁。"
            self._save()
            return

        self.sandbox.ensure()
        if not self.sandbox.is_clean():
            reverted = self.sandbox.revert(patch.diff)
            clean = self.sandbox.is_clean()
            if not reverted.ok or not clean:
                self._iter("resume", action="resume_verification",
                           decision="interrupted verification recovery could not restore baseline",
                           observations=[reverted.stderr[:1500],
                                         f"sandbox preserved for inspection: {self.sandbox.path}"])
                # Keep RUNNING as evidence of incomplete verification. The
                # teardown guard preserves unknown changes for inspection.
                raise _Stop("interrupted verification requires inspection: sandbox is not safely restored")

        result = self._sandbox_verify_once(patch, gate)
        self._resume_evidence = result.observation
        gate.apply_to(self.task)
        self._save()
        if result.signal == LoopSignal.BLOCKED:
            raise _Stop(result.reason)

    def _await_approval(self) -> None:
        """Park a green candidate for a human review before landing."""
        self.task.set_status(TaskStatus.AWAITING_APPROVAL)
        self._iter("verify", action="finish",
                   decision="checks green; awaiting approval",
                   observations=["sandbox reverted to clean HEAD"])
        self._save()

    # -- ToolExecutor implementation --------------------------------------
    def initial_prompt(self) -> str:
        prompt = reproduce_prompt(self.task.problem, self.task.acceptance)
        if self._resume_evidence:
            prompt += "\n\n进程恢复后的真实检查结果：\n" + self._resume_evidence
        return prompt

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
        label, target, fn = dispatch_readonly(step, self.tools, self._work_cwd())
        try:
            body = fn()
            status = "ok"
        except (FileNotFoundError, ValueError, OSError, SafetyViolation) as exc:
            body = f"{label.upper()} FAILED for {target}: {exc}. Choose valid input."
            status = "failed"
        self._iter(
            "react",
            action=label,
            decision=f"probe {self._probes}: {target} ({status})",
            observations=[f"{target}: {status}", body[:300]],
        )
        return StepResult(observation=f"\n{body}\n", action=label)

    def _exec_run_check(self, step: RunCheckStep, gate: GateState) -> StepResult:
        self._iter("check", action="run_check",
                   decision=f"run_check {step.kind.value}: started")
        outcome = self.tools.run_check(
            step.kind,
            cwd=self._work_cwd(),
            sandboxed=self.sandbox is not None,
        )
        verdict = "PASS" if outcome.passed else "FAIL"
        self._iter("check", action="run_check",
                   decision=f"run_check {step.kind.value}: {verdict}",
                   observations=["command: " + " ".join(outcome.argv), outcome.raw_tail])
        if not gate.red_seen:
            if outcome.passed:
                self._already_green += 1
                return StepResult(
                    observation=(f"run_check {step.kind.value}: PASS\n{outcome.raw_tail[:3000]}\n"
                                 "当前检查没有复现失败，问题可能已修复或现有测试未覆盖。"
                                 "不要制造失败来解锁写入；若没有可运行的失败用例，"
                                 "调用 blocked 报告已通过的检查与缺少的复现条件。")
                )
            self._last_failure = outcome.raw_tail
            gate.record_red()
            gate.apply_to(self.task)
            self.task.set_status(TaskStatus.REPRODUCED)
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
        if escalate:
            self.budget.note_rethink()
            self.task.diagnosis_rethink_count = self.budget.rethink_count
            evidence += "\n同一假设反复失败，请重新诊断并尝试不同方法；确认真实阻碍才 blocked。"

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
        if self.budget.note_hypothesis_failure(patch.hypothesis):
            self.budget.note_rethink()
            self.task.diagnosis_rethink_count = self.budget.rethink_count
            self._save()

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
        if self.task.status == TaskStatus.BLOCKED and self.task.verify_state == VerifyState.RUNNING.value:
            return  # Interrupted recovery retains unknown changes for inspection.
        try:
            self.sandbox.teardown()
        except OSError as exc:
            self._iter("landing", decision="sandbox teardown warning",
                       observations=[str(exc)[:300]])

    def _iter(self, phase, *, hypothesis="", action="", decision="",
              observations=None) -> None:
        n = len(self.store.read_iterations(self.task.id)) + 1
        record = Iteration(
            index=n, phase=phase, hypothesis=hypothesis, action=action,
            model_calls=self.budget.model_calls,
            observations=observations or [], decision=decision)
        self.store.append_iteration(self.task.id, record)
        self.task.updated_at = record.created_at
        self.store.save(self.task)

    def _block(self, reason: str) -> DevTask:
        self._iter("block", decision=reason)
        if self.task.status != TaskStatus.VERIFIED:
            self.task.set_status(TaskStatus.BLOCKED)
        return self._save()

    def _save(self) -> DevTask:
        self.store.save(self.task)
        return self.task

# tests/test_coder_harness.py
import json
import os
import subprocess
from pathlib import Path

import pytest

from agent_core.coder.budget import BudgetGuard
from agent_core.coder.harness import CoderHarness
from agent_core.coder.models import (
    AcceptanceCriterion,
    BudgetConfig,
    CheckKind,
    CommandResult,
    DevTask,
    ProbeResult,
    ProbeTarget,
    TaskStatus,
)
from agent_core.coder.task_store import TaskStore
from agent_core.coder.tools import ControlledTools, default_runner
from agent_core.models import ChatResponse, ToolCall, Usage


def make_task(tmp):
    return DevTask(
        id="dev_h1", title="rating", problem="rating/action contradiction",
        acceptance=[AcceptanceCriterion(id="a", description="Hold has no buy verbs",
                                        check=CheckKind.UNIT)],
        workdir=str(tmp),
    )


def reply(content):
    return ChatResponse(content=content, model="script", tier="flash",
                        usage=Usage(), latency_ms=0)


def step(action, **kw):
    # Flat action envelope parsed by parser.parse_agent_step.
    return json.dumps({"action": action, **kw})


class ScriptedChat:
    """Returns queued replies; a callable 'loop' reply repeats after the queue."""
    def __init__(self, contents, loop=None):
        self.queue = [reply(c) for c in contents]
        self.loop = reply(loop) if loop else None
        self.calls = 0

    def chat(self, request):
        self.calls += 1
        if self.queue:
            return self.queue.pop(0)
        if self.loop:
            return self.loop
        raise AssertionError("unexpected extra model call")


class CapturingChat(ScriptedChat):
    """Remembers every request's messages so feedback can be asserted."""
    def __init__(self, contents):
        super().__init__(contents)
        self.seen = []

    def chat(self, request):
        self.seen.append(request.messages)
        return super().chat(request)


SANDBOX_ROOT_NAME = "worktrees"


class FakeRunner:
    """Check results are split by cwd.
      sandbox_unit: rc sequence for unit/e2e test commands inside the worktree.
        Index 0 is the reproduction (red); each later index is one patch's
        verification. type:check/lint always return 0.
      main_unit: int (constant) or rc sequence for the main checkout.
    `worktree add` really creates the directory so filesystem steps run."""
    def __init__(self, sandbox_unit=None, main_unit=0):
        self.sb = list(sandbox_unit or [])
        self.sb_i = 0
        self.main_const = main_unit if isinstance(main_unit, int) else None
        self.main_seq = list(main_unit) if isinstance(main_unit, list) else []
        self.main_i = 0
        self.applied = []      # (cwd, diff)
        self.calls = []        # (argv, cwd, stdin)

    @staticmethod
    def _in_sandbox(cwd):
        return SANDBOX_ROOT_NAME in Path(cwd).parts

    def _rc_for_test(self, argv, cwd):
        cmd = " ".join(argv)
        is_test = ("test:unit" in cmd) or ("test:e2e" in cmd)
        if not is_test:
            return 0  # type:check / lint always green
        if self._in_sandbox(cwd):
            rc = self.sb[min(self.sb_i, len(self.sb) - 1)] if self.sb else 0
            self.sb_i += 1
            return rc
        if self.main_seq:
            rc = self.main_seq[min(self.main_i, len(self.main_seq) - 1)]
            self.main_i += 1
            return rc
        return self.main_const

    def __call__(self, argv, cwd, timeout=None, stdin=None):
        cwd = str(cwd)
        self.calls.append((list(argv), cwd, stdin))
        joined = " ".join(argv)
        if "worktree" in argv and "add" in argv:
            os.makedirs(argv[4], exist_ok=True)
            return CommandResult(argv=argv, returncode=0, stdout="", stderr="")
        if "worktree" in argv:
            return CommandResult(argv=argv, returncode=0, stdout="worktree", stderr="")
        if any(k in joined for k in ("test:unit", "test:e2e", "type:check", "lint")):
            rc = self._rc_for_test(argv, cwd)
            out = ("Tests  1 failed | 14 passed (15)\n × caps Buy to Hold\n"
                   if rc else "Tests  15 passed (15)\n")
            return CommandResult(argv=argv, returncode=rc, stdout=out, stderr="")
        if "git apply" in joined and stdin:
            self.applied.append((cwd, stdin))
        return CommandResult(argv=argv, returncode=0, stdout="", stderr="")


def sandbox_path(tmp):
    return tmp / SANDBOX_ROOT_NAME / "dev_h1"


def seed_sb(tmp, rel, content):
    """Create a file at <rel> inside the sandbox path that ensure() will reuse."""
    p = sandbox_path(tmp) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def harness_for(tmp, chat, runner, cfg=None, sandbox_enabled=True):
    store = TaskStore(tmp / "tasks")
    task = make_task(tmp)
    store.create(task)
    tools = ControlledTools(tmp, runner=runner)
    sandbox = None
    if sandbox_enabled:
        from agent_core.coder.sandbox import WorktreeSandbox
        from agent_core.coder.linker import Linker
        sandbox = WorktreeSandbox(
            "dev_h1", tmp, tmp / SANDBOX_ROOT_NAME, tools, linker=Linker())
    h = CoderHarness(task, chat, tools, store, verify_cwd=tmp,
                     sandbox=sandbox,
                     budget=BudgetGuard(cfg) if cfg else BudgetGuard(BudgetConfig()),
                     supports_tools=False)
    return h, store


RED = step("run_check", phase="reproduce", check="unit")
PATCH1 = step("apply_patch", phase="patch", hypothesis="h1",
              diff="--- a/x.ts\n+++ b/x.ts\n@@\n+1\n")
PATCH2 = step("apply_patch", phase="patch", hypothesis="h2-different",
              diff="--- a/y.ts\n+++ b/y.ts\n@@\n+2\n")
FINISH = step("finish", summary="verified patch ready for review")


def test_happy_path_reproduce_patch_verify_verified(tmp_path):
    runner = FakeRunner([1, 0])      # red in sandbox, green in sandbox; main unit green
    chat = ScriptedChat([RED, PATCH1, FINISH])
    h, store = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    assert out.red_seen is True
    main = [(c, d) for c, d in runner.applied if Path(c) == tmp_path]
    sb = [(c, d) for c, d in runner.applied if SANDBOX_ROOT_NAME in Path(c).parts]
    assert any("x.ts" in d for _c, d in sb)          # verified in sandbox
    assert any("x.ts" in d for _c, d in main)        # landed to main
    assert len(store.read_iterations("dev_h1")) >= 2
    assert (tmp_path / "tasks" / "dev_h1" / "patches" / "0001.diff").exists()


def test_first_patch_fails_then_second_succeeds(tmp_path):
    runner = FakeRunner([1, 1, 0])  # red, patch1 still red, patch2 green
    chat = ScriptedChat([RED, PATCH1, PATCH2, FINISH])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    sandbox_revert = [
        a for a, c, s in runner.calls
        if a[:2] == ["git", "apply"] and "-R" in a
        and SANDBOX_ROOT_NAME in Path(c).parts]
    assert sandbox_revert  # failed patch was reverted in the sandbox


def test_cheating_patch_rejected_then_clean_patch_accepted(tmp_path):
    runner = FakeRunner([1, 0])
    cheat = step("apply_patch", phase="patch", hypothesis="bad",
                 diff="--- a/spec.ts\n+++ b/spec.ts\n@@\n+  it.only('x', () => {})\n")
    chat = ScriptedChat([RED, cheat, PATCH1, FINISH])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    # The cheating diff was never applied anywhere (sandbox or main).
    assert all("it.only" not in d for _c, d in runner.applied)


def test_cannot_reproduce_blocks(tmp_path):
    runner = FakeRunner([0, 0])          # already green: cannot reproduce
    chat = ScriptedChat([RED, RED, step("blocked", reason="no matching reproduction test")])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    assert chat.calls == 3


def test_green_checks_do_not_prevent_later_reproduction(tmp_path):
    runner = FakeRunner([0, 0, 1, 0])
    chat = ScriptedChat([RED, RED, RED, PATCH1, FINISH])
    h, _ = harness_for(tmp_path, chat, runner)
    assert h.run(auto_approve=False).status == TaskStatus.AWAITING_APPROVAL


def test_every_check_persists_start_and_result_even_when_already_green(tmp_path):
    from agent_core.coder.gates import GateState
    from agent_core.coder.parser import RunCheckStep

    h, store = harness_for(tmp_path, ScriptedChat([]), FakeRunner([0, 1, 0]))
    gate = GateState()
    request = RunCheckStep(kind=CheckKind.UNIT)
    first = h.execute(request, gate)
    h.execute(request, gate)
    h.execute(request, gate)
    records = store.read_iterations(h.task.id)
    checks = [r for r in records if r.action == "run_check"]
    assert [r.decision for r in checks] == [
        "run_check unit: started", "run_check unit: PASS",
        "run_check unit: started", "run_check unit: FAIL",
        "run_check unit: started", "run_check unit: PASS",
    ]
    assert "15 passed" in first.observation
    assert "已修复" in first.observation
    assert "15 passed" in " ".join(checks[1].observations)
    assert gate.red_seen


def test_read_progress_updates_persisted_activity_time(tmp_path):
    from datetime import datetime, timezone
    from agent_core.coder.gates import GateState
    from agent_core.coder.parser import ReadFileStep

    h, store = harness_for(tmp_path, ScriptedChat([]), FakeRunner([]))
    seed_sb(tmp_path, "server/x.ts", "const x = 1;")
    h.task.updated_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
    store.save(h.task)
    h.execute(ReadFileStep(path="server/x.ts"), GateState())
    record = store.read_iterations(h.task.id)[-1]
    assert store.load(h.task.id).updated_at == record.created_at


def test_repeated_diagnosis_failures_can_continue_to_a_verified_patch(tmp_path):
    runner = FakeRunner([1, 1, 1, 1, 0])
    chat = ScriptedChat([RED, PATCH1, PATCH1, PATCH1, PATCH2, FINISH])
    h, _ = harness_for(tmp_path, chat, runner)
    assert h.run(auto_approve=False).status == TaskStatus.AWAITING_APPROVAL
    assert h.budget.rethink_count == 2


def test_manual_gate_pauses_then_approve_continues(tmp_path):
    runner = FakeRunner([1, 0])
    chat = ScriptedChat([RED, PATCH1, FINISH])
    h, store = harness_for(tmp_path, chat, runner)
    paused = h.run(auto_approve=False)
    assert paused.status == TaskStatus.AWAITING_APPROVAL
    # Main checkout is untouched before approval; apply only happened in sandbox.
    assert not any(Path(c) == tmp_path for c, _ in runner.applied)
    assert any(SANDBOX_ROOT_NAME in Path(c).parts for c, _ in runner.applied)
    resumed = h.run(auto_approve=True)
    assert resumed.status == TaskStatus.VERIFIED
    assert any(Path(c) == tmp_path for c, _ in runner.applied)


def test_budget_exhausted_blocks(tmp_path):
    runner = FakeRunner([0])
    seed_sb(tmp_path, "server/x.ts", "x")
    read = step("read_file", phase="reproduce", path="server/x.ts")
    chat = ScriptedChat([], loop=read)   # keeps reading forever
    h, _ = harness_for(tmp_path, chat, runner, cfg=BudgetConfig(max_model_calls=3))
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED


def test_read_missing_file_is_feedback_not_crash(tmp_path):
    # The model guesses a path that does not exist. The loop feeds the tool
    # error back as an observation instead of crashing the whole process.
    runner = FakeRunner([1])
    bad_read = step("read_file", phase="reproduce", path="server/src/missing.ts")
    give_up = step("blocked", phase="reproduce", reason="target file absent")
    chat = CapturingChat([bad_read, give_up])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    assert len(chat.seen) == 2
    flat = " ".join(str(m.get("content", "")) for m in chat.seen[1])
    assert "missing.ts" in flat and "not a file" in flat


def test_read_probes_are_recorded(tmp_path):
    runner = FakeRunner([0])
    seed_sb(tmp_path, "server/x.ts", "x")
    read = step("read_file", phase="reproduce", path="server/x.ts")
    give_up = step("blocked", phase="reproduce", reason="environment issue")
    chat = ScriptedChat([read, give_up])
    h, store = harness_for(tmp_path, chat, runner)
    h.run(auto_approve=True)
    probes = [i for i in store.read_iterations("dev_h1") if i.action == "read_file"]
    assert probes, "expected a read_file iteration to be recorded"
    assert any("server/x.ts" in o for i in probes for o in i.observations)


def test_probe_reminder_does_not_impose_default_hard_cap(tmp_path):
    runner = FakeRunner([0])
    reads = []
    for index in range(8):
        path = f"server/source-{index}.ts"
        seed_sb(tmp_path, path, f"const value = {index};")
        reads.append(step("read_file", phase="reproduce", path=path))
    give_up = step(
        "blocked", phase="reproduce",
        reason="local database/data issue; no test reproduces empty page")
    chat = CapturingChat(reads + [give_up])
    h, _ = harness_for(tmp_path, chat, runner)
    assert h.max_probes is None
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    flat = " ".join(
        " ".join(str(m.get("content", "")) for m in ms) for ms in chat.seen)
    assert "PROBE BUDGET WARNING" in flat
    assert "run_check" in flat and "blocked" in flat


def test_default_harness_completes_after_many_readonly_steps(tmp_path):
    runner = FakeRunner([1, 0])
    reads = []
    for index in range(50):
        path = f"server/source-{index}.ts"
        seed_sb(tmp_path, path, f"const value = {index};")
        reads.append(step("read_file", phase="reproduce", path=path))
    chat = ScriptedChat(reads + [RED, PATCH1, FINISH])
    h, store = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=False)
    assert out.status == TaskStatus.AWAITING_APPROVAL
    assert chat.calls == 53
    assert len([i for i in store.read_iterations(out.id) if i.action == "read_file"]) == 50
    assert not any(Path(c) == tmp_path for c, _ in runner.applied)


def test_repeated_source_reads_check_green_baseline_and_stop_without_fake_patch(tmp_path):
    runner = FakeRunner([0])
    seed_sb(tmp_path, "server/x.ts", "const alreadyFixed = true;")
    read = step("read_file", path="server/x.ts")
    chat = ScriptedChat([], loop=read)
    h, store = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=False)
    assert out.status == TaskStatus.BLOCKED
    assert not out.red_seen and out.verify_state == "none"
    assert chat.calls == 3
    records = store.read_iterations(out.id)
    assert any(r.decision == "run_check unit: PASS" for r in records)
    assert "无法复现" in records[-1].decision
    assert not list((store.root / out.id / "patches").glob("*.diff"))
    assert not runner.applied


def test_harness_reads_requested_page_beyond_original_4000_characters(tmp_path):
    from agent_core.coder.gates import GateState
    from agent_core.coder.parser import ReadFileStep

    seed_sb(tmp_path, "server/large.ts", "// padding " * 500 + "\nconst target = 'visible';\n")
    h, _ = harness_for(tmp_path, ScriptedChat([]), FakeRunner([]))
    result = h.execute(ReadFileStep(path="server/large.ts", start_line=2), GateState())
    assert "2: const target = 'visible';" in result.observation


@pytest.mark.parametrize("reason", [
    "iteration budget reached", "model call budget reached",
    "wall-clock time budget reached", "too many read-only probes without progress",
])
def test_explicit_resume_keeps_budget_block_evidence_and_revalidates(tmp_path, reason):
    chat = ScriptedChat([RED, PATCH1, FINISH])
    h, store = harness_for(tmp_path, chat, FakeRunner([1, 0]))
    h.task.red_seen = True
    h.task.sandbox_dirty = True
    h.task.verify_state = "passed"
    h._block(reason)
    history = store.read_iterations(h.task.id)
    out = h.run(auto_approve=False, resume_budget=True)
    assert out.status == TaskStatus.AWAITING_APPROVAL
    records = store.read_iterations(out.id)
    assert records[:len(history)] == history
    assert records[len(history)].action == "resume_budget"
    assert reason in records[len(history)].observations
    assert any(i.action == "run_check" and i.decision == "run_check unit: FAIL"
               for i in records[len(history):])
    assert chat.calls == 3


@pytest.mark.parametrize("reason", ["human rejected", "postgres unavailable", ""])
def test_resume_refuses_non_budget_blocks_without_model_or_artifact_changes(tmp_path, reason):
    chat = ScriptedChat([])
    h, store = harness_for(tmp_path, chat, FakeRunner())
    h._block(reason)
    before_task = store.load(h.task.id)
    before_history = store.read_iterations(h.task.id)
    with pytest.raises(ValueError, match="budget"):
        h.run(auto_approve=False, resume_budget=True)
    assert chat.calls == 0
    assert store.load(h.task.id) == before_task
    assert store.read_iterations(h.task.id) == before_history


def test_run_does_not_implicitly_resume_a_budget_block(tmp_path):
    chat = ScriptedChat([])
    h, _ = harness_for(tmp_path, chat, FakeRunner())
    h._block("iteration budget reached")
    assert h.run(auto_approve=False).status == TaskStatus.BLOCKED
    assert chat.calls == 0


@pytest.mark.parametrize("status", [TaskStatus.NEW, TaskStatus.AWAITING_APPROVAL, TaskStatus.VERIFIED])
def test_resume_flag_never_reopens_nonblocked_tasks(tmp_path, status):
    chat = ScriptedChat([])
    h, store = harness_for(tmp_path, chat, FakeRunner())
    h._block("iteration budget reached")
    h.task.set_status(status)
    store.save(h.task)
    before = store.load(h.task.id)
    with pytest.raises(ValueError, match="budget"):
        h.run(auto_approve=False, resume_budget=True)
    assert store.load(h.task.id) == before
    assert chat.calls == 0


def test_resume_refuses_missing_block_evidence(tmp_path):
    chat = ScriptedChat([])
    h, store = harness_for(tmp_path, chat, FakeRunner())
    h.task.set_status(TaskStatus.BLOCKED)
    store.save(h.task)
    with pytest.raises(ValueError, match="budget"):
        h.run(auto_approve=False, resume_budget=True)
    assert store.read_iterations(h.task.id) == []
    assert chat.calls == 0


def test_probe_env_detects_down_db_and_blocks_with_checklist(tmp_path):
    runner = FakeRunner([1])
    probe = step("probe_env", phase="reproduce")
    give_up = step(
        "blocked", phase="reproduce",
        reason="postgres down; run scripts/db/start-db.ps1")
    chat = ScriptedChat([probe, give_up])
    h, store = harness_for(tmp_path, chat, runner)
    h.tools.probe_targets = [
        ProbeTarget(name="postgres", kind="tcp", target="127.0.0.1:5432")]
    h.tools._probe = lambda targets: [
        ProbeResult(name="postgres", kind="tcp", target="127.0.0.1:5432",
                    up=False, detail="ConnectionRefused")]
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    assert any(i.action == "probe_env" for i in store.read_iterations("dev_h1"))


def test_grep_then_run_check_reproduces_and_continues(tmp_path):
    runner = FakeRunner([1, 0])
    seed_sb(tmp_path, "server/x.ts", "caps()\n")
    grep_step = step("grep", phase="reproduce", pattern="caps",
                     glob_include="*.ts")
    chat = ScriptedChat([grep_step, RED, PATCH1, FINISH])
    h, store = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    recs = store.read_iterations("dev_h1")
    assert any(i.action == "grep" for i in recs)
    assert any("server/x.ts" in o for i in recs if i.action == "grep"
               for o in i.observations)


def test_sandbox_e2e_acceptance_runs_fullstack(tmp_path):
    runner = FakeRunner([1, 0])
    task_accept = step("run_check", phase="reproduce", check="e2e")
    patch = step("apply_patch", phase="patch", hypothesis="h",
                 diff="--- a/x.ts\n+++ b/x.ts\n@@\n+1\n")
    chat = ScriptedChat([task_accept, patch, FINISH])
    # Build an e2e-acceptance task.
    store = TaskStore(tmp_path / "tasks")
    t = DevTask(id="dev_h1", title="e2e", problem="p",
                acceptance=[AcceptanceCriterion(id="a", description="d",
                                                check=CheckKind.E2E)],
                workdir=str(tmp_path))
    store.create(t)
    tools = ControlledTools(tmp_path, runner=runner)
    from agent_core.coder.sandbox import WorktreeSandbox
    from agent_core.coder.linker import Linker
    sb = WorktreeSandbox("dev_h1", tmp_path, tmp_path / "worktrees", tools,
                         linker=Linker())
    h = CoderHarness(t, chat, tools, store, verify_cwd=tmp_path, sandbox=sb,
                     supports_tools=False)
    h.run(auto_approve=True)
    cmds = [" ".join(a) for a, c, s in runner.calls
            if "test:e2e" in " ".join(a) and SANDBOX_ROOT_NAME in Path(c).parts]
    assert any("test:e2e:fullstack" in c for c in cmds)


def test_main_unit_failure_rolls_back_and_returns_to_diagnosis(tmp_path):
    runner = FakeRunner([1, 0], main_unit=1)   # sandbox green, main unit red
    chat = ScriptedChat([RED, PATCH1, FINISH], loop=PATCH1)
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    # The main checkout saw an apply followed by a rollback (-R).
    main_calls = [a for a, c, s in runner.calls
                  if a[:2] == ["git", "apply"] and Path(c) == tmp_path]
    assert any("-R" in " ".join(a) for a in main_calls)
    assert out.status in (TaskStatus.DIAGNOSED, TaskStatus.BLOCKED)


def test_sandbox_disabled_uses_legacy_main_path(tmp_path):
    runner = FakeRunner(sandbox_unit=[], main_unit=[1, 0])  # red then green on main
    chat = ScriptedChat([RED, PATCH1, FINISH])
    h, _ = harness_for(tmp_path, chat, runner, sandbox_enabled=False)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    # No worktree commands were issued.
    assert not any("worktree" in a for a, c, s in runner.calls)


def test_approval_in_new_process_loads_patch_from_disk(tmp_path):
    """`agent dev approve` runs in a brand-new process: the in-memory
    `_latest_patch` is gone. The approved patch must be reloaded from disk
    before it can land on the main checkout (this is the cross-process bug that
    a naive `_latest_patch is None` check would hit with 'no patch to verify').
    """
    runner = FakeRunner([1, 0])
    h1, store = harness_for(tmp_path, ScriptedChat([RED, PATCH1, FINISH]), runner)
    assert h1.run(auto_approve=False).status == TaskStatus.AWAITING_APPROVAL
    # Simulate the fresh CLI process: reload the task, new harness has no patch
    # in RAM and must not call the model (AWAITING goes straight to landing).
    task = store.load("dev_h1")
    tools2 = ControlledTools(tmp_path, runner=runner)
    from agent_core.coder.sandbox import WorktreeSandbox
    from agent_core.coder.linker import Linker
    sb2 = WorktreeSandbox("dev_h1", tmp_path, tmp_path / "worktrees", tools2,
                          linker=Linker())
    h2 = CoderHarness(task, ScriptedChat([]), tools2, store,
                      verify_cwd=tmp_path, sandbox=sb2)
    out = h2.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    assert any(Path(c) == tmp_path for c, _d in runner.applied)  # landed


@pytest.mark.parametrize("limits", [None, 20])
def test_build_harness_wires_sandbox_and_budget_settings(monkeypatch, tmp_path, limits):
    from agent_core.coder import cli
    from agent_core import config
    store = TaskStore(tmp_path / "tasks")
    task = make_task(tmp_path)
    store.create(task)
    monkeypatch.setattr(cli, "_store", lambda: store)
    monkeypatch.setattr(cli, "get_settings", lambda: config.Settings(
        _env_file=None, coder_data_dir=str(tmp_path / "coder"),
        coder_worktree_dir=str(tmp_path / "coder" / "worktrees"),
        coder_max_iterations=limits, coder_max_model_calls=limits,
        coder_wallclock_seconds=limits, coder_max_probes=limits,
        webapp_workdir=str(tmp_path)))
    h = cli.build_harness("dev_h1")
    assert h.sandbox is not None
    assert h.sandbox.path == tmp_path / "coder" / "worktrees" / "dev_h1"
    assert h.budget.config.max_iterations == limits
    assert h.budget.config.max_model_calls == limits
    assert h.budget.config.wallclock_seconds == limits
    assert h.max_probes == limits


def tool_reply(*calls):
    return ChatResponse(
        content="", model="script", tier="flash", usage=Usage(), latency_ms=0,
        tool_calls=[ToolCall(id=f"c{i}", name=name, arguments=args)
                    for i, (name, args) in enumerate(calls)],
    )


class FunctionChat:
    def __init__(self, responses):
        self.responses = list(responses)
        self.i = 0
        self.requests = []

    def chat(self, request):
        self.requests.append(request)
        response = self.responses[min(self.i, len(self.responses) - 1)]
        self.i += 1
        return response


def harness_for_function(tmp, chat, runner, cfg=None):
    store = TaskStore(tmp / "tasks")
    task = make_task(tmp)
    store.create(task)
    tools = ControlledTools(tmp, runner=runner)
    from agent_core.coder.sandbox import WorktreeSandbox
    from agent_core.coder.linker import Linker
    sandbox = WorktreeSandbox(
        "dev_h1", tmp, tmp / SANDBOX_ROOT_NAME, tools, linker=Linker())
    harness = CoderHarness(
        task, chat, tools, store, verify_cwd=tmp, sandbox=sandbox,
        budget=BudgetGuard(cfg) if cfg else BudgetGuard(BudgetConfig()),
        supports_tools=True,
    )
    return harness, store


def test_function_protocol_happy_path(tmp_path):
    runner = FakeRunner([1, 0])
    chat = FunctionChat([
        tool_reply(("run_check", {"check": "unit"})),
        tool_reply(("apply_patch", {
            "diff": "--- a/x.ts\n+++ b/x.ts\n@@\n+1\n",
            "hypothesis": "h1",
        })),
        tool_reply(("finish", {"summary": "done"})),
    ])
    harness, _ = harness_for_function(tmp_path, chat, runner)
    out = harness.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    assert out.red_seen is True
    assert all(request.tools is not None for request in chat.requests)


def test_function_gate_hides_apply_patch_before_red(tmp_path):
    runner = FakeRunner([1, 0])
    chat = FunctionChat([
        tool_reply(("run_check", {"check": "unit"})),
        tool_reply(("blocked", {"reason": "test stops after observing gate"})),
    ])
    harness, _ = harness_for_function(tmp_path, chat, runner)
    harness.run(auto_approve=True)
    first_tools = {tool["function"]["name"] for tool in chat.requests[0].tools}
    assert "apply_patch" not in first_tools and "finish" not in first_tools


@pytest.fixture()
def interrupted_verification(tmp_path):
    """Stop a real isolated git checkout after the harness persisted RUNNING."""
    from agent_core.coder.sandbox import WorktreeSandbox

    main = tmp_path / "main"
    main.mkdir()
    (main / "x.ts").write_text("old\n", encoding="utf-8")
    for args in (
        ["init"], ["add", "x.ts"],
        ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "baseline"],
    ):
        subprocess.run(["git", *args], cwd=main, check=True, capture_output=True)
    store = TaskStore(tmp_path / "tasks")
    task = make_task(main)
    store.create(task)
    diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-old\n+fixed\n"

    def stop_at(point):
        checks = []

        def run(argv, cwd, timeout=None, stdin=None):
            if argv[:2] == ["npm", "run"]:
                checks.append(argv[2])
                if len(checks) == 2 and point == "during_check":
                    raise KeyboardInterrupt("simulated process termination during verification")
                return CommandResult(argv=argv, returncode=1 if len(checks) == 1 else 0,
                                     stdout="Tests 1 failed" if len(checks) == 1 else "Tests 1 passed")
            return default_runner(argv, cwd, timeout, stdin)

        class InterruptibleSandbox(WorktreeSandbox):
            def apply(self, patch):
                if point == "before_apply":
                    raise KeyboardInterrupt("simulated process termination before apply")
                return super().apply(patch)

            def revert(self, patch):
                result = super().revert(patch)
                if point == "after_revert":
                    raise KeyboardInterrupt("simulated process termination after revert")
                return result

        tools = ControlledTools(main, runner=run)
        sandbox = InterruptibleSandbox(task.id, main, tmp_path / "worktrees", tools,
                                        link_dependencies=False, copy_env=False)
        chat = ScriptedChat([RED, step("apply_patch", diff=diff, hypothesis="replace old")])
        harness = CoderHarness(task, chat, tools, store, sandbox=sandbox, supports_tools=False)
        with pytest.raises(KeyboardInterrupt):
            harness.run(auto_approve=False)
        saved = store.load(task.id)
        assert saved.status == TaskStatus.VERIFYING
        assert saved.verify_state == "running" and saved.sandbox_dirty
        return sandbox

    def resume(chat):
        checks = []

        def run(argv, cwd, timeout=None, stdin=None):
            if argv[:2] == ["npm", "run"]:
                checks.append(argv[2])
                return CommandResult(argv=argv, returncode=0, stdout="Tests 1 passed")
            return default_runner(argv, cwd, timeout, stdin)

        tools = ControlledTools(main, runner=run)
        sandbox = WorktreeSandbox(task.id, main, tmp_path / "worktrees", tools,
                                   link_dependencies=False, copy_env=False)
        harness = CoderHarness(store.load(task.id), chat, tools, store,
                               sandbox=sandbox, supports_tools=False)
        return harness, checks

    return stop_at, resume, store, main


@pytest.mark.parametrize("point", ["before_apply", "during_check", "after_revert"])
def test_run_revalidates_persisted_interrupted_candidate(interrupted_verification, point):
    stop_at, resume, store, main = interrupted_verification
    sandbox = stop_at(point)
    before = store.read_iterations("dev_h1")
    chat = CapturingChat([FINISH])
    harness, checks = resume(chat)
    out = harness.run(auto_approve=False)
    assert out.status == TaskStatus.AWAITING_APPROVAL
    assert checks == ["test:unit", "type:check", "lint"]
    assert (main / "x.ts").read_text() == "old\n"
    assert (sandbox.path / "x.ts").read_text() == "old\n"
    records = store.read_iterations("dev_h1")
    assert records[:len(before)] == before
    assert any(record.action == "resume_verification" for record in records)
    assert any(record.decision == "sandbox checks green; reverted; ready to finish" for record in records[len(before):])
    assert "验收全部通过" in str(chat.seen[0])


def test_interrupted_recovery_keeps_unexpected_dirty_files_for_inspection(interrupted_verification):
    stop_at, resume, store, _ = interrupted_verification
    sandbox = stop_at("during_check")
    unexpected = sandbox.path / "unexpected.ts"
    unexpected.write_text("preserve evidence\n", encoding="utf-8")
    chat = ScriptedChat([])
    harness, checks = resume(chat)
    out = harness.run(auto_approve=False)
    assert out.status == TaskStatus.BLOCKED
    assert checks == [] and chat.calls == 0
    assert unexpected.read_text() == "preserve evidence\n"
    assert "interrupted verification" in store.read_iterations(out.id)[-1].decision

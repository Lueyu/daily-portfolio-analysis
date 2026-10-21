# tests/test_coder_harness.py
import json
import os
from pathlib import Path

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
from agent_core.coder.tools import ControlledTools
from agent_core.models import ChatResponse, Usage


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
                     budget=BudgetGuard(cfg) if cfg else BudgetGuard(BudgetConfig()))
    return h, store


RED = step("run_check", phase="reproduce", check="unit")
PATCH1 = step("apply_patch", phase="patch", hypothesis="h1",
              diff="--- a/x.ts\n+++ b/x.ts\n@@\n+1\n")
PATCH2 = step("apply_patch", phase="patch", hypothesis="h2-different",
              diff="--- a/y.ts\n+++ b/y.ts\n@@\n+2\n")


def test_happy_path_reproduce_patch_verify_verified(tmp_path):
    runner = FakeRunner([1, 0])      # red in sandbox, green in sandbox; main unit green
    chat = ScriptedChat([RED, PATCH1])
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
    chat = ScriptedChat([RED, PATCH1, PATCH2])
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
    chat = ScriptedChat([RED, cheat, PATCH1])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    # The cheating diff was never applied anywhere (sandbox or main).
    assert all("it.only" not in d for _c, d in runner.applied)


def test_cannot_reproduce_blocks(tmp_path):
    runner = FakeRunner([0, 0])          # already green: cannot reproduce
    chat = ScriptedChat([RED, RED])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED


def test_manual_gate_pauses_then_approve_continues(tmp_path):
    runner = FakeRunner([1, 0])
    chat = ScriptedChat([RED, PATCH1])
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


def test_probe_ultimatum_before_hard_cap(tmp_path):
    runner = FakeRunner([0])
    seed_sb(tmp_path, "server/x.ts", "x")
    read = step("read_file", phase="reproduce", path="server/x.ts")
    give_up = step(
        "blocked", phase="reproduce",
        reason="local database/data issue; no test reproduces empty page")
    chat = CapturingChat([read] * 8 + [give_up])
    h, _ = harness_for(tmp_path, chat, runner)
    assert h.max_probes >= 10
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    flat = " ".join(
        " ".join(str(m.get("content", "")) for m in ms) for ms in chat.seen)
    assert "PROBE BUDGET WARNING" in flat
    assert "run_check" in flat and "blocked" in flat


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
    chat = ScriptedChat([grep_step, RED, PATCH1])
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
    chat = ScriptedChat([task_accept, patch])
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
    h = CoderHarness(t, chat, tools, store, verify_cwd=tmp_path, sandbox=sb)
    h.run(auto_approve=True)
    cmds = [" ".join(a) for a, c, s in runner.calls
            if "test:e2e" in " ".join(a) and SANDBOX_ROOT_NAME in Path(c).parts]
    assert any("test:e2e:fullstack" in c for c in cmds)


def test_main_unit_failure_rolls_back_and_returns_to_diagnosis(tmp_path):
    runner = FakeRunner([1, 0], main_unit=1)   # sandbox green, main unit red
    # The same patch keeps failing the main-unit smoke; the retry discipline
    # must eventually block rather than loop forever.
    chat = ScriptedChat([RED, PATCH1], loop=PATCH1)
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    # The main checkout saw an apply followed by a rollback (-R).
    main_calls = [a for a, c, s in runner.calls
                  if a[:2] == ["git", "apply"] and Path(c) == tmp_path]
    assert any("-R" in " ".join(a) for a in main_calls)
    assert out.status in (TaskStatus.DIAGNOSED, TaskStatus.BLOCKED)


def test_sandbox_disabled_uses_legacy_main_path(tmp_path):
    runner = FakeRunner(sandbox_unit=[], main_unit=[1, 0])  # red then green on main
    chat = ScriptedChat([RED, PATCH1])
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
    h1, store = harness_for(tmp_path, ScriptedChat([RED, PATCH1]), runner)
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


def test_build_harness_wires_sandbox_when_enabled(monkeypatch, tmp_path):
    from agent_core.coder import cli
    from agent_core import config
    store = TaskStore(tmp_path / "tasks")
    task = make_task(tmp_path)
    store.create(task)
    monkeypatch.setattr(cli, "_store", lambda: store)
    monkeypatch.setattr(cli, "get_settings", lambda: config.Settings(
        _env_file=None, coder_data_dir=str(tmp_path / "coder"),
        coder_worktree_dir=str(tmp_path / "coder" / "worktrees"),
        webapp_workdir=str(tmp_path)))
    h = cli.build_harness("dev_h1")
    assert h.sandbox is not None
    assert h.sandbox.path == tmp_path / "coder" / "worktrees" / "dev_h1"

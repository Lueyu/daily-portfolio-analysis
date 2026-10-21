# tests/test_coder_harness.py
import json

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


class FakeRunner:
    """unit_results lists the exit code of each successive `test:unit` run."""
    def __init__(self, unit_results):
        self.unit_results = list(unit_results)
        self.i = 0
        self.applied = []
        self.calls = []

    def __call__(self, argv, cwd, timeout=None, stdin=None):
        cmd = " ".join(argv)
        self.calls.append(cmd)
        if "test:unit" in cmd:
            rc = self.unit_results[min(self.i, len(self.unit_results) - 1)]
            self.i += 1
            out = ("Tests  1 failed | 14 passed (15)\n × caps Buy to Hold\n"
                   if rc else "Tests  15 passed (15)\n")
            return CommandResult(argv=argv, returncode=rc, stdout=out, stderr="")
        if "git apply" in cmd and stdin:
            self.applied.append(stdin)
        return CommandResult(argv=argv, returncode=0, stdout="", stderr="")


def harness_for(tmp, chat, runner, cfg=None):
    store = TaskStore(tmp / "tasks")
    task = make_task(tmp)
    store.create(task)
    tools = ControlledTools(tmp, runner=runner)
    h = CoderHarness(task, chat, tools, store, verify_cwd=tmp,
                     budget=BudgetGuard(cfg) if cfg else BudgetGuard(BudgetConfig()))
    return h, store


RED = step("run_check", phase="reproduce", check="unit")
PATCH1 = step("apply_patch", phase="patch", hypothesis="h1",
              diff="--- a/x.ts\n+++ b/x.ts\n@@\n+1\n")
PATCH2 = step("apply_patch", phase="patch", hypothesis="h2-different",
              diff="--- a/y.ts\n+++ b/y.ts\n@@\n+2\n")


def test_happy_path_reproduce_patch_verify_verified(tmp_path):
    runner = FakeRunner([1, 0])            # red on reproduce, green on verify
    chat = ScriptedChat([RED, PATCH1])
    h, store = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    assert out.red_seen is True
    assert any("x.ts" in p for p in runner.applied)
    assert len(store.read_iterations("dev_h1")) >= 2
    assert (tmp_path / "tasks" / "dev_h1" / "patches" / "0001.diff").exists()


def test_first_patch_fails_then_second_succeeds(tmp_path):
    runner = FakeRunner([1, 1, 0])        # red, patch1 still red, patch2 green
    chat = ScriptedChat([RED, PATCH1, PATCH2])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    # Failed patch was reversed before the next attempt.
    assert "-R" in " ".join(c for c in runner.calls if "apply" in c)


def test_cheating_patch_rejected_then_clean_patch_accepted(tmp_path):
    runner = FakeRunner([1, 0])
    cheat = step("apply_patch", phase="patch", hypothesis="bad",
                 diff="--- a/spec.ts\n+++ b/spec.ts\n@@\n+  it.only('x', () => {})\n")
    chat = ScriptedChat([RED, cheat, PATCH1])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.VERIFIED
    assert all("it.only" not in d for d in runner.applied)  # cheat never applied


def test_cannot_reproduce_blocks(tmp_path):
    runner = FakeRunner([0, 0])          # already green: cannot reproduce
    chat = ScriptedChat([RED, RED])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED


def test_budget_exhausted_blocks(tmp_path):
    runner = FakeRunner([0])
    read = step("read_file", phase="reproduce", path="server/x.ts")
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "x.ts").write_text("x", encoding="utf-8")
    chat = ScriptedChat([], loop=read)   # keeps reading forever
    h, _ = harness_for(tmp_path, chat, runner, cfg=BudgetConfig(max_model_calls=3))
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED


class CapturingChat(ScriptedChat):
    """Remembers every request's messages so feedback can be asserted."""
    def __init__(self, contents):
        super().__init__(contents)
        self.seen = []

    def chat(self, request):
        self.seen.append(request.messages)
        return super().chat(request)


def test_read_missing_file_is_feedback_not_crash(tmp_path):
    # The model guesses a path that does not exist. A robust loop feeds the
    # tool error back as an observation so the model can correct itself,
    # instead of crashing the whole process.
    runner = FakeRunner([1])
    bad_read = step("read_file", phase="reproduce", path="server/src/missing.ts")
    give_up = step("blocked", phase="reproduce", reason="target file absent")
    chat = CapturingChat([bad_read, give_up])
    h, _ = harness_for(tmp_path, chat, runner)
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    # Second model round must carry the read failure back to the model.
    assert len(chat.seen) == 2
    flat = " ".join(str(m.get("content", "")) for m in chat.seen[1])
    assert "missing.ts" in flat and "not a file" in flat


def test_read_probes_are_recorded(tmp_path):
    # Each read must be recorded so the UI shows what the agent inspected.
    runner = FakeRunner([0])
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "x.ts").write_text("x", encoding="utf-8")
    read = step("read_file", phase="reproduce", path="server/x.ts")
    give_up = step("blocked", phase="reproduce", reason="environment issue")
    chat = ScriptedChat([read, give_up])
    h, store = harness_for(tmp_path, chat, runner)
    h.run(auto_approve=True)
    recs = store.read_iterations("dev_h1")
    probes = [i for i in recs if i.action == "read_file"]
    assert probes, "expected a read_file iteration to be recorded"
    assert any("server/x.ts" in o for i in probes for o in i.observations)


def test_probe_ultimatum_before_hard_cap(tmp_path):
    # A realistic investigation reads several files. Before the hard cap kills
    # the run, the model must be told to run_check or blocked with a checklist.
    runner = FakeRunner([0])
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "x.ts").write_text("x", encoding="utf-8")
    read = step("read_file", phase="reproduce", path="server/x.ts")
    give_up = step(
        "blocked", phase="reproduce",
        reason="local database/data issue; no test reproduces empty page")
    chat = CapturingChat([read] * 8 + [give_up])
    h, _ = harness_for(tmp_path, chat, runner)
    assert h.max_probes >= 10  # raised from 6 so real investigations fit
    out = h.run(auto_approve=True)
    assert out.status == TaskStatus.BLOCKED
    flat = " ".join(
        " ".join(str(m.get("content", "")) for m in ms) for ms in chat.seen)
    assert "PROBE BUDGET WARNING" in flat
    assert "run_check" in flat and "blocked" in flat


def test_manual_gate_pauses_then_approve_continues(tmp_path):
    runner = FakeRunner([1, 0])
    chat = ScriptedChat([RED, PATCH1])
    h, store = harness_for(tmp_path, chat, runner)
    paused = h.run(auto_approve=False)
    assert paused.status == TaskStatus.AWAITING_APPROVAL
    assert runner.applied == []          # nothing applied before approval
    resumed = h.run(auto_approve=True)
    assert resumed.status == TaskStatus.VERIFIED
    assert runner.applied               # applied after approval


def test_probe_env_detects_down_db_and_blocks_with_checklist(tmp_path):
    # A down database is an environment problem: the agent must detect it with
    # probe_env and block with a concrete human checklist, not burn the budget.
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
    # grep is a read-only probe: it must be traced and not break the loop that
    # then reproduces the failure with run_check and completes a fix.
    runner = FakeRunner([1, 0])
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "x.ts").write_text("caps()\n", encoding="utf-8")
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

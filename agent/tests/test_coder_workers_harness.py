"""Exercise a worker thread through the real model loop, tools and checkpoints."""
import json
import subprocess
import sys
import textwrap

import pytest

from agent_core.coder.checkpoints import BusyError, CheckpointStore
from agent_core.coder.general_harness import GeneralHarness
from agent_core.coder.general_state import MANAGED_EXCLUSIONS
from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask, TaskStatus
from agent_core.coder.task_store import TaskStore
from agent_core.coder.workers import WorkerManager
from agent_core.models import ChatResponse, ToolCall, Usage


class ScriptedChat:
    def __init__(self, criterion_id="answer"):
        self.steps = iter([
            ("edit_file", {"path": "one.py", "old_text": "answer = 0", "new_text": "answer = 42", "reason": "repair"}),
            ("verify", {"command": "python verify.py", "criterion_ids": [criterion_id], "scope": "target"}),
            ("verify", {"command": "python verify.py", "criterion_ids": [], "scope": "regression"}),
            ("finish", {"summary": "Real Python assertions passed"}),
        ])

    def chat(self, request):
        name, arguments = next(self.steps, ("blocked", {"reason": "Unexpected extra model call"}))
        return ChatResponse(content="", model="scripted-test", tier="flash", usage=Usage(), latency_ms=0,
                            tool_calls=[ToolCall(id="test-" + name, name=name, arguments=arguments)])


class LocalTestRuntime:
    """Only the fixed test fixture command executes; production uses containers."""
    def __init__(self, workspace):
        self.workspace, self.calls = workspace, 0

    def ensure(self):
        pass

    def active_writers(self):
        return []

    def terminal_start(self, command, **kwargs):
        assert command == "python verify.py"
        result = subprocess.run([sys.executable, "verify.py"], cwd=self.workspace,
                                capture_output=True, text=True, timeout=10)
        self.calls += 1
        return {"session_id": f"verify{self.calls}", "status": "completed", "exit_code": result.returncode,
                "output": result.stdout + result.stderr, "cursor": 0}

    def stop_all(self):
        pass


def test_worker_runs_real_harness_and_assertions_then_merges_and_undoes(tmp_path):
    workspace = tmp_path / "parent"
    workspace.mkdir()
    (workspace / "one.py").write_text("answer = 0\n", encoding="utf-8")
    (workspace / "verify.py").write_text(
        "from one import answer\nassert answer == 42\nprint('1 passed')\n", encoding="utf-8")
    parent = CheckpointStore(workspace, tmp_path / "parent-checkpoints", excluded_roots=MANAGED_EXCLUSIONS)
    parent.snapshot()
    children = []

    def runner(context):
        store = TaskStore(context.task_store_root)
        task = DevTask(id=context.task_id, title="worker", problem=context.prompt,
                       workdir=str(context.workspace), runtime_version=2,
                       acceptance=[AcceptanceCriterion(id="answer", description="answer is 42", check=CheckKind.UNIT)])
        store.create(task)
        harness = GeneralHarness(task, ScriptedChat(), store,
                                 runtime_factory=lambda source, state: LocalTestRuntime(source))
        harness.state = {"version": 2, "baseline": context.baseline_revision,
                         "revision": context.baseline_revision, "verification": [], "pending": None, "services": []}
        harness._save()
        context.register_cancel(harness.runtime.stop_all)
        children.append(harness)
        harness.run()
        return {"status": "completed" if task.status == TaskStatus.AWAITING_APPROVAL else "blocked",
                "summary": task.status.value}

    manager = WorkerManager(parent, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("Set answer to 42", ["one.py"])
        result = manager.poll(worker["worker_id"], wait_ms=10000)
        assert result["status"] == "completed", result
        assert children[0].runtime.calls == 2
        assert "answer = 0" in (workspace / "one.py").read_text()
        assert children[0].load_context()
        change = manager.merge(worker["worker_id"], expected_revision=parent.snapshot())
        assert "answer = 42" in (workspace / "one.py").read_text()
        assert change["verification_invalidated"] is True
        parent.undo(change["id"], expected_revision=change["after"])
        assert "answer = 0" in (workspace / "one.py").read_text()
    finally:
        manager.close()


def test_parent_agent_tools_spawn_child_loop_review_merge_and_require_reverification(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "one.py").write_text("answer = 0\n", encoding="utf-8")
    (source / "verify.py").write_text(
        "from one import answer\nassert answer == 42\nprint('1 passed')\n", encoding="utf-8")
    task = DevTask(id="dev_parentworkers", title="delegate", problem="Set answer to 42", workdir=str(source),
                   runtime_version=2,
                   acceptance=[AcceptanceCriterion(id="answer", description="answer is 42", check=CheckKind.UNIT)])
    store = TaskStore(tmp_path / "tasks")
    store.create(task)
    parent = GeneralHarness(task, ScriptedChat("worker_goal"), store,
                            runtime_factory=lambda workspace, state: LocalTestRuntime(workspace))

    def act(name, **arguments):
        return parent.execute(parent.registry.validate(name, arguments), parent.gate)

    try:
        parent.prepare()
        before = parent.journal.snapshot()
        spawned = json.loads(act("agent_spawn", prompt="Set answer to 42", owned_paths=["one.py"]).observation)
        worker_id = spawned["worker_id"]
        polled = json.loads(act("agent_poll", worker_id=worker_id, wait_ms=10000).observation)
        assert polled["status"] == "completed", polled
        diff = json.loads(act("agent_diff", worker_id=worker_id).observation)
        assert diff["files"] == ["one.py"] and "+answer = 42" in diff["diff"]
        assert "answer = 0" in (parent.workspace / "one.py").read_text()
        merged = json.loads(act("agent_merge", worker_id=worker_id, expected_revision=before).observation)
        assert merged["files"] == ["one.py"]
        assert parent.state["revision"] == merged["after"]
        assert act("finish", summary="child passed").signal != "finish"
        act("verify", command="python verify.py", criterion_ids=["answer"], scope="target")
        act("verify", command="python verify.py", criterion_ids=[], scope="regression")
        assert act("finish", summary="Parent also passed").signal == "finish"
        assert "answer = 0" in (source / "one.py").read_text()
        undone = json.loads(act("undo_change", change_id=merged["id"],
                                expected_revision=parent.state["revision"]).observation)
        assert undone["files"] == ["one.py"]
        assert "answer = 0" in (parent.workspace / "one.py").read_text()
        assert act("finish", summary="old validation").signal != "finish"
    finally:
        parent.stop()


def test_parent_runtime_stops_even_if_child_controller_close_is_busy(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    task = DevTask(id="dev_busyworker", title="cleanup", problem="cleanup", workdir=str(source),
                   acceptance=[AcceptanceCriterion(id="a", description="works", check=CheckKind.UNIT)])
    store = TaskStore(tmp_path / "tasks")
    store.create(task)
    parent = GeneralHarness(task, None, store,
                            runtime_factory=lambda workspace, state: LocalTestRuntime(workspace))
    stopped = []
    monkeypatch.setattr(parent.runtime, "stop_all", lambda: stopped.append(True))

    def busy():
        raise BusyError("worker cleanup still pending")

    monkeypatch.setattr(parent.extensions, "close", busy)
    with pytest.raises(BusyError, match="cleanup"):
        parent.stop()
    assert stopped == [True]


def test_parent_harness_reopens_worker_controller_after_clean_shutdown(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    task = DevTask(id="dev_reopenworker", title="resume", problem="resume", workdir=str(source),
                   acceptance=[AcceptanceCriterion(id="a", description="works", check=CheckKind.UNIT)])
    store = TaskStore(tmp_path / "tasks")
    store.create(task)
    parent = GeneralHarness(task, None, store,
                            runtime_factory=lambda workspace, state: LocalTestRuntime(workspace))
    parent.prepare()
    original = parent.extensions.workers()
    parent.stop()
    resumed = parent.extensions.workers()
    try:
        assert resumed is not original
        assert not resumed.active()
    finally:
        parent.stop()


def test_parent_restart_recovers_descendant_runtimes_after_process_exit(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    (source / "source.py").write_bytes(b"original")
    task = DevTask(id="dev_nestedrecovery", title="recover", problem="recover", workdir=str(source),
                   acceptance=[AcceptanceCriterion(id="a", description="works", check=CheckKind.UNIT)])
    store = TaskStore(tmp_path / "tasks")
    store.create(task)
    stopped_workspaces = []

    def runtime_factory(workspace, state):
        runtime = LocalTestRuntime(workspace)
        runtime.stop_all = lambda: stopped_workspaces.append(workspace)
        return runtime

    parent = GeneralHarness(task, None, store, runtime_factory=runtime_factory)
    parent.prepare()
    script = textwrap.dedent(f"""
        import os, threading
        from pathlib import Path
        from agent_core.coder.checkpoints import CheckpointStore
        from agent_core.coder.general_state import MANAGED_EXCLUSIONS
        from agent_core.coder.workers import WorkerManager
        ready = threading.Event()
        parent = CheckpointStore(Path({str(parent.workspace)!r}), Path({str(parent.journal.root)!r}),
                                 excluded_roots=MANAGED_EXCLUSIONS)
        def runner(context):
            journal = CheckpointStore(context.workspace, context.state_dir / 'checkpoints',
                                      excluded_roots=MANAGED_EXCLUSIONS)
            nested = WorkerManager(journal, context.state_dir / 'workers',
                                   lambda child: threading.Event().wait(), depth=1, max_depth=2)
            nested.spawn('grandchild')
            ready.set()
            threading.Event().wait()
        manager = WorkerManager(parent, Path({str(parent.state_dir / 'workers')!r}), runner, max_depth=2)
        manager.spawn('child')
        assert ready.wait(10)
        os._exit(27)
    """)
    process = subprocess.run([sys.executable, "-c", script], capture_output=True, timeout=20)
    assert process.returncode == 27, process.stderr
    try:
        parent.extensions.recover_workers()
        workers = parent.extensions.workers().list()
        assert workers[0]["status"] == "interrupted"
        child_root = parent.state_dir / "workers" / "tasks" / workers[0]["worker_id"] / "runtime"
        nested = json.loads((child_root / "workers" / "workers.json").read_text())
        grandchild = next(iter(nested["workers"].values()))
        assert grandchild["status"] == "interrupted"
        assert len(set(stopped_workspaces)) == 2
        assert child_root / "workspace" in stopped_workspaces
        assert parent.workspace not in stopped_workspaces
    finally:
        parent.stop()

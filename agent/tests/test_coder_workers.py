"""Parallel workers use independent source copies and conservative atomic merges."""
from __future__ import annotations

import importlib
import subprocess
import sys
import threading
from pathlib import Path

import pytest

from agent_core.coder.checkpoints import BusyError, CheckpointStore, ConflictError
from agent_core.coder.general_state import MANAGED_EXCLUSIONS


def api():
    return importlib.import_module("agent_core.coder.workers")


def fixture_store(tmp_path):
    workspace = tmp_path / "parent"
    workspace.mkdir()
    (workspace / "one.py").write_bytes(b"original\n")
    journal = CheckpointStore(workspace, tmp_path / "checkpoints", excluded_roots=MANAGED_EXCLUSIONS)
    journal.snapshot()
    return journal


def complete(manager, worker_id):
    result = manager.poll(worker_id, wait_ms=5000)
    assert result["status"] not in {"starting", "running", "cancelling"}, result
    return result


def test_parallel_workers_have_independent_current_source_and_merge_once(tmp_path):
    journal = fixture_store(tmp_path)
    (journal.workspace / "dirty.py").write_bytes(b"current uncommitted source")
    entered = threading.Barrier(3)
    release = threading.Event()
    seen = []

    def runner(context):
        seen.append(context)
        assert (context.workspace / "dirty.py").read_bytes() == b"current uncommitted source"
        assert context.baseline_revision == journal.snapshot()
        entered.wait(timeout=5)
        release.wait(timeout=5)
        (context.workspace / (context.prompt + ".py")).write_text(context.prompt, encoding="utf-8")
        return {"status": "completed", "summary": context.prompt}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        first = manager.spawn("first", ["first.py"])
        second = manager.spawn("second", ["second.py"])
        entered.wait(timeout=5)
        assert len(manager.active()) == 2
        assert len({c.workspace for c in seen}) == 2
        assert all(c.workspace != journal.workspace for c in seen)
        assert all(c.task_store_root / c.task_id / "runtime" == c.state_dir for c in seen)
        assert not (journal.workspace / "first.py").exists()
        release.set()
        complete(manager, first["worker_id"])
        complete(manager, second["worker_id"])
        (journal.workspace / "parent-only.py").write_bytes(b"preserve independent work")
        previous = journal.snapshot()
        diff = manager.diff(first["worker_id"])
        assert diff["files"] == ["first.py"] and "+first" in diff["diff"]
        change = manager.merge(first["worker_id"], expected_revision=previous)
        assert change["files"] == ["first.py"]
        assert (journal.workspace / "parent-only.py").read_bytes() == b"preserve independent work"
        assert len(journal.list_changes()) == 1
        assert manager.poll(first["worker_id"])["status"] == "merged"
        with pytest.raises(ValueError, match="completed"):
            manager.merge(first["worker_id"], expected_revision=change["after"])
        journal.undo(change["id"], expected_revision=change["after"])
        assert not (journal.workspace / "first.py").exists()
        assert (journal.workspace / "parent-only.py").exists()
    finally:
        release.set()
        manager.close()


def test_merge_rejects_same_file_conflict_without_changes(tmp_path):
    journal = fixture_store(tmp_path)

    def runner(context):
        (context.workspace / "one.py").write_bytes(b"worker")
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("change one")
        complete(manager, worker["worker_id"])
        (journal.workspace / "one.py").write_bytes(b"parent")
        revision = journal.snapshot()
        with pytest.raises(ConflictError, match="one.py"):
            manager.merge(worker["worker_id"], expected_revision=revision)
        assert (journal.workspace / "one.py").read_bytes() == b"parent"
        assert journal.list_changes() == []
        assert journal.pending() is None
    finally:
        manager.close()


def test_merge_rejects_scope_escape_and_stale_revision(tmp_path):
    journal = fixture_store(tmp_path)

    def runner(context):
        (context.workspace / "one.py").write_bytes(b"worker")
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("scope", ["allowed"])
        assert complete(manager, worker["worker_id"])["status"] == "completed"
        revision = journal.snapshot()
        with pytest.raises(ValueError, match="scope"):
            manager.merge(worker["worker_id"], expected_revision=revision)
        with pytest.raises(ConflictError, match="revision"):
            manager.merge(worker["worker_id"], expected_revision="0" * 64)
        assert (journal.workspace / "one.py").read_text() == "original\n"
    finally:
        manager.close()


def test_merge_io_failure_restores_parent_and_records_one_rollback(tmp_path, monkeypatch):
    journal = fixture_store(tmp_path)

    def runner(context):
        (context.workspace / "one.py").write_bytes(b"changed")
        (context.workspace / "two.py").write_bytes(b"new")
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("modify")
        complete(manager, worker["worker_id"])
        revision = journal.snapshot()
        objects = importlib.import_module("agent_core.coder.checkpoints.objects")
        original = objects.atomic_write
        failed = False

        def fail_second_write(path, data):
            nonlocal failed
            if path == journal.workspace / "two.py" and not failed:
                failed = True
                raise OSError("injected failure")
            return original(path, data)

        monkeypatch.setattr(objects, "atomic_write", fail_second_write)
        with pytest.raises(OSError, match="injected failure"):
            manager.merge(worker["worker_id"], expected_revision=revision)
        assert journal.snapshot() == revision
        assert len(journal.list_changes()) == 1
        assert journal.list_changes()[0]["status"] == "failed_rolled_back"
        assert journal.pending() is None
    finally:
        manager.close()


def test_cancel_propagates_only_to_owned_worker_and_preserves_partial_diff(tmp_path):
    journal = fixture_store(tmp_path)
    entered = threading.Barrier(3)
    stopped = []

    def runner(context):
        context.register_cancel(lambda: stopped.append(context.worker_id))
        (context.workspace / (context.prompt + ".py")).write_bytes(b"partial")
        entered.wait(timeout=5)
        context.cancel_event.wait(timeout=5)
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner, max_workers=2)
    try:
        first, second = manager.spawn("a"), manager.spawn("b")
        entered.wait(timeout=5)
        with pytest.raises(BusyError, match="concurrency"):
            manager.spawn("over limit")
        manager.cancel(first["worker_id"])
        assert complete(manager, first["worker_id"])["status"] == "cancelled"
        assert stopped == [first["worker_id"]]
        assert manager.poll(second["worker_id"])["status"] == "running"
        assert manager.diff(first["worker_id"])["files"] == ["a.py"]
        with pytest.raises(ValueError, match="completed"):
            manager.merge(first["worker_id"], expected_revision=journal.snapshot())
        manager.cancel_all()
        assert complete(manager, second["worker_id"])["status"] == "cancelled"
    finally:
        manager.close()


def test_duplicate_controller_cannot_interrupt_live_worker(tmp_path):
    journal = fixture_store(tmp_path)
    started, release = threading.Event(), threading.Event()

    def runner(context):
        started.set()
        release.wait(timeout=5)
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("active")
        assert started.wait(5)
        with pytest.raises(BusyError):
            api().WorkerManager(journal, tmp_path / "workers", runner)
        assert manager.poll(worker["worker_id"])["status"] == "running"
    finally:
        release.set()
        manager.close()


def test_restart_recovers_orphan_worker_after_controller_process_exit(tmp_path):
    journal = fixture_store(tmp_path)
    script = (
        "import os,threading; from pathlib import Path; "
        "from agent_core.coder.workers import WorkerManager; "
        "from agent_core.coder.checkpoints import CheckpointStore; "
        "from agent_core.coder.general_state import MANAGED_EXCLUSIONS; "
        f"j=CheckpointStore(Path({str(journal.workspace)!r}),Path({str(journal.root)!r}),"
        "excluded_roots=MANAGED_EXCLUSIONS); "
        f"m=WorkerManager(j,Path({str(tmp_path / 'workers')!r}),lambda c: threading.Event().wait()); "
        "m.spawn('orphan'); os._exit(23)"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True)
    assert result.returncode == 23, result.stderr
    recovered = []
    manager = api().WorkerManager(journal, tmp_path / "workers", lambda c: {},
                                 recover_runtime=lambda c: recovered.append(c.worker_id))
    try:
        records = manager.list()
        assert len(records) == 1 and records[0]["status"] == "interrupted"
        assert recovered == [records[0]["worker_id"]]
        assert not manager.active()
        assert manager.diff(records[0]["worker_id"])["files"] == []
    finally:
        manager.close()


def test_depth_limit_rejects_nested_spawn(tmp_path):
    journal = fixture_store(tmp_path)
    manager = api().WorkerManager(journal, tmp_path / "workers", lambda c: {}, depth=1, max_depth=1)
    try:
        with pytest.raises(ValueError, match="depth"):
            manager.spawn("too deep")
    finally:
        manager.close()


def test_cancel_cleanup_finishes_before_snapshot_and_reports_stop_failure(tmp_path):
    journal = fixture_store(tmp_path)
    entered, cleanup_started, release_cleanup = threading.Event(), threading.Event(), threading.Event()
    allow_cleanup = threading.Event()

    def runner(context):
        def stop():
            cleanup_started.set()
            release_cleanup.wait(timeout=5)
            if not allow_cleanup.is_set():
                raise OSError("runtime could not stop")

        context.register_cancel(stop)
        entered.set()
        context.cancel_event.wait(timeout=5)
        cleanup_started.wait(timeout=5)
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("running")
        assert entered.wait(5)
        canceller = threading.Thread(target=manager.cancel, args=(worker["worker_id"],))
        canceller.start()
        assert cleanup_started.wait(5)
        assert manager.poll(worker["worker_id"], wait_ms=100)["status"] == "cancelling"
        release_cleanup.set()
        canceller.join(5)
        result = complete(manager, worker["worker_id"])
        assert "runtime could not stop" in result["error"]
        assert "final_revision" not in result
        assert result["status"] == "cleanup_failed"
        assert manager.active()
        with pytest.raises(BusyError, match="running"):
            manager.diff(worker["worker_id"])
    finally:
        release_cleanup.set()
        with pytest.raises(BusyError, match="cleanup"):
            manager.close()
        allow_cleanup.set()
        manager.cancel(worker["worker_id"])
        manager.close()


def test_failed_cleanup_can_retry_without_restarting_worker(tmp_path):
    journal = fixture_store(tmp_path)
    stops = []

    def runner(context):
        def stop():
            stops.append(context.worker_id)
            if len(stops) == 1:
                raise OSError("transient stop failure")
        context.register_cancel(stop)
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("runtime cleanup")
        assert complete(manager, worker["worker_id"])["status"] == "cleanup_failed"
        assert manager.active()
        retried = manager.cancel(worker["worker_id"])
        assert retried["status"] == "cancelled"
        assert retried.get("final_revision")
        assert not manager.active()
        assert len(stops) == 2
    finally:
        manager.close()


def test_poll_reports_bounded_saved_child_progress_without_snapshotting_running_source(tmp_path):
    from agent_core.coder.task_store import TaskStore
    journal = fixture_store(tmp_path)
    started = threading.Event()

    def runner(context):
        for index in range(5):
            TaskStore._append_jsonl_atomic(context.state_dir / "events.jsonl", {
                "index": index, "action": "terminal_poll", "summary": f"step {index}",
                "createdAt": "2026-10-26T00:00:00Z", "payload": {"verbose": "do not echo"},
            })
        started.set()
        context.cancel_event.wait(timeout=5)
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("progress")
        assert started.wait(5)
        result = manager.poll(worker["worker_id"])
        assert [item["summary"] for item in result["recent_events"]] == ["step 2", "step 3", "step 4"]
        assert all("payload" not in item for item in result["recent_events"])
        assert "final_revision" not in result
    finally:
        manager.close()


def test_close_rejects_new_workers_while_cancelled_model_call_finishes(tmp_path):
    journal = fixture_store(tmp_path)
    started, release = threading.Event(), threading.Event()

    def runner(context):
        started.set()
        release.wait(timeout=5)
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        manager.spawn("waiting for model")
        assert started.wait(5)
        with pytest.raises(BusyError, match="progress"):
            manager.close(wait_ms=0)
        with pytest.raises(RuntimeError, match="closing"):
            manager.spawn("must not start during teardown")
    finally:
        release.set()
        manager.close()


def test_completed_worker_merge_survives_manager_manifest_save_failure(tmp_path, monkeypatch):
    journal = fixture_store(tmp_path)

    def runner(context):
        (context.workspace / "one.py").write_bytes(b"child")
        return {"status": "completed"}

    root = tmp_path / "workers"
    manager = api().WorkerManager(journal, root, runner)
    worker = manager.spawn("modify")
    complete(manager, worker["worker_id"])
    with monkeypatch.context() as patch:
        patch.setattr(manager, "_save", lambda: (_ for _ in ()).throw(OSError("manifest write failed")))
        with pytest.raises(OSError, match="manifest write"):
            manager.merge(worker["worker_id"], expected_revision=journal.snapshot())
    manager.close()
    resumed = api().WorkerManager(journal, root, runner)
    try:
        assert resumed.poll(worker["worker_id"])["status"] == "merged"
        assert len(journal.list_changes()) == 1
    finally:
        resumed.close()


def test_binary_add_delete_and_file_directory_merge_preserve_other_parent_work(tmp_path):
    journal = fixture_store(tmp_path)
    (journal.workspace / "obsolete").write_bytes(b"remove me")

    def runner(context):
        (context.workspace / "one.py").unlink()
        (context.workspace / "one.py").mkdir()
        (context.workspace / "one.py" / "image.bin").write_bytes(b"\x00\xff\x80binary")
        (context.workspace / "obsolete").unlink()
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("change file layout")
        complete(manager, worker["worker_id"])
        (journal.workspace / "parent.txt").write_bytes(b"keep")
        change = manager.merge(worker["worker_id"], expected_revision=journal.snapshot())
        assert (journal.workspace / "one.py" / "image.bin").read_bytes() == b"\x00\xff\x80binary"
        assert not (journal.workspace / "obsolete").exists()
        journal.undo(change["id"], expected_revision=change["after"])
        assert (journal.workspace / "one.py").read_bytes() == b"original\n"
        assert (journal.workspace / "obsolete").read_bytes() == b"remove me"
        assert (journal.workspace / "parent.txt").read_bytes() == b"keep"
    finally:
        manager.close()


def test_unsafe_worker_output_is_failed_and_never_mergeable(tmp_path):
    journal = fixture_store(tmp_path)

    def runner(context):
        (context.workspace / ".env").write_bytes(b"SECRET=not-managed")
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("invalid source")
        result = complete(manager, worker["worker_id"])
        assert result["status"] == "failed" and "environment" in result["error"]
        with pytest.raises(ValueError, match="completed"):
            manager.merge(worker["worker_id"], expected_revision=journal.snapshot())
        assert not (journal.workspace / ".env").exists()
    finally:
        manager.close()


def test_worker_runtime_registered_after_cancel_is_stopped_immediately(tmp_path):
    journal = fixture_store(tmp_path)
    entered, register = threading.Event(), threading.Event()
    stopped = []

    def runner(context):
        entered.set()
        register.wait(timeout=5)
        context.register_cancel(lambda: stopped.append(context.worker_id))
        return {"status": "completed"}

    manager = api().WorkerManager(journal, tmp_path / "workers", runner)
    try:
        worker = manager.spawn("late runtime")
        assert entered.wait(5)
        manager.cancel(worker["worker_id"])
        register.set()
        assert complete(manager, worker["worker_id"])["status"] == "cancelled"
        assert stopped == [worker["worker_id"]]
    finally:
        register.set()
        manager.close()


def test_parent_pending_operation_rejects_spawn(tmp_path):
    journal = fixture_store(tmp_path)
    manager = api().WorkerManager(journal, tmp_path / "workers", lambda c: {})
    try:
        pending = journal.begin("active terminal", "terminal")
        with pytest.raises(BusyError, match="pending"):
            manager.spawn("unstable source")
        journal.finish(pending)
    finally:
        manager.close()

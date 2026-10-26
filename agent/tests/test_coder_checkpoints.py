"""Byte-preserving checkpoints use real workspaces and never use Git restore."""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


def api():
    return importlib.import_module("agent_core.coder.checkpoints")


def make_store(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    return api().CheckpointStore(workspace, tmp_path / "checkpoints"), workspace


def record(store, workspace, name, data):
    operation = store.begin(reason="test edit", tool="write_file")
    path = workspace / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return store.finish(operation)


@pytest.mark.parametrize("crash_after_move", [False, True])
def test_unsupported_terminal_files_can_be_quarantined_and_rolled_back(tmp_path, monkeypatch, crash_after_move):
    store, workspace = make_store(tmp_path)
    (workspace / "a.txt").write_bytes(b"before")
    before = store.snapshot()
    operation = store.begin("unsafe command", "terminal")
    (workspace / "a.txt").write_bytes(b"partial")
    (workspace / ".env").write_bytes(b"private created content")
    with pytest.raises(api().UnsafePathError):
        store.finish(operation)
    if crash_after_move:
        original = store._objects.apply
        monkeypatch.setattr(store._objects, "apply", lambda *args: (_ for _ in ()).throw(KeyboardInterrupt()))
        with pytest.raises(KeyboardInterrupt):
            store.rollback_pending()
        monkeypatch.setattr(store._objects, "apply", original)
        store = api().CheckpointStore(workspace, store.root)
    change = store.rollback_pending()
    assert change["status"] == "failed_rolled_back"
    assert change["after"] == before and store.pending() is None
    assert (workspace / "a.txt").read_bytes() == b"before"
    assert not (workspace / ".env").exists()
    quarantine = store.root / "quarantine" / operation
    assert (quarantine / ".env").read_bytes() == b"private created content"
    assert record(store, workspace, "a.txt", b"next")["files"] == ["a.txt"]


def test_hard_exit_during_reconstruction_does_not_poison_live_workspace(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a.txt").write_bytes(b"before")
    before = store.snapshot()
    operation = store.begin("bad command", "terminal")
    (workspace / ".env").write_bytes(b"created")
    with pytest.raises(api().UnsafePathError):
        store.finish(operation)
    script = (
        "import os; from pathlib import Path; "
        "from agent_core.coder.checkpoints import CheckpointStore; "
        f"s=CheckpointStore(Path({str(workspace)!r}),Path({str(store.root)!r})); "
        "original=os.replace; "
        "\ndef die(source, target):"
        "\n if 'reconstruction' in Path(target).parts and Path(target).name=='a.txt': os._exit(72)"
        "\n return original(source,target)"
        "\nos.replace=die; s.rollback_pending()"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True,
                            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")})
    assert result.returncode == 72, result.stderr
    assert not list(workspace.iterdir())
    resumed = api().CheckpointStore(workspace, store.root)
    assert resumed.rollback_pending()["after"] == before
    assert (workspace / "a.txt").read_bytes() == b"before"


def test_snapshot_restores_binary_ignored_source_additions_and_deletions(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / ".gitignore").write_bytes(b"*.bin\nignored.py\n")
    (workspace / "ignored.py").write_bytes(b"original\r\n")
    (workspace / "asset.bin").write_bytes(bytes(range(256)))
    revision = store.snapshot()
    operation = store.begin("rename and modify", "shell")
    (workspace / "ignored.py").rename(workspace / "renamed.py")
    (workspace / "asset.bin").write_bytes(b"\x00\xffnew")
    change = store.finish(operation)
    assert set(change["files"]) == {"ignored.py", "renamed.py", "asset.bin"}
    restored = store.restore(revision, expected_revision=change["after"])
    assert (workspace / "ignored.py").read_bytes() == b"original\r\n"
    assert not (workspace / "renamed.py").exists()
    assert (workspace / "asset.bin").read_bytes() == bytes(range(256))
    assert restored["after"] == revision
    assert len(store.list_changes()) == 2
    store.undo(restored["id"], expected_revision=revision)
    assert (workspace / "renamed.py").read_bytes() == b"original\r\n"


def test_undo_preserves_later_unrelated_changes(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a.py").write_bytes(b"before")
    first = record(store, workspace, "a.py", b"after")
    second = record(store, workspace, "b.py", b"keep me")
    result = store.undo(first["id"], expected_revision=second["after"])
    assert result["files"] == ["a.py"]
    assert (workspace / "a.py").read_bytes() == b"before"
    assert (workspace / "b.py").read_bytes() == b"keep me"


def test_same_file_conflict_leaves_all_bytes_and_journal_unchanged(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a.py").write_bytes(b"before")
    first = record(store, workspace, "a.py", b"first")
    second = record(store, workspace, "a.py", b"second")
    before = store.list_changes()
    with pytest.raises(api().ConflictError, match="a.py"):
        store.undo(first["id"], expected_revision=second["after"])
    assert (workspace / "a.py").read_bytes() == b"second"
    assert store.list_changes() == before
    assert store.pending() is None


def test_stale_restore_rejected_before_writing(tmp_path):
    store, workspace = make_store(tmp_path)
    first = record(store, workspace, "a", b"one")
    (workspace / "a").write_bytes(b"external edit")
    with pytest.raises(api().ConflictError, match="revision"):
        store.restore(first["before"], expected_revision=first["after"])
    assert (workspace / "a").read_bytes() == b"external edit"


def test_cancelled_operation_records_partial_writes_and_can_be_undone(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a").write_bytes(b"original")
    operation = store.begin("cancelled tool", "shell")
    (workspace / "a").write_bytes(b"partial")
    change = store.finish(operation, status="cancelled")
    assert change["status"] == "cancelled"
    assert change["before"] != change["after"]
    store.undo(change["id"], change["after"])
    assert (workspace / "a").read_bytes() == b"original"


def test_interrupted_operation_survives_restart_and_recovers(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a").write_bytes(b"original")
    operation = store.begin("interrupted tool", "shell")
    (workspace / "a").write_bytes(b"partial")
    store.close()
    reopened = api().CheckpointStore(workspace, store.root)
    assert reopened.pending()["id"] == operation
    with pytest.raises(api().BusyError):
        reopened.begin("must recover first", "shell")
    recovered = reopened.recover()
    assert recovered["status"] == "recovered"
    assert reopened.pending() is None
    reopened.undo(recovered["id"], recovered["after"])
    assert (workspace / "a").read_bytes() == b"original"
    assert reopened.recover() is None


def test_dependency_roots_excluded_but_gitignored_source_is_managed(tmp_path):
    store, workspace = make_store(tmp_path)
    for name in ["node_modules", ".git", ".venv", "__pycache__"]:
        (workspace / name).mkdir()
        (workspace / name / "keep").write_bytes(b"before")
    revision = store.snapshot()
    for name in ["node_modules", ".git", ".venv", "__pycache__"]:
        (workspace / name / "keep").write_bytes(b"after")
    assert store.snapshot() == revision
    (workspace / "ordinary.tmp").write_bytes(b"included")
    assert store.snapshot() != revision


def test_corrupt_blob_prevents_restore_without_workspace_changes(tmp_path):
    store, workspace = make_store(tmp_path)
    change = record(store, workspace, "a", b"before")
    latest = record(store, workspace, "a", b"after")
    import hashlib

    digest = hashlib.sha256(b"before").hexdigest()
    blobs = list(store.root.rglob(digest))
    assert len(blobs) == 1
    blobs[0].write_bytes(b"CORRUPT")
    with pytest.raises(api().IntegrityError):
        store.restore(change["after"], latest["after"])
    assert (workspace / "a").read_bytes() == b"after"
    assert store.pending() is None


def test_store_must_be_outside_workspace(tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with pytest.raises(api().UnsafePathError):
        api().CheckpointStore(workspace, workspace / ".snapshots")


def test_process_lock_serializes_mutation_across_store_instances(tmp_path):
    store, workspace = make_store(tmp_path)
    operation = store.begin("held", "shell")
    script = (
        "from pathlib import Path; "
        "from agent_core.coder.checkpoints import CheckpointStore, BusyError; "
        f"s=CheckpointStore(Path({str(workspace)!r}),Path({str(store.root)!r})); "
        "\ntry: s.begin('competing','shell')"
        "\nexcept BusyError: print('locked')"
        "\nelse: raise AssertionError('concurrent writer accepted')"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")})
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "locked"
    store.finish(operation)
    other = api().CheckpointStore(workspace, store.root)
    other.finish(other.begin("next", "shell"))


def test_manifest_unsafe_path_is_rejected(tmp_path):
    store, workspace = make_store(tmp_path)
    revision = store.snapshot()
    import hashlib

    payload = {"version": 1, "files": {"../escape": {"sha256": "0" * 64, "mode": 420}}}
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    bad_revision = hashlib.sha256(data).hexdigest()
    (store.root / "manifests" / f"{bad_revision}.json").write_bytes(data)
    with pytest.raises(api().UnsafePathError):
        store.restore(bad_revision, revision)
    assert not (tmp_path / "escape").exists()


def test_cross_platform_case_collision_manifest_is_rejected(tmp_path):
    store, workspace = make_store(tmp_path)
    revision = store.snapshot()
    import hashlib

    entry = {"sha256": "0" * 64, "mode": 420}
    payload = {"version": 1, "files": {"Readme": entry, "README": entry}}
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    bad_revision = hashlib.sha256(data).hexdigest()
    (store.root / "manifests" / f"{bad_revision}.json").write_bytes(data)
    with pytest.raises(api().UnsafePathError, match="collision"):
        store.restore(bad_revision, revision)


def test_symlink_or_junction_escape_is_rejected(tmp_path):
    store, workspace = make_store(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep").write_bytes(b"safe")
    link = workspace / "escape"
    if os.name == "nt":
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"New-Item -ItemType Junction -Path '{link}' -Target '{outside}'"],
            capture_output=True,
        )
        assert result.returncode == 0
    else:
        link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(api().UnsafePathError):
        store.snapshot()
    assert (outside / "keep").read_bytes() == b"safe"


def test_file_directory_transitions_restore_without_touching_excluded_roots(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "node").write_bytes(b"file")
    revision = store.snapshot()
    operation = store.begin("file to directory", "shell")
    (workspace / "node").unlink()
    (workspace / "node").mkdir()
    (workspace / "node" / "child").write_bytes(b"child")
    change = store.finish(operation)
    store.restore(revision, change["after"])
    assert (workspace / "node").read_bytes() == b"file"


def test_export_snapshot_preserves_bytes_without_touching_live_workspace(tmp_path):
    store, workspace = make_store(tmp_path)
    change = record(store, workspace, "nested/asset.bin", b"\x00\xfforiginal")
    (workspace / "nested" / "asset.bin").write_bytes(b"later")
    destination = tmp_path / "export"
    manifest = store.read_manifest(change["after"])
    assert set(manifest) == {"nested/asset.bin"}
    store.export_snapshot(change["after"], destination)
    assert (destination / "nested" / "asset.bin").read_bytes() == b"\x00\xfforiginal"
    assert (workspace / "nested" / "asset.bin").read_bytes() == b"later"
    with pytest.raises(api().UnsafePathError):
        store.export_snapshot(change["after"], workspace)
    with pytest.raises(api().UnsafePathError):
        store.export_snapshot(change["after"], destination)


def test_secret_environment_file_is_refused_before_any_blob_is_written(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / ".env.local").write_bytes(b"SECRET=never-copy")
    (workspace / "a.py").write_bytes(b"source")
    with pytest.raises(api().UnsafePathError, match="environment"):
        store.snapshot()
    assert list((store.root / "blobs").iterdir()) == []


def test_restore_preflights_excluded_directory_obstruction_before_writing(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a").write_bytes(b"before")
    (workspace / "z").write_bytes(b"file")
    revision = store.snapshot()
    (workspace / "a").write_bytes(b"after")
    (workspace / "z").unlink()
    (workspace / "z" / "node_modules").mkdir(parents=True)
    (workspace / "z" / "node_modules" / "keep").write_bytes(b"excluded")
    expected = store.snapshot()
    with pytest.raises(api().ConflictError, match="z"):
        store.restore(revision, expected)
    assert (workspace / "a").read_bytes() == b"after"
    assert (workspace / "z" / "node_modules" / "keep").read_bytes() == b"excluded"
    assert store.pending() is None


def test_partial_restore_io_failure_rolls_back_and_records_failure(tmp_path, monkeypatch):
    store, workspace = make_store(tmp_path)
    for name in ["a", "b"]:
        (workspace / name).write_bytes(b"original")
    revision = store.snapshot()
    for name in ["a", "b"]:
        (workspace / name).write_bytes(b"current")
    expected = store.snapshot()
    objects = importlib.import_module("agent_core.coder.checkpoints.objects")
    real_write = objects.atomic_write
    failed = False

    def fail_second_workspace_write(path, data):
        nonlocal failed
        if path == workspace / "b" and not failed:
            failed = True
            raise OSError("injected disk failure")
        real_write(path, data)

    monkeypatch.setattr(objects, "atomic_write", fail_second_workspace_write)
    with pytest.raises(OSError, match="injected"):
        store.restore(revision, expected)
    assert store.snapshot() == expected
    assert store.pending() is None
    assert store.list_changes()[-1]["status"] == "failed_rolled_back"


def test_failed_rollback_keeps_recoverable_journal(tmp_path, monkeypatch):
    store, workspace = make_store(tmp_path)
    for name in ["a", "b"]:
        (workspace / name).write_bytes(b"original")
    revision = store.snapshot()
    for name in ["a", "b"]:
        (workspace / name).write_bytes(b"current")
    expected = store.snapshot()
    objects = importlib.import_module("agent_core.coder.checkpoints.objects")
    real_write = objects.atomic_write

    def fail_restore_and_rollback(path, data):
        if path == workspace / "b" or (path == workspace / "a" and data == b"current"):
            raise OSError("persistent disk failure")
        real_write(path, data)

    monkeypatch.setattr(objects, "atomic_write", fail_restore_and_rollback)
    with pytest.raises(api().CheckpointError, match="recovery"):
        store.restore(revision, expected)
    assert store.pending()["before"] == expected
    assert (workspace / "a").read_bytes() == b"original"
    assert (workspace / "b").read_bytes() == b"current"
    monkeypatch.setattr(objects, "atomic_write", real_write)
    change = store.recover()
    store.undo(change["id"], change["after"])
    assert store.snapshot() == expected


def test_different_store_roots_cannot_mutate_the_same_workspace_concurrently(tmp_path):
    store, workspace = make_store(tmp_path)
    alternative = api().CheckpointStore(workspace, tmp_path / "other-store")
    operation = store.begin("held", "shell")
    with pytest.raises(api().BusyError):
        alternative.begin("competing", "shell")
    store.finish(operation)


def test_actual_owner_process_exit_releases_lock_and_preserves_pending(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a").write_bytes(b"original")
    script = (
        "import os; from pathlib import Path; "
        "from agent_core.coder.checkpoints import CheckpointStore; "
        f"w=Path({str(workspace)!r}); s=CheckpointStore(w,Path({str(store.root)!r})); "
        "s.begin('crash','shell'); (w/'a').write_bytes(b'partial'); os._exit(23)"
    )
    result = subprocess.run([sys.executable, "-c", script], capture_output=True,
                            env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")})
    assert result.returncode == 23
    assert store.pending() is not None
    change = store.recover()
    store.undo(change["id"], change["after"])
    assert (workspace / "a").read_bytes() == b"original"


@pytest.mark.parametrize("name", ["/absolute", "a\\b", "a/../b", "C:/escape", "a:stream", "NUL", "x.", "x "])
def test_unsafe_manifest_paths_are_rejected_before_writes(tmp_path, name):
    store, workspace = make_store(tmp_path)
    revision = store.snapshot()
    import hashlib

    payload = {"version": 1, "files": {name: {"sha256": "0" * 64, "mode": 420}}}
    data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    bad_revision = hashlib.sha256(data).hexdigest()
    (store.root / "manifests" / f"{bad_revision}.json").write_bytes(data)
    with pytest.raises(api().UnsafePathError):
        store.restore(bad_revision, revision)
    assert list(workspace.iterdir()) == []


def test_manifest_checksum_tampering_is_detected(tmp_path):
    store, workspace = make_store(tmp_path)
    original = record(store, workspace, "a", b"original")
    current = record(store, workspace, "a", b"current")
    manifest = store.root / "manifests" / f"{original['after']}.json"
    manifest.write_bytes(b'{"version":1,"files":{}}')
    with pytest.raises(api().IntegrityError, match="Corrupt manifest"):
        store.restore(original["after"], current["after"])
    assert (workspace / "a").read_bytes() == b"current"


def test_adopt_inflight_operation_does_not_snapshot_running_writes(tmp_path, monkeypatch):
    store, workspace = make_store(tmp_path)
    operation = store.begin("long process", "shell")
    (workspace / "a").write_bytes(b"in progress")
    store.close()
    reopened = api().CheckpointStore(workspace, store.root)
    real_capture = reopened._objects.capture

    def forbidden_capture():
        raise AssertionError("adopt must not snapshot a running process")

    monkeypatch.setattr(reopened._objects, "capture", forbidden_capture)
    with pytest.raises(api().CheckpointError, match="operation"):
        reopened.adopt("wrong-id")
    assert reopened.adopt(operation)["id"] == operation
    (workspace / "a").write_bytes(b"finished")
    monkeypatch.setattr(reopened._objects, "capture", real_capture)
    change = reopened.finish(operation)
    assert change["files"] == ["a"]
    assert reopened.pending() is None


def test_replaced_blob_directory_cannot_redirect_checkpoint_writes(tmp_path):
    store, workspace = make_store(tmp_path)
    (workspace / "a").write_bytes(b"source")
    outside = tmp_path / "outside-store"
    outside.mkdir()
    link = store.root / "blobs"
    link.rmdir()
    if os.name == "nt":
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             f"New-Item -ItemType Junction -Path '{link}' -Target '{outside}'"],
            capture_output=True,
        )
        assert result.returncode == 0
    else:
        link.symlink_to(outside, target_is_directory=True)
    with pytest.raises(api().UnsafePathError):
        store.snapshot()
    assert list(outside.iterdir()) == []

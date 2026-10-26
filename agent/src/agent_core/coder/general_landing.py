"""Approval-only file landing with isolated revalidation and durable undo data.

Git is used only by source seeding to enumerate files. Model commands never run
in the main checkout, and landing never changes its index or branch.
"""
from __future__ import annotations

import json
import os
import re
import stat
import uuid
from pathlib import Path

from .checkpoints import CheckpointStore, ConflictError, IntegrityError
from .checkpoints.locking import MutationLock, workspace_lock_path
from .checkpoints.objects import atomic_write, canonical, digest
from .checkpoints.paths import reject_link, reject_link_ancestors, validate_paths
from .general_state import MANAGED_EXCLUSIONS, seed_workspace, source_path
from .models import TaskStatus


def _save(path: Path, value: dict) -> None:
    atomic_write(path, canonical(value))


def _read(path: Path, default=None):
    reject_link_ancestors(path)
    return json.loads(path.read_bytes()) if path.exists() else default


def _entry(root: Path, name: str) -> dict | None:
    path = source_path(root, name)
    try:
        before = path.stat()
    except (FileNotFoundError, NotADirectoryError):
        return None
    if stat.S_ISDIR(before.st_mode):
        return None
    if not stat.S_ISREG(before.st_mode):
        raise ConflictError(f"Unsupported main file: {name}")
    data = path.read_bytes()
    after = path.stat()
    if (before.st_mtime_ns, before.st_size, before.st_ino) != (
            after.st_mtime_ns, after.st_size, after.st_ino):
        raise ConflictError(f"File changed while reading: {name}")
    return {"sha256": digest(data), "mode": stat.S_IMODE(after.st_mode) & 0o777}


def _assert_entries(root: Path, expected: dict, alternate: dict | None = None) -> dict:
    actual = {name: _entry(root, name) for name in expected}
    conflicts = [name for name, value in actual.items() if value != expected[name]
                 and (alternate is None or value != alternate[name])]
    if conflicts:
        raise ConflictError("Main file conflict: " + ", ".join(conflicts))
    return actual


def _preflight(root: Path, current: dict, desired: dict) -> None:
    removed = {name for name, entry in current.items() if entry is not None and desired[name] is None}
    for name, entry in desired.items():
        target = source_path(root, name)
        if entry is None:
            continue
        for parent in target.parents:
            if parent == root:
                break
            if parent.is_file() and parent.relative_to(root).as_posix() not in removed:
                raise ConflictError(f"Unmanaged parent file blocks landing: {name}")
        if not target.is_dir():
            continue
        for directory, folders, files in os.walk(target, followlinks=False):
            for child in folders + files:
                path = Path(directory) / child
                reject_link(path)
                if child in files and path.relative_to(root).as_posix() not in removed:
                    raise ConflictError(f"Unmanaged directory contents block landing: {name}")


def _bytes(root: Path, name: str, entry: dict) -> bytes:
    path = source_path(root, name)
    data = path.read_bytes()
    if digest(data) != entry["sha256"]:
        raise IntegrityError(f"Landing backup checksum mismatch: {name}")
    return data


def _mutate(root: Path, current: dict, desired: dict, backup: Path, progress=None) -> None:
    """Only scoped regular files are replaced; unexpected files are never removed."""
    _preflight(root, current, desired)
    contents = {name: _bytes(backup, name, entry) for name, entry in desired.items() if entry is not None}
    removed = sorted((name for name in current if current[name] is not None and desired[name] is None),
                     key=lambda name: (-name.count("/"), name))
    for name in removed:
        _assert_entries(root, {name: current[name]})
        target = source_path(root, name)
        target.unlink()
        parent = target.parent
        while parent != root:
            try:
                parent.rmdir()
            except OSError:
                break
            parent = parent.parent
        if progress:
            progress(name)
    for name, entry in sorted(desired.items()):
        if entry is None or entry == current[name]:
            continue
        _assert_entries(root, {name: current[name]})
        target = source_path(root, name)
        if target.is_dir():
            for directory, _, _ in os.walk(target, topdown=False, followlinks=False):
                reject_link(Path(directory))
                Path(directory).rmdir()
        target.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(target, contents[name])
        os.chmod(target, entry["mode"])
        if progress:
            progress(name)


def _refresh(harness) -> None:
    harness.prepare()
    harness.state = harness.evidence.load("state.json", harness.state)
    harness.task = harness.store.load(harness.task.id)
    if Path(harness.task.workdir).resolve() != harness.main_cwd:
        raise ConflictError("Task checkout changed since the approval controller was created")
    harness.evidence.task = harness.task


def _approved_checks(harness) -> list[dict]:
    state = harness.state
    if harness.task.status != TaskStatus.AWAITING_APPROVAL:
        raise ValueError("Landing requires awaiting_approval status")
    if state.get("pending") or harness.journal.pending() or harness.runtime.active_writers():
        raise ValueError("Stop active source operations before approval")
    revision = harness.journal.snapshot()
    if state.get("candidate") != revision or state.get("revision") != revision:
        raise ValueError("Approved candidate does not match the actual source revision")
    # Reuse the observed candidate page only when its exact source revision is
    # still approved. The fresh merged-copy runtime below reruns assertions;
    # it must not require an interactive browser session merely to land files.
    if harness.verification_gaps()['browser_required_actions']:
        raise ValueError('E2E approval requires current candidate browser observation')
    checks = [check for check in state.get("verification", [])
              if check.get("revision") == revision and check.get("passed") is True
              and check.get("exit_code") == 0 and check.get("has_assertions") is True
              and not check.get("source_changed") and not check.get("invalidated")]
    required = {criterion.id for criterion in harness.task.acceptance}
    covered = {cid for check in checks if check.get("scope") == "target"
               for cid in check.get("criterion_ids", [])}
    if not required <= covered or not any(check.get("scope") == "regression" for check in checks):
        raise ValueError("Approval requires current target and regression assertion evidence")
    for check in checks:
        command = check.get("command", "")
        if not isinstance(command, str) or not command.strip() or re.fullmatch(
                r"\s*(?:true|echo\b.*|printf\b.*)\s*", command, re.S):
            raise ValueError("Verification command must execute actual assertions")
    return checks


def _seed_manifest(main: Path, workspace: Path, journal_root: Path) -> dict:
    seed_workspace(main, workspace)
    journal = CheckpointStore(workspace, journal_root, excluded_roots=MANAGED_EXCLUSIONS)
    try:
        return journal.read_manifest(journal.snapshot())
    finally:
        journal.close()


def _runtime(harness, workspace: Path, state: Path):
    if harness.runtime_factory:
        return harness.runtime_factory(workspace, state)
    from .runtime import ContainerRuntime
    return ContainerRuntime(harness.task.id + "-landing", workspace, state,
                            image=harness.runtime_image, docker_prefix=harness.docker_prefix,
                            network_policy=harness.network_policy)


def _cleanup_runtimes(harness) -> list[str]:
    """Called only with the main mutation lock, so no live approval is interrupted."""
    root = harness.state_dir / "landing"
    reject_link_ancestors(root)
    stopped = []
    for directory in sorted(root.glob("*")):
        if not re.fullmatch(r"[a-f0-9]{32}", directory.name):
            continue
        record = _read(directory / "journal.json")
        if record is None and not (directory / "engine").exists():
            # A process can exit between mkdir and its first durable journal.
            continue
        if (not isinstance(record, dict) or record.get("version") != 1
                or record.get("id") != directory.name or record.get("main") != str(harness.main_cwd)):
            raise IntegrityError("Landing runtime journal does not belong to this checkout")
        if record.get("runtime_stopped") is not True:
            reject_link_ancestors(directory / "merged")
            reject_link_ancestors(directory / "engine")
            if (directory / "engine").exists():
                _runtime(harness, directory / "merged", directory / "engine").stop_all()
            record["runtime_stopped"] = True
            stopped.append(directory.name)
        if record["status"] == "validating":
            record.update(status="validation_failed", error="Isolated validation was interrupted before landing")
        _save(directory / "journal.json", record)
    return stopped


def cleanup_landing_runtimes(harness) -> list[str]:
    """Stop interrupted approval runtimes without changing main checkout files."""
    lock = MutationLock(workspace_lock_path(harness.main_cwd))
    lock.acquire()
    try:
        return _cleanup_runtimes(harness)
    finally:
        lock.release()


def _verify(harness, directory: Path, checks: list[dict], record: dict) -> None:
    from .general_state import assertions_passed
    merged = directory / "merged"
    journal = CheckpointStore(merged, directory / "verify-checkpoints", excluded_roots=MANAGED_EXCLUSIONS)
    runtime = _runtime(harness, merged, directory / "engine")
    try:
        runtime.ensure()
        revision = journal.snapshot()
        for check in checks:
            result = runtime.terminal_start(check["command"], cwd=check.get("cwd", "."),
                                            timeout_seconds=check.get("timeout_seconds", 300))
            output = result.get("output", "")
            while result.get("status") == "running" or result.get("output_truncated"):
                result = runtime.terminal_poll(result["session_id"], cursor=result.get("cursor", 0), wait_ms=250)
                output = (output + result.get("output", ""))[-150000:]
            if runtime.active_writers():
                raise ValueError("Verification still has active source writers")
            artifact = result.get("artifact_path")
            if artifact:
                path = Path(artifact).resolve()
                if path.is_relative_to((directory / "engine").resolve()) and path.is_file():
                    output = path.read_text(encoding="utf-8", errors="replace")[-150000:]
            changed = journal.snapshot() != revision
            passed = (result.get("status") == "completed" and result.get("exit_code") == 0
                      and not changed and assertions_passed(output))
            record["verification"].append({**check, "passed": passed, "source_changed": changed,
                "exit_code": result.get("exit_code"), "output": output[-12000:],
                "session_id": result.get("session_id")})
            _save(directory / "journal.json", record)
            if not passed:
                raise ValueError("Merged verification failed: assertions must pass without source changes")
    finally:
        try:
            runtime.stop_all()
            record["runtime_stopped"] = True
            _save(directory / "journal.json", record)
        finally:
            journal.close()


def _existing(harness) -> tuple[Path | None, dict | None]:
    root = harness.state_dir / "landing"
    pointer = _read(root / "state.json", {})
    identity = pointer.get("active")
    if not identity:
        return None, None
    if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{32}", identity):
        raise IntegrityError("Invalid landing identity")
    directory = root / identity
    record = _read(directory / "journal.json")
    if (not isinstance(record, dict) or record.get("version") != 1 or record.get("id") != identity
            or record.get("main") != str(harness.main_cwd)):
        raise IntegrityError("Landing journal does not belong to this checkout")
    if not isinstance(record.get("before"), dict) or set(record["before"]) != set(record.get("after", {})):
        raise IntegrityError("Invalid landing file inventory")
    for entries in (record["before"], record["after"]):
        validate_paths(name for name, entry in entries.items() if entry is not None)
        for name, entry in entries.items():
            source_path(harness.main_cwd, name)
            if entry is not None and (not isinstance(entry, dict) or set(entry) != {"sha256", "mode"}
                    or not re.fullmatch(r"[a-f0-9]{64}", str(entry.get("sha256")))
                    or not isinstance(entry.get("mode"), int) or not 0 <= entry["mode"] <= 0o777):
                raise IntegrityError("Invalid landing file metadata")
    return directory, record


def _result(record: dict) -> dict:
    return {"id": record["id"], "status": record["status"], "candidate": record["candidate"],
            "files": sorted(record["before"]), "verification": record["verification"]}


def _sync(harness, record: dict) -> dict:
    result = _result(record)
    harness.state["landing"] = {key: value for key, value in result.items() if key != "verification"}
    harness.task.set_status(TaskStatus.VERIFIED if record["status"] == "landed" else TaskStatus.AWAITING_APPROVAL)
    harness._save()
    harness.evidence.event("landing" if record["status"] == "landed" else "rollback_landing",
                           "候选修改已落地" if record["status"] == "landed" else "本次落地已撤销", result)
    return result


def _rollback(harness, directory: Path, record: dict) -> dict:
    if record["status"] == "rolled_back":
        return _sync(harness, record)
    partial = record["status"] != "landed"
    try:
        actual = _assert_entries(harness.main_cwd, record["after"], record["before"] if partial else None)
        _preflight(harness.main_cwd, actual, record["before"])
        for name, entry in record["before"].items():
            if entry is not None:
                _bytes(directory / "before", name, entry)
    except Exception as exc:
        record.update(status="conflicted", recovery_error=str(exc))
        _save(directory / "journal.json", record)
        raise
    record["status"] = "rolling_back"
    _save(directory / "journal.json", record)
    try:
        _mutate(harness.main_cwd, actual, record["before"], directory / "before")
        _assert_entries(harness.main_cwd, record["before"])
    except Exception as exc:
        record.update(status="rollback_failed", recovery_error=str(exc))
        _save(directory / "journal.json", record)
        raise RuntimeError("Landing rollback is incomplete; durable backups require recovery") from exc
    record["status"] = "rolled_back"
    _save(directory / "journal.json", record)
    return _sync(harness, record)


def land_candidate(harness) -> dict:
    """Approve the exact verified revision, recheck the merged checkout, then write."""
    _refresh(harness)
    lock = MutationLock(workspace_lock_path(harness.main_cwd))
    lock.acquire()
    try:
        _cleanup_runtimes(harness)
        checks = _approved_checks(harness)
        old_directory, old = _existing(harness)
        if old and old["status"] == "landed":
            if old["candidate"] != harness.state["candidate"]:
                raise ConflictError("A different candidate is already landed")
            _assert_entries(harness.main_cwd, old["after"])
            return _sync(harness, old)
        if old and old["status"] not in ("rolled_back", "validation_failed"):
            _rollback(harness, old_directory, old)
        baseline = harness.journal.read_manifest(harness.state["baseline"])
        candidate = harness.journal.read_manifest(harness.state["candidate"])
        names = sorted(name for name in set(baseline) | set(candidate) if baseline.get(name) != candidate.get(name))
        before = {name: baseline.get(name) for name in names}
        after = {name: candidate.get(name) for name in names}
        _assert_entries(harness.main_cwd, before)
        _preflight(harness.main_cwd, before, after)
        root = harness.state_dir / "landing"
        identity = uuid.uuid4().hex
        directory = root / identity
        directory.mkdir(parents=True)
        record = {"version": 1, "id": identity, "main": str(harness.main_cwd), "status": "validating",
                  "baseline": harness.state["baseline"], "candidate": harness.state["candidate"],
                  "before": before, "after": after, "applied": [], "verification": []}
        _save(directory / "journal.json", record)
        harness.journal.export_snapshot(harness.state["candidate"], directory / "candidate")
        initial = _seed_manifest(harness.main_cwd, directory / "merged", directory / "seed-checkpoints")
        _mutate(directory / "merged", before, after, directory / "candidate")
        try:
            _verify(harness, directory, checks, record)
            _refresh(harness)
            if _approved_checks(harness) != checks:
                raise ConflictError("Approval evidence changed during isolated verification")
            current = _seed_manifest(harness.main_cwd, directory / "recheck", directory / "recheck-checkpoints")
            if current != initial:
                raise ConflictError("Main checkout changed during isolated verification")
            if harness.journal.snapshot() != record["candidate"]:
                raise ConflictError("Candidate changed during isolated verification")
            _assert_entries(harness.main_cwd, before)
            for name, entry in before.items():
                if entry is not None:
                    data = _bytes(harness.main_cwd, name, entry)
                    target = source_path(directory / "before", name)
                    atomic_write(target, data)
                    os.chmod(target, entry["mode"])
        except Exception as exc:
            record.update(status="validation_failed", error=str(exc))
            _save(directory / "journal.json", record)
            harness.evidence.event("landing_failed", str(exc), {"id": identity, "status": record["status"]})
            raise
        record.update(status="prepared", main_fingerprint=digest(canonical(initial)))
        _save(directory / "journal.json", record)
        pointer = _read(root / "state.json", {"version": 1, "history": []})
        pointer.update(active=identity, history=[*pointer.get("history", []), identity])
        _save(root / "state.json", pointer)
        record["status"] = "applying"
        _save(directory / "journal.json", record)

        def progress(name):
            record["applied"].append(name)
            _save(directory / "journal.json", record)

        try:
            _mutate(harness.main_cwd, before, after, directory / "candidate", progress)
            _assert_entries(harness.main_cwd, after)
            record["status"] = "landed"
            _save(directory / "journal.json", record)
        except Exception as exc:
            record["error"] = str(exc)
            _rollback(harness, directory, record)
            raise
        return _sync(harness, record)
    finally:
        lock.release()


def rollback_landing(harness) -> dict:
    """Undo only this landing's files, refusing overlapping later user edits."""
    _refresh(harness)
    lock = MutationLock(workspace_lock_path(harness.main_cwd))
    lock.acquire()
    try:
        _cleanup_runtimes(harness)
        directory, record = _existing(harness)
        if record is None:
            raise ValueError("No durable landing is available to roll back")
        return _rollback(harness, directory, record)
    finally:
        lock.release()

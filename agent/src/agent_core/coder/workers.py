"""Parallel task controllers with separate source, runtime and recovery state.

The injected runner owns the model/harness. It must observe cancel_event and
register a callback that stops ONLY its runtime (including nested workers).
No worker receives a writable parent path. Merge is the sole parent mutation.
"""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .checkpoints import BusyError, CheckpointStore, ConflictError, IntegrityError, UnsafePathError
from .checkpoints.locking import MutationLock
from .checkpoints.objects import atomic_write, canonical
from .checkpoints.paths import portable_path, reject_link_ancestors, validate_paths, validate_runtime_tree
from .general_state import snapshot_diff

ACTIVE_STATUSES = frozenset({"starting", "running", "cancelling", "cleanup_failed"})
Runner = Callable[["WorkerContext"], dict[str, Any]]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class WorkerContext:
    worker_id: str
    prompt: str
    workspace: Path
    state_dir: Path
    task_store_root: Path
    baseline_revision: str
    owned_paths: tuple[str, ...]
    depth: int
    cancel_event: threading.Event = field(default_factory=threading.Event)
    _callbacks: list[Callable[[], None]] = field(default_factory=list, repr=False)
    _callback_lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    _stopped: bool = field(default=False, repr=False)
    _stop_errors: list[str] = field(default_factory=list, repr=False)

    @property
    def task_id(self) -> str:
        return self.worker_id

    def register_cancel(self, callback: Callable[[], None]) -> None:
        """Late registration after cancellation still stops the new runtime."""
        with self._callback_lock:
            if not self._stopped:
                self._callbacks.append(callback)
                return
            try:
                callback()
            except Exception as exc:
                self._stop_errors.append(str(exc))
                self._callbacks.append(callback)
                raise

    def stop_runtime(self, *, retry: bool = False) -> None:
        with self._callback_lock:
            if not self._stopped or (retry and self._stop_errors):
                self._stopped = True
                self._stop_errors = []
                callbacks, self._callbacks = self._callbacks, []
                # Serialize cleanup and final snapshot even when cancellation
                # races a runner returning from its final model call.
                for callback in callbacks:
                    try:
                        callback()
                    except Exception as exc:
                        self._stop_errors.append(str(exc))
                        self._callbacks.append(callback)
            if self._stop_errors:
                raise RuntimeError("Worker cleanup failed: " + "; ".join(self._stop_errors))


class WorkerManager:
    """One durable controller per parent; bounded parallelism, no iteration cap."""

    def __init__(self, parent_journal: CheckpointStore, root: Path, runner: Runner, *,
                 max_workers: int = 3, depth: int = 0, max_depth: int = 1,
                 recover_runtime: Callable[[WorkerContext], None] | None = None):
        if max_workers < 1 or depth < 0 or max_depth < 0:
            raise ValueError("Invalid worker concurrency/depth configuration")
        self.parent = parent_journal
        reject_link_ancestors(Path(root).absolute())
        self.root = Path(root).resolve()
        if (self.root.is_relative_to(self.parent.workspace)
                or self.parent.workspace.is_relative_to(self.root)):
            raise UnsafePathError("Worker metadata must be separate from parent source")
        self.root.mkdir(parents=True, exist_ok=True)
        self.runner, self.recover_runtime = runner, recover_runtime
        self.max_workers, self.depth, self.max_depth = max_workers, depth, max_depth
        self._mutex = threading.RLock()
        self._lock = MutationLock(self.root / "controller.lock")
        self._lock.acquire()
        self._closed = False
        self._closing = False
        self._threads: dict[str, threading.Thread] = {}
        self._contexts: dict[str, WorkerContext] = {}
        self._done: dict[str, threading.Event] = {}
        self._manifest_path = self.root / "workers.json"
        try:
            self._records = self._load()
            self._recover()
        except BaseException:
            self._lock.release()
            raise

    def _load(self) -> dict[str, dict[str, Any]]:
        if not self._manifest_path.exists():
            return {}
        reject_link_ancestors(self._manifest_path)
        data = json.loads(self._manifest_path.read_bytes())
        if (data.get("version") != 1 or data.get("parent_workspace") != str(self.parent.workspace)
                or not isinstance(data.get("workers"), dict)):
            raise IntegrityError("Invalid worker manifest or parent workspace")
        for worker_id, record in data["workers"].items():
            if (not re.fullmatch(r"dev_[a-f0-9]{32}", worker_id)
                    or record.get("worker_id") != worker_id):
                raise IntegrityError("Invalid persisted worker id")
        return data["workers"]

    def _save(self) -> None:
        atomic_write(self._manifest_path, canonical({
            "version": 1, "parent_workspace": str(self.parent.workspace), "workers": self._records,
        }))

    def _context(self, record: dict[str, Any]) -> WorkerContext:
        task_store_root = self.root / "tasks"
        state_dir = task_store_root / record["worker_id"] / "runtime"
        return WorkerContext(
            record["worker_id"], record["prompt"], state_dir / "workspace", state_dir,
            task_store_root, record["baseline_revision"], tuple(record["owned_paths"]), record["depth"],
        )

    def _journal(self, context: WorkerContext) -> CheckpointStore:
        return CheckpointStore(context.workspace, context.state_dir / "checkpoints",
                               excluded_roots=self.parent._paths.excluded_roots)

    def _capture_settled(self, context: WorkerContext) -> str:
        journal = self._journal(context)
        try:
            pending = journal.pending()
            if pending:
                journal.adopt(pending["id"])
                try:
                    validate_runtime_tree(context.workspace)
                    journal.finish(pending["id"], "recovered")
                except UnsafePathError:
                    journal.rollback_pending()
            validate_runtime_tree(context.workspace)
            return journal.snapshot()
        finally:
            journal.close()

    def _recover(self) -> None:
        # Holding the OS lock proves the old controller no longer owns workers.
        changed = False
        completed_merges = {item["reason"]: item for item in self.parent.list_changes()
                            if item.get("tool") == "worker_merge" and item.get("status") == "completed"}
        for record in self._records.values():
            landed = completed_merges.get(f"Merge worker {record['worker_id']}")
            if landed and record["status"] == "completed":
                # The checkpoint journal is authoritative if saving the worker
                # record failed after its parent transaction already committed.
                record.update(status="merged", merged_at=_now(), merge_change_id=landed["id"],
                              merged_revision=landed["after"])
                changed = True
            if record["status"] not in ACTIVE_STATUSES:
                continue
            context = self._context(record)
            self._contexts[context.worker_id] = context
            self._done[context.worker_id] = threading.Event()
            self._done[context.worker_id].set()
            record.update(status="interrupted", finished_at=_now(),
                          error="Controller exited before worker completion; rerun as a new worker")
            try:
                if self.recover_runtime:
                    context.register_cancel(lambda c=context: self.recover_runtime(c))
                    context.stop_runtime()
                else:
                    journal = self._journal(context)
                    try:
                        if journal.pending():
                            def require_runtime_cleanup():
                                raise BusyError("Orphan runtime needs explicit cleanup before recovery")
                            context.register_cancel(require_runtime_cleanup)
                            context.stop_runtime()
                    finally:
                        journal.close()
                record["final_revision"] = self._capture_settled(context)
            except Exception as exc:
                record["status"] = "cleanup_failed"
                record["error"] += "; " + str(exc)
            changed = True
        if changed:
            self._save()

    def _require_open(self) -> None:
        if self._closed:
            raise RuntimeError("Worker manager is closed")
        if self._closing:
            raise RuntimeError("Worker manager is closing")

    def _record(self, worker_id: str) -> dict[str, Any]:
        if worker_id not in self._records:
            raise ValueError(f"Unknown worker: {worker_id}")
        return self._records[worker_id]

    def spawn(self, prompt: str, owned_paths: list[str] | None = None) -> dict[str, Any]:
        with self._mutex:
            self._require_open()
            if not prompt.strip():
                raise ValueError("Worker prompt must be nonempty")
            if self.depth >= self.max_depth:
                raise ValueError("Worker depth limit reached")
            if len(self.active()) >= self.max_workers:
                raise BusyError("Worker concurrency limit reached; poll or cancel an existing worker")
            if self.parent.pending():
                raise BusyError("Parent has a pending source operation; settle it before spawning")
            scopes = list(dict.fromkeys(owned_paths or []))
            for scope in scopes:
                portable_path(scope)
                self.parent._paths.target(scope)
            revision = self.parent.snapshot()
            worker_id = "dev_" + uuid.uuid4().hex
            record = {"worker_id": worker_id, "prompt": prompt.strip(), "owned_paths": scopes,
                      "baseline_revision": revision, "depth": self.depth + 1,
                      "status": "starting", "created_at": _now()}
            context = self._context(record)
            self.parent.export_snapshot(revision, context.workspace)
            child = self._journal(context)
            try:
                if child.snapshot() != revision:
                    raise IntegrityError("Worker source does not match its parent checkpoint")
            finally:
                child.close()
            self._records[worker_id], self._contexts[worker_id] = record, context
            self._done[worker_id] = threading.Event()
            thread = threading.Thread(target=self._run, args=(context,),
                                      name=f"coding-worker-{worker_id}", daemon=True)
            self._threads[worker_id] = thread
            self._save()
            try:
                thread.start()
            except Exception as exc:
                record.update(status="failed", error=str(exc), finished_at=_now())
                self._done[worker_id].set()
                self._save()
                raise
            return dict(record)

    def _run(self, context: WorkerContext) -> None:
        worker_id = context.worker_id
        with self._mutex:
            record = self._records[worker_id]
            record.update(status="running", started_at=_now())
            self._save()
        result: dict[str, Any] = {}
        try:
            if not context.cancel_event.is_set():
                result = self.runner(context)
                if not isinstance(result, dict):
                    raise ValueError("Worker runner must return a result object")
                if result.get("status") not in {"completed", "blocked", "failed", "cancelled"}:
                    raise ValueError("Worker runner must report completed/blocked/failed/cancelled")
        except BaseException as exc:
            result = {"status": "failed", "error": str(exc) or type(exc).__name__}
        cleanup_failed = False
        try:
            context.stop_runtime()
        except Exception as exc:
            cleanup_failed = True
            result.update(status="cleanup_failed", error=str(exc))
        try:
            if cleanup_failed:
                raise BusyError(result["error"])
            revision = self._capture_settled(context)
            result["final_revision"] = revision
        except Exception as exc:
            result.update(status="cleanup_failed" if cleanup_failed else "failed", error=str(exc))
        with self._mutex:
            # Keep runner output out of structural fields such as paths and ids.
            record.update({key: result[key] for key in ("summary", "error", "final_revision") if key in result})
            record["status"] = ("cleanup_failed" if cleanup_failed else
                                "cancelled" if context.cancel_event.is_set() else result.get("status", "failed"))
            record["finished_at"] = _now()
            try:
                self._save()
            finally:
                self._done[worker_id].set()

    def list(self) -> list[dict[str, Any]]:
        with self._mutex:
            return [dict(record) for record in self._records.values()]

    def active(self) -> list[dict[str, Any]]:
        return [record for record in self.list() if record["status"] in ACTIVE_STATUSES]

    def poll(self, worker_id: str, wait_ms: int = 0) -> dict[str, Any]:
        if not 0 <= wait_ms <= 30000:
            raise ValueError("wait_ms must be between 0 and 30000")
        with self._mutex:
            self._record(worker_id)
            done = self._done.get(worker_id)
        if done and wait_ms:
            done.wait(wait_ms / 1000)
        with self._mutex:
            record = dict(self._record(worker_id))
            record["recent_events"] = self._recent_events(self._context(record))
            return record

    @staticmethod
    def _recent_events(context: WorkerContext) -> list[dict[str, Any]]:
        """Inspect durable progress without reading a running source tree."""
        path = context.state_dir / "events.jsonl"
        reject_link_ancestors(path)
        if not path.exists():
            return []
        with path.open("rb") as stream:
            stream.seek(0, 2)
            start = max(0, stream.tell() - 65536)
            stream.seek(start)
            lines = stream.read(65536).splitlines()
        if start:
            lines = lines[1:]  # A capped read can begin inside a JSON record.
        rows = []
        for line in reversed(lines):
            try:
                row = json.loads(line)
            except (ValueError, UnicodeDecodeError):
                continue  # A crashed event append may have an incomplete tail.
            if not isinstance(row, dict):
                continue
            rows.append({"index": row.get("index"), "action": str(row.get("action", ""))[:100],
                         "summary": str(row.get("summary", ""))[:500], "createdAt": row.get("createdAt")})
            if len(rows) == 3:
                break
        return list(reversed(rows))

    def cancel(self, worker_id: str) -> dict[str, Any]:
        with self._mutex:
            record = self._record(worker_id)
            if record["status"] not in ACTIVE_STATUSES:
                return dict(record)
            context = self._contexts[worker_id]
            context.cancel_event.set()
            record["status"] = "cancelling"
            self._save()
        try:
            context.stop_runtime(retry=True)
            if self._done[worker_id].is_set():
                revision = self._capture_settled(context)
                with self._mutex:
                    record.update(status="cancelled", final_revision=revision, finished_at=_now())
                    record.pop("cleanup_error", None)
                    self._save()
        except Exception as exc:
            with self._mutex:
                record["cleanup_error"] = str(exc)
                if self._done[worker_id].is_set():
                    record["status"] = "cleanup_failed"
                self._save()
        return self.poll(worker_id)

    def cancel_all(self) -> list[dict[str, Any]]:
        for record in self.active():
            self.cancel(record["worker_id"])
        return self.list()

    def _finished_snapshot(self, record: dict[str, Any]) -> tuple[WorkerContext, CheckpointStore, str]:
        if record["status"] in ACTIVE_STATUSES:
            raise BusyError("Worker is still running; poll it before inspecting its final diff")
        revision = record.get("final_revision")
        if not revision:
            raise ValueError("Worker has no settled source snapshot; runtime recovery is required")
        context = self._context(record)
        return context, self._journal(context), revision

    def diff(self, worker_id: str) -> dict[str, Any]:
        with self._mutex:
            record = self._record(worker_id)
            context, journal, revision = self._finished_snapshot(record)
            try:
                before, after = journal.read_manifest(context.baseline_revision), journal.read_manifest(revision)
                files = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
                directory = context.state_dir / "reviews" / uuid.uuid4().hex
                diff = snapshot_diff(journal, context.baseline_revision, revision, directory)
                return {"worker_id": worker_id, "files": files, "diff": diff,
                        "baseline_revision": context.baseline_revision, "revision": revision}
            finally:
                journal.close()

    def merge(self, worker_id: str, expected_revision: str) -> dict[str, Any]:
        with self._mutex:
            self._require_open()
            record = self._record(worker_id)
            if record["status"] != "completed":
                raise ValueError("Only a completed worker can be merged")
            context, child, revision = self._finished_snapshot(record)
            try:
                if child.pending() or child.snapshot() != revision:
                    raise ConflictError("Worker source changed after completion")
                change = self._merge_snapshot(context, child, revision, expected_revision)
            finally:
                child.close()
            record.update(status="merged", merged_at=_now(), merge_change_id=change["id"],
                          merged_revision=change["after"])
            self._save()
            return {**change, "worker_id": worker_id, "verification_invalidated": bool(change["files"])}

    def _merge_snapshot(self, context: WorkerContext, child: CheckpointStore,
                        child_revision: str, expected_revision: str) -> dict[str, Any]:
        # Reuse CheckpointStore's atomic restore transaction and rollback path.
        # Its lock covers three-way validation through the last source write.
        with self.parent._exclusive():
            state = self.parent._read()
            self.parent._require_idle(state)
            before, current = self.parent._current(expected_revision)
            base = self.parent._objects.load(context.baseline_revision)
            changed = child.read_manifest(child_revision)
            paths = sorted(name for name in base.keys() | changed.keys() if base.get(name) != changed.get(name))
            if context.owned_paths:
                outside = [name for name in paths if not any(
                    name == scope or name.startswith(scope + "/") for scope in context.owned_paths)]
                if outside:
                    raise ValueError("Worker changed files outside owned scope: " + ", ".join(outside))
            conflicts = [name for name in paths if current.get(name) not in (base.get(name), changed.get(name))]
            if conflicts:
                raise ConflictError("Worker merge conflicts with parent edits: " + ", ".join(conflicts))
            desired = dict(current)
            for name in paths:
                if name in changed:
                    desired[name] = changed[name]
                else:
                    desired.pop(name, None)
            try:
                validate_paths(desired)
            except UnsafePathError as exc:
                raise ConflictError(f"Worker merge conflicts with parent paths: {exc}") from exc
            self.parent._objects.preflight(current, desired)
            for name in paths:
                if name not in changed:
                    continue
                digest = changed[name]["sha256"]
                blob = self.parent.root / "blobs" / digest
                if blob.exists():
                    self.parent._objects.blob(digest)
                else:
                    atomic_write(blob, child._objects.blob(digest))
            target = self.parent._objects.save_manifest(desired)
            return self.parent._restore(state, before, current, target, desired,
                                        reason=f"Merge worker {context.worker_id}", tool="worker_merge")

    def close(self, wait_ms: int = 5000) -> None:
        """Cancel children and retain ownership until their controllers exit."""
        if not 0 <= wait_ms <= 30000:
            raise ValueError("wait_ms must be between 0 and 30000")
        with self._mutex:
            if self._closed:
                return
            self._closing = True
        self.cancel_all()
        deadline = time.monotonic() + wait_ms / 1000
        for thread in self._threads.values():
            if thread.ident is not None:
                thread.join(max(0, deadline - time.monotonic()))
        with self._mutex:
            if any(thread.is_alive() for thread in self._threads.values()):
                raise BusyError("Worker cancellation still in progress; controller ownership retained")
            if self.active():
                raise BusyError("Worker runtime cleanup failed; controller ownership retained")
            self._closed = True
            self._lock.release()

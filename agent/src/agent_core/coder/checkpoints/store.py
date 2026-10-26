"""Persistent reversible workspace operations, independent from Git.

Callers must quiesce their subprocesses before finish/recover/restore/undo.
The lock serializes cooperating stores; unrelated host processes are not jailed.
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

from .errors import BusyError, CheckpointError, ConflictError, IntegrityError, UnsafePathError
from .locking import MutationLock, workspace_lock_path
from .objects import Manifest, SnapshotObjects, atomic_write, canonical
from .paths import DEFAULT_EXCLUDED_ROOTS, WorkspacePaths, reject_link_ancestors, validate_paths


class CheckpointStore:
    def __init__(
        self, workspace: Path, root: Path, *,
        excluded_roots: Iterable[str] = DEFAULT_EXCLUDED_ROOTS,
    ):
        workspace, root = Path(workspace).absolute(), Path(root).absolute()
        reject_link_ancestors(workspace)
        reject_link_ancestors(root)
        self.workspace, self.root = workspace.resolve(), root.resolve()
        if not self.workspace.is_dir():
            raise UnsafePathError(f"Workspace is not a directory: {self.workspace}")
        if self.root.is_relative_to(self.workspace):
            raise UnsafePathError("Checkpoint store must be outside the managed workspace")
        self.root.mkdir(parents=True, exist_ok=True)
        self._paths = WorkspacePaths(self.workspace, excluded_roots)
        self._mutex = threading.RLock()
        self._lock = MutationLock(workspace_lock_path(self.workspace))
        self._active: str | None = None
        self._state_path = self.root / "state.json"
        if not self._state_path.exists():
            with self._exclusive():
                if not self._state_path.exists():
                    self._save({"version": 1, "workspace": str(self.workspace),
                                "excluded_roots": list(self._paths.excluded_roots),
                                "pending": None, "changes": []})
        state = self._read()
        if state["workspace"] != str(self.workspace):
            raise UnsafePathError("Checkpoint store belongs to a different workspace")
        if state.get("excluded_roots") != list(self._paths.excluded_roots):
            raise UnsafePathError("Checkpoint exclusion policy differs from the existing store")
        self._objects = SnapshotObjects(self.root, self._paths)

    def _read(self) -> dict[str, Any]:
        reject_link_ancestors(self._state_path)
        try:
            value = json.loads(self._state_path.read_bytes())
        except (OSError, ValueError) as exc:
            raise IntegrityError("Checkpoint journal is missing or corrupt") from exc
        if (not isinstance(value, dict) or value.get("version") != 1
                or not isinstance(value.get("workspace"), str)
                or not isinstance(value.get("changes"), list)
                or not isinstance(value.get("pending"), (dict, type(None)))):
            raise IntegrityError("Invalid checkpoint journal")
        return value

    def _save(self, state: dict[str, Any]) -> None:
        atomic_write(self._state_path, canonical(state))

    @contextmanager
    def _exclusive(self) -> Iterator[None]:
        with self._mutex:
            self._lock.acquire()
            try:
                yield
            finally:
                self._lock.release()

    def close(self) -> None:
        """Release ownership, preserving any in-flight journal for recovery."""
        with self._mutex:
            self._active = None
            self._lock.release()

    def snapshot(self) -> str:
        with self._mutex:
            if self._active is not None:
                return self._objects.capture()
            with self._exclusive():
                return self._objects.capture()

    def pending(self) -> dict[str, Any] | None:
        return self._read()["pending"]

    def list_changes(self) -> list[dict[str, Any]]:
        return self._read()["changes"]

    def read_manifest(self, revision: str) -> Manifest:
        """Return verified path -> {sha256, mode} entries for inspection."""
        with self._mutex:
            if self._active is not None:
                return self._objects.load(revision)
            with self._exclusive():
                return self._objects.load(revision)

    def export_snapshot(self, revision: str, destination: Path) -> None:
        """Materialize verified bytes into a fresh external directory."""
        with self._exclusive():
            destination = Path(destination).absolute()
            reject_link_ancestors(destination)
            destination = destination.resolve()
            if any(destination.is_relative_to(path) or path.is_relative_to(destination)
                   for path in [self.workspace, self.root]):
                raise UnsafePathError("Snapshot export must be separate from workspace and store")
            if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
                raise UnsafePathError("Snapshot export destination must be empty")
            files = self._objects.load(revision)
            destination.mkdir(parents=True, exist_ok=True)
            for name, entry in sorted(files.items()):
                target = destination.joinpath(*name.split("/"))
                reject_link_ancestors(target)
                atomic_write(target, self._objects.blob(entry["sha256"]))
                os.chmod(target, entry["mode"])

    @staticmethod
    def _require_idle(state: dict[str, Any]) -> None:
        if state["pending"] is not None:
            raise BusyError("An in-flight operation requires finish or recover before another mutation")

    def begin(self, reason: str, tool: str) -> str:
        with self._mutex:
            self._lock.acquire()
            try:
                state = self._read()
                self._require_idle(state)
                before = self._objects.capture()
                operation = {"id": uuid.uuid4().hex, "before": before,
                             "reason": reason, "tool": tool, "status": "in_flight"}
                state["pending"] = operation
                self._save(state)
                self._active = operation["id"]
                return self._active
            except BaseException:
                self._lock.release()
                raise

    def _settle(self, state: dict[str, Any], status: str) -> dict[str, Any]:
        operation = state["pending"]
        before = self._objects.load(operation["before"])
        after_revision = self._objects.capture()
        after = self._objects.load(after_revision)
        change = dict(operation, after=after_revision, status=status,
                      files=sorted(name for name in before.keys() | after.keys()
                                   if before.get(name) != after.get(name)))
        state["changes"].append(change)
        state["pending"] = None
        self._save(state)
        return change

    def adopt(self, operation_id: str) -> dict[str, Any]:
        """Reclaim an interrupted controller's operation without reading live files.

        The runtime must still poll/cancel its job before calling finish. This
        method deliberately does not assume that loss of the controller stopped
        the container or process it launched.
        """
        with self._mutex:
            if self._active == operation_id:
                return self._read()["pending"]
            self._lock.acquire()
            try:
                operation = self._read()["pending"]
                if not operation or operation.get("id") != operation_id:
                    raise CheckpointError("Requested operation does not match persisted in-flight operation")
                self._active = operation_id
                return operation
            except BaseException:
                self._lock.release()
                raise

    def finish(self, operation_id: str, status: str = "completed") -> dict[str, Any]:
        with self._mutex:
            if self._active != operation_id:
                raise BusyError("Only the active operation owner can finish; use recover after restart")
            try:
                state = self._read()
                if not state["pending"] or state["pending"]["id"] != operation_id:
                    raise IntegrityError("Active operation does not match the persisted journal")
                return self._settle(state, status)
            finally:
                self.close()

    def recover(self) -> dict[str, Any] | None:
        """Record observed partial writes after owner exit; do not discard them."""
        with self._exclusive():
            state = self._read()
            return self._settle(state, "recovered") if state["pending"] else None

    def rollback_pending(self) -> dict[str, Any]:
        """Quarantine an unrepresentable task tree, then restore its exact before.

        Call only after stopping all task writers. Never traverse quarantine:
        it may contain links or secret files created by a failed command.
        Durable intent makes a crash after rename/reconstruction recoverable.
        """
        with self._mutex:
            if self._active is None:
                self._lock.acquire()
            try:
                state = self._read()
                operation = state["pending"]
                if not operation or not re.fullmatch(r"[a-f0-9]{32}", operation["id"]):
                    raise CheckpointError("No valid pending operation to roll back")
                quarantine = self.root / "quarantine" / operation["id"]
                reject_link_ancestors(quarantine)
                reject_link_ancestors(self.workspace)
                if not quarantine.resolve().is_relative_to(self.root) or quarantine.is_relative_to(self.workspace):
                    raise UnsafePathError("Invalid quarantine destination")
                if not operation.get("rollback_started"):
                    if quarantine.exists():
                        raise IntegrityError("Unexpected existing quarantine")
                    operation["rollback_started"] = True
                    self._save(state)
                if not quarantine.exists():
                    quarantine.parent.mkdir(parents=True, exist_ok=True)
                    if not self.workspace.is_dir():
                        raise UnsafePathError("Managed workspace disappeared; preserve journal for recovery")
                    self.workspace.rename(quarantine)
                self.workspace.mkdir(exist_ok=True)
                # Manifest target validation must see the clean directory:
                # an existing tracked path may have been replaced by a link.
                desired = self._objects.load(operation["before"])
                current = self._objects.load(self._objects.capture())
                if current != desired:
                    if any(self.workspace.iterdir()):
                        raise ConflictError("Workspace changed during rollback reconstruction")
                    # Build away from the live tree. A hard exit during an
                    # atomic file write leaves only an abandoned staging tree,
                    # never an ambiguous temporary file among current source.
                    staging = self.root / "reconstruction" / uuid.uuid4().hex
                    reject_link_ancestors(staging)
                    staging.mkdir(parents=True)
                    old_paths = self._objects.paths
                    self._objects.paths = WorkspacePaths(staging, self._paths.excluded_roots)
                    try:
                        self._objects.preflight({}, desired)
                        self._objects.apply({}, desired)
                        if self._objects.capture() != operation["before"]:
                            raise IntegrityError("Invalid reconstructed snapshot")
                    finally:
                        self._objects.paths = old_paths
                    # Both roots were resolved/checked above; remove only the
                    # empty task directory, then atomically activate staging.
                    self.workspace.rmdir()
                    staging.rename(self.workspace)
                if self._objects.capture() != operation["before"]:
                    raise IntegrityError("Failed to restore the pre-operation snapshot")
                return self._settle(state, "failed_rolled_back")
            finally:
                self.close()

    def _current(self, expected_revision: str) -> tuple[str, Manifest]:
        revision = self._objects.capture()
        if revision != expected_revision:
            raise ConflictError(f"Workspace revision changed: expected {expected_revision}, found {revision}")
        return revision, self._objects.load(revision)

    def _restore(
        self, state: dict[str, Any], before: str, current: Manifest,
        target: str, desired: Manifest, *, reason: str, tool: str,
    ) -> dict[str, Any]:
        self._objects.preflight(current, desired)
        state["pending"] = {"id": uuid.uuid4().hex, "before": before, "target": target,
                            "reason": reason, "tool": tool, "status": "in_flight"}
        self._save(state)
        # An interruption leaves the pre-operation snapshot and target journal intact.
        try:
            self._objects.apply(current, desired)
            return self._settle(state, "completed")
        except Exception:
            try:
                observed = self._objects.load(self._objects.capture())
                self._objects.preflight(observed, current)
                self._objects.apply(observed, current)
                if self._objects.capture() != before:
                    raise IntegrityError("Rollback did not reproduce the pre-operation snapshot")
                self._settle(state, "failed_rolled_back")
            except Exception as rollback_error:
                raise CheckpointError("Restore/rollback failed; explicit recovery is required") from rollback_error
            raise

    def restore(self, revision: str, expected_revision: str) -> dict[str, Any]:
        with self._exclusive():
            state = self._read()
            self._require_idle(state)
            desired = self._objects.load(revision)
            before, current = self._current(expected_revision)
            return self._restore(state, before, current, revision, desired,
                                 reason=f"Restore snapshot {revision}", tool="restore")

    def undo(self, change_id: str, expected_revision: str) -> dict[str, Any]:
        with self._exclusive():
            state = self._read()
            self._require_idle(state)
            change = next((item for item in state["changes"] if item["id"] == change_id), None)
            if change is None:
                raise CheckpointError(f"Unknown change: {change_id}")
            original = self._objects.load(change["before"])
            changed = self._objects.load(change["after"])
            before, current = self._current(expected_revision)
            desired = dict(current)
            paths = sorted(name for name in original.keys() | changed.keys()
                           if original.get(name) != changed.get(name))
            conflicts = [name for name in paths if current.get(name) != changed.get(name)]
            if conflicts:
                raise ConflictError("Undo conflicts with later edits: " + ", ".join(conflicts))
            for name in paths:
                if name in original:
                    desired[name] = original[name]
                else:
                    desired.pop(name, None)
            try:
                validate_paths(desired)
            except UnsafePathError as exc:
                raise ConflictError(f"Undo conflicts with later paths: {exc}") from exc
            target = self._objects.save_manifest(desired)
            return self._restore(state, before, current, target, desired,
                                 reason=f"Undo change {change_id}", tool="undo")

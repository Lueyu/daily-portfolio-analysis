"""On-disk work products for dev-tasks (spec section 4.2).

Layout under <root>/<task-id>/:
  task.json                 current state (atomic replace, never partial)
  iterations/iterations.jsonl  append-only, one Iteration per line, replayable
  patches/NNNN.diff         every proposed patch, numbered sequentially

The store is plain file IO with no model/network dependencies.
"""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
import uuid
from pathlib import Path

from .models import DevTask, Iteration, Patch


class TaskStore:
    def __init__(self, root: Path | str):
        self.root = Path(root)

    # -- paths -------------------------------------------------------------
    def _dir(self, task_id: str) -> Path:
        return self.root / task_id

    def _task_file(self, task_id: str) -> Path:
        return self._dir(task_id) / "task.json"

    def _iter_file(self, task_id: str) -> Path:
        return self._dir(task_id) / "iterations" / "iterations.jsonl"

    # -- task --------------------------------------------------------------
    def create(self, task: DevTask) -> Path:
        if self._task_file(task.id).exists():
            raise FileExistsError(f"task already exists: {task.id}")
        (self._dir(task.id) / "iterations").mkdir(parents=True, exist_ok=True)
        (self._dir(task.id) / "patches").mkdir(parents=True, exist_ok=True)
        return self._atomic_write(
            self._task_file(task.id), task.model_dump_json(indent=2)
        )

    def save(self, task: DevTask) -> Path:
        return self._atomic_write(
            self._task_file(task.id), task.model_dump_json(indent=2)
        )

    def load(self, task_id: str) -> DevTask:
        return DevTask.model_validate_json(
            self._task_file(task_id).read_text(encoding="utf-8")
        )

    def list_tasks(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted(p.name for p in self.root.iterdir() if p.is_dir())

    # -- iterations --------------------------------------------------------
    @staticmethod
    def _jsonl_prefix(path: Path, *, preserve_incomplete: bool = False) -> str:
        """Read committed rows; only an incomplete final row may be ignored."""
        raw = path.read_bytes() if path.exists() else b""
        prefix, _, tail = raw.rpartition(b"\n")
        prefix = prefix + b"\n" if b"\n" in raw else b""
        if tail:
            try:
                json.loads(tail)
                prefix += tail + b"\n"
            except (ValueError, UnicodeDecodeError):
                if preserve_incomplete:
                    path.with_name(path.name + ".incomplete-" + uuid.uuid4().hex).write_bytes(tail)
        lines = [line for line in prefix.decode("utf-8").splitlines() if line.strip()]
        return "\n".join(lines) + "\n" if lines else ""

    @staticmethod
    def _append_jsonl_atomic(path: Path, value: dict) -> Path:
        prefix = TaskStore._jsonl_prefix(path, preserve_incomplete=True)
        return TaskStore._atomic_write(path, prefix + json.dumps(value, ensure_ascii=False) + "\n")

    def append_iteration(self, task_id: str, iteration: Iteration) -> Path:
        path = self._iter_file(task_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        return self._append_jsonl_atomic(path, iteration.model_dump(mode="json"))

    def read_iterations(self, task_id: str) -> list[Iteration]:
        path = self._iter_file(task_id)
        if not path.exists():
            return []
        rows = []
        for line in self._jsonl_prefix(path).splitlines():
            if line.strip():
                rows.append(Iteration.model_validate_json(line))
        return rows

    # -- patches -----------------------------------------------------------
    def save_patch(self, task_id: str, patch: Patch) -> Path:
        d = self._dir(task_id) / "patches"
        d.mkdir(parents=True, exist_ok=True)
        n = len(list(d.glob("*.diff"))) + 1
        path = d / f"{n:04d}.diff"
        path.write_text(patch.diff, encoding="utf-8")
        return path

    def latest_patch(self, task_id: str) -> Patch:
        """Reload the newest saved patch from disk (cross-process approval)."""
        d = self._dir(task_id) / "patches"
        files = sorted(d.glob("*.diff"))
        if not files:
            raise FileNotFoundError(f"no patch found for task {task_id}")
        diff = files[-1].read_text(encoding="utf-8")
        targets = list(dict.fromkeys(
            re.findall(r"^\+\+\+ b/(.+)$", diff, re.M)))
        return Patch(patch_id=files[-1].stem, diff=diff,
                     target_files=targets, hypothesis="")

    # -- helper ------------------------------------------------------------
    @staticmethod
    def _atomic_write(path: Path, content: str) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".task-", suffix=".tmp", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
                fh.write(content)
                fh.flush()
                os.fsync(fh.fileno())
            # Windows readers/antivirus can briefly deny replacing an open file.
            # Keep the old file intact; retry only sharing/access errors, finitely.
            for attempt in range(7):
                try:
                    os.replace(tmp, path)  # atomic on Windows + POSIX
                    break
                except OSError as exc:
                    if getattr(exc, "winerror", None) not in {5, 32, 33} or attempt == 6:
                        raise
                    time.sleep(min(0.02 * 2 ** attempt, 0.2))
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return path

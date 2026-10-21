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
    def append_iteration(self, task_id: str, iteration: Iteration) -> Path:
        path = self._iter_file(task_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(iteration.model_dump(mode="json"), ensure_ascii=False) + "\n"
        with path.open("a", encoding="utf-8") as fh:
            fh.write(line)
        return path

    def read_iterations(self, task_id: str) -> list[Iteration]:
        path = self._iter_file(task_id)
        if not path.exists():
            return []
        rows = []
        for line in path.read_text(encoding="utf-8").splitlines():
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
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(content)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)  # atomic on Windows + POSIX
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return path

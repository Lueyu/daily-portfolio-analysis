"""Source seeding and durable evidence for a container-backed task."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .models import Iteration
from .checkpoints.paths import DEFAULT_EXCLUDED_ROOTS, WorkspacePaths
from .task_store import TaskStore

EXCLUDED = {".git", "node_modules", ".venv", "__pycache__", ".pytest_cache",
            ".ruff_cache", "dist", "build", "coverage", "test-results", "playwright-report"}
MANAGED_EXCLUSIONS = (*DEFAULT_EXCLUDED_ROOTS, "test-results", "playwright-report", "blob-report", ".swc")


def assertions_passed(output: str) -> bool:
    """Require positive assertions without contradictory structured failure counts."""
    output = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", output)
    if _failed_test_counts(output):
        return False
    return bool(re.search(
        r"\b[1-9]\d*\s+passed\b|(?:assertions? passed)\s*[:= ]\s*[1-9]\d*|"
        r'"passed"\s*:\s*[1-9]\d*|^\s*(?:#|ℹ)\s+pass\s+[1-9]\d*\b',
        output, re.I | re.M))


def _failed_test_counts(output: str) -> bool:
    # Match reporter summaries, not expected application logs such as "failed request".
    if re.search(r"^\s*(?:#|ℹ)\s+(?:fail(?:ed)?|cancelled|canceled|errors?)\s+[1-9]\d*\s*$",
                 output, re.I | re.M):
        return True
    count = r"\d+\s+(?:passed|failed|errors?|cancelled|canceled|skipped|xfailed|xpassed|deselected|warnings?|rerun)\b"
    summary = re.compile(
        rf"^(?:(?:Test Files|Tests|Errors)\s+)?({count}(?:\s*[,|]\s*{count})*)"
        r"(?=\s*(?:$|\(|in\b))", re.I)
    for line in output.splitlines():
        match = summary.match(line.strip().strip("=").strip())
        if match and re.search(r"\b[1-9]\d*\s+(?:failed|errors?|cancelled|canceled)\b",
                               match[1], re.I):
            return True
    # The existing compact JSON reporter uses a "passed" counter; unrelated error
    # objects in captured test logs must not turn a successful test run into failure.
    for text in [output, *output.splitlines()]:
        if not text.lstrip().startswith("{"):
            continue
        try:
            report = json.loads(text)
        except json.JSONDecodeError:
            continue
        if not isinstance(report, dict) or "passed" not in report:
            continue
        for key in ("fail", "failed", "failures", "cancelled", "canceled", "error", "errors"):
            value = report.get(key, 0)
            if isinstance(value, (int, float)) and value > 0:
                return True
    return False


def seed_workspace(source: Path, workspace: Path) -> None:
    """Export the current checkout, including dirty files, without shared Git metadata."""
    source = source.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["git", "-C", str(source), "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        capture_output=True, timeout=30,
    )
    ignored_root = subprocess.run(["git", "-C", str(source), "check-ignore", "-q", "."],
                                  capture_output=True, timeout=30).returncode == 0
    names = (result.stdout.decode("utf-8").split("\0") if result.returncode == 0 and not ignored_root else
             [str(p.relative_to(source)) for p in source.rglob("*") if p.is_file()])
    for name in dict.fromkeys(names):
        rel = Path(name)
        if not name or rel.is_absolute() or ".." in rel.parts:
            continue
        if any(p in EXCLUDED or p.startswith(".env") for p in rel.parts):
            continue
        if rel.parts[:2] == ("agent", "data") or rel.parts[:1] in (("docs",), (".agents",)):
            continue
        origin = source / rel
        if not origin.is_file() or origin.is_symlink():
            continue
        resolved = origin.resolve()
        if not resolved.is_relative_to(source) or workspace.resolve() in resolved.parents:
            continue
        if any((source / Path(*rel.parts[:i])).is_symlink() or
               getattr(source / Path(*rel.parts[:i]), "is_junction", lambda: False)()
               for i in range(1, len(rel.parts) + 1)):
            continue
        target = workspace / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, target, follow_symlinks=False)


def source_path(workspace: Path, relative: str) -> Path:
    return WorkspacePaths(workspace.resolve(), MANAGED_EXCLUSIONS).target(relative)


class EvidenceStore:
    def __init__(self, root: Path, task, store: TaskStore):
        self.root, self.task, self.store = root, task, store
        self.root.mkdir(parents=True, exist_ok=True)

    def load(self, name: str, default=None):
        path = self.root / name
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default

    def save(self, name: str, value) -> None:
        TaskStore._atomic_write(self.root / name, json.dumps(value, ensure_ascii=False, indent=2))

    def event(self, action: str, summary: str, payload=None) -> None:
        payload = payload or {}
        path = self.root / "events.jsonl"
        index = len(TaskStore._jsonl_prefix(path).splitlines())
        created = datetime.now(timezone.utc)
        row = {"index": index, "action": action, "summary": summary,
               "createdAt": created.isoformat(), "payload": payload}
        TaskStore._append_jsonl_atomic(path, row)
        records = self.store.read_iterations(self.task.id)
        self.store.append_iteration(self.task.id, Iteration(
            index=len(records) + 1, phase="react", action=action,
            decision=summary, observations=[json.dumps(payload, ensure_ascii=False)[:5000]],
            created_at=created,
        ))
        self.task.updated_at = created
        self.store.save(self.task)


def snapshot_diff(journal, before: str, after: str, directory: Path) -> str:
    """Use Git only to render a binary-capable review diff, not as recovery storage."""
    directory.mkdir(parents=True, exist_ok=False)
    left, right = directory / "before", directory / "after"
    journal.export_snapshot(before, left)
    journal.export_snapshot(after, right)
    env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
    result = subprocess.run(
        ["git", "diff", "--no-index", "--binary", "--no-ext-diff", "--no-textconv", "--", "before", "after"],
        cwd=directory, env=env, capture_output=True, timeout=30,
    )
    if result.returncode not in (0, 1):
        raise ValueError(result.stderr.decode("utf-8", errors="replace"))
    diff = result.stdout.decode("utf-8", errors="replace")
    lines = []
    for line in diff.splitlines(keepends=True):
        if line.startswith(("diff --git ", "--- ", "+++ ", "Binary files ")):
            for prefix in ("a/before/", "a/after/"):
                line = line.replace(prefix, "a/")
            for prefix in ("b/before/", "b/after/"):
                line = line.replace(prefix, "b/")
        lines.append(line)
    return "".join(lines)


def read_events(root: Path, cursor: int = 0, limit: int = 100) -> dict:
    path = root / "events.jsonl"
    rows = [json.loads(line) for line in TaskStore._jsonl_prefix(path).splitlines() if line]
    selected = rows[max(0, cursor):max(0, cursor) + limit]
    return {"events": selected, "cursor": max(0, cursor) + len(selected)}

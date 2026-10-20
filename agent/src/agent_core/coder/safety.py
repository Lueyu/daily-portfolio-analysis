"""Pure safety guards for the coder persona.

Every action the model asks for is funnelled through these functions before
touching the disk or spawning a process. They are pure (no I/O, no model) so
they can be exhaustively unit tested. Defence in depth:
  * path lock: confine reads/writes to the webapp workdir, block secrets,
    virtualenvs and dependency caches;
  * command lock: only a fixed allow-list of npm scripts, built as an argv
    list (never shell=True, never a free-form string), so command injection is
    structurally impossible;
  * test-integrity lock: refuse patches that skip/force tests or delete
    assertions;
  * git lock: read-only commands + apply only; no push/force/commit.
"""

from __future__ import annotations

import re
from pathlib import Path

from .models import CheckKind


class SafetyViolation(Exception):
    """Raised when a requested action crosses a safety boundary."""


# Path segments that must never be read or written by the coder.
_FORBIDDEN_NAMES = {
    ".venv",
    "node_modules",
    "__pycache__",
    ".git",
}
_FORBIDDEN_SUFFIXES = {".pyc", ".lock"}

# The only npm scripts the tools may run. Maps each check kind to its script.
_CHECK_SCRIPTS: dict[CheckKind, str] = {
    CheckKind.UNIT: "test:unit",
    CheckKind.E2E: "test:e2e",
    CheckKind.TYPECHECK: "type:check",
    CheckKind.LINT: "lint",
}

# git verbs / flags that change history or talk to the network.
_FORBIDDEN_GIT_TOKENS = {
    "push",
    "commit",
    "reset",
    "--force",
    "-f",
    "force",
    "clean",
    "rebase",
    "checkout",
    "switch",
}
_ALLOWED_GIT = {"status", "diff", "stash", "apply", "log", "rev-parse"}


def _is_forbidden(path: Path) -> bool:
    if set(path.parts) & _FORBIDDEN_NAMES:
        return True
    if path.name.startswith(".env"):
        return True
    if path.suffix in _FORBIDDEN_SUFFIXES:
        return True
    return False


def safe_join(workdir: Path | str, rel: str) -> Path:
    """Resolve rel under workdir and guarantee it stays inside and is not sensitive."""
    base = Path(workdir).resolve()
    candidate = (base / rel).resolve()
    if base not in (candidate, *candidate.parents):
        raise SafetyViolation(f"path escapes workdir: {rel!r}")
    if _is_forbidden(candidate.relative_to(base)):
        raise SafetyViolation(f"access to sensitive path denied: {rel!r}")
    return candidate


def npm_run_args(kind: CheckKind | str) -> list[str]:
    """Return the fixed argv for an allowed check, or raise for anything else."""
    if not isinstance(kind, CheckKind):
        try:
            kind = CheckKind(kind)
        except ValueError as exc:
            raise SafetyViolation(f"unknown check kind: {kind!r}") from exc
    if kind not in _CHECK_SCRIPTS:
        raise SafetyViolation(f"check kind not allow-listed: {kind!r}")
    return ["npm", "run", _CHECK_SCRIPTS[kind]]


# Patterns that weaken or silence the test suite.
_CHEAT_RULES = (
    (r"\b(?:it|test|describe)\.(?:skip|todo|only)\b", "test skip/only marker"),
    (r"\b(?:xit|xdescribe)\b", "disabled test marker"),
    (r"\.only\(", "exclusive .only( focus"),
    (r"^-.*\b(?:expect|assert)\b", "deleted assertion line"),
)


def scan_test_cheating(diff: str) -> list[str]:
    """Return human-readable reasons if a diff weakens the test suite."""
    hits: list[str] = []
    for line in diff.splitlines():
        added = line.startswith("+")
        removed = line.startswith("-")
        for pattern, reason in _CHEAT_RULES:
            if not re.search(pattern, line):
                continue
            is_deletion_rule = reason == "deleted assertion line"
            if is_deletion_rule and not removed:
                continue
            if not is_deletion_rule and not added:
                continue
            hits.append(f"{reason}: {line.strip()[:120]}")
    return hits


def guard_git_args(args: list[str]) -> None:
    """Raise unless the git invocation is read-only or an apply."""
    if not args:
        raise SafetyViolation("empty git command")
    verb = args[0]
    if verb not in _ALLOWED_GIT:
        raise SafetyViolation(f"git verb not allowed: {verb!r}")
    for token in args[1:]:
        if token in _FORBIDDEN_GIT_TOKENS or token.startswith("--force"):
            raise SafetyViolation(f"git argument not allowed: {token!r}")

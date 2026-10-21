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

# The only `git worktree` subcommands the sandbox lifecycle may use.
_ALLOWED_WORKTREE_SUB = {"add", "remove", "list", "prune"}


def guard_worktree_args(args: list[str]) -> None:
    """Validate the tokens that follow `git worktree`.

    Only fixed shapes are accepted:
      add --detach <path> HEAD | remove <path> | list --porcelain | prune
    """
    if not args:
        raise SafetyViolation("empty worktree command")
    sub = args[0]
    if sub not in _ALLOWED_WORKTREE_SUB:
        raise SafetyViolation(f"worktree subcommand not allowed: {sub!r}")
    for token in args[1:]:
        if token in _FORBIDDEN_GIT_TOKENS or token.startswith("--force"):
            raise SafetyViolation(f"worktree argument not allowed: {token!r}")
    if sub == "add":
        if len(args) != 4 or args[1] != "--detach" or args[3] != "HEAD":
            raise SafetyViolation("worktree add must be: add --detach <path> HEAD")
        if not args[2] or args[2].startswith("-"):
            raise SafetyViolation("worktree add requires a concrete path")
    elif sub == "remove":
        if len(args) != 2 or not args[1] or args[1].startswith("-"):
            raise SafetyViolation("worktree remove requires a concrete path")
    elif sub == "list":
        if args != ["list", "--porcelain"]:
            raise SafetyViolation("worktree list must be: list --porcelain")
    elif sub == "prune":
        if args != ["prune"]:
            raise SafetyViolation("worktree prune takes no arguments")


def _is_forbidden(path: Path) -> bool:
    if set(path.parts) & _FORBIDDEN_NAMES:
        return True
    if path.name.startswith(".env"):
        return True
    if path.suffix in _FORBIDDEN_SUFFIXES:
        return True
    return False


def is_sensitive_entry(name: str) -> bool:
    """True for a single file/dir name that must never be explored.

    Shared by list_dir / glob / grep so secrets and dependency trees stay
    hidden across every read-only tool. ``name`` is a single entry name, not
    a path.
    """
    if name in _FORBIDDEN_NAMES:
        return True
    if name.startswith(".env"):
        return True
    if Path(name).suffix in _FORBIDDEN_SUFFIXES:
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


def npm_run_args(kind: CheckKind | str, sandboxed: bool = False) -> list[str]:
    """Return the fixed argv for an allowed check, or raise for anything else."""
    if not isinstance(kind, CheckKind):
        try:
            kind = CheckKind(kind)
        except ValueError as exc:
            raise SafetyViolation(f"unknown check kind: {kind!r}") from exc
    if kind not in _CHECK_SCRIPTS:
        raise SafetyViolation(f"check kind not allow-listed: {kind!r}")
    script = _CHECK_SCRIPTS[kind]
    # Inside a worktree the E2E suite must use the isolated-port fullstack
    # config (3099/8090 + deterministic fake agent). The default script binds
    # Vite to 8080 and would collide with the developer's running stack.
    if sandboxed and kind == CheckKind.E2E:
        script = "test:e2e:fullstack"
    return ["npm", "run", script]


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

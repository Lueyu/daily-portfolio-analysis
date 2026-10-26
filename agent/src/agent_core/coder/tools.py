"""Controlled execution tools for the coder persona.

Every subprocess is launched with shell=False and a fixed argv list. The
process runner is injectable so the whole layer is unit-testable offline; the
default runner wraps subprocess.run. The model can never reach this layer with
an arbitrary command: it only names a check kind, and safety.py turns that
into an argv list.
"""

from __future__ import annotations

import fnmatch
import os
import re
import shutil
import socket
import subprocess
import time
from collections.abc import Callable
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from .models import (
    CheckKind,
    CommandResult,
    ProbeResult,
    ProbeTarget,
    TestOutcome,
)
from .safety import (
    SafetyViolation,
    guard_git_args,
    guard_worktree_args,
    is_sensitive_entry,
    npm_run_args,
    safe_join,
)

# Runner signature is fixed at four args; stdin is used for `git apply`.
Runner = Callable[[list[str], Path, float | None, str | None], CommandResult]

_MAX_READ_BYTES = 200_000
_TAIL_CHARS = 4000
_MAX_LIST_ENTRIES = 200
_MAX_MATCHES = 100
_MAX_GREP_LINE_CHARS = 200
_READ_PAGE_CONTENT_CHARS = 12000
_MAX_SEARCH_OUTPUT_CHARS = 4500
_BINARY_SAMPLE_BYTES = 2048
_CHECK_TIMEOUTS = {
    CheckKind.UNIT: 300.0,
    CheckKind.E2E: 600.0,
    CheckKind.TYPECHECK: 300.0,
    CheckKind.LINT: 300.0,
}


def _is_probably_binary(path: Path) -> bool:
    """Heuristic: a NUL byte in the first 2 KiB marks a binary file."""
    try:
        with open(path, "rb") as fh:
            return b"\x00" in fh.read(_BINARY_SAMPLE_BYTES)
    except OSError:
        return True


def _matches_include(path: Path, root: Path, pattern: str | None) -> bool:
    if not pattern:
        return True
    pattern = pattern.replace("\\", "/")
    relative = path.relative_to(root).as_posix()
    return fnmatch.fnmatch(path.name, pattern) or fnmatch.fnmatch(relative, pattern)


def _walk_files(root: Path, glob_include: str | None = None):
    """Yield files under root, pruning sensitive dirs in place for speed.

    Pruning ``dirnames`` in place keeps os.walk from descending into
    node_modules/.venv/.git at all, which is what makes grep fast on a real
    project. An optional fnmatch filter applies to the basename or relative path.
    """
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if not is_sensitive_entry(d)]
        for name in filenames:
            if is_sensitive_entry(name):
                continue
            path = Path(dirpath) / name
            if not _matches_include(path, root, glob_include):
                continue
            yield path


def _rel_posix(path: Path, root: Path) -> str:
    """Path of ``path`` relative to ``root`` using forward slashes."""
    return path.resolve().relative_to(root.resolve()).as_posix()


def _decode(blob) -> str:
    if blob is None:
        return ""
    if isinstance(blob, bytes):
        return blob.decode("utf-8", errors="replace")
    return blob


def default_runner(argv: list[str], cwd: Path, timeout: float | None,
                   stdin: str | None = None) -> CommandResult:
    start = time.monotonic()
    # Byte mode on purpose: with text=True on Windows, subprocess rewrites the
    # stdin '\n' to '\r\n', which corrupts a patch piped into `git apply`.
    # Encoding explicitly keeps the diff byte-for-byte and output decoding stable.
    # Resolve the executable via PATH/PATHEXT. On Windows, shell=False cannot
    # spawn "npm" directly (it is shipped as npm.cmd); shutil.which finds the
    # right extension. Fall back to the raw name so a missing binary is reported
    # below instead of crashing the whole run.
    executable = shutil.which(argv[0]) or argv[0]
    run_argv = [executable, *argv[1:]]
    kwargs = dict(cwd=str(cwd), capture_output=True, shell=False, timeout=timeout)
    if stdin is not None:
        kwargs["input"] = stdin.encode("utf-8")
    elapsed = lambda: int((time.monotonic() - start) * 1000)
    try:
        proc = subprocess.run(run_argv, **kwargs)
        return CommandResult(
            argv=run_argv, returncode=proc.returncode,
            stdout=_decode(proc.stdout), stderr=_decode(proc.stderr),
            duration_ms=elapsed(),
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult(
            argv=run_argv, returncode=124,
            stdout=_decode(exc.stdout), stderr=f"timeout after {timeout}s",
            duration_ms=int((timeout or 0) * 1000),
        )
    except FileNotFoundError:
        # A missing tool (e.g. npm not on PATH) is a failed check with the
        # conventional 127 code, fed back as evidence -- never a process crash.
        return CommandResult(
            argv=run_argv, returncode=127, stdout="",
            stderr=f"command not found: {argv[0]}",
            duration_ms=elapsed(),
        )


def _tail(text: str, chars: int = _TAIL_CHARS) -> str:
    return text[-chars:] if text else ""


def parse_test_output(kind: CheckKind, argv: list[str],
                      result: CommandResult) -> TestOutcome:
    """Convert a raw command result into a structured TestOutcome.

    Pass/fail is anchored on the process exit code; counts and failing names
    are best-effort parsing for the model's evidence. The raw tail is always
    retained so a parser miss never hides the real error.
    """
    blob = f"{result.stdout}\n{result.stderr}"
    passed = result.returncode == 0

    passed_m = re.findall(r"(\d+)\s+passed", blob)
    failed_m = re.findall(r"(\d+)\s+failed", blob)
    total_passed = int(passed_m[-1]) if passed_m else 0
    total_failed = int(failed_m[-1]) if failed_m else 0
    total = total_passed + total_failed if (passed_m or failed_m) else 0

    failed_names: list[str] = []
    if kind in (CheckKind.UNIT, CheckKind.E2E):
        for line in blob.splitlines():
            m = re.match(r"\s*[×x]\s+(.+?)\s*$", line)
            if m:
                failed_names.append(m.group(1))
        # De-duplicate while preserving order.
        failed_names = list(dict.fromkeys(failed_names))

    return TestOutcome(
        check=kind, passed=passed, total=total, failed=failed_names,
        summary="passed" if passed else "failed",
        raw_tail=_tail(blob), argv=list(argv),
    )


# Prober maps a list of fixed localhost targets to their results. Injectable so
# the layer is unit-testable offline without opening real sockets.
Prober = Callable[[list[ProbeTarget]], list[ProbeResult]]


def default_prober(timeout: float) -> Prober:
    """Probe localhost targets with the stdlib only.

    For TCP we open a short-lived connection. For HTTP we issue a GET; any
    HTTP status (401/403/404/...) still proves an HTTP server is answering, so
    only a refused connection / DNS failure / timeout counts as down.
    """

    def probe(targets: list[ProbeTarget]) -> list[ProbeResult]:
        results: list[ProbeResult] = []
        for target in targets:
            start = time.monotonic()
            latency = lambda: int((time.monotonic() - start) * 1000)
            try:
                if target.kind == "tcp":
                    host, _, port = target.target.rpartition(":")
                    with socket.create_connection((host, int(port)), timeout=timeout):
                        pass
                elif target.kind == "http":
                    try:
                        urlopen(target.target, timeout=timeout).close()
                    except HTTPError:
                        # A status code means an HTTP server responded.
                        pass
                else:
                    raise ValueError(f"unknown probe kind: {target.kind}")
                results.append(ProbeResult(
                    name=target.name, kind=target.kind, target=target.target,
                    up=True, latency_ms=latency()))
            except (URLError, OSError, ValueError) as exc:
                results.append(ProbeResult(
                    name=target.name, kind=target.kind, target=target.target,
                    up=False, latency_ms=latency(), detail=type(exc).__name__))
        return results

    return probe


def build_probe_targets(settings) -> list[ProbeTarget]:
    """Build the fixed localhost probe plan from settings."""
    return [
        ProbeTarget(
            name="postgres", kind="tcp",
            target=f"{settings.probe_pg_host}:{settings.probe_pg_port}"),
        ProbeTarget(
            name="backend", kind="http", target=settings.probe_backend_url),
        ProbeTarget(
            name="frontend", kind="http", target=settings.probe_frontend_url),
    ]


class ControlledTools:
    """The only surface the coder uses to touch the repository."""

    def __init__(self, workdir: Path | str, runner: Runner | None = None,
                 probe_targets: list[ProbeTarget] | None = None,
                 prober: Prober | None = None, probe_timeout: float = 2.0):
        self.workdir = Path(workdir)
        self._run = runner or default_runner
        self.probe_targets = probe_targets or []
        self._probe = prober or default_prober(probe_timeout)

    # -- read --------------------------------------------------------------
    def read_file(self, rel: str, cwd: Path | str | None = None) -> str:
        base = Path(cwd) if cwd else self.workdir
        path = safe_join(base, rel)
        if not path.is_file():
            raise FileNotFoundError(f"not a file: {rel}")
        size = path.stat().st_size
        if size > _MAX_READ_BYTES:
            raise ValueError(f"file too large ({size} bytes): {rel}")
        return path.read_text(encoding="utf-8", errors="replace")

    def read_file_page(self, rel: str, start_line: int = 1, max_lines: int = 80,
                       start_column: int = 1, cwd: Path | str | None = None) -> str:
        """Bounded source view with a lossless continuation for long lines.

        Columns count Unicode characters, not UTF-8 bytes. A continuation always
        names the next unread character; no source tail is silently discarded.
        ``read_file`` remains the unformatted internal API.
        """
        if start_line < 1 or start_column < 1 or not 1 <= max_lines <= 200:
            raise ValueError("start_line/start_column must be positive; max_lines must be 1..200")
        lines = self.read_file(rel, cwd=cwd).splitlines()
        total = len(lines)
        if start_line > total:
            return f"FILE {rel} total_lines={total}; EOF (start_line={start_line})"
        if start_column > len(lines[start_line - 1]) + 1:
            raise ValueError("start_column is beyond this line; use the reported NEXT position")
        rows: list[str] = []
        remaining = _READ_PAGE_CONTENT_CHARS
        next_line, next_column = start_line, start_column
        last_line = min(total, start_line + max_lines - 1)
        for number in range(start_line, last_line + 1):
            line = lines[number - 1]
            offset = start_column - 1 if number == start_line else 0
            # Leave enough room for the column annotation on a split line.
            room = remaining - len(str(number)) - 90
            if room <= 0:
                break
            part = line[offset:offset + room]
            end_column = offset + len(part)
            split = offset > 0 or end_column < len(line)
            label = f"{number}"
            if split:
                label += f" [columns={offset + 1}-{end_column}/{len(line)}]"
            row = f"{label}: {part}"
            rows.append(row)
            remaining -= len(row) + 1
            if end_column < len(line):
                next_line, next_column = number, end_column + 1
                break
            next_line, next_column = number + 1, 1
        header = f"FILE {rel} total_lines={total}; lines={start_line}-{start_line + len(rows) - 1}"
        footer = "EOF"
        if next_line <= total:
            footer = (f"[page truncated; NEXT start_line={next_line} "
                      f"start_column={next_column}; use read_file with the same path]")
        return "\n".join([header, *rows, footer])

    # -- read-only exploration ---------------------------------------------
    def list_dir(self, rel: str = ".", cwd: Path | str | None = None) -> str:
        """List one directory level; directories end with '/'. Sensitive
        entries (deps, secrets, VCS) are hidden and the listing is capped."""
        base = Path(cwd) if cwd else self.workdir
        root = safe_join(base, rel)
        if not root.is_dir():
            raise FileNotFoundError(f"not a directory: {rel}")
        dirs: list[str] = []
        files: list[str] = []
        for entry in root.iterdir():
            if is_sensitive_entry(entry.name):
                continue
            (dirs if entry.is_dir() else files).append(entry.name)
        names = [n + "/" for n in sorted(dirs, key=str.lower)]
        names += sorted(files, key=str.lower)
        note = ""
        if len(names) > _MAX_LIST_ENTRIES:
            names = names[:_MAX_LIST_ENTRIES]
            note = (f"\n... truncated to the first {_MAX_LIST_ENTRIES} entries; "
                    "narrow the path")
        return "\n".join(names) + note

    def glob(self, pattern: str, rel: str = ".",
             cwd: Path | str | None = None) -> str:
        """Find files by name pattern (e.g. server/**/*.ts). Pure pathlib,
        no shell. Sensitive paths are filtered and the result is capped."""
        base = Path(cwd) if cwd else self.workdir
        root = safe_join(base, rel)
        if not root.is_dir():
            raise FileNotFoundError(f"not a directory: {rel}")
        root_resolved = root.resolve()
        found: list[str] = []
        truncated = False
        for p in root.glob(pattern):
            if not p.is_file():
                continue
            try:
                rel_path = p.resolve().relative_to(root_resolved)
            except ValueError:
                continue  # a pattern with '..' must never leak outside the root
            if any(is_sensitive_entry(part) for part in rel_path.parts):
                continue
            if len(found) >= _MAX_MATCHES:
                truncated = True
                break
            found.append(rel_path.as_posix())
        result = "\n".join(sorted(found)) or "(no matches)"
        if truncated:
            result += "\n[results truncated; narrow the path or pattern]"
        return result

    def grep(self, pattern: str, rel: str = ".", glob_include: str | None = None,
             max_results: int = _MAX_MATCHES, cwd: Path | str | None = None) -> str:
        """Search file contents with a regex, returning 'path:line: text'.

        Skips sensitive dirs, binary files and oversized files. Implemented in
        pure Python (no system ripgrep dependency on Windows)."""
        try:
            regex = re.compile(pattern)
        except re.error as exc:
            raise ValueError(f"invalid regex {pattern!r}: {exc}") from exc
        base = Path(cwd) if cwd else self.workdir
        root = safe_join(base, rel)
        if not root.is_dir() and not root.is_file():
            raise FileNotFoundError(f"not a file or directory: {rel}")
        limit = max(1, min(int(max_results or _MAX_MATCHES), _MAX_MATCHES))
        hits: list[str] = []
        search_root = root.parent if root.is_file() else root
        paths = [root] if root.is_file() else _walk_files(root, glob_include)
        output_chars = 0
        for path in paths:
            if not _matches_include(path, search_root, glob_include):
                continue
            try:
                if path.stat().st_size > _MAX_READ_BYTES or _is_probably_binary(path):
                    continue
                lines = path.read_text(
                    encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            rel_name = _rel_posix(path, search_root)
            for lineno, line in enumerate(lines, 1):
                match = regex.search(line)
                if match:
                    start = max(0, match.start() - 60) if len(line) > _MAX_GREP_LINE_CHARS else 0
                    end = min(len(line), start + _MAX_GREP_LINE_CHARS)
                    snippet = line[start:end]
                    note = ""
                    if start > 0 or end < len(line):
                        note = (f" [columns={start + 1}-{end}/{len(line)}; truncated; "
                                f"read_file start_line={lineno} start_column={start + 1}]")
                    hit = f"{rel_name}:{lineno}: {snippet}{note}"
                    if len(hits) >= limit or output_chars + len(hit) > _MAX_SEARCH_OUTPUT_CHARS:
                        return "\n".join(hits + [
                            "[results truncated; narrow path/pattern or use read_file at a matching line]",
                        ])
                    hits.append(hit)
                    output_chars += len(hit) + 1
        return "\n".join(hits) or "(no matches)"

    # -- environment probe (read-only, localhost whitelist) ----------------
    def probe_env(self, names: list[str] | None = None,
                  cwd: Path | str | None = None) -> str:
        """Report whether configured local services are reachable.

        The model may only select from the configured target names; an
        arbitrary host/URL is rejected, so this cannot be used as a network
        backdoor. With no selection it probes every configured target.
        """
        if not self.probe_targets:
            return "No environment probes configured."
        wanted = self.probe_targets
        if names:
            known = {t.name for t in self.probe_targets}
            unknown = [n for n in names if n not in known]
            if unknown:
                raise ValueError(
                    "probe_env only accepts configured localhost target names; "
                    f"not allowed: {unknown}")
            wanted = [t for t in self.probe_targets if t.name in names]
        results = self._probe(wanted)
        lines: list[str] = []
        for r in results:
            state = "UP  " if r.up else "DOWN"
            detail = f" {r.detail}" if r.detail else ""
            lines.append(
                f"{state} {r.name} ({r.kind} {r.target}) {r.latency_ms}ms{detail}")
        down = [r.name for r in results if not r.up]
        lines.append("")
        if down:
            lines.append(
                "DOWN: " + ", ".join(down) + ". Start the local services before "
                "reproducing; for PostgreSQL run scripts/db/start-db.ps1.")
        else:
            lines.append("All configured local services are reachable.")
        return "\n".join(lines)

    # -- verification ------------------------------------------------------
    def run_check(self, kind: CheckKind, cwd: Path | str | None = None,
                  sandboxed: bool = False) -> TestOutcome:
        argv = npm_run_args(kind, sandboxed=sandboxed)
        base = Path(cwd) if cwd else self.workdir
        timeout = 900.0 if (sandboxed and kind == CheckKind.E2E) else _CHECK_TIMEOUTS[kind]
        result = self._run(argv, base, timeout, None)
        return parse_test_output(kind, argv, result)

    # -- git (harness-internal only; never exposed as a model action) ------
    def git_apply(self, diff: str, cwd: Path | str | None = None,
                  reverse: bool = False) -> CommandResult:
        # The diff is piped over stdin ('-' reads the patch); never shell=True.
        args = ["apply", "--whitespace=nowarn"]
        if reverse:
            args.append("-R")
        args.append("-")
        guard_git_args(args)  # defence-in-depth on the fixed argv
        base = Path(cwd) if cwd else self.workdir
        return self._run(["git", *args], base, 120.0, diff)

    def git_diff(self, cwd: Path | str | None = None) -> str:
        guard_git_args(["diff"])
        base = Path(cwd) if cwd else self.workdir
        return self._run(["git", "diff"], base, 120.0, None).stdout

    def git_status(self, cwd: Path | str | None = None) -> str:
        guard_git_args(["status", "--short"])
        base = Path(cwd) if cwd else self.workdir
        return self._run(["git", "status", "--short"], base, 120.0, None).stdout

    # -- git worktree (harness-internal sandbox management; never a model action)
    def git_snapshot_paths(self, cwd: Path | str) -> CommandResult:
        """Enumerate current tracked changes and nonignored untracked paths.

        NUL separators preserve spaces and Unicode; optional locks are disabled
        so even Git's opportunistic index refresh cannot write the main index.
        """
        base = Path(cwd)
        tracked = self._run([
            "git", "--no-optional-locks", "diff", "--name-only", "--no-renames",
            "-z", "HEAD", "--",
        ], base, 120.0, None)
        if not tracked.ok:
            return tracked
        untracked = self._run([
            "git", "--no-optional-locks", "ls-files", "--others",
            "--exclude-standard", "-z", "--",
        ], base, 120.0, None)
        if untracked.ok:
            untracked.stdout = tracked.stdout + untracked.stdout
        return untracked

    def git_snapshot_commit(self, cwd: Path | str) -> CommandResult:
        """Save the copied source baseline in a detached worktree only.

        This fixed lifecycle operation is never a model action and deliberately
        does not expand guard_git_args (which still forbids commit and push).
        """
        base = Path(cwd).resolve()
        git_file = base / ".git"
        if (base == self.workdir.resolve() or not git_file.is_file()
                or git_file.is_symlink()):
            raise SafetyViolation("snapshot requires a separate Git worktree")
        detached = self._run(
            ["git", "symbolic-ref", "--quiet", "HEAD"], base, 120.0, None)
        if detached.returncode != 1:
            raise SafetyViolation("snapshot requires a detached worktree HEAD")
        staged = self._run(["git", "add", "--all", "--"], base, 120.0, None)
        if not staged.ok:
            return staged
        changed = self._run(
            ["git", "diff", "--cached", "--quiet"], base, 120.0, None)
        if changed.returncode != 1:
            return changed
        # .git is a regular file in a worktree, so no hooks can exist below it.
        # Identity, hooks and signing overrides are process-local only.
        return self._run([
            "git", "-c", f"core.hooksPath={git_file}",
            "-c", "user.name=Coder Sandbox",
            "-c", "user.email=coder-sandbox@localhost",
            "-c", "commit.gpgsign=false", "commit", "--no-verify",
            "-m", "Snapshot current workspace for isolated verification",
        ], base, 120.0, None)

    def git_worktree_add(self, path: Path | str,
                         cwd: Path | str | None = None) -> CommandResult:
        args = ["worktree", "add", "--detach", str(Path(path)), "HEAD"]
        guard_worktree_args(args[1:])
        base = Path(cwd) if cwd else self.workdir
        return self._run(["git", *args], base, 120.0, None)

    def git_worktree_list(self, cwd: Path | str | None = None) -> str:
        args = ["worktree", "list", "--porcelain"]
        guard_worktree_args(args[1:])
        base = Path(cwd) if cwd else self.workdir
        return self._run(["git", *args], base, 120.0, None).stdout

    def git_worktree_unlock_initialization(
            self, path: Path | str, cwd: Path | str) -> CommandResult:
        """Release only a sandbox's interrupted creation lock before pruning."""
        target = Path(path).resolve()
        base = Path(cwd).resolve()
        marker = target.parent / f".{target.name}.initializing"
        if target == base or not marker.is_file():
            raise SafetyViolation("unlock requires an interrupted sandbox marker")
        return self._run(
            ["git", "worktree", "unlock", str(target)], base, 60.0, None)

    def git_worktree_prune(self, cwd: Path | str | None = None) -> CommandResult:
        args = ["worktree", "prune"]
        guard_worktree_args(args[1:])
        base = Path(cwd) if cwd else self.workdir
        return self._run(["git", *args], base, 60.0, None)

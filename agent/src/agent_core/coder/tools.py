"""Controlled, sandboxed tools for the coder.

The tools are a thin execution layer over pure safety guards:
  * read_file: confined + size-limited;
  * run_check: one of the four fixed npm scripts;
  * git_apply / git_diff / git_status: harness-internal, read-only or apply.
The subprocess runner is injected (a fake in tests, the real subprocess-based
runner in production), so this module never needs the network or a real repo
to be unit tested.
"""

from __future__ import annotations

import re
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

from .models import CheckKind, CommandResult, TestOutcome
from .safety import guard_git_args, npm_run_args, safe_join

# Runner signature is fixed at four args; stdin is used for `git apply`.
Runner = Callable[[list[str], Path, float | None, str | None], CommandResult]

_MAX_READ_BYTES = 200_000
_TAIL_CHARS = 4000
_CHECK_TIMEOUTS = {
    CheckKind.UNIT: 300.0,
    CheckKind.E2E: 600.0,
    CheckKind.TYPECHECK: 300.0,
    CheckKind.LINT: 300.0,
}


def default_runner(argv: list[str], cwd: Path, timeout: float | None,
                   stdin: str | None = None) -> CommandResult:
    start = time.monotonic()
    kwargs = dict(cwd=str(cwd), capture_output=True, text=True, shell=False,
                  timeout=timeout, encoding="utf-8", errors="replace")
    if stdin is not None:
        kwargs["input"] = stdin
    try:
        proc = subprocess.run(argv, **kwargs)
        return CommandResult(
            argv=argv, returncode=proc.returncode,
            stdout=proc.stdout or "", stderr=proc.stderr or "",
            duration_ms=int((time.monotonic() - start) * 1000),
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult(
            argv=argv, returncode=124,
            stdout=exc.stdout or "", stderr=f"timeout after {timeout}s",
            duration_ms=int((timeout or 0) * 1000),
        )


def tail(text: str, limit: int = _TAIL_CHARS) -> str:
    return text[-limit:] if len(text) > limit else text


def _failed_files(stdout: str) -> list[str]:
    # Vitest prints `FAIL <path-to-file> > test name`; keep the file stem.
    return [Path(x).stem for x in re.findall(r"FAIL\s+(\S+)", stdout)]


def parse_test_output(kind: CheckKind, argv: list[str],
                      result: CommandResult) -> TestOutcome:
    """Turn a raw test command result into a structured pass/fail outcome."""
    out = result.stdout or ""
    err = result.stderr or ""

    if kind == CheckKind.E2E:
        # Playwright marks failed cases with a cross; the exit code is the
        # authoritative signal. A stray "N failed" word is not enough.
        failed = [m.group(1).strip() for m in re.finditer(r"[✘×]\s*([^\n]+)", out)]
        passed = result.returncode == 0 and not failed
        passed_n = re.findall(r"(\d+)\s+passed", out)
        summary = f"{passed_n[-1]} passed" if passed_n else f"exit {result.returncode}"
    elif kind == CheckKind.UNIT:
        failed = _failed_files(out)
        passed = result.returncode == 0 and not failed
        m = re.search(r"Tests\s+.*", out)
        summary = m.group(0) if m else f"exit {result.returncode}"
    else:
        failed = _failed_files(out)
        passed = result.returncode == 0 and not failed
        summary = f"exit {result.returncode}"

    raw = "\n".join(part for part in (out, err) if part)
    return TestOutcome(
        check=kind,
        passed=passed,
        total=0,
        failed=failed,
        summary=summary,
        raw_tail=tail(raw),
        argv=argv,
    )


class ControlledTools:
    def __init__(self, workdir: Path | str, runner: Runner | None = None):
        self.workdir = Path(workdir)
        self._run: Runner = runner or default_runner

    # -- read --------------------------------------------------------------
    def read_file(self, rel: str) -> str:
        path = safe_join(self.workdir, rel)
        if not path.is_file():
            raise FileNotFoundError(f"not a file: {rel}")
        if path.stat().st_size > _MAX_READ_BYTES:
            raise ValueError(f"file too large to read in one call: {rel}")
        return tail(path.read_text(encoding="utf-8", errors="replace"))

    # -- verification ------------------------------------------------------
    def run_check(self, kind: CheckKind, cwd: Path | str | None = None) -> TestOutcome:
        argv = npm_run_args(kind)
        base = Path(cwd) if cwd else self.workdir
        result = self._run(argv, base, _CHECK_TIMEOUTS[kind], None)
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

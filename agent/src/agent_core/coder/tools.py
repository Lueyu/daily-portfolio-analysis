"""Controlled execution tools for the coder persona.

Every subprocess is launched with shell=False and a fixed argv list. The
process runner is injectable so the whole layer is unit-testable offline; the
default runner wraps subprocess.run. The model can never reach this layer with
an arbitrary command: it only names a check kind, and safety.py turns that
into an argv list.
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
    kwargs = dict(cwd=str(cwd), capture_output=True, shell=False, timeout=timeout)
    if stdin is not None:
        kwargs["input"] = stdin.encode("utf-8")
    try:
        proc = subprocess.run(argv, **kwargs)
        return CommandResult(
            argv=argv, returncode=proc.returncode,
            stdout=_decode(proc.stdout), stderr=_decode(proc.stderr),
            duration_ms=int((time.monotonic() - start) * 1000),
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult(
            argv=argv, returncode=124,
            stdout=_decode(exc.stdout), stderr=f"timeout after {timeout}s",
            duration_ms=int((timeout or 0) * 1000),
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


class ControlledTools:
    """The only surface the coder uses to touch the repository."""

    def __init__(self, workdir: Path | str, runner: Runner | None = None):
        self.workdir = Path(workdir)
        self._run = runner or default_runner

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

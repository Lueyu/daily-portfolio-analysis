"""Directory links for the worktree sandbox.

A sandbox needs a populated ``node_modules`` to run npm checks, but copying
that tree is slow and huge. Instead we *link* the sandbox's dependency folder
to the main checkout's real one:

  * Windows: a directory junction (`mklink /J`). A junction needs no admin
    rights (unlike a symbolic link), and is created through a fixed argv list
    handed to ``cmd /c`` (no shell string interpolation).
  * POSIX:   ``os.symlink(target, link, target_is_directory=True)``.

Teardown is safety-critical: a junction that points at a real directory must
be removed with ``os.rmdir``/``os.unlink``, which deletes the reparse point
only. Calling ``shutil.rmtree`` on it would walk *into* the target and erase
the real ``node_modules``. This module never rmtree's a link.
"""
from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path
from collections.abc import Callable

# (argv, cwd) -> (returncode, stdout, stderr). Injectable for offline tests.
LinkRunner = Callable[[list[str], Path], "tuple[int, str, str]"]


class LinkError(Exception):
    """Raised when a dependency link cannot be created."""


class Linker:
    def __init__(self, runner: LinkRunner | None = None):
        self._run = runner or self._default_run

    # -- platform ----------------------------------------------------------
    @staticmethod
    def is_windows() -> bool:
        return sys.platform.startswith("win")

    @staticmethod
    def _default_run(argv: list[str], cwd: Path) -> tuple[int, str, str]:
        proc = subprocess.run(
            argv, cwd=str(cwd), capture_output=True, shell=False)
        out = proc.stdout.decode("utf-8", errors="replace") if proc.stdout else ""
        err = proc.stderr.decode("utf-8", errors="replace") if proc.stderr else ""
        return proc.returncode, out, err

    # -- create ------------------------------------------------------------
    def make_link(self, link: Path | str, target: Path | str) -> None:
        link = Path(link)
        target = Path(target)
        if self.is_junction(link) or link.is_symlink():
            return  # idempotent
        if not target.exists():
            raise LinkError(f"link target does not exist: {target}")
        link.parent.mkdir(parents=True, exist_ok=True)
        if self.is_windows():
            argv = ["cmd", "/c", "mklink", "/J", str(link), str(target)]
            rc, _out, err = self._run(argv, link.parent)
            if rc != 0 or not self.is_junction(link):
                raise LinkError(f"mklink /J failed for {link}: {err.strip()}")
        else:
            os.symlink(target, link, target_is_directory=True)

    # -- detect ------------------------------------------------------------
    def is_junction(self, path: Path | str) -> bool:
        """True for a directory junction (Windows) or symlink (POSIX)."""
        path = Path(path)
        try:
            st = os.lstat(path)
        except OSError:
            return False
        if self.is_windows():
            attrs = getattr(st, "st_file_attributes", 0)
            return bool(attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT)
        return stat.S_ISLNK(st.st_mode)

    # -- remove (link only, never the target) ------------------------------
    def remove_link(self, path: Path | str) -> None:
        path = Path(path)
        if not self.is_junction(path) and not path.is_symlink():
            return
        if self.is_windows():
            # os.rmdir on a junction removes the reparse point itself, not the
            # target directory.
            os.rmdir(path)
        else:
            os.unlink(path)

"""Non-blocking OS locks released automatically when a process exits."""

from __future__ import annotations

import os
import hashlib
import tempfile
from pathlib import Path
from typing import BinaryIO

from .errors import BusyError
from .paths import reject_link_ancestors


def workspace_lock_path(workspace: Path) -> Path:
    """Use one lock per canonical workspace even if callers choose different stores."""
    directory = Path(tempfile.gettempdir()) / "agent-checkpoint-locks"
    reject_link_ancestors(directory)
    directory.mkdir(exist_ok=True)
    key = hashlib.sha256(os.fsencode(os.path.normcase(str(workspace.resolve())))).hexdigest()
    path = directory / f"{key}.lock"
    reject_link_ancestors(path)
    return path


class MutationLock:
    def __init__(self, path: Path):
        self.path = path
        self.handle: BinaryIO | None = None

    def acquire(self) -> None:
        if self.handle is not None:
            raise BusyError("Mutation lock is already held")
        reject_link_ancestors(self.path)
        handle = self.path.open("a+b")
        try:
            if self.path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            handle.close()
            raise BusyError("Another process holds the workspace mutation lock") from exc
        self.handle = handle

    def release(self) -> None:
        if self.handle is None:
            return
        handle, self.handle = self.handle, None
        try:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()

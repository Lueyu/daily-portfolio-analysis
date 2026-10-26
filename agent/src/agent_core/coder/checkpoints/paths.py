"""Portable path validation; these checks do not constitute an OS sandbox."""

from __future__ import annotations

import os
import re
import stat
import unicodedata
from pathlib import Path, PurePosixPath
from typing import Iterable

from .errors import UnsafePathError

# Named dependency/cache roots are excluded at any directory depth. No gitignore
# rules are consulted. Additional artifact roots are explicit relative paths.
EXCLUDED_NAMES = frozenset({
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".cache", ".next", ".tox", ".nox",
})
DEFAULT_EXCLUDED_ROOTS = ("dist", "build", "coverage", "artifacts", ".agent-artifacts")
_RESERVED = re.compile(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$", re.I)


def portable_path(value: str) -> tuple[str, ...]:
    if not isinstance(value, str) or not value:
        raise UnsafePathError(f"Invalid checkpoint path: {value!r}")
    parts = value.split("/")
    if PurePosixPath(value).is_absolute() or any(
        part in {"", ".", ".."}
        or part.endswith((".", " "))
        or _RESERVED.fullmatch(part)
        or any(ord(char) < 32 or char in '\\:*?"<>|' for char in part)
        for part in parts
    ):
        raise UnsafePathError(f"Unsafe checkpoint path: {value!r}")
    return tuple(parts)


def validate_paths(paths: Iterable[str]) -> None:
    observed: dict[str, str] = {}
    files = set(paths)
    for name in sorted(files):
        parts = portable_path(name)
        for index in range(1, len(parts) + 1):
            prefix = "/".join(parts[:index])
            key = unicodedata.normalize("NFC", prefix).casefold()
            previous = observed.setdefault(key, prefix)
            if previous != prefix:
                raise UnsafePathError(f"Cross-platform case collision: {previous!r}, {prefix!r}")
            if index < len(parts) and prefix in files:
                raise UnsafePathError(f"File/directory collision: {prefix!r}")


def reject_link(path: Path) -> None:
    info = path.lstat()
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & reparse:
        raise UnsafePathError(f"Symlink/junction/reparse point is not managed: {path}")


def reject_link_ancestors(path: Path) -> None:
    for candidate in [*reversed(path.parents), path]:
        if os.path.lexists(candidate):
            reject_link(candidate)


def validate_runtime_tree(workspace: Path) -> None:
    """One source policy for initial mounts and post-command settlement."""
    reject_link_ancestors(workspace)
    for directory, folders, files in os.walk(workspace, followlinks=False):
        for name in folders + files:
            reject_link(Path(directory) / name)
            if name.casefold() == ".git":
                raise UnsafePathError("Task workspace must not contain .git metadata")
        folders[:] = [name for name in folders if name.casefold() not in EXCLUDED_NAMES]


class WorkspacePaths:
    def __init__(self, workspace: Path, excluded_roots: Iterable[str]):
        self.workspace = workspace
        self.excluded_roots = tuple(sorted(set(excluded_roots)))
        for value in self.excluded_roots:
            portable_path(value)

    def excluded(self, name: str) -> bool:
        return any(part.casefold() in EXCLUDED_NAMES for part in name.split("/")) or any(
            name.casefold() == root.casefold()
            or name.casefold().startswith(root.casefold() + "/")
            for root in self.excluded_roots
        )

    def target(self, name: str) -> Path:
        portable_path(name)
        self.reject_secret(name)
        if self.excluded(name):
            raise UnsafePathError(f"Checkpoint references excluded root: {name}")
        target = self.workspace.joinpath(*name.split("/"))
        reject_link_ancestors(target)
        if not target.resolve().is_relative_to(self.workspace):
            raise UnsafePathError(f"Checkpoint path escapes workspace: {name}")
        return target

    @staticmethod
    def reject_secret(name: str) -> None:
        if any(part.casefold() == ".env" or part.casefold().startswith(".env.")
               for part in name.split("/")):
            raise UnsafePathError(f"Secret environment file is not managed: {name}")

    def files(self) -> dict[str, Path]:
        reject_link_ancestors(self.workspace)
        found: dict[str, Path] = {}
        visited: list[str] = []
        for directory, dirs, files in os.walk(self.workspace, followlinks=False):
            current = Path(directory)
            for name in list(dirs) + files:
                path = current / name
                reject_link(path)
                relative = path.relative_to(self.workspace).as_posix()
                if self.excluded(relative):
                    if name in dirs:
                        dirs.remove(name)
                    continue
                portable_path(relative)
                self.reject_secret(relative)
                visited.append(relative)
                if name in files:
                    if not stat.S_ISREG(path.lstat().st_mode):
                        raise UnsafePathError(f"Special file is not managed: {relative}")
                    found[relative] = path
        # Include directory names in collision detection without treating them as files.
        case_names: dict[str, str] = {}
        for name in visited:
            key = unicodedata.normalize("NFC", name).casefold()
            prior = case_names.setdefault(key, name)
            if prior != name:
                raise UnsafePathError(f"Cross-platform case collision: {prior!r}, {name!r}")
        validate_paths(found)
        return found

"""Content-addressed manifests and raw-byte blobs with strict read verification."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path
from typing import Any

from .errors import ConflictError, IntegrityError
from .paths import WorkspacePaths, reject_link, reject_link_ancestors, validate_paths

Manifest = dict[str, dict[str, Any]]
_HASH = re.compile(r"^[0-9a-f]{64}$")


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    reject_link_ancestors(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".checkpoint-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            descriptor = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


class SnapshotObjects:
    def __init__(self, root: Path, paths: WorkspacePaths):
        self.root = root
        self.paths = paths
        for directory in [root / "blobs", root / "manifests"]:
            reject_link_ancestors(directory)
            directory.mkdir(exist_ok=True)

    def blob(self, sha256: str) -> bytes:
        if not isinstance(sha256, str) or not _HASH.fullmatch(sha256):
            raise IntegrityError("Invalid blob digest")
        path = self.root / "blobs" / sha256
        try:
            reject_link_ancestors(path)
            data = path.read_bytes()
        except OSError as exc:
            raise IntegrityError(f"Missing/unreadable blob: {sha256}") from exc
        if digest(data) != sha256:
            raise IntegrityError(f"Corrupt blob: {sha256}")
        return data

    def save_manifest(self, files: Manifest) -> str:
        validate_paths(files)
        data = canonical({"version": 1, "files": files})
        revision = digest(data)
        path = self.root / "manifests" / f"{revision}.json"
        reject_link_ancestors(path)
        if path.exists():
            if path.read_bytes() != data:
                raise IntegrityError(f"Corrupt manifest: {revision}")
        else:
            atomic_write(path, data)
        return revision

    def load(self, revision: str, *, verify_blobs: bool = True) -> Manifest:
        if not isinstance(revision, str) or not _HASH.fullmatch(revision):
            raise IntegrityError("Invalid snapshot revision")
        path = self.root / "manifests" / f"{revision}.json"
        try:
            reject_link_ancestors(path)
            data = path.read_bytes()
            payload = json.loads(data)
        except (OSError, ValueError) as exc:
            raise IntegrityError(f"Missing/malformed manifest: {revision}") from exc
        if digest(data) != revision or not isinstance(payload, dict):
            raise IntegrityError(f"Corrupt manifest: {revision}")
        files = payload.get("files")
        if payload.get("version") != 1 or not isinstance(files, dict):
            raise IntegrityError(f"Invalid manifest schema: {revision}")
        validate_paths(files)
        for name, entry in files.items():
            self.paths.target(name)
            if (not isinstance(entry, dict) or set(entry) != {"sha256", "mode"}
                    or not isinstance(entry["mode"], int) or not 0 <= entry["mode"] <= 0o777):
                raise IntegrityError(f"Invalid manifest entry: {name}")
            if not isinstance(entry["sha256"], str) or not _HASH.fullmatch(entry["sha256"]):
                raise IntegrityError(f"Invalid blob digest: {name}")
            if verify_blobs:
                self.blob(entry["sha256"])
        return files

    def capture(self) -> str:
        files: Manifest = {}
        for name, path in sorted(self.paths.files().items()):
            before = path.stat()
            data = path.read_bytes()
            after = path.stat()
            if (before.st_mtime_ns, before.st_size, before.st_ino) != (
                after.st_mtime_ns, after.st_size, after.st_ino
            ):
                raise ConflictError(f"File changed while snapshotting: {name}")
            sha256 = digest(data)
            blob = self.root / "blobs" / sha256
            if blob.exists():
                self.blob(sha256)
            else:
                atomic_write(blob, data)
            files[name] = {"sha256": sha256, "mode": stat.S_IMODE(after.st_mode) & 0o777}
        return self.save_manifest(files)

    def apply(self, current: Manifest, desired: Manifest) -> None:
        # The caller has validated every desired blob before journaling/mutating.
        removed = sorted(set(current) - set(desired), key=lambda name: (-name.count("/"), name))
        for name in removed:
            target = self.paths.target(name)
            target.unlink()
            parent = target.parent
            while parent != self.paths.workspace:
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent
        for name, entry in sorted(desired.items()):
            if current.get(name) == entry:
                continue
            target = self.paths.target(name)
            if target.is_dir():
                self._remove_empty_directories(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(target, self.blob(entry["sha256"]))
            os.chmod(target, entry["mode"])

    def preflight(self, current: Manifest, desired: Manifest) -> None:
        """Reject excluded or unmanaged obstructions before the first write."""
        for name in desired:
            target = self.paths.target(name)
            if not target.is_dir():
                continue
            for directory, dirs, files in os.walk(target, followlinks=False):
                for child in dirs + files:
                    path = Path(directory) / child
                    reject_link(path)
                    relative = path.relative_to(self.paths.workspace).as_posix()
                    if self.paths.excluded(relative) or (
                        child in files and (relative not in current or relative in desired)
                    ):
                        raise ConflictError(f"Restore would overwrite unmanaged path: {relative}")

    @staticmethod
    def _remove_empty_directories(target: Path) -> None:
        # Only rmdir is used: unexpected files cause failure, never recursive deletion.
        for directory, _, _ in os.walk(target, topdown=False, followlinks=False):
            path = Path(directory)
            reject_link(path)
            path.rmdir()

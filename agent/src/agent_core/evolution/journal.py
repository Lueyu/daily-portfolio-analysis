"""Local immutable decision exports, not an authenticated business database.

One file per UUID avoids same-day upserts. No-overwrite publication uses a hard
link on the same filesystem: readers never see partially written JSON. A disk
without hard-link support fails explicitly. Users can still alter local files;
content hashes are identifiers, not signatures or proof of provenance.
"""

import hashlib
import json
import os
import tempfile
from pathlib import Path
from uuid import UUID

from .contracts import DecisionRecord


def canonical_bytes(record: DecisionRecord) -> bytes:
    # Revalidate even if a library caller used model_construct/model_copy.
    record = DecisionRecord.model_validate(record.model_dump(mode="json"))
    return (json.dumps(record.model_dump(mode="json"), ensure_ascii=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def decision_digest(record: DecisionRecord) -> str:
    return hashlib.sha256(canonical_bytes(record)).hexdigest()


class DecisionJournal:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def _path(self, decision_id: UUID | str) -> Path:
        return self.root / f"{UUID(str(decision_id))}.json"

    def save(self, record: DecisionRecord) -> Path:
        content = canonical_bytes(record)
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._path(record.decision_id)
        fd, name = tempfile.mkstemp(prefix=".decision-", suffix=".tmp", dir=self.root)
        temporary = Path(name)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                if target.is_symlink() or target.read_bytes() != content:
                    raise ValueError("decision id conflict; existing snapshot was not overwritten") from None
            return target
        finally:
            temporary.unlink(missing_ok=True)

    def load(self, decision_id: UUID | str) -> DecisionRecord:
        target = self._path(decision_id)
        if target.is_symlink():
            raise ValueError("journal record must not be a symbolic link")
        record = DecisionRecord.model_validate_json(target.read_bytes())
        if record.decision_id != UUID(str(decision_id)):
            raise ValueError("decision id conflicts with journal filename")
        return record

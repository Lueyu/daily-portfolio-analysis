"""Control-plane inbox and single-use external-action approvals.

These files live outside the editable workspace. Separate immutable records
let an HTTP writer and the active model loop cooperate without lost updates.
An approval is consumed before sending the external request: after a crash its
outcome is uncertain and it must not be silently replayed.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .checkpoints import BusyError
from .checkpoints.locking import MutationLock
from .task_store import TaskStore


class SessionControl:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.inbox = self.root / 'inbox'
        self.approvals = self.root / 'approvals'
        self.inbox.mkdir(parents=True, exist_ok=True)
        self.approvals.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _now():
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _fingerprint(arguments):
        raw = json.dumps(arguments, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
        if len(raw.encode()) > 65536:
            raise ValueError('approval arguments exceed 64 KiB')
        return hashlib.sha256(raw.encode()).hexdigest()

    def _path(self, request_id, suffix='.json'):
        if not re.fullmatch(r'[a-f0-9]{32}', request_id):
            raise ValueError('invalid approval id')
        return self.approvals / (request_id + suffix)

    def send(self, text: str):
        if not isinstance(text, str) or not text.strip() or len(text) > 20000:
            raise ValueError('message must contain 1–20000 characters')
        row = {'id': uuid.uuid4().hex, 'text': text.strip(), 'createdAt': self._now()}
        TaskStore._atomic_write(self.inbox / (row['id'] + '.json'), json.dumps(row, ensure_ascii=False))
        return row

    def messages(self, acknowledged=()):
        seen = set(acknowledged)
        rows = [json.loads(p.read_text(encoding='utf-8')) for p in self.inbox.glob('*.json')
                if p.stem not in seen]
        return sorted(rows, key=lambda row: (row['createdAt'], row['id']))

    def request_approval(self, arguments: dict, summary: str):
        fingerprint = self._fingerprint(arguments)
        request_id = fingerprint[:32]
        path = self._path(request_id)
        if not path.exists():
            row = {'id': request_id, 'fingerprint': fingerprint, 'arguments': arguments,
                   'summary': summary[:2000], 'createdAt': self._now()}
            TaskStore._atomic_write(path, json.dumps(row, ensure_ascii=False))
        return self._approval(request_id)

    def _approval(self, request_id):
        path = self._path(request_id)
        if not path.is_file():
            raise ValueError('unknown approval')
        row = json.loads(path.read_text(encoding='utf-8'))
        decision = self._path(request_id, '.decision.json')
        row['status'] = 'pending'
        if decision.is_file():
            row['status'] = json.loads(decision.read_text(encoding='utf-8'))['status']
        if self._path(request_id, '.consumed').exists():
            row['status'] = 'consumed'
        return row

    def list_approvals(self):
        return sorted([self._approval(p.stem) for p in self.approvals.glob('*.json')
                       if re.fullmatch(r'[a-f0-9]{32}', p.stem)], key=lambda row: row['createdAt'])

    def decide(self, request_id: str, approve: bool):
        self._approval(request_id)
        decision = self._path(request_id, '.decision.json')
        # The OS releases ownership on process exit. A leftover lock file must
        # not permanently prevent retrying an unpublished human decision.
        lock = MutationLock(self._path(request_id, '.decision.lock'))
        try:
            lock.acquire()
        except BusyError as exc:
            raise ValueError('approval decision is in progress') from exc
        try:
            # Another writer may have published between the first read and
            # acquisition; only the current lock owner can decide a pending row.
            if self._approval(request_id)['status'] != 'pending':
                raise ValueError('approval already decided or consumed')
            TaskStore._atomic_write(decision, json.dumps({
                'status': 'approved' if approve else 'denied', 'decidedAt': self._now()}))
            return self._approval(request_id)
        finally:
            lock.release()

    def authorize(self, arguments: dict):
        fingerprint = self._fingerprint(arguments)
        request_id = fingerprint[:32]
        if not self._path(request_id).exists():
            return 'missing'
        row = self._approval(request_id)
        if row['fingerprint'] != fingerprint:
            raise ValueError('approval fingerprint mismatch')
        if row['status'] != 'approved':
            return row['status']
        try:
            with self._path(request_id, '.consumed').open('x', encoding='utf-8') as stream:
                stream.write(self._now())
                stream.flush()
                os.fsync(stream.fileno())
        except FileExistsError:
            return 'consumed'
        return 'approved'

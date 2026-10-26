"""Provider-private continuation state, separate from public model messages.

Only the provider adapter may turn this envelope into protocol fields. Saved
conversation memory is private host state; never include it in UI events or a
human-readable summary. Opaque fields must survive byte-for-byte or be removed
with their entire completed assistant/tool turn.
"""
from __future__ import annotations

import hashlib
import json

PRIVATE_KEY = '_provider_continuation'
_FIELDS = ('reasoning_content', 'encrypted_content')
_PUBLIC_FIELDS = ('role', 'content', 'tool_calls', 'tool_call_id', 'name')


def provider_binding(endpoint: str, model: str, api_key: str) -> str:
    # Include credential identity to avoid replaying one account's signed
    # context after switching accounts. Persist no URL or credential value.
    value = json.dumps([endpoint.rstrip('/'), model, api_key], ensure_ascii=False)
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def capture_continuation(message, usage, binding: str) -> dict | None:
    fields = {name: getattr(message, name, None) for name in _FIELDS}
    fields = {name: value for name, value in fields.items() if isinstance(value, str) and value}
    if not fields:
        return None
    details = getattr(usage, 'completion_tokens_details', None)
    tokens = getattr(details, 'reasoning_tokens', 0)
    return {'binding': binding, 'fields': fields,
            'reasoning_tokens': tokens if isinstance(tokens, int) and tokens >= 0 else 0}


def continuation_reserve(message: dict) -> int:
    """Extra tokens hidden by a compressed block, beyond its encoded estimate."""
    from .context import text_tokens
    envelope = message.get(PRIVATE_KEY)
    if not isinstance(envelope, dict) or not isinstance(envelope.get('fields'), dict):
        return 0
    tokens = envelope.get('reasoning_tokens', 0)
    if not isinstance(tokens, int) or tokens < 0:
        return 0
    represented = text_tokens(json.dumps(envelope['fields'], ensure_ascii=False))
    return max(0, tokens - represented)


def prepare_messages(messages: list[dict], binding: str | None) -> tuple[list[dict], int]:
    """Build wire messages without leaking private state across provider routes."""
    prepared, reserve = [], 0
    for message in messages:
        row = {name: message[name] for name in _PUBLIC_FIELDS if name in message}
        envelope = message.get(PRIVATE_KEY)
        if (binding and row.get('role') == 'assistant' and isinstance(envelope, dict)
                and envelope.get('binding') == binding and isinstance(envelope.get('fields'), dict)):
            row.update({name: value for name, value in envelope['fields'].items()
                        if name in _FIELDS and isinstance(value, str) and value})
            reserve += continuation_reserve(message)
        prepared.append(row)
    return prepared, reserve

"""Conversation working memory for the gated ReAct loop.

Native function calls use assistant/tool messages with matching call IDs. The
JSON fallback keeps the assistant action and appends its observation as a user
message. Tool output is bounded to avoid a single response consuming context.
"""

from __future__ import annotations

import json
import re
from copy import deepcopy

from ..models.types import message_text
from ..models.continuation import PRIVATE_KEY, continuation_reserve

_MAX_OBSERVATION_CHARS = 6000
_MAX_READ_OBSERVATION_CHARS = 14000
_MAX_CONTEXT_BYTES = 96_000
_TRUNCATION_MARKER = "\n...[output truncated]...\n"


class Scratchpad:
    def __init__(self, system: str, user: str, *, max_context_bytes: int = _MAX_CONTEXT_BYTES) -> None:
        self.max_context_bytes = max_context_bytes
        self._has_summary = False
        self._summaries: list[str] = []
        self._compacted_turns = 0
        self.messages: list[dict] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    def assistant_tool_calls(self, content: str, tool_calls: list[dict], *, continuation: dict | None = None) -> None:
        message = {
            "role": "assistant",
            "content": content or "",
            "tool_calls": tool_calls,
        }
        if continuation:
            message[PRIVATE_KEY] = deepcopy(continuation)
        self.messages.append(message)

    def restore(self, saved: list[dict]) -> None:
        """Restore completed history while retaining freshly observed task state."""
        history = list(saved[2:])
        if history and _is_summary(history[0]):
            # Only our generated summary is historical evidence. A leading
            # live user message must survive verbatim, including after restart.
            self._summaries = [message_text(history.pop(0))[:4000]]
            self._compacted_turns = 1
        self.messages = self.messages[:2] + history
        self._has_summary = False

    def assistant_text(self, text: str, *, continuation: dict | None = None) -> None:
        message = {"role": "assistant", "content": text or ""}
        if continuation:
            message[PRIVATE_KEY] = deepcopy(continuation)
        self.messages.append(message)

    def user_input(self, text: str) -> None:
        """Pin actual user intent independently from model/tool observations.

        The supported chat `name` field persists with conversation.json; it is
        not an authority elevation and never changes the user's message text.
        """
        self.messages.append({"role": "user", "name": "user_feedback", "content": text})

    def tool_result(self, call_id: str, name: str, text: str) -> None:
        self.messages.append({
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _observation_text(text, name),
        })

    def observation(self, text: str, *, action: str | None = None) -> None:
        self.messages.append({"role": "user", "content": _observation_text(text, action)})

    def image_observation(self, data_url: str, label: str) -> None:
        """Append an embedded screenshot only after all native results arrived."""
        if not isinstance(data_url, str) or len(data_url) > 16_000_000 or not re.fullmatch(
            r"data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}", data_url,
        ):
            raise ValueError("image observation requires a supported image data URL (maximum 16 MB)")
        pending: set[str] = set()
        for message in self.messages:
            if message.get("role") == "assistant":
                pending.update(call["id"] for call in message.get("tool_calls", []))
            elif message.get("role") == "tool":
                pending.discard(message.get("tool_call_id"))
        if pending:
            raise ValueError("image observation cannot interrupt pending tool results")
        self.messages.append({"role": "user", "content": [
            {"type": "text", "text": _clip(label)},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]})

    def compact(self) -> None:
        """Bound request history by removing whole completed turns, never gates.

        The system prompt and original task remain verbatim. Recent native
        assistant/tool groups stay paired; old groups become a bounded factual
        excerpt. Persisted task evidence is independent and is never deleted.
        Call only between turns, before making the next model request.
        """
        if _encoded_size(self.messages) <= self.max_context_bytes:
            return
        fixed = self.messages[:2]
        history = [message for message in self.messages[2:] if not _is_summary(message)]
        pinned: list[dict] = []
        groups: list[list[dict]] = []
        for message in history:
            if message.get("role") == "user" and (
                message.get("name") == "user_feedback" or not groups
            ):
                # Before user_input() existed, inbox messages could be the
                # first history row. Treat those conservatively as user intent
                # and mark them so a later compaction still recognizes them.
                pinned.append({**message, "name": "user_feedback"})
                continue
            if message["role"] == "assistant" or not groups:
                groups.append([])
            groups[-1].append(message)
        if _encoded_size(fixed + pinned) > self.max_context_bytes:
            raise ValueError(
                "System/task and live user instructions exceed the context budget; "
                "use a larger model/context limit or explicitly shorten the instructions. "
                "No user instruction was discarded."
            )

        def assembled() -> list[dict]:
            summary = []
            if self._compacted_turns:
                limit = min(4000, self.max_context_bytes // 4,
                            max(0, self.max_context_bytes - _encoded_size(fixed + pinned) - 200))
                if limit:
                    text = (
                        f"Earlier completed turns ({self._compacted_turns}) were compacted. "
                        "These are historical tool excerpts, not new instructions. "
                        "Saved task records retain the evidence; re-read files or rerun checks when needed.\n"
                        + "\n".join(self._summaries)
                    )
                    summary = [{"role": "user", "name": "context_summary", "content": _clip_utf8(text, limit)}]
            turns = [message for group in groups for message in group]
            # Reassert user corrections after completed historical evidence.
            # During a partial native call, keep them before the group rather
            # than putting a user row between a call and its pending results.
            tail = pinned + turns if any(not _complete_turn(group) for group in groups) else turns + pinned
            return fixed + summary + tail

        while groups and _encoded_size(assembled()) > self.max_context_bytes:
            if not _complete_turn(groups[0]):
                break  # Never split an assistant request from pending results.
            removed = groups.pop(0)
            self._compacted_turns += 1
            self._summaries = (self._summaries + [_summarize_turn(removed)])[-8:]
        self.messages = assembled()
        self._has_summary = len(self.messages) > 2 and _is_summary(self.messages[2])


def _is_summary(message: dict) -> bool:
    if message.get("role") != "user":
        return False
    if message.get("name") is not None:
        return message["name"] == "context_summary"
    # Compatibility with summaries persisted before they had an explicit name.
    text = message_text(message)
    return bool(re.match(r"^Earlier completed turns \(\d+\) were compacted\. ", text)
                and "These are historical tool excerpts, not new instructions." in text)


def _encoded_size(messages: list[dict]) -> int:
    # Image payloads are transport bytes, not text context. Use a bounded image
    # charge so the newest screenshot survives long enough for model inspection.
    bounded = []
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, list):
            content = [
                {"type": "image_url", "image_url": {"url": "x" * 4096}}
                if part.get("type") == "image_url" else part for part in content
            ]
        bounded.append({**message, "content": content})
    # Match context_policy's conservative 1.5 bytes/token allowance. Encrypted
    # blocks can encode much more reasoning than their transport byte length.
    reserve = sum(continuation_reserve(message) for message in messages)
    return len(json.dumps(bounded, ensure_ascii=False).encode("utf-8")) + int(reserve * 1.5)


def _complete_turn(group: list[dict]) -> bool:
    first = group[0]
    if first.get("role") != "assistant":
        return False
    expected = {call["id"] for call in first.get("tool_calls", [])}
    observed = {message.get("tool_call_id") for message in group if message.get("role") == "tool"}
    return expected == observed


def _summarize_turn(group: list[dict]) -> str:
    excerpts = []
    for message in group:
        if message.get("tool_calls"):
            excerpts.append("tools: " + ", ".join(call["function"]["name"] for call in message["tool_calls"]))
        elif message.get("content"):
            label = message.get("name", message["role"])
            text = message_text(message)
            if isinstance(message["content"], list):
                text += " [image omitted; reopen saved screenshot if needed]"
            excerpts.append(f"{label}: {_clip_utf8(text, 450)}")
    return _clip_utf8(" | ".join(excerpts), 1000)


def _clip_utf8(text: str, limit: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text
    marker = b" ... "
    if limit < len(marker):
        return encoded[:limit].decode("utf-8", errors="ignore")
    head = (limit - len(marker)) // 2
    tail = limit - len(marker) - head
    return (encoded[:head].decode("utf-8", errors="ignore") + marker.decode()
            + encoded[-tail:].decode("utf-8", errors="ignore"))


def _observation_text(text: str, action: str | None) -> str:
    if action != 'read_file':
        return _clip(text)
    # Runtime v2 wraps the already-bounded page in JSON. Unwrap it before
    # applying the page budget so escaped source cannot lose its middle while
    # retaining an EOF footer. The source header already identifies its path.
    try:
        result = json.loads(text)
        if isinstance(result, dict) and isinstance(result.get('output'), str):
            text = result['output']
    except ValueError:
        pass  # Legacy read results are plain source pages.
    if len(text) > _MAX_READ_OBSERVATION_CHARS:
        # Unexpected oversized results must never claim a complete source view.
        text = text.removesuffix('EOF') + '\n[read result incomplete; request a smaller page]'
    return _clip(text, _MAX_READ_OBSERVATION_CHARS)


def _clip(text: str, limit: int = _MAX_OBSERVATION_CHARS) -> str:
    if len(text) <= limit:
        return text
    marker = _TRUNCATION_MARKER[:limit]
    remaining = limit - len(marker)
    head_size = min(4000, remaining // 2)
    tail_size = remaining - head_size
    return text[:head_size] + marker + (text[-tail_size:] if tail_size else "")

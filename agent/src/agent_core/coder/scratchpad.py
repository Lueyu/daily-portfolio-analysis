"""Conversation working memory for the gated ReAct loop.

Native function calls use assistant/tool messages with matching call IDs. The
JSON fallback keeps the assistant action and appends its observation as a user
message. Tool output is bounded to avoid a single response consuming context.
"""

from __future__ import annotations

_MAX_OBSERVATION_CHARS = 6000
_TRUNCATION_MARKER = "\n...[output truncated]...\n"


class Scratchpad:
    def __init__(self, system: str, user: str) -> None:
        self.messages: list[dict] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

    def assistant_tool_calls(self, content: str, tool_calls: list[dict]) -> None:
        self.messages.append({
            "role": "assistant",
            "content": content or "",
            "tool_calls": tool_calls,
        })

    def assistant_text(self, text: str) -> None:
        self.messages.append({"role": "assistant", "content": text or ""})

    def tool_result(self, call_id: str, name: str, text: str) -> None:
        self.messages.append({
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": _clip(text),
        })

    def observation(self, text: str) -> None:
        self.messages.append({"role": "user", "content": _clip(text)})


def _clip(text: str, limit: int = _MAX_OBSERVATION_CHARS) -> str:
    if len(text) <= limit:
        return text
    marker = _TRUNCATION_MARKER[:limit]
    remaining = limit - len(marker)
    head_size = min(4000, remaining // 2)
    tail_size = remaining - head_size
    return text[:head_size] + marker + (text[-tail_size:] if tail_size else "")

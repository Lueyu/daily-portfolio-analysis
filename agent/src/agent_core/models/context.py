"""Conservative context estimates; exact vendor usage remains authoritative."""

from __future__ import annotations

import json
import math


def text_tokens(text: str) -> int:
    # Code/JSON usually tokenizes near 3-4 ASCII characters/token; Unicode
    # varies much more. Budget two tokens/non-ASCII character, then overhead.
    ascii_chars = sum(ord(char) < 128 for char in text)
    return math.ceil(ascii_chars / 3 + (len(text) - ascii_chars) * 2) + 16


def request_tokens(messages: list[dict], tools: list[dict] | None = None) -> int:
    from .continuation import continuation_reserve
    bounded, images = [], 0
    for message in messages:
        content = message.get("content", "")
        if isinstance(content, list):
            parts = []
            for part in content:
                if part.get("type") == "image_url":
                    images += 1
                    parts.append({"type": "image_url", "image_url": {"url": "[image]"}})
                else:
                    parts.append(part)
            content = parts
        bounded.append({**message, "content": content})
    return (text_tokens(json.dumps(bounded, ensure_ascii=False)) + images * 4096
            + sum(continuation_reserve(message) for message in messages)
            + (text_tokens(json.dumps(tools, ensure_ascii=False)) if tools else 0))

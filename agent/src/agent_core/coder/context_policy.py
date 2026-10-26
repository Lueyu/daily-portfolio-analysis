"""Size conversation memory against the selected coding model's actual profile."""

from __future__ import annotations

import json

from ..models import ModelTask
from ..models.context import text_tokens
from .tool_schema import openai_tools_payload


def effective_context_bytes(settings, chat, registry, system: str, task: str) -> int:
    requested = getattr(settings, "coder_context_bytes", 192000)
    spec_for_task = getattr(chat, "spec_for_task", None)
    if not callable(spec_for_task):
        return requested  # Tests/legacy injected adapters do not declare a model.
    spec = spec_for_task(ModelTask.CODE)
    window = spec.context_window
    schemas = openai_tools_payload([registry.get(name) for name in registry.names()])
    schema_tokens = text_tokens(json.dumps(schemas, ensure_ascii=False))
    # context_brief is appended after Scratchpad compaction. Reserve space for
    # it, model output and protocol overhead rather than counting history alone.
    state_reserve = min(12000, max(2048, window // 8))
    safety = max(1024, window // 20)
    available = window - schema_tokens - spec.max_output_tokens - state_reserve - safety
    # 1.5 UTF-8 bytes/token is conservative for mixed source/Chinese prompts.
    size = min(requested, max(0, int(available * 1.5)))
    minimum = len((system + task).encode("utf-8")) + 8192
    if size < minimum:
        raise ValueError(
            f"Coding model context window ({window} tokens) cannot fit tools, system/task context, "
            f"and {spec.max_output_tokens} output tokens. Configure a larger CODER_CONTEXT_WINDOW/model "
            "or reduce the task and CODER_MAX_OUTPUT_TOKENS."
        )
    return size

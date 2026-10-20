"""Model abstraction layer (M1).

Public surface:
    from agent_core.models import ChatService, ChatRequest, ChatResponse, ModelTask

    svc = ChatService(get_settings())
    resp = svc.chat(ChatRequest(task=ModelTask.RATING, messages=[...]))
"""

from .openai_compatible import (
    OpenAICompatibleProvider,
    build_provider,
    is_transient_error,
)
from .router import ChatService, chat
from .specs import build_specs
from .types import (
    ChatChunk,
    ChatRequest,
    ChatResponse,
    ModelSpec,
    ModelTask,
    ModelTier,
    PingResult,
    TASK_TIER,
    Usage,
    estimate_prompt_tokens,
    parse_json,
)

__all__ = [
    "ChatService",
    "chat",
    "ChatRequest",
    "ChatResponse",
    "ChatChunk",
    "ModelSpec",
    "ModelTask",
    "ModelTier",
    "TASK_TIER",
    "Usage",
    "PingResult",
    "OpenAICompatibleProvider",
    "build_provider",
    "build_specs",
    "is_transient_error",
    "parse_json",
    "estimate_prompt_tokens",
]

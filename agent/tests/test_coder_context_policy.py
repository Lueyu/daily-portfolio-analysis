import pytest

from agent_core.config import Settings
from agent_core.models import ChatRequest, ChatService, ModelTask
from agent_core.coder.general_tools import build_general_registry


def test_declared_model_window_limits_history_including_schema_and_output():
    from agent_core.coder.context_policy import effective_context_bytes
    settings = Settings(_env_file=None, coder_model="small", coder_context_window=64000,
                        coder_max_output_tokens=4096)
    chat = ChatService(settings)
    size = effective_context_bytes(settings, chat, build_general_registry(), "system", "fix a bug")
    assert 16000 <= size < settings.coder_context_bytes
    assert size < 64000 * 2


def test_tiny_model_fails_before_attempting_any_provider_call():
    from agent_core.coder.context_policy import effective_context_bytes
    settings = Settings(_env_file=None, coder_model="tiny", coder_context_window=4096,
                        coder_max_output_tokens=512)
    with pytest.raises(ValueError, match="context window.*tools"):
        effective_context_bytes(settings, ChatService(settings), build_general_registry(), "system", "fix")


def test_coder_request_reserves_declared_output_and_rejects_oversized_prompt():
    settings = Settings(_env_file=None, coder_model="small", coder_api_key="test-key",
                        coder_context_window=64000, coder_max_output_tokens=4096)
    provider = ChatService(settings).provider_for("coder")
    request = ChatRequest(task=ModelTask.CODE, messages=[{"role": "user", "content": "fix"}])
    assert provider._build_kwargs(request)["max_tokens"] == 4096
    request.messages[0]["content"] = "超长上下文" * 30000
    with pytest.raises(ValueError, match="context window"):
        provider._build_kwargs(request)

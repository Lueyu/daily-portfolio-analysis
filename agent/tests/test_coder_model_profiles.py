import pytest

from agent_core.config import Settings
from agent_core.models import ChatRequest, ChatResponse, ChatService, ModelTask
from agent_core.models.types import Usage


def settings(**kwargs):
    return Settings(_env_file=None, pro_api_key="test-pro", flash_api_key="test-flash", **kwargs)


def test_coder_defaults_to_pro_without_silent_fallback(monkeypatch):
    service = ChatService(settings(), sleep=lambda _: None)
    request = ChatRequest(task=ModelTask.CODE, messages=[{"role": "user", "content": "fix"}])
    assert service.resolve_tier(request) == "pro"
    calls = []
    def fail(tier, req):
        calls.append(tier)
        raise RuntimeError("provider unavailable")
    monkeypatch.setattr(service, "_call", fail)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        service.chat(request)
    assert calls == ["pro"]


def test_coder_custom_provider_is_independent(monkeypatch):
    monkeypatch.setenv("TEST_CODER_KEY", "custom-key")
    service = ChatService(settings(
        coder_model="custom-coder", coder_base_url="https://models.example/v1",
        coder_api_key_env="TEST_CODER_KEY", coder_context_window=64000,
    ))
    request = ChatRequest(task=ModelTask.CODE, messages=[])
    assert service.resolve_tier(request) == "coder"
    provider = service.provider_for("coder")
    assert provider.model == "custom-coder"
    assert str(provider._client.base_url) == "https://models.example/v1/"
    assert provider._client.api_key == "custom-key"
    assert service.spec_for_task(ModelTask.CODE).context_window == 64000


def test_coder_fallback_requires_explicit_opt_in_and_reports_degradation(monkeypatch):
    service = ChatService(settings(coder_allow_fallback=True))
    def call(tier, request):
        if tier == "pro":
            raise RuntimeError("upstream down")
        return ChatResponse(content="fallback", model="flash", tier=tier, usage=Usage(), latency_ms=0)
    monkeypatch.setattr(service, "_call", call)
    result = service.chat(ChatRequest(task=ModelTask.CODE, messages=[]))
    assert result.degraded and result.requested_tier == "pro"
    assert "upstream down" in result.degrade_reason


def test_started_coding_stream_is_not_replayed_on_fallback_model(monkeypatch):
    from agent_core.models.coding_stream import IncompleteCodeStream
    service = ChatService(settings(coder_allow_fallback=True))
    calls = []
    def call(tier, request):
        calls.append(tier)
        raise IncompleteCodeStream('stream interrupted')
    monkeypatch.setattr(service, '_call', call)
    with pytest.raises(IncompleteCodeStream):
        service.chat(ChatRequest(task=ModelTask.CODE, messages=[]))
    assert calls == ['pro']


def test_image_inspection_uses_real_image_and_vision_profile(tmp_path, monkeypatch):
    image = tmp_path / "shot.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\nimage-data")
    monkeypatch.setenv("TEST_VISION_KEY", "test-key")
    service = ChatService(settings(
        coder_vision_model="vision-model", coder_vision_base_url="https://vision.example/v1",
        coder_vision_api_key_env="TEST_VISION_KEY", coder_vision_supports_images=True,
    ))
    seen = []
    def call(tier, request):
        seen.append((tier, request))
        return ChatResponse(content="visible result", model="vision-model", tier=tier, usage=Usage(), latency_ms=0)
    monkeypatch.setattr(service, "_call", call)
    result = service.inspect_image(image, "Check contrast")
    assert result.content == "visible result"
    assert seen[0][0] == "vision"
    assert seen[0][1].messages[-1]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_text_model_cannot_claim_visual_inspection(tmp_path):
    image = tmp_path / "shot.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\nimage-data")
    with pytest.raises(ValueError, match="image-capable"):
        ChatService(settings()).inspect_image(image, "What is visible?")


def test_custom_endpoint_does_not_inherit_an_unrelated_provider_credential():
    service = ChatService(settings(coder_model="other", coder_base_url="https://other.example/v1"))
    assert not service.coding_capabilities()["primary"]["configured"]
    with pytest.raises(ValueError, match="missing API key"):
        service.provider_for("coder")


def test_capabilities_do_not_expose_credentials():
    service = ChatService(settings(coder_model="other", coder_base_url="https://other.example/v1",
                                   coder_api_key="secret-provider-key"))
    status = service.coding_capabilities()
    assert status["primary"]["configured"]
    assert "secret-provider-key" not in str(status)
    assert status["vision"]["configured"] is False


def test_custom_model_does_not_inherit_vision_claim_from_another_model():
    service = ChatService(settings(pro_supports_images=True, coder_model="text-model"))
    assert service.spec_for_task(ModelTask.CODE).supports_images is False


def test_coder_stream_fallback_handles_establishment_failure(monkeypatch):
    from agent_core.models import ChatChunk
    service = ChatService(settings(coder_allow_fallback=True))
    class Provider:
        def stream_chat(self, request):
            yield ChatChunk(tier="flash", model="flash", delta_content="ok")
    def provider_for(tier):
        if tier == "pro":
            raise ValueError("missing API key")
        return Provider()
    monkeypatch.setattr(service, "provider_for", provider_for)
    chunks = list(service.stream_chat(ChatRequest(task=ModelTask.CODE, messages=[])))
    assert chunks[0].degraded and chunks[0].requested_tier == "pro"
    assert chunks[-1].delta_content == "ok"


def test_provider_retry_limit_is_not_multiplied_by_sdk_retries(monkeypatch):
    import httpx
    import openai
    from agent_core.models import openai_compatible as module
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(503, json={"error": {"message": "temporary failure", "type": "server_error"}})
    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(module, "DefaultHttpxClient", lambda **kwargs: client)
    provider = module.OpenAICompatibleProvider("coder", "https://example.invalid/v1", "test", "test",
                                               max_attempts=2, sleep=lambda _: None)
    with pytest.raises(openai.InternalServerError):
        provider.chat(ChatRequest(messages=[{"role": "user", "content": "hi"}]))
    assert len(calls) == 2


@pytest.mark.parametrize('trust_env', [False, True])
@pytest.mark.parametrize('tier', ['flash', 'pro', 'coder', 'vision'])
def test_every_model_profile_uses_explicit_transport_policy(tier, trust_env):
    from agent_core.models.openai_compatible import build_provider
    configured = settings(model_trust_env=trust_env, coder_model='coder-model', coder_api_key='coder-key',
                          coder_vision_model='vision-model', coder_vision_api_key='vision-key')
    provider = build_provider(configured, tier)
    try:
        assert provider._client._client._trust_env is trust_env
    finally:
        provider._client.close()


def test_model_provider_uses_configurable_finite_request_timeout():
    from agent_core.models.openai_compatible import build_provider
    provider = build_provider(settings(model_request_timeout_seconds=145), 'pro')
    try:
        assert provider._client._client.timeout.read == 145
    finally:
        provider._client.close()

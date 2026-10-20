"""M1 tests: chat parsing, retries, fallback, cost, routing, JSON parsing.

All offline: the OpenAI SDK client is replaced with a programmable fake; no
real network. Sleep is injected as a no-op so retry tests run instantly.
"""

from types import SimpleNamespace

import httpx
import openai
import pytest

from agent_core.models import ChatRequest, ChatService, ModelSpec, ModelTask
from agent_core.models.openai_compatible import (
    OpenAICompatibleProvider,
    is_transient_error,
)
from agent_core.models.types import estimate_prompt_tokens, parse_json


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _Usage:
    def __init__(self, p: int = 10, c: int = 4) -> None:
        self.prompt_tokens = p
        self.completion_tokens = c


class _Message:
    def __init__(self, content: str = "hello", reasoning: str = "") -> None:
        self.content = content
        self.reasoning_content = reasoning


class _Choice:
    def __init__(self, content: str = "hello") -> None:
        self.message = _Message(content)
        self.finish_reason = "stop"


class _Response:
    def __init__(self, content: str = "hello", model: str = "fake-model") -> None:
        self.model = model
        self.usage = _Usage()
        self.choices = [_Choice(content)]


class _ScriptedCompletions:
    """Returns a queued response or raises a queued exception per call."""

    def __init__(self, *, responses=None, exceptions=None) -> None:
        self.responses = list(responses or [])
        self.exceptions = list(exceptions or [])
        self.calls = 0
        self.kwargs_list: list[dict] = []

    def create(self, **kwargs):
        i = self.calls
        self.calls += 1
        self.kwargs_list.append(kwargs)
        if i < len(self.exceptions) and self.exceptions[i] is not None:
            raise self.exceptions[i]
        if i < len(self.responses):
            return self.responses[i]
        return self.responses[-1]


class _ScriptedChat:
    def __init__(self, completions: _ScriptedCompletions) -> None:
        self.completions = completions


class _ScriptedOpenAI:
    def __init__(self, completions: _ScriptedCompletions) -> None:
        self.chat = _ScriptedChat(completions)


def _status_error(cls, status_code: int, retry_after: str | None = None):
    request = httpx.Request("POST", "http://ark/chat/completions")
    headers = {"retry-after": retry_after} if retry_after else {}
    response = httpx.Response(
        status_code, request=request, headers=headers, json={"error": {"message": "x"}}
    )
    return cls("boom", response=response, body={"error": {"message": "boom"}})


def _provider(
    *,
    completions: _ScriptedCompletions,
    tier: str = "flash",
    spec: ModelSpec | None = None,
    max_attempts: int = 3,
    sleeps: list[float] | None = None,
) -> OpenAICompatibleProvider:
    provider = OpenAICompatibleProvider(
        tier,
        "http://ark",
        "test-key",
        "fake-model",
        spec=spec or ModelSpec(tier=tier, model="fake-model", context_window=128_000),
        max_attempts=max_attempts,
        sleep=(lambda s: sleeps.append(s)) if sleeps is not None else (lambda s: None),
    )
    provider._client = _ScriptedOpenAI(completions)  # type: ignore[assignment]
    return provider


def _settings(**overrides) -> SimpleNamespace:
    base = dict(
        model_base_url="http://ark",
        default_tier="flash",
        flash_api_key="flash-key",
        flash_model="flash-model",
        pro_api_key="pro-key",
        pro_model="pro-model",
        flash_cost_per_mtok_input=0.0,
        flash_cost_per_mtok_output=0.0,
        pro_cost_per_mtok_input=0.0,
        pro_cost_per_mtok_output=0.0,
        max_retries=3,
        fallback_to_flash=True,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------


def test_transient_error_classification() -> None:
    assert is_transient_error(_status_error(openai.RateLimitError, 429))
    assert is_transient_error(_status_error(openai.InternalServerError, 503))
    assert is_transient_error(openai.APITimeoutError(httpx.Request("POST", "http://x")))
    assert not is_transient_error(_status_error(openai.BadRequestError, 400))
    assert not is_transient_error(_status_error(openai.AuthenticationError, 401))
    assert not is_transient_error(_status_error(openai.NotFoundError, 404))


# ---------------------------------------------------------------------------
# chat() parsing + cost
# ---------------------------------------------------------------------------


def test_chat_returns_normalised_response() -> None:
    p = _provider(completions=_ScriptedCompletions(responses=[_Response("world")]))
    resp = p.chat(ChatRequest(messages=[{"role": "user", "content": "hi"}]))
    assert resp.content == "world"
    assert resp.model == "fake-model"
    assert resp.tier == "flash"
    assert resp.usage.prompt_tokens == 10
    assert resp.usage.completion_tokens == 4
    assert resp.latency_ms >= 0
    assert resp.attempts == 1


def test_chat_cost_uses_spec_prices() -> None:
    spec = ModelSpec(
        tier="flash",
        model="fake-model",
        context_window=128_000,
        cost_per_mtok_input=0.5,
        cost_per_mtok_output=1.0,
    )
    p = _provider(
        completions=_ScriptedCompletions(responses=[_Response()]),
        spec=spec,
    )
    resp = p.chat(ChatRequest(messages=[{"role": "user", "content": "hi"}]))
    # 10 input * 0.5/M + 4 output * 1.0/M = 9e-6
    assert resp.usage.cost_usd == pytest.approx(9e-6, rel=1e-9)


# ---------------------------------------------------------------------------
# Retry / fail-fast
# ---------------------------------------------------------------------------


def test_chat_retries_on_429_then_succeeds() -> None:
    sleeps: list[float] = []
    comp = _ScriptedCompletions(
        responses=[_Response(), _Response(), _Response("ok")],
        exceptions=[
            _status_error(openai.RateLimitError, 429, retry_after="0"),
            _status_error(openai.InternalServerError, 503),
            None,
        ],
    )
    p = _provider(completions=comp, max_attempts=3, sleeps=sleeps)
    resp = p.chat(ChatRequest(messages=[{"role": "user", "content": "hi"}]))
    assert resp.content == "ok"
    assert comp.calls == 3
    assert resp.attempts == 3
    assert len(sleeps) == 2  # slept before attempt 2 and attempt 3
    assert sleeps[0] == 0.0  # first backoff honoured Retry-After: 0


def test_chat_does_not_retry_deterministic_error() -> None:
    comp = _ScriptedCompletions(
        responses=[_Response()],
        exceptions=[_status_error(openai.BadRequestError, 400)],
    )
    p = _provider(completions=comp, max_attempts=5)
    with pytest.raises(openai.BadRequestError):
        p.chat(ChatRequest(messages=[{"role": "user", "content": "hi"}]))
    assert comp.calls == 1  # fail fast, no retries


def test_chat_gives_up_after_max_attempts() -> None:
    comp = _ScriptedCompletions(
        responses=[_Response()],
        exceptions=[_status_error(openai.InternalServerError, 500)] * 3,
    )
    p = _provider(completions=comp, max_attempts=3)
    with pytest.raises(openai.InternalServerError):
        p.chat(ChatRequest(messages=[{"role": "user", "content": "hi"}]))
    assert comp.calls == 3


# ---------------------------------------------------------------------------
# JSON mode
# ---------------------------------------------------------------------------


def test_json_mode_sets_response_format_and_hint() -> None:
    comp = _ScriptedCompletions(responses=[_Response('{"rating": "Hold"}')])
    p = _provider(completions=comp)
    resp = p.chat(
        ChatRequest(messages=[{"role": "user", "content": "评级"}], json_mode=True)
    )
    kwargs = comp.kwargs_list[0]
    assert kwargs["response_format"] == {"type": "json_object"}
    # A hint was injected because the original prompt had no "json" word.
    assert "json" in kwargs["messages"][0]["content"].lower()
    assert resp.json() == {"rating": "Hold"}


# ---------------------------------------------------------------------------
# Routing + fallback (ChatService)
# ---------------------------------------------------------------------------


def _service_with_providers(pro_provider, flash_provider, settings=None):
    svc = ChatService(settings or _settings(), sleep=lambda s: None)
    svc._providers = {"pro": pro_provider, "flash": flash_provider}
    return svc


def test_routing_maps_tasks_to_tiers() -> None:
    svc = ChatService(_settings(), sleep=lambda s: None)
    assert svc.resolve_tier(
        ChatRequest(messages=[{"role": "user", "content": "x"}], task=ModelTask.RATING)
    ) == "pro"
    assert svc.resolve_tier(
        ChatRequest(messages=[{"role": "user", "content": "x"}], task=ModelTask.SUMMARIZE)
    ) == "flash"
    assert svc.resolve_tier(
        ChatRequest(messages=[{"role": "user", "content": "x"}])
    ) == "flash"  # default_tier


def test_pro_failure_falls_back_to_flash() -> None:
    pro = _provider(
        tier="pro",
        completions=_ScriptedCompletions(
            responses=[_Response()],
            exceptions=[_status_error(openai.NotFoundError, 404)],
        ),
        max_attempts=1,
    )
    flash = _provider(
        tier="flash",
        completions=_ScriptedCompletions(responses=[_Response("flash answer")]),
    )
    svc = _service_with_providers(pro, flash)
    resp = svc.chat(
        ChatRequest(messages=[{"role": "user", "content": "rate"}], task=ModelTask.RATING)
    )
    assert resp.tier == "flash"
    assert resp.content == "flash answer"
    assert resp.degraded is True
    assert resp.requested_tier == "pro"
    assert "NotFound" in resp.degrade_reason


def test_flash_failure_is_not_masked_by_fallback() -> None:
    flash = _provider(
        tier="flash",
        completions=_ScriptedCompletions(
            responses=[_Response()],
            exceptions=[_status_error(openai.AuthenticationError, 401)],
        ),
        max_attempts=1,
    )
    svc = _service_with_providers(flash, flash)
    with pytest.raises(openai.AuthenticationError):
        svc.chat(ChatRequest(messages=[{"role": "user", "content": "x"}]))


def test_fallback_disabled_raises_pro_error() -> None:
    pro = _provider(
        tier="pro",
        completions=_ScriptedCompletions(
            responses=[_Response()],
            exceptions=[_status_error(openai.NotFoundError, 404)],
        ),
        max_attempts=1,
    )
    flash = _provider(
        tier="flash", completions=_ScriptedCompletions(responses=[_Response()])
    )
    svc = _service_with_providers(
        pro, flash, _settings(fallback_to_flash=False)
    )
    with pytest.raises(openai.NotFoundError):
        svc.chat(
            ChatRequest(
                messages=[{"role": "user", "content": "x"}], task=ModelTask.RATING
            )
        )


# ---------------------------------------------------------------------------
# parse_json + token estimate
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        '{"a": 1}',
        '```json\n{"a": 1}\n```',
        'Here is the result:\n{"a": 1}\nThanks',
        '  [1, 2, 3]  ',
    ],
)
def test_parse_json_accepts_common_shapes(text: str) -> None:
    parsed = parse_json(text)
    assert parsed in ({"a": 1}, [1, 2, 3])


def test_parse_json_raises_without_json() -> None:
    with pytest.raises(ValueError):
        parse_json("no json here at all")


def test_token_estimate_is_positive() -> None:
    assert estimate_prompt_tokens([{"role": "user", "content": "hello world"}]) >= 1

"""Tests for the OpenAI-compatible model provider (no network: fake SDK client)."""

from types import SimpleNamespace

import pytest

from agent_core.models.openai_compatible import (
    OpenAICompatibleProvider,
    build_provider,
)


class _FakeUsage:
    prompt_tokens = 5
    completion_tokens = 2


class _FakeMessage:
    content = "pong"
    reasoning_content = ""


class _FakeChoice:
    message = _FakeMessage()


class _FakeResponse:
    model = "fake-model-1"
    usage = _FakeUsage()
    choices = [_FakeChoice()]


class _FakeCompletions:
    def __init__(self) -> None:
        self.last_kwargs: dict | None = None

    def create(self, **kwargs):
        self.last_kwargs = kwargs
        return _FakeResponse()


class _FakeChat:
    def __init__(self) -> None:
        self.completions = _FakeCompletions()


class _FakeOpenAI:
    def __init__(self, **kwargs) -> None:
        self.init_kwargs = kwargs
        self.chat = _FakeChat()


def _provider_with_fake_client() -> tuple[OpenAICompatibleProvider, _FakeOpenAI]:
    provider = OpenAICompatibleProvider(
        "x", "http://test.example", "test-key", "fake-model"
    )
    fake = _FakeOpenAI()
    provider._client = fake  # type: ignore[assignment]
    return provider, fake


def test_ping_returns_reply_usage_and_model() -> None:
    provider, fake = _provider_with_fake_client()
    result = provider.ping()

    assert result.provider == "x"
    assert result.model == "fake-model-1"
    assert result.reply == "pong"
    assert result.prompt_tokens == 5
    assert result.completion_tokens == 2
    assert result.latency_ms >= 0
    # The ping should be a minimal chat call.
    assert fake.chat.completions.last_kwargs["model"] == "fake-model"
    assert fake.chat.completions.last_kwargs["max_tokens"] == 64


def test_missing_api_key_raises() -> None:
    with pytest.raises(ValueError, match="missing API key"):
        OpenAICompatibleProvider("x", "http://test.example", None, "m")


def test_build_provider_unknown_name_raises() -> None:
    settings = SimpleNamespace(model_provider="nope")
    with pytest.raises(ValueError, match="unknown model provider"):
        build_provider(settings)  # type: ignore[arg-type]


def test_build_provider_selects_deepseek_settings() -> None:
    settings = SimpleNamespace(
        model_provider="deepseek",
        deepseek_base_url="http://ds",
        deepseek_api_key="ds-key",
        deepseek_model="ds-model",
        ark_base_url="http://ark",
        ark_api_key="ark-key",
        ark_model="ark-model",
    )
    provider = build_provider(settings)  # type: ignore[arg-type]
    assert provider.name == "deepseek"
    assert provider.model == "ds-model"


def test_build_provider_explicit_name_overrides_default() -> None:
    settings = SimpleNamespace(
        model_provider="deepseek",
        deepseek_base_url="http://ds",
        deepseek_api_key="ds-key",
        deepseek_model="ds-model",
        ark_base_url="http://ark",
        ark_api_key="ark-key",
        ark_model="ark-model",
    )
    provider = build_provider(settings, "ark")  # type: ignore[arg-type]
    assert provider.name == "ark"
    assert provider.model == "ark-model"

"""OpenAI-compatible chat model provider.

Both tiers (flash / pro) speak the same OpenAI-compatible chat protocol on
Volcengine Ark; only the API key and model id differ. This provider normalises
that protocol into ``ChatRequest`` / ``ChatResponse`` and adds the M1
production concerns:

  * retries with exponential backoff + jitter, honouring ``Retry-After``;
  * only *transient* errors are retried (429 / 5xx / timeout / connection);
  * deterministic errors (400 / 401 / 403 / 404) fail fast;
  * usage -> cost via the model's declared spec.

Tier-to-tier fallback (pro -> flash) lives in the router, not here, because a
single provider should not know about other tiers.
"""

from __future__ import annotations

import random
import time
from typing import Callable

import openai
from openai import OpenAI
from tenacity import (
    Retrying,
    retry_if_exception,
    stop_after_attempt,
)

from ..config import Settings
from .types import (
    ChatRequest,
    ChatResponse,
    ModelSpec,
    ModelTier,
    PingResult,
    Usage,
)


def is_transient_error(exc: BaseException) -> bool:
    """Decide whether an error may succeed on a retry.

    Transient (retry): rate limit, timeout, dropped connection, server fault.
    Deterministic (fail fast): bad request, auth, permission, missing model.
    """
    if isinstance(
        exc,
        (
            openai.RateLimitError,        # 429
            openai.APITimeoutError,
            openai.APIConnectionError,
            openai.InternalServerError,   # 500/502/503/504
        ),
    ):
        return True
    if isinstance(exc, openai.APIStatusError):
        return exc.status_code >= 500 or exc.status_code in (408, 409)
    return False


def _json_hint_messages(messages: list[dict[str, str]]) -> list[dict[str, str]]:
    """OpenAI JSON mode requires the word 'json' in the prompt. Ensure it."""
    blob = " ".join(m.get("content", "") for m in messages)
    if "json" in blob.lower():
        return messages
    return [
        {
            "role": "system",
            "content": "Respond with a single valid JSON object and no prose.",
        },
        *messages,
    ]


class OpenAICompatibleProvider:
    """Thin wrapper over the OpenAI SDK for an OpenAI-compatible vendor."""

    def __init__(
        self,
        tier: str,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout: float = 60.0,
        spec: ModelSpec | None = None,
        max_attempts: int = 3,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key:
            raise ValueError(
                f"missing API key for '{tier}' tier (set {tier.upper()}_API_KEY)"
            )
        self.tier = tier
        self.model = model
        self.spec = spec or ModelSpec(tier=tier, model=model, context_window=128_000)
        self.max_attempts = max_attempts
        self._sleep = sleep
        self._client = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
        )

    def _retryer(self) -> Retrying:
        return Retrying(
            stop=stop_after_attempt(self.max_attempts),
            wait=self._backoff,
            retry=retry_if_exception(is_transient_error),
            reraise=True,
            sleep=self._sleep,
        )

    @staticmethod
    def _backoff(retry_state) -> float:  # noqa: ANN001 (tenacity call state)
        """Exponential backoff + jitter, preferring the server's Retry-After."""
        exc = retry_state.outcome.exception()
        response = getattr(exc, "response", None)
        if response is not None:
            retry_after = getattr(response, "headers", {}).get("retry-after")
            if retry_after:
                try:
                    return float(retry_after)
                except (TypeError, ValueError):
                    pass
        attempt = max(1, retry_state.attempt_number - 1)
        return min(20.0, 2.0**attempt) + random.uniform(0.0, 0.5)

    def _build_kwargs(self, req: ChatRequest) -> dict:
        kwargs: dict = {
            "model": self.model,
            "messages": req.messages,
            "temperature": req.temperature,
        }
        if req.max_tokens is not None:
            kwargs["max_tokens"] = req.max_tokens
        if req.stop:
            kwargs["stop"] = req.stop
        if req.json_mode:
            if self.spec.supports_json:
                kwargs["response_format"] = {"type": "json_object"}
                kwargs["messages"] = _json_hint_messages(req.messages)
            else:
                # Model declared without native JSON mode: ask for JSON in text.
                kwargs["messages"] = _json_hint_messages(req.messages)
        return kwargs

    def chat(self, req: ChatRequest) -> ChatResponse:
        """Send a chat request with retries and return a normalised response."""
        kwargs = self._build_kwargs(req)
        started = time.perf_counter()
        retryer = self._retryer()
        resp = retryer(lambda: self._client.chat.completions.create(**kwargs))
        latency_ms = int((time.perf_counter() - started) * 1000)

        message = resp.choices[0].message
        reasoning = getattr(message, "reasoning_content", None) or ""
        usage = resp.usage
        prompt_tokens = getattr(usage, "prompt_tokens", 0) or 0
        completion_tokens = getattr(usage, "completion_tokens", 0) or 0
        return ChatResponse(
            content=(getattr(message, "content", None) or "").strip(),
            reasoning=reasoning.strip() if isinstance(reasoning, str) else "",
            model=getattr(resp, "model", None) or self.model,
            tier=self.tier,
            requested_tier=self.tier,
            usage=Usage(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                cost_usd=self.spec.cost_usd(prompt_tokens, completion_tokens),
            ),
            latency_ms=latency_ms,
            finish_reason=getattr(resp.choices[0], "finish_reason", None) or "stop",
            attempts=getattr(retryer, "statistics", {}).get("attempt_number", 1) or 1,
        )

    def ping(self, prompt: str = "Reply with exactly one word: pong") -> PingResult:
        """Send a trivial prompt and report the reply, token usage and latency.

        Raises an ``openai.*`` error on auth/rate-limit/network/model failure so
        the CLI can surface the vendor's exact message. Reasoning models may
        spend tokens on a hidden ``reasoning_content`` chain before answering.
        """
        resp = self.chat(
            ChatRequest(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=64,
                temperature=0,
            )
        )
        return PingResult(
            tier=self.tier,
            model=resp.model,
            reply=resp.content,
            reasoning=resp.reasoning,
            prompt_tokens=resp.usage.prompt_tokens,
            completion_tokens=resp.usage.completion_tokens,
            latency_ms=resp.latency_ms,
        )


def build_provider(
    settings: Settings,
    tier: str | None = None,
    spec: ModelSpec | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> OpenAICompatibleProvider:
    """Construct a provider for a model tier ("flash" or "pro").

    Args:
        settings: Resolved application settings.
        tier: ``"flash"`` / ``"pro"``; defaults to ``settings.default_tier``.
        spec: Optional capability/price spec to attach.
        sleep: Injected sleep for tests (defaults to real time).
    """
    chosen = (tier or settings.default_tier).strip().lower()
    if chosen == ModelTier.FLASH.value:
        return OpenAICompatibleProvider(
            ModelTier.FLASH.value,
            settings.model_base_url,
            settings.flash_api_key,
            settings.flash_model,
            spec=spec,
            max_attempts=settings.max_retries,
            sleep=sleep,
        )
    if chosen == ModelTier.PRO.value:
        return OpenAICompatibleProvider(
            ModelTier.PRO.value,
            settings.model_base_url,
            settings.pro_api_key,
            settings.pro_model,
            spec=spec,
            max_attempts=settings.max_retries,
            sleep=sleep,
        )
    raise ValueError(f"unknown model tier '{chosen}' (expected 'flash' or 'pro')")

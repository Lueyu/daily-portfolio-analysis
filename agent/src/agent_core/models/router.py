"""Task routing, context-aware tier selection and transparent fallback.

The ``ChatService`` is the single object the business layer talks to:

    svc = ChatService(get_settings())
    resp = svc.chat(ChatRequest(task=ModelTask.RATING, messages=[...]))

It decides which tier handles a task, upgrades the tier when the prompt is too
large, and transparently falls back pro -> flash when the strong tier is
unavailable (rate limited, not opened on the account, server error). Fallback
is always flagged on the response so the caller can treat the result as lower
confidence.
"""

from __future__ import annotations

import time
from typing import Callable

from ..config import Settings
from .openai_compatible import OpenAICompatibleProvider, build_provider
from .specs import build_specs
from .types import (
    TASK_TIER,
    ChatChunk,
    ChatRequest,
    ChatResponse,
    ModelSpec,
    ModelTier,
    estimate_prompt_tokens,
)


class ChatService:
    """Model-tier routing + resilient chat with transparent fallback."""

    def __init__(
        self,
        settings: Settings,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.settings = settings
        self._sleep = sleep
        self.specs = build_specs(settings)
        self._providers: dict[str, OpenAICompatibleProvider] = {}

    def provider_for(self, tier: str) -> OpenAICompatibleProvider:
        """Lazily build and cache a provider for a tier."""
        if tier not in self._providers:
            self._providers[tier] = build_provider(
                self.settings,
                tier,
                spec=self.specs[tier],
                sleep=self._sleep,
            )
        return self._providers[tier]

    def resolve_tier(self, req: ChatRequest) -> str:
        """Choose a tier from the task, then upgrade if the prompt is too large."""
        if req.task is not None:
            tier = TASK_TIER[req.task]
        else:
            tier = self.settings.default_tier
        tier = ModelTier(tier).value

        est = req.estimated_prompt_tokens or estimate_prompt_tokens(req.messages)
        spec = self.specs[tier]
        # If the chosen tier's window would be close to full, use a tier with a
        # larger window (currently a no-op when both windows are equal).
        if est > spec.context_window * 0.9:
            other = (
                ModelTier.PRO.value
                if tier == ModelTier.FLASH.value
                else ModelTier.FLASH.value
            )
            if self.specs[other].context_window > spec.context_window:
                return other
        return tier

    def spec_for_task(self, task) -> ModelSpec:
        """Return the capability spec of the tier that would serve a task."""
        tier = self.resolve_tier(ChatRequest(
            messages=[{"role": "user", "content": ""}], task=task))
        return self.specs[tier]

    def supports_tools_for(self, task) -> bool:
        """Whether the model that serves this task supports function calling."""
        return bool(self.spec_for_task(task).supports_tools)

    def chat(self, req: ChatRequest) -> ChatResponse:
        """Run a chat call with tier routing and transparent pro->flash fallback."""
        requested = self.resolve_tier(req)

        if requested == ModelTier.PRO.value and self.settings.fallback_to_flash:
            return self._chat_pro_with_fallback(req)
        return self._call(requested, req)

    def _chat_pro_with_fallback(self, req: ChatRequest) -> ChatResponse:
        """Try the pro tier; if it ultimately fails, answer with flash instead."""
        try:
            return self._call(ModelTier.PRO.value, req)
        except Exception as exc:  # noqa: BLE001 - any pro outage -> fallback
            try:
                resp = self._call(ModelTier.FLASH.value, req)
            except Exception:
                # Flash also failed: surface the original pro failure so the
                # caller sees the real root cause rather than a masked one.
                raise
            resp.degraded = True
            resp.requested_tier = ModelTier.PRO.value
            resp.degrade_reason = f"{type(exc).__name__}: {exc}"
            return resp

    def _call(self, tier: str, req: ChatRequest) -> ChatResponse:
        return self.provider_for(tier).chat(req)

    # ------------------------------------------------------------------
    # Streaming
    # ------------------------------------------------------------------

    def stream_chat(self, req: ChatRequest):
        """Return a generator of :class:`ChatChunk` events for a routed call.

        pro tasks with ``fallback_to_flash`` go through the stream-aware
        fallback; everything else streams straight from the chosen tier.
        """
        requested = self.resolve_tier(req)
        if requested == ModelTier.PRO.value and self.settings.fallback_to_flash:
            return self._stream_pro_with_fallback(req)
        return self.provider_for(requested).stream_chat(req)

    def _stream_pro_with_fallback(self, req: ChatRequest):
        """Stream pro, switching to flash only if the pro stream never starts.

        We pull the first event before yielding anything to the caller. If the
        pro stream fails while being established (auth / not-open / rate
        limit), no text has been shown, so we can transparently switch to
        flash. Once the first event has been delivered, a mid-stream failure is
        raised as-is — silently restarting after partial output would duplicate
        or contradict what the user already saw.
        """
        pro = self.provider_for(ModelTier.PRO.value)
        gen = pro.stream_chat(req)
        try:
            first = next(gen)
        except StopIteration:
            return
        except Exception as exc:  # noqa: BLE001 - any pro outage -> fallback
            if not self.settings.fallback_to_flash:
                raise
            yield ChatChunk(
                tier=ModelTier.FLASH.value,
                model=self.specs[ModelTier.FLASH.value].model,
                requested_tier=ModelTier.PRO.value,
                degraded=True,
                degrade_reason=f"{type(exc).__name__}: {exc}",
            )
            yield from self.provider_for(ModelTier.FLASH.value).stream_chat(req)
            return

        # The pro stream started successfully: relay the first event and the
        # rest. A failure from here on is NOT transparently retried/fallbacked.
        yield first
        yield from gen


# ---------------------------------------------------------------------------
# Convenience functional API (the shape used by M2 business code).
# ---------------------------------------------------------------------------

_default_service: ChatService | None = None


def _service() -> ChatService:
    global _default_service
    if _default_service is None:
        from ..config import get_settings

        _default_service = ChatService(get_settings())
    return _default_service


def chat(
    messages: list[dict[str, str]],
    task=None,
    *,
    json_mode: bool = False,
    temperature: float = 0.0,
    max_tokens: int | None = None,
) -> ChatResponse:
    """Convenience wrapper: ``chat(messages, task=ModelTask.RATING)``."""
    return _service().chat(
        ChatRequest(
            messages=messages,
            task=task,
            json_mode=json_mode,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    )

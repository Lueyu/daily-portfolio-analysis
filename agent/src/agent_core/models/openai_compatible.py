"""OpenAI-compatible chat model provider.

Day 3 scope is a minimal connectivity check (``ping``): prove that an API key and
model id work against one OpenAI-compatible endpoint. Volcengine Ark (Doubao),
DeepSeek and OpenAI all speak the same ``chat.completions`` protocol, so the same
client class serves them; only ``base_url`` / ``api_key`` / ``model`` differ.

The full provider abstraction (capability declaration, streaming, usage
accounting, retry/backoff, fast/slow routing) is built out in M1; this file keeps
the seam in place so that later work does not change call sites.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

from openai import OpenAI

from ..config import Settings


@dataclass(frozen=True)
class PingResult:
    """Outcome of a single minimal chat round-trip."""

    provider: str
    model: str
    reply: str
    reasoning: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int


class OpenAICompatibleProvider:
    """Thin wrapper over the OpenAI SDK for any compatible vendor.

    Args:
        name: Logical provider name, e.g. ``"deepseek"`` / ``"ark"``.
        base_url: Vendor OpenAI-compatible API root.
        api_key: Bearer API key.
        model: Model / endpoint id used in ``chat.completions``.
        timeout: Per-request timeout in seconds.
    """

    def __init__(
        self,
        name: str,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout: float = 20.0,
    ) -> None:
        if not api_key:
            raise ValueError(
                f"missing API key for provider '{name}' "
                f"(set the corresponding *_API_KEY env var)"
            )
        self.name = name
        self.model = model
        self._client = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
        )

    def ping(self, prompt: str = "Reply with exactly one word: pong") -> PingResult:
        """Send a trivial prompt and report the reply, token usage and latency.

        Raises an ``openai.*`` error on auth/rate-limit/network/model failure so
        the CLI can surface the vendor's exact message. Reasoning models may spend
        tokens on a hidden ``reasoning_content`` chain before answering; the token
        budget is kept large enough to still return a visible answer.
        """
        started = time.perf_counter()
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=64,
            temperature=0,
        )
        latency_ms = int((time.perf_counter() - started) * 1000)
        message = resp.choices[0].message
        reasoning = getattr(message, "reasoning_content", None) or ""
        usage = resp.usage
        return PingResult(
            provider=self.name,
            model=resp.model or self.model,
            reply=(message.content or "").strip(),
            reasoning=reasoning.strip(),
            prompt_tokens=usage.prompt_tokens if usage else 0,
            completion_tokens=usage.completion_tokens if usage else 0,
            latency_ms=latency_ms,
        )


def build_provider(settings: Settings, name: str | None = None) -> OpenAICompatibleProvider:
    """Construct a provider from settings by logical name.

    Args:
        settings: Resolved application settings.
        name: ``"deepseek"`` / ``"ark"``; defaults to ``settings.model_provider``.
    """
    provider = (name or settings.model_provider).strip().lower()
    if provider == "ark":
        return OpenAICompatibleProvider(
            "ark",
            settings.ark_base_url,
            settings.ark_api_key,
            settings.ark_model,
        )
    if provider == "deepseek":
        return OpenAICompatibleProvider(
            "deepseek",
            settings.deepseek_base_url,
            settings.deepseek_api_key,
            settings.deepseek_model,
        )
    raise ValueError(
        f"unknown model provider '{provider}' (expected 'deepseek' or 'ark')"
    )

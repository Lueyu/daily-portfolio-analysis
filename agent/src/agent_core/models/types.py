"""Core data types for the model layer (M1).

The whole point of these types is *dependency inversion*: the business logic
(stock analysis, debate, rating) only ever speaks ``ChatRequest`` /
``ChatResponse`` and never knows which vendor is underneath. Swapping
DeepSeek-on-Ark for another OpenAI-compatible vendor then changes config, not
call sites.

Everything is a plain dataclass so it is trivial to construct in tests and to
serialise into the checkpoint trace.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum


class ModelTier(str, Enum):
    """A model *role*, not a vendor.

    ``flash`` = cheap / fast, default for routine, high-volume steps.
    ``pro``   = stronger reasoning, reserved for high-stakes decisions.
    """

    FLASH = "flash"
    PRO = "pro"


class ModelTask(str, Enum):
    """What the call is for. The router maps a task to a tier.

    Keep the set small for now; M2/M4 will grow it. The split is deliberately
    "routine, high-volume, cheap" vs "high-stakes, worth paying for".
    """

    # --- routine, high-volume, tolerant of a weaker model -> flash ---
    SUMMARIZE = "summarize"   # news / transcript / evidence summaries
    EXTRACT = "extract"       # structured extraction (JSON facts)
    TRANSLATE = "translate"
    DEBATE = "debate"         # one bull/bear argument (many calls per run)
    # --- high-stakes, worth the stronger model -> pro ---
    RATING = "rating"         # final rating / sizing decision
    PLAN = "plan"             # planning / reflection
    CRITIC = "critic"         # final critic / risk synthesis


# Default routing: which tier each task uses.
TASK_TIER: dict[ModelTask, ModelTier] = {
    ModelTask.SUMMARIZE: ModelTier.FLASH,
    ModelTask.EXTRACT: ModelTier.FLASH,
    ModelTask.TRANSLATE: ModelTier.FLASH,
    ModelTask.DEBATE: ModelTier.FLASH,
    ModelTask.RATING: ModelTier.PRO,
    ModelTask.PLAN: ModelTier.PRO,
    ModelTask.CRITIC: ModelTier.PRO,
}


@dataclass(frozen=True)
class ModelSpec:
    """Declared capability + pricing of a concrete model id.

    Capabilities are engineering declarations (kept in config/code rather than
    guessed at call time). Pricing is per 1,000,000 tokens; leave at 0.0 if you
    have not filled in real prices, so we never invent a cost.
    """

    tier: str
    model: str
    context_window: int
    supports_tools: bool = True
    supports_json: bool = True
    supports_streaming: bool = True
    is_reasoning: bool = False
    cost_per_mtok_input: float = 0.0
    cost_per_mtok_output: float = 0.0

    def cost_usd(self, prompt_tokens: int, completion_tokens: int) -> float:
        """Return the billed cost for this usage, or 0.0 if prices are unset."""
        return (
            prompt_tokens * self.cost_per_mtok_input / 1_000_000.0
            + completion_tokens * self.cost_per_mtok_output / 1_000_000.0
        )


@dataclass
class Usage:
    """Token usage and cost for one call."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    cost_usd: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


@dataclass(frozen=True)
class PingResult:
    """Outcome of a single minimal connectivity round-trip."""

    tier: str
    model: str
    reply: str
    reasoning: str
    prompt_tokens: int
    completion_tokens: int
    latency_ms: int


@dataclass
class ChatRequest:
    """One chat completion request, independent of the vendor schema."""

    messages: list[dict[str, str]]
    temperature: float = 0.0
    max_tokens: int | None = None
    stop: list[str] | None = None
    json_mode: bool = False
    task: ModelTask | None = None
    # Hard cap on context length the router should tolerate; set from the spec.
    estimated_prompt_tokens: int = 0
    timeout: float = 60.0


@dataclass
class ChatResponse:
    """Normalised result of one chat completion."""

    content: str
    model: str
    tier: str
    usage: Usage
    latency_ms: int
    finish_reason: str = "stop"
    reasoning: str = ""
    # Transparent fallback: set when the requested tier failed and a cheaper
    # tier actually answered. Business code must be able to see this.
    requested_tier: str = ""
    degraded: bool = False
    degrade_reason: str | None = None
    attempts: int = 1

    def json(self) -> dict | list:
        """Parse JSON content, tolerating a ```json code fence and prose.

        Raises ``ValueError`` if no JSON object/array can be recovered. Callers
        that need structured output should handle this explicitly.
        """
        return parse_json(self.content)


def parse_json(text: str) -> dict | list:
    """Best-effort parse of a model reply that should contain JSON.

    Handles three common shapes:
      1. pure JSON
      2. a ```json ... ``` fenced block
      3. JSON embedded in surrounding prose (take the first balanced block)
    """
    if not text:
        raise ValueError("empty model response")
    s = text.strip()
    # Strip a Markdown code fence if present.
    if s.startswith("```"):
        s = s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
        # Cut off a trailing fence if the whole thing was fenced.
        s = s.strip()
    # First try the whole string (covers pure JSON and fenced JSON).
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    # Fall back to the first {...} or [...] span, so light prose around JSON
    # does not break structured calls.
    start = min(
        (s.find("{") for s in [s] if s.find("{") != -1),
        default=-1,
    )
    if start == -1:
        start = s.find("[")
        if start == -1:
            raise ValueError(f"no JSON object found in response: {text[:200]!r}")
    open_ch = s[start]
    close_ch = "}" if open_ch == "{" else "]"
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == open_ch:
            depth += 1
        elif ch == close_ch:
            depth -= 1
            if depth == 0:
                return json.loads(s[start : i + 1])
    raise ValueError(f"unbalanced JSON in response: {text[:200]!r}")


def estimate_prompt_tokens(messages: list[dict[str, str]]) -> int:
    """Rough token estimate without a tokenizer (4 chars/token is a safe-ish
    upper bound for English+Chinese mix). Only used for pre-routing checks;
    the vendor's usage field is the source of truth after a call.
    """
    chars = sum(len(m.get("content", "")) for m in messages)
    return max(1, int(chars / 3.5))

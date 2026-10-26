"""Model capability registry.

Builds a ``ModelSpec`` for each tier from settings. Capabilities here are
engineering declarations that the router relies on (e.g. "does this model have
enough context", "can it answer JSON"). They are not magic: they reflect the
vendor's documented capabilities and are kept in one place so they are easy to
correct when a model is upgraded.
"""

from __future__ import annotations

from ..config import Settings
from .types import ModelSpec, ModelTier
from .profiles import coding_profile


# Declared capability defaults per family. Both DeepSeek V4 variants on Ark
# are OpenAI-compatible chat models with JSON mode and a large context window.
# Context windows are conservative engineering values; verify against the Ark
# console when a model is upgraded.
_DEEPSEEK_FLASH = dict(
    context_window=128_000,
    supports_tools=True,
    supports_json=True,
    supports_streaming=True,
    is_reasoning=False,
)
_DEEPSEEK_PRO = dict(
    context_window=128_000,
    supports_tools=True,
    supports_json=True,
    supports_streaming=True,
    is_reasoning=True,
)


def build_specs(settings: Settings) -> dict[str, ModelSpec]:
    """Return the tier -> ModelSpec map for both tiers."""
    specs = {
        ModelTier.FLASH.value: ModelSpec(
            tier=ModelTier.FLASH.value,
            model=settings.flash_model,
            cost_per_mtok_input=settings.flash_cost_per_mtok_input,
            cost_per_mtok_output=settings.flash_cost_per_mtok_output,
            supports_images=bool(getattr(settings, "flash_supports_images", False)),
            **_DEEPSEEK_FLASH,
        ),
        ModelTier.PRO.value: ModelSpec(
            tier=ModelTier.PRO.value,
            model=settings.pro_model,
            cost_per_mtok_input=settings.pro_cost_per_mtok_input,
            cost_per_mtok_output=settings.pro_cost_per_mtok_output,
            supports_images=bool(getattr(settings, "pro_supports_images", False)),
            **_DEEPSEEK_PRO,
        ),
    }
    if hasattr(settings, "coder_model_tier"):
        specs["coder"] = coding_profile(settings, specs)
        if settings.coder_vision_model:
            specs["vision"] = ModelSpec(
                tier="vision", model=settings.coder_vision_model,
                context_window=settings.coder_vision_context_window,
                max_output_tokens=settings.coder_vision_max_output_tokens,
                supports_images=settings.coder_vision_supports_images,
            )
    return specs

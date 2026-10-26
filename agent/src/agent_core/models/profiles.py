"""Resolve operator-configured coding profiles without exposing credentials."""

from __future__ import annotations

import os
from dataclasses import replace

from .types import ModelSpec


def coding_profile(settings, specs: dict[str, ModelSpec]) -> ModelSpec:
    base = specs[getattr(settings, "coder_model_tier", "pro")]
    return replace(
        base, tier="coder", model=settings.coder_model or base.model,
        context_window=settings.coder_context_window or base.context_window,
        max_output_tokens=settings.coder_max_output_tokens,
        supports_images=(settings.coder_supports_images if settings.coder_supports_images is not None
                         else base.supports_images if not settings.coder_model else False),
        # Inherited prices only describe the inherited model.
        cost_per_mtok_input=0.0 if settings.coder_model else base.cost_per_mtok_input,
        cost_per_mtok_output=0.0 if settings.coder_model else base.cost_per_mtok_output,
    )


def profile_connection(settings, tier: str) -> tuple[str, str | None]:
    prefix = "coder_vision" if tier == "vision" else "coder"
    base_url = getattr(settings, f"{prefix}_base_url", None)
    key_env = getattr(settings, f"{prefix}_api_key_env", None)
    direct_key = getattr(settings, f"{prefix}_api_key", None)
    if key_env:
        key = os.environ.get(key_env)
        # Settings loads agent/.env without mutating os.environ. Support env
        # references to its declared key fields as well as process env vars.
        if not key:
            key = getattr(settings, key_env.lower(), None)
    elif direct_key:
        key = direct_key
    elif base_url:
        # Never forward an inherited credential to a different endpoint.
        key = None
    else:
        key = getattr(settings, f"{settings.coder_model_tier}_api_key", None)
    return base_url or settings.model_base_url, key

"""Convert registered ToolSpecs into OpenAI function-calling schemas."""

from __future__ import annotations

from .registry import ToolSpec


def openai_tool_schema(spec: ToolSpec) -> dict:
    """Return the OpenAI `tools` entry for one registered tool."""
    if spec.parameters is not None:
        parameters = spec.parameters
    else:
        parameters = spec.param_model.model_json_schema()
        # Pydantic emits a schema title; OpenAI ignores it but we keep the
        # payload minimal. The coder's step models are flat (no nested $defs).
        parameters.pop("title", None)
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description or spec.name,
            "parameters": parameters,
        },
    }


def openai_tools_payload(specs: list[ToolSpec]) -> list[dict]:
    """Return the full `tools` payload for the currently visible tools."""
    return [openai_tool_schema(s) for s in specs]

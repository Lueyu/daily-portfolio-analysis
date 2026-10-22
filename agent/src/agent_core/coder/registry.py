"""Pluggable tool registry for the coder persona.

The registry is the single source of truth for the actions the model may take.
Each tool declares its name, permission kind, the *gate* that must be open for
it to be visible, and a pydantic parameter model. Parsing a model reply is then
a table lookup instead of a hard-coded if/elif chain, so adding a tool means
registering one spec rather than editing parser + harness + prompts.

The registry is pure logic (no disk, no network): it only parses and describes
tools. Execution lives in tools.py/harness.py and orchestration lives in
react_loop.py.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable

from pydantic import BaseModel, ValidationError

from ..models import parse_json


class ToolKind(str, Enum):
    """Permission category of a tool."""

    READ_ONLY = "read_only"  # explores the repo / environment; no side effects
    VERIFY = "verify"        # runs an allow-listed check
    PATCH = "patch"          # proposes a change (applied only after approval)
    TERMINAL = "terminal"    # finishes or blocks the run


class GateKind(str, Enum):
    """Capability gate that must be open before the tool is shown to the model.

    ALWAYS      : available from the start (reads, run_check, blocked).
    NEEDS_RED   : only after a failing reproduction test was seen.
    NEEDS_GREEN : only after the sandboxed verification set passed.
    """

    ALWAYS = "always"
    NEEDS_RED = "needs_red"
    NEEDS_GREEN = "needs_green"


@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: ToolKind
    param_model: type[BaseModel]
    gate: GateKind
    # Optional custom payload -> step mapping (e.g. run_check's check -> kind).
    from_payload: Callable[[dict], BaseModel] | None = None
    description: str = ""
    # Optional explicit OpenAI parameters schema. Used when the model-facing
    # parameter differs from the pydantic step model (e.g. run_check takes
    # "check", while its step model stores a "kind" enum).
    parameters: dict | None = None


class UnknownToolError(ValueError):
    """Raised when the model names an action that is not registered."""


# Top-level envelope keys that are never tool parameters. "action" routes the
# call; "phase" is legacy orchestration metadata. They are stripped from a flat
# envelope; the nested "params" object is still validated with extra="forbid".
_ENVELOPE_KEYS = {"action", "phase"}


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._tools:
            raise ValueError(f"tool already registered: {spec.name}")
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec:
        if name not in self._tools:
            raise UnknownToolError(f"unsupported action: {name!r}")
        return self._tools[name]

    def names(self) -> list[str]:
        return sorted(self._tools)

    def parse_action(self, text: str) -> tuple[str, dict]:
        """Extract (tool name, payload dict) from a JSON model reply.

        Supports both {"action": ..., "params": {...}} and a flat envelope.
        """
        data = parse_json(text)
        if not isinstance(data, dict):
            raise ValueError("model action must be a JSON object")
        action = data.get("action")
        if not isinstance(action, str) or not action.strip():
            raise ValueError("model action requires a string 'action'")
        raw = data.get("params")
        if raw is None:
            payload = {k: v for k, v in data.items() if k not in _ENVELOPE_KEYS}
        elif isinstance(raw, dict):
            payload = raw
        else:
            raise ValueError("tool params must be an object")
        return action.strip(), payload

    def validate(self, name: str, payload: dict) -> BaseModel:
        """Validate a (tool name, arguments dict) into a strongly-typed step."""
        spec = self.get(name)
        if spec.from_payload is not None:
            return spec.from_payload(payload)
        try:
            return spec.param_model(**payload)
        except ValidationError as exc:
            raise ValueError(str(exc)) from exc

    def parse(self, text: str) -> BaseModel:
        """Parse raw model text into a validated step."""
        name, payload = self.parse_action(text)
        return self.validate(name, payload)

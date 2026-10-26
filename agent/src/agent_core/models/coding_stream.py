"""Collect native coding tool calls atomically; never expose partial arguments."""
from __future__ import annotations

import json

import httpx
import openai


class IncompleteCodeStream(openai.OpenAIError):
    """A started stream is unsafe to turn into executable tool calls."""


def _incomplete():
    return IncompleteCodeStream('Model stream did not contain a complete response; no tool was executed.')


def collect_code_completion(client, kwargs):
    """Retry may happen before the first event, never after a started stream.

    The SDK joins content/tool deltas by index and keeps terminal usage. We
    consume every event privately, then validate the completed envelope before
    the caller can construct ToolCalls. Hidden reasoning is never published.
    """
    received = False
    try:
        with client.chat.completions.stream(**kwargs, stream_options={'include_usage': True}) as stream:
            for _event in stream:
                received = True
            completion = stream.get_final_completion()
        if len(completion.choices) != 1:
            raise _incomplete()
        choice = completion.choices[0]
        if choice.finish_reason not in ('stop', 'tool_calls'):
            raise _incomplete()
        calls = choice.message.tool_calls or []
        if calls and choice.finish_reason != 'tool_calls':
            raise _incomplete()
        ids = set()
        for call in calls:
            if not call.id or call.id in ids or not call.function.name:
                raise _incomplete()
            ids.add(call.id)
            if not isinstance(json.loads(call.function.arguments), dict):
                raise _incomplete()
        return completion
    except Exception as error:
        if received:
            # Do not replay an expensive partially generated response or let
            # callers execute its fragments. The task can resume explicitly.
            raise _incomplete() from None
        if isinstance(error, openai.OpenAIError):
            raise
        # httpx can fail while reading the first SSE event after HTTP headers.
        # Normalize those establishment failures for the existing retry policy.
        request = httpx.Request('POST', 'https://model.invalid/')
        if isinstance(error, httpx.TimeoutException):
            raise openai.APITimeoutError(request=request) from None
        if isinstance(error, httpx.TransportError):
            raise openai.APIConnectionError(request=request) from None
        raise _incomplete() from None

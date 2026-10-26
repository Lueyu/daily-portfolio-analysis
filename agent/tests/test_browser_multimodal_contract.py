"""Image observations must preserve native tool protocol and capability gates."""

import json
from types import SimpleNamespace

import pytest

from agent_core.coder.scratchpad import Scratchpad
from agent_core.models.openai_compatible import OpenAICompatibleProvider
from agent_core.models.router import ChatService
from agent_core.models.specs import build_specs
from agent_core.models.types import ChatRequest, ModelSpec, ModelTask, estimate_prompt_tokens


def image_message(size=128):
    return {"role": "user", "content": [
        {"type": "text", "text": "Browser screenshot"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64," + "A" * size}},
    ]}


def provider(supports_images=False):
    return OpenAICompatibleProvider(
        "flash", "http://unused.invalid", "test-key", "test-model",
        spec=ModelSpec("flash", "test-model", 128_000, supports_images=supports_images),
    )


def settings(**overrides):
    values = dict(default_tier="flash", flash_model="flash", pro_model="pro",
                  flash_cost_per_mtok_input=0, flash_cost_per_mtok_output=0,
                  pro_cost_per_mtok_input=0, pro_cost_per_mtok_output=0)
    values.update(overrides)
    return SimpleNamespace(**values)


def test_image_token_estimate_is_bounded_and_includes_text():
    small = estimate_prompt_tokens([image_message(128)])
    huge = estimate_prompt_tokens([image_message(2_000_000)])
    assert 500 <= small == huge <= 3000
    assert estimate_prompt_tokens([image_message(), {"role": "user", "content": "x" * 350}]) > small


def test_provider_preserves_image_parts_and_adds_json_hint():
    req = ChatRequest(messages=[image_message()], json_mode=True)
    kwargs = provider(True)._build_kwargs(req)
    assert kwargs["messages"][-1] == req.messages[0]
    assert "JSON" in kwargs["messages"][0]["content"]
    assert kwargs["response_format"] == {"type": "json_object"}


def test_provider_rejects_image_for_unsupported_model_before_network():
    with pytest.raises(ValueError, match="does not support image"):
        provider()._build_kwargs(ChatRequest(messages=[image_message()]))


def test_json_hint_only_inspects_text_parts():
    message = image_message()
    message["content"][0]["text"] = "Describe this as JSON"
    kwargs = provider(True)._build_kwargs(ChatRequest(messages=[message], json_mode=True))
    assert kwargs["messages"] == [message]


def test_image_capability_comes_from_explicit_tier_settings():
    assert not build_specs(settings())["flash"].supports_images
    svc = ChatService(settings(flash_supports_images=True, pro_supports_images=False))
    assert svc.supports_images_for(ModelTask.CODE)
    assert not svc.supports_images_for(ModelTask.PLAN)


def test_image_observation_follows_all_native_results_without_breaking_pair():
    pad = Scratchpad("system", "task")
    pad.assistant_tool_calls("", [
        {"id": call_id, "type": "function", "function": {"name": "browser_screenshot", "arguments": "{}"}}
        for call_id in ("first", "second")
    ])
    pad.tool_result("first", "browser_screenshot", "first image saved")
    pad.tool_result("second", "browser_screenshot", "second image saved")
    pad.image_observation("data:image/png;base64,AAAA", "Desktop screenshot")
    assert [message["role"] for message in pad.messages] == ["system", "user", "assistant", "tool", "tool", "user"]
    assert pad.messages[-1]["content"][0] == {"type": "text", "text": "Desktop screenshot"}
    assert pad.messages[-1]["content"][1]["image_url"]["url"] == "data:image/png;base64,AAAA"


def test_image_observation_rejects_pending_tool_results():
    pad = Scratchpad("system", "task")
    pad.assistant_tool_calls("", [{"id": "pending", "type": "function", "function": {
        "name": "browser_screenshot", "arguments": "{}",
    }}])
    with pytest.raises(ValueError, match="pending tool"):
        pad.image_observation("data:image/png;base64,AAAA", "screenshot")


def test_image_compaction_never_copies_base64_into_summary():
    pad = Scratchpad("system", "task", max_context_bytes=1600)
    pad.assistant_text("inspect screenshot")
    pad.image_observation("data:image/png;base64," + "ABCD" * 8000, "Screenshot showing clipped toolbar")
    pad.compact()
    encoded = json.dumps(pad.messages)
    assert len(encoded.encode()) <= 1600
    assert "clipped toolbar" in encoded
    assert "ABCD" not in encoded
    assert "image omitted" in encoded


@pytest.mark.parametrize("url", ["https://example.com/p.png", "file:///secret", "data:text/html;base64,AAAA"])
def test_image_observation_requires_embedded_supported_image(url):
    with pytest.raises(ValueError, match="image data URL"):
        Scratchpad("s", "t").image_observation(url, "screenshot")

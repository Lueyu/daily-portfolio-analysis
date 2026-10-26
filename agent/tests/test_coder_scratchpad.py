import json
import pytest

from agent_core.coder.scratchpad import Scratchpad


def test_restored_compacted_history_can_be_compacted_again():
    pad = Scratchpad("system", "task", max_context_bytes=1400)
    for i in range(8):
        pad.assistant_text("action " + str(i))
        pad.observation("result " * 100)
        pad.compact()
    resumed = Scratchpad("system", "fresh task", max_context_bytes=1400)
    resumed.restore(pad.messages)
    resumed.assistant_text("new action")
    resumed.observation("new " * 1000)
    resumed.compact()
    from agent_core.coder.scratchpad import _encoded_size
    assert _encoded_size(resumed.messages) <= 1400
    assert resumed.messages[1]["content"] == "fresh task"


def test_starts_with_system_and_user():
    s = Scratchpad("sys", "user-task")
    assert s.messages[0] == {"role": "system", "content": "sys"}
    assert s.messages[1] == {"role": "user", "content": "user-task"}


def test_function_protocol_round_trip():
    s = Scratchpad("sys", "task")
    s.assistant_tool_calls(
        "looking", [{"id": "c1", "type": "function",
                     "function": {"name": "read_file", "arguments": '{"path":"a"}'}}])
    s.tool_result("c1", "read_file", "FILE a:\nhello")
    last = s.messages[-1]
    assert last["role"] == "tool" and last["tool_call_id"] == "c1"
    assert "hello" in last["content"]


def test_json_protocol_uses_user_observations():
    s = Scratchpad("sys", "task")
    s.assistant_text('{"action":"read_file","path":"a"}')
    s.observation("FILE a:\nx")
    assert s.messages[-1]["role"] == "user"
    assert "FILE a" in s.messages[-1]["content"]


def test_observations_are_truncated():
    s = Scratchpad("sys", "task")
    s.tool_result("c1", "terminal_poll", "x" * 9000)
    assert len(s.messages[-1]["content"]) <= 6000


def encoded_size(messages):
    return len(json.dumps(messages, ensure_ascii=False).encode("utf-8"))


def assert_complete_tool_groups(messages):
    pending = set()
    for message in messages:
        if message["role"] == "assistant":
            assert not pending
            pending = {call["id"] for call in message.get("tool_calls", [])}
        elif message["role"] == "tool":
            assert message["tool_call_id"] in pending
            pending.remove(message["tool_call_id"])
        else:
            assert not pending
    assert not pending


def test_long_native_history_compacts_complete_turns_with_evidence_summary():
    pad = Scratchpad("system rules", "original task and acceptance", max_context_bytes=5000)
    original = pad.messages[:]
    for turn in range(40):
        pad.assistant_tool_calls("inspect", [
            {"id": f"{turn}-a", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"a.ts"}'}},
            {"id": f"{turn}-b", "type": "function", "function": {"name": "grep", "arguments": '{"pattern":"p"}'}},
        ])
        pad.tool_result(f"{turn}-a", "read_file", "real evidence " + "内容" * 200)
        pad.tool_result(f"{turn}-b", "grep", f"LATEST_{turn}: concrete match")
        pad.compact()
        assert encoded_size(pad.messages) <= 5000
        assert pad.messages[:2] == original
        assert_complete_tool_groups(pad.messages)
    assert "Earlier completed turns" in pad.messages[2]["content"]
    assert "read_file" in pad.messages[2]["content"]
    assert pad.messages[-1]["content"] == "LATEST_39: concrete match"


def test_json_history_compacts_without_losing_original_task_or_latest_observation():
    pad = Scratchpad("system", "acceptance unchanged", max_context_bytes=2000)
    for turn in range(40):
        pad.assistant_text(json.dumps({"action": "read_file", "path": "x.ts"}))
        pad.observation(f"observation {turn}: " + "x" * 500)
        pad.compact()
        assert encoded_size(pad.messages) <= 2000
    assert pad.messages[0]["content"] == "system"
    assert pad.messages[1]["content"] == "acceptance unchanged"
    assert "observation 39" in pad.messages[-1]["content"]


def test_one_oversized_completed_tool_turn_is_summarized_as_a_whole():
    pad = Scratchpad("system", "task", max_context_bytes=2000)
    pad.assistant_tool_calls("", [{"id": "big", "type": "function", "function": {
        "name": "apply_patch", "arguments": json.dumps({"diff": "x" * 20_000}),
    }}])
    pad.tool_result("big", "apply_patch", "candidate failed with precise check evidence")
    pad.compact()
    assert encoded_size(pad.messages) <= 2000
    assert_complete_tool_groups(pad.messages)
    assert "apply_patch" in pad.messages[2]["content"]
    assert "precise check evidence" in pad.messages[2]["content"]


def test_compaction_never_separates_pending_native_tool_calls():
    pad = Scratchpad("system", "task", max_context_bytes=1500)
    pad.assistant_tool_calls("", [
        {"id": "a", "type": "function", "function": {"name": "read_file", "arguments": "{}"}},
        {"id": "b", "type": "function", "function": {"name": "read_file", "arguments": "{}"}},
    ])
    pad.tool_result("a", "read_file", "x" * 2000)
    pad.compact()
    assert pad.messages[2]["tool_calls"][1]["id"] == "b"
    pad.tool_result("b", "read_file", "complete")
    pad.compact()
    assert encoded_size(pad.messages) <= 1500
    assert_complete_tool_groups(pad.messages)


def _many_complete_turns(pad, count=10):
    for turn in range(count):
        pad.assistant_tool_calls("inspect", [{"id": str(turn), "type": "function", "function": {
            "name": "read_file", "arguments": "{}",
        }}])
        pad.tool_result(str(turn), "read_file", "evidence " * 100)


def test_leading_legacy_user_instruction_does_not_block_compaction():
    pad = Scratchpad("system", "task", max_context_bytes=1000)
    instruction = "保留所有键盘交互；不要修改服务端接口。"
    pad.messages.append({"role": "user", "content": instruction})
    _many_complete_turns(pad)
    pad.compact()
    assert encoded_size(pad.messages) <= 1000
    assert any(message.get("content") == instruction for message in pad.messages)
    assert_complete_tool_groups(pad.messages)


def test_multiple_live_instructions_survive_compaction_and_restore_verbatim():
    pad = Scratchpad("system", "task", max_context_bytes=1400)
    first = "Do not rename the public API."
    latest = "Correction: change only the button colour, and preserve keyboard support."
    pad.user_input(first)
    _many_complete_turns(pad, 3)
    pad.user_input(latest)
    _many_complete_turns(pad, 4)
    pad.compact()
    assert encoded_size(pad.messages) <= 1400
    assert [m["content"] for m in pad.messages if m.get("name") == "user_feedback"] == [first, latest]
    resumed = Scratchpad("system", "fresh task state", max_context_bytes=1400)
    resumed.restore(pad.messages)
    _many_complete_turns(resumed)
    resumed.compact()
    assert encoded_size(resumed.messages) <= 1400
    assert [m["content"] for m in resumed.messages if m.get("name") == "user_feedback"] == [first, latest]
    assert_complete_tool_groups(resumed.messages)


def test_restore_does_not_treat_real_leading_user_message_as_historical_excerpt():
    instruction = "Do not touch auth. " + "Keep this exact user requirement. " * 180
    saved = [{"role": "system", "content": "old"}, {"role": "user", "content": "task"},
             {"role": "user", "content": instruction}]
    resumed = Scratchpad("system", "fresh task", max_context_bytes=12000)
    resumed.restore(saved)
    assert any(message.get("content") == instruction for message in resumed.messages)


def test_pinned_user_intent_too_large_is_explicit_not_silently_truncated():
    pad = Scratchpad("system", "task", max_context_bytes=1000)
    instruction = "must preserve this exact requirement " * 80
    pad.user_input(instruction)
    _many_complete_turns(pad)
    with pytest.raises(ValueError, match="user instructions.*context"):
        pad.compact()
    assert any(message.get("content") == instruction for message in pad.messages)

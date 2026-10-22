from agent_core.coder.scratchpad import Scratchpad


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
    s.tool_result("c1", "read_file", "x" * 9000)
    assert len(s.messages[-1]["content"]) <= 6000

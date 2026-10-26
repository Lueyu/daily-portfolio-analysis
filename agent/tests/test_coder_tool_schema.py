from agent_core.coder.parser import build_default_registry
from agent_core.coder.tool_schema import openai_tool_schema, openai_tools_payload


def test_read_file_schema_describes_path():
    reg = build_default_registry()
    schema = openai_tool_schema(reg.get("read_file"))
    assert schema["type"] == "function"
    fn = schema["function"]
    assert fn["name"] == "read_file"
    assert fn["parameters"]["properties"]["path"]["type"] == "string"
    assert fn["parameters"]["required"] == ["path"]


def test_run_check_uses_explicit_check_enum():
    reg = build_default_registry()
    fn = openai_tool_schema(reg.get("run_check"))["function"]
    assert "check" in fn["parameters"]["properties"]
    assert set(fn["parameters"]["properties"]["check"]["enum"]) == {
        "unit", "e2e", "typecheck", "lint"}
    assert fn["parameters"]["required"] == ["check"]


def test_payload_is_list_of_function_tools():
    reg = build_default_registry()
    visible = [reg.get(n) for n in ("read_file", "run_check")]
    payload = openai_tools_payload(visible)
    assert [t["function"]["name"] for t in payload] == ["read_file", "run_check"]
    assert all(t["type"] == "function" for t in payload)

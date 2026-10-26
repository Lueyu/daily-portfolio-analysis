# tests/test_coder_registry.py
import pytest

from agent_core.coder.registry import (
    GateKind,
    ToolKind,
    ToolRegistry,
    UnknownToolError,
)
from agent_core.coder.parser import (
    ApplyPatchStep,
    BlockedStep,
    FinishStep,
    ReadFileStep,
    RunCheckStep,
    build_default_registry,
    parse_agent_step,
)
from agent_core.coder.models import CheckKind


def test_registry_rejects_unknown_tool():
    reg = ToolRegistry()
    with pytest.raises(UnknownToolError):
        reg.parse('{"action":"rm_rf","params":{"path":"/"}}')


def test_default_registry_knows_all_existing_actions():
    reg = build_default_registry()
    assert set(reg.names()) >= {
        "read_file", "run_check", "apply_patch", "finish", "blocked"}


def test_parse_flat_and_params_envelopes_equivalent():
    flat = parse_agent_step('{"action":"read_file","path":"a.ts"}')
    nested = parse_agent_step(
        '{"action":"read_file","params":{"path":"a.ts"}}')
    assert isinstance(flat, ReadFileStep) and flat.path == "a.ts"
    assert isinstance(nested, ReadFileStep) and nested.path == "a.ts"


def test_run_check_maps_check_to_kind():
    step = parse_agent_step('{"action":"run_check","params":{"check":"e2e"}}')
    assert isinstance(step, RunCheckStep) and step.kind == CheckKind.E2E


def test_apply_patch_and_terminal_actions():
    assert isinstance(
        parse_agent_step('{"action":"apply_patch","params":{"diff":"--- a/x"}}'),
        ApplyPatchStep)
    assert isinstance(
        parse_agent_step('{"action":"finish","params":{"summary":"done"}}'),
        FinishStep)
    assert isinstance(
        parse_agent_step('{"action":"blocked","params":{"reason":"env"}}'),
        BlockedStep)


def test_missing_fields_rejected():
    with pytest.raises(ValueError):
        parse_agent_step('{"action":"read_file"}')
    with pytest.raises(ValueError):
        parse_agent_step('{"action":"apply_patch"}')
    with pytest.raises(ValueError):
        parse_agent_step('{"action":"finish"}')


def test_run_check_rejects_relative_and_unknown_kind():
    with pytest.raises(ValueError):
        parse_agent_step('{"action":"run_check","params":{"check":"../../x"}}')
    with pytest.raises(ValueError):
        parse_agent_step('{"action":"run_check","params":{"check":"build"}}')


def test_validate_accepts_dict_payload():
    reg = build_default_registry()
    step = reg.validate("read_file", {"path": "a.ts"})
    assert isinstance(step, ReadFileStep) and step.path == "a.ts"


def test_validate_rejects_extra_fields():
    reg = build_default_registry()
    with pytest.raises(ValueError):
        reg.validate("read_file", {"path": "a.ts", "bogus": 1})


def test_validate_unknown_tool():
    reg = build_default_registry()
    with pytest.raises(UnknownToolError):
        reg.validate("rm_rf", {"path": "/"})


def test_parse_action_returns_name_and_payload():
    reg = build_default_registry()
    name, payload = reg.parse_action(
        '{"action":"read_file","params":{"path":"a.ts"}}')
    assert name == "read_file" and payload == {"path": "a.ts"}
    name2, payload2 = reg.parse_action('{"action":"read_file","path":"b.ts"}')
    assert name2 == "read_file" and payload2 == {"path": "b.ts"}


def test_gate_metadata_is_declared():
    reg = build_default_registry()
    assert reg.get("read_file").gate == GateKind.ALWAYS
    assert reg.get("run_check").gate == GateKind.ALWAYS
    assert reg.get("apply_patch").gate == GateKind.NEEDS_RED
    assert reg.get("finish").gate == GateKind.NEEDS_GREEN
    assert reg.get("blocked").gate == GateKind.ALWAYS
    assert reg.get("read_file").kind == ToolKind.READ_ONLY
    assert reg.get("apply_patch").kind == ToolKind.PATCH

# tests/test_coder_registry.py
import pytest

from agent_core.coder.registry import (
    Phase,
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


def test_phase_metadata_is_declared():
    reg = build_default_registry()
    assert reg.is_allowed("read_file", Phase.REPRODUCE)
    assert reg.is_allowed("read_file", Phase.DIAGNOSE)
    assert not reg.is_allowed("apply_patch", Phase.REPRODUCE)
    assert reg.is_allowed("apply_patch", Phase.DIAGNOSE)
    assert reg.get("read_file").kind == ToolKind.READ_ONLY
    assert reg.get("apply_patch").kind == ToolKind.PATCH

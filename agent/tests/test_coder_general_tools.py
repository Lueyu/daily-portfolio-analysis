"""The general agent exposes editing before red and validates tool inputs."""
import importlib.util

import pytest


def registry():
    name = "agent_core.coder.general_tools"
    assert importlib.util.find_spec(name), "general agent tool contract is missing"
    from agent_core.coder.general_tools import build_general_registry
    return build_general_registry()


def test_general_agent_can_edit_before_any_failed_test():
    from agent_core.coder.gates import GateState, visible_tools
    names = visible_tools(registry(), GateState())
    assert {"write_file", "edit_file", "apply_patch", "terminal_start", "browser"} <= set(names)
    # Completion is validated by current revision evidence in the executor;
    # hiding it sent v2 models the obsolete apply_patch prerequisite.
    assert "finish" in names


def test_terminal_and_verification_have_precise_parameters():
    reg = registry()
    step = reg.validate("terminal_start", {"command": "python -m pytest -q", "reason": "inspect failure"})
    assert step.cwd == "."
    assert step.timeout_seconds > 0
    step = reg.validate("verify", {"command": "npm test", "criterion_ids": ["ac1"], "scope": "target"})
    assert step.criterion_ids == ["ac1"]
    with pytest.raises(ValueError):
        reg.validate("terminal_start", {"command": "echo hi", "reason": "x", "timeout_seconds": -1})


def test_undo_requires_revision_to_protect_later_edits():
    reg = registry()
    with pytest.raises(ValueError):
        reg.validate("undo_change", {"change_id": "abc"})
    assert reg.validate("undo_change", {"change_id": "abc", "expected_revision": "abc"}).change_id == "abc"


def test_unknown_browser_parameters_do_not_become_shell_arguments():
    reg = registry()
    with pytest.raises(ValueError):
        reg.validate("browser", {"action": "navigate", "command": "host command"})

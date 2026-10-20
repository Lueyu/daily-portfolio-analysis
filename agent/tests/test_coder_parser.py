import pytest

from agent_core.coder.models import CheckKind
from agent_core.coder.parser import (
    ApplyPatchStep,
    FinishStep,
    BlockedStep,
    ReadFileStep,
    RunCheckStep,
    parse_agent_step,
)


def test_parse_read_file():
    step = parse_agent_step('{"action": "read_file", "path": "server/x.ts"}')
    assert isinstance(step, ReadFileStep)
    assert step.path == "server/x.ts"


def test_parse_run_check():
    step = parse_agent_step('{"action": "run_check", "check": "unit"}')
    assert isinstance(step, RunCheckStep)
    assert step.kind == CheckKind.UNIT


def test_parse_apply_patch():
    step = parse_agent_step(
        '{"action": "apply_patch", "diff": "--- a/x", "hypothesis": "h1"}'
    )
    assert isinstance(step, ApplyPatchStep)
    assert step.hypothesis == "h1"
    assert step.diff.startswith("--- a/x")


def test_parse_finish():
    step = parse_agent_step('{"action": "finish", "summary": "fixed"}')
    assert isinstance(step, FinishStep)
    assert step.summary == "fixed"


def test_parse_finish_blocked():
    step = parse_agent_step('{"action": "blocked", "reason": "no reproduction"}')
    assert isinstance(step, BlockedStep)
    assert step.reason == "no reproduction"


def test_parse_tolerates_json_code_fence():
    step = parse_agent_step(
        '```json\n{"action": "read_file", "path": "server/x.ts"}\n```'
    )
    assert isinstance(step, ReadFileStep)


def test_parse_unknown_action_raises():
    with pytest.raises(ValueError):
        parse_agent_step('{"action": "network", "host": "x"}')


def test_parse_missing_path_raises():
    with pytest.raises(ValueError):
        parse_agent_step('{"action": "read_file"}')


def test_parse_missing_diff_raises():
    with pytest.raises(ValueError):
        parse_agent_step('{"action": "apply_patch"}')


def test_parse_missing_check_raises():
    with pytest.raises(ValueError):
        parse_agent_step('{"action": "run_check"}')


def test_parse_rejects_disallowed_relative_check():
    with pytest.raises(ValueError):
        parse_agent_step('{"action": "run_check", "check": "../../../evil"}')

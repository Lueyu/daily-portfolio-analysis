import json

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


def test_read_file_pagination_contract():
    step = parse_agent_step(json.dumps({
        "action": "read_file", "path": "long.ts", "start_line": 150,
        "max_lines": 20, "start_column": 4001,
    }))
    assert (step.start_line, step.max_lines, step.start_column) == (150, 20, 4001)
    defaults = ReadFileStep(path="long.ts")
    assert (defaults.start_line, defaults.max_lines, defaults.start_column) == (1, 80, 1)


@pytest.mark.parametrize("field,value", [
    ("start_line", 0), ("start_column", 0), ("max_lines", 0),
    ("max_lines", 201), ("start_line", 1.5),
])
def test_read_file_rejects_invalid_page(field, value):
    with pytest.raises(ValueError):
        ReadFileStep(path="long.ts", **{field: value})


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


def test_patch_parsing_preserves_diff_whitespace_and_final_newline():
    diff = "--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+fixed \n"
    step = parse_agent_step(json.dumps({"action": "apply_patch", "diff": diff}))
    assert step.diff == diff


@pytest.mark.parametrize("diff", ["", "  \n\t"])
def test_whitespace_only_patch_is_rejected(diff):
    with pytest.raises(ValueError):
        parse_agent_step(json.dumps({"action": "apply_patch", "diff": diff}))


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

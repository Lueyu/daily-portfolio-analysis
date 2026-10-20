from agent_core.coder.models import CheckKind, CommandResult
from agent_core.coder.tools import ControlledTools, parse_test_output

VITEST_PASS = """
 ✓ server/x.spec.ts (2)
 Test Files  1 passed (1)
      Tests  2 passed (2)
"""

VITEST_FAIL = """
FAIL server/modules/multi-agent/rating-rules.ts > caps buy
expected: 'Hold' to equal 'Buy'
stderr-tail
"""

E2E_PASS = """
Running 1 test using 1 worker
  ✓ home loads (300 ms)
  5 passed (5s)
  1 failed
"""


def make_runner(output):
    captured = {}

    def run(argv, cwd, timeout=None, stdin=None):
        captured["argv"] = argv
        captured["stdin"] = stdin
        return output

    return run, captured


def test_run_check_parses_passed():
    runner, captured = make_runner(
        CommandResult(argv=[], returncode=0, stdout=VITEST_PASS)
    )
    tools = ControlledTools(workdir="D:/stock/code", runner=runner)
    outcome = tools.run_check(CheckKind.UNIT)
    assert captured["argv"] == ["npm", "run", "test:unit"]
    assert outcome.passed
    assert "2 passed" in outcome.summary


def test_run_check_parses_failures_and_tail():
    runner, _ = make_runner(
        CommandResult(argv=[], returncode=2, stdout=VITEST_FAIL, stderr="stderr-tail")
    )
    tools = ControlledTools(workdir="D:/stock/code", runner=runner)
    outcome = tools.run_check(CheckKind.TYPECHECK)
    assert not outcome.passed
    assert "rating-rules" in outcome.failed
    assert "stderr-tail" in outcome.raw_tail


def test_parse_e2e_summary():
    outcome = parse_test_output(
        CheckKind.E2E,
        ["npm", "run", "test:e2e"],
        CommandResult(argv=[], returncode=0, stdout=E2E_PASS),
    )
    assert outcome.passed
    assert "5 passed" in outcome.summary


def test_read_file_within_workdir(tmp_path):
    (tmp_path / "x.ts").write_text("hello", encoding="utf-8")
    tools = ControlledTools(tmp_path)
    assert tools.read_file("x.ts") == "hello"


def test_read_file_rejects_escape(tmp_path):
    tools = ControlledTools(tmp_path)
    import pytest
    from agent_core.coder.safety import SafetyViolation

    with pytest.raises(SafetyViolation):
        tools.read_file("../outside.ts")


def test_git_apply_uses_stdin(tmp_path):
    DIFF = "--- a/x.ts\n+++ b/x.ts\n"
    captured = {}

    def run(argv, cwd, timeout=None, stdin=None):
        captured.update(argv=argv, stdin=stdin)
        return CommandResult(argv=argv, returncode=0, stdout="", stderr="")

    tools = ControlledTools(tmp_path, runner=run)
    res = tools.git_apply(DIFF, cwd=tmp_path)
    assert res.ok
    assert res.argv == ["git", "apply", "--whitespace=nowarn", "-"]
    assert captured["stdin"] == DIFF

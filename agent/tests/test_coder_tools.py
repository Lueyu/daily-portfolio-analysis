# tests/test_coder_tools.py
from pathlib import Path

import pytest

from agent_core.coder.models import CheckKind, CommandResult
from agent_core.coder.safety import SafetyViolation
from agent_core.coder.tools import ControlledTools, parse_test_output


def script_runner(table):
    """Return a runner that responds by argv substring, recording calls."""
    calls = []

    def run(argv, cwd, timeout=None, stdin=None):
        calls.append((list(argv), str(cwd), stdin))
        for needle, result in table:
            if needle in " ".join(argv):
                return result
        return CommandResult(argv=list(argv), returncode=0, stdout="", stderr="")
    run.calls = calls
    return run


def test_read_file_inside_workdir(tmp_path):
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "x.ts").write_text("export const a = 1", encoding="utf-8")
    tools = ControlledTools(tmp_path)
    assert "a = 1" in tools.read_file("server/x.ts")


def test_read_file_rejects_escape(tmp_path):
    tools = ControlledTools(tmp_path)
    with pytest.raises(SafetyViolation):
        tools.read_file("../outside.txt")


def test_run_check_uses_whitelisted_argv_and_parses(tmp_path):
    ok = CommandResult(
        argv=["npm", "run", "test:unit"], returncode=0,
        stdout="Test Files  1 passed\nTests  15 passed (15)\n", stderr="")
    runner = script_runner([("test:unit", ok)])
    tools = ControlledTools(tmp_path, runner=runner)
    outcome = tools.run_check(CheckKind.UNIT)
    assert outcome.passed is True
    assert runner.calls[0][0] == ["npm", "run", "test:unit"]
    assert Path(runner.calls[0][1]) == tmp_path.resolve()


def test_parse_vitest_failure_collects_names_and_counts():
    text = (
        " ❯ server/rating-rules.spec.ts > caps Buy to Hold\n"
        " × caps Buy to Hold\n\n"
        " Test Files  1 failed\n Tests  1 failed | 14 passed (15)\n"
    )
    res = CommandResult(argv=["npm", "run", "test:unit"], returncode=1,
                        stdout=text, stderr="")
    out = parse_test_output(CheckKind.UNIT, res.argv, res)
    assert out.passed is False
    assert out.total == 15
    assert any("caps Buy to Hold" in n for n in out.failed)


def test_parse_vitest_success():
    res = CommandResult(argv=["npm", "run", "test:unit"], returncode=0,
                        stdout="Tests  15 passed (15)\n", stderr="")
    out = parse_test_output(CheckKind.UNIT, res.argv, res)
    assert out.passed and out.total == 15 and out.failed == []


def test_parse_typecheck_failure():
    res = CommandResult(argv=["npm", "run", "type:check"], returncode=2,
                        stdout="", stderr="server/x.ts(10,5): error TS2322: Type X")
    out = parse_test_output(CheckKind.TYPECHECK, res.argv, res)
    assert out.passed is False
    assert "TS2322" in out.raw_tail


def test_git_apply_uses_stdin_not_shell(tmp_path):
    runner = script_runner([("git apply", CommandResult(argv=["git", "apply"], returncode=0))])
    tools = ControlledTools(tmp_path, runner=runner)
    result = tools.git_apply("--- a/x\n+++ b/x\n")
    assert result.ok
    assert runner.calls[0][0] == ["git", "apply", "--whitespace=nowarn", "-"]


def test_default_runner_missing_command_returns_127(tmp_path):
    from agent_core.coder.tools import default_runner
    res = default_runner(["definitely_no_such_binary_xyz_9"], tmp_path, 5.0, None)
    assert res.returncode == 127
    assert "definitely_no_such_binary_xyz_9" in res.stderr


def test_default_runner_resolves_executable_via_which(tmp_path, monkeypatch):
    # On Windows, shell=False cannot spawn "npm" (it is npm.cmd); the runner
    # must resolve the executable through shutil.which/PATHEXT.
    import agent_core.coder.tools as tools_mod

    captured = {}

    class FakeProc:
        returncode = 0
        stdout = b""
        stderr = b""

    def fake_run(argv, **kwargs):
        captured["argv"] = argv
        return FakeProc()

    monkeypatch.setattr(
        tools_mod.shutil, "which",
        lambda name: f"/resolved/{name}.cmd" if name == "npm" else None)
    monkeypatch.setattr(tools_mod.subprocess, "run", fake_run)
    tools_mod.default_runner(["npm", "run", "test:unit"], tmp_path, 5.0, None)
    assert captured["argv"][0] == "/resolved/npm.cmd"


def test_git_diff_is_readonly(tmp_path):
    runner = script_runner([("git diff", CommandResult(argv=["git", "diff"], returncode=0, stdout="DIFF"))])
    tools = ControlledTools(tmp_path, runner=runner)
    assert "DIFF" in tools.git_diff()
    assert runner.calls[0][0] == ["git", "diff"]

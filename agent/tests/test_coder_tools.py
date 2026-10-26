# tests/test_coder_tools.py
from pathlib import Path

import pytest

from agent_core.coder.models import (
    CheckKind,
    CommandResult,
    ProbeResult,
    ProbeTarget,
)
from agent_core.coder.safety import SafetyViolation, guard_worktree_args
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


def test_read_file_page_reaches_code_beyond_old_prefix(tmp_path):
    lines = [f"line {number}: " + "x" * 60 for number in range(1, 151)]
    lines[139] = "const importantFix = true;"
    (tmp_path / "long.ts").write_text("\n".join(lines), encoding="utf-8")
    tools = ControlledTools(tmp_path)
    first = tools.read_file_page("long.ts")
    assert "total_lines=150" in first and "NEXT start_line=" in first
    assert "lines=1-80" in first and "NEXT start_line=81 start_column=1" in first
    later = tools.read_file_page("long.ts", start_line=138, max_lines=5)
    assert "140: const importantFix = true;" in later
    assert "NEXT start_line=143 start_column=1" in later


def test_read_file_page_long_line_continuation_loses_no_characters(tmp_path):
    import re

    original = "甲" * 14300 + "UNIQUE_TAIL" + "乙" * 13000
    (tmp_path / "long.ts").write_text(original + "\nlast line", encoding="utf-8")
    tools = ControlledTools(tmp_path)
    column = 1
    collected = ""
    for _ in range(4):
        page = tools.read_file_page("long.ts", start_line=1,
                                    start_column=column, max_lines=1)
        assert len(page) < 14000
        row = next(line for line in page.splitlines() if line.startswith("1"))
        collected += row.split(": ", 1)[1]
        continuation = re.search(r"NEXT start_line=1 start_column=(\d+)", page)
        if not continuation:
            assert "NEXT start_line=2 start_column=1" in page
            break
        column = int(continuation.group(1))
        assert "columns=" in row and "truncated" in page
    assert collected == original


def test_read_file_page_empty_eof_and_security(tmp_path):
    (tmp_path / "empty.ts").write_text("", encoding="utf-8")
    tools = ControlledTools(tmp_path)
    assert "EOF" in tools.read_file_page("empty.ts")
    with pytest.raises(SafetyViolation):
        tools.read_file_page("../outside.txt")


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


# --- read-only exploration: list_dir / glob / grep ---------------------

def test_list_dir_lists_entries_and_hides_sensitive(tmp_path):
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "a.ts").write_text("x", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "x").write_text("x", encoding="utf-8")
    (tmp_path / ".env").write_text("SECRET=1", encoding="utf-8")
    tools = ControlledTools(tmp_path)
    out = tools.list_dir(".")
    assert "server/" in out and "a.ts" not in out        # only one level deep
    assert "node_modules" not in out and ".env" not in out


def test_list_dir_rejects_escape(tmp_path):
    with pytest.raises(SafetyViolation):
        ControlledTools(tmp_path).list_dir("..")


def test_list_dir_missing_path_is_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        ControlledTools(tmp_path).list_dir("nope")


def test_glob_finds_files_and_hides_sensitive(tmp_path):
    (tmp_path / "server").mkdir()
    (tmp_path / "server" / "a.service.ts").write_text("x", encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "b.service.ts").write_text("x", encoding="utf-8")
    out = ControlledTools(tmp_path).glob("**/*.service.ts")
    assert "server/a.service.ts" in out
    assert "node_modules" not in out


def test_glob_no_matches_message(tmp_path):
    assert ControlledTools(tmp_path).glob("**/*.zzz") == "(no matches)"


def test_glob_result_limit_is_explicit(tmp_path):
    for number in range(101):
        (tmp_path / f"source{number}.ts").write_text("", encoding="utf-8")
    result = ControlledTools(tmp_path).glob("*.ts")
    assert len([line for line in result.splitlines() if line.endswith(".ts")]) == 100
    assert "truncated" in result and "narrow" in result


def test_grep_matches_content_with_line_numbers(tmp_path):
    (tmp_path / "server").mkdir(parents=True)
    (tmp_path / "server" / "a.ts").write_text(
        "const keep = 1\nconst findme = 2\n", encoding="utf-8")
    out = ControlledTools(tmp_path).grep("findme", glob_include="*.ts")
    assert "server/a.ts:2:" in out and "findme" in out


def test_grep_respects_max_results_and_skips_binary(tmp_path):
    (tmp_path / "a.bin").write_bytes(b"\x00\x01findme\x00")
    (tmp_path / "a.txt").write_text("findme\n", encoding="utf-8")
    out = ControlledTools(tmp_path).grep("findme", max_results=50)
    assert "a.txt" in out and "a.bin" not in out


def test_grep_bad_regex_is_value_error(tmp_path):
    with pytest.raises(ValueError):
        ControlledTools(tmp_path).grep("(")


def test_grep_no_matches_message(tmp_path):
    (tmp_path / "a.txt").write_text("hello\n", encoding="utf-8")
    assert ControlledTools(tmp_path).grep("zzzz") == "(no matches)"


def test_grep_accepts_file_path_and_relative_include(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "select.tsx").write_text("const target = true;", encoding="utf-8")
    tools = ControlledTools(tmp_path)
    assert "select.tsx:1:" in tools.grep("target", "src/select.tsx")
    assert "src/select.tsx:1:" in tools.grep("target", glob_include="**/select.tsx")
    with pytest.raises(SafetyViolation):
        tools.grep("target", "../outside.tsx")


def test_grep_long_line_reports_matching_columns_and_read_hint(tmp_path):
    (tmp_path / "long.ts").write_text("x" * 500 + "importantMatch" + "y" * 500,
                                      encoding="utf-8")
    result = ControlledTools(tmp_path).grep("importantMatch", "long.ts")
    assert "importantMatch" in result
    assert "columns=" in result and "truncated" in result
    assert "read_file" in result and "start_line=1" in result


def test_grep_output_and_result_caps_are_explicit(tmp_path):
    (tmp_path / "many.ts").write_text("\n".join(f"target {i} " + "x" * 190
                                               for i in range(120)), encoding="utf-8")
    tools = ControlledTools(tmp_path)
    limited = tools.grep("target", max_results=2)
    assert "truncated" in limited and "narrow" in limited
    assert "many.ts:3:" not in limited
    assert len(tools.grep("target")) < 5000


# --- environment probe (localhost whitelist only) ----------------------

def _probe_targets():
    return [
        ProbeTarget(name="postgres", kind="tcp", target="127.0.0.1:5432"),
        ProbeTarget(name="backend", kind="http", target="http://localhost:3000"),
    ]


def _prober_from(mapping):
    def prober(targets):
        return [mapping[t.name] for t in targets]
    return prober


def test_probe_env_reports_up_and_down_and_summary(tmp_path):
    prober = _prober_from({
        "postgres": ProbeResult(name="postgres", kind="tcp",
                                target="127.0.0.1:5432", up=False,
                                detail="ConnectionRefused"),
        "backend": ProbeResult(name="backend", kind="http",
                               target="http://localhost:3000", up=True,
                               latency_ms=5),
    })
    tools = ControlledTools(tmp_path, probe_targets=_probe_targets(), prober=prober)
    out = tools.probe_env()
    assert "DOWN" in out and "postgres" in out
    assert "UP" in out and "backend" in out
    assert "start-db" in out


def test_probe_env_all_reachable_summary(tmp_path):
    prober = _prober_from({
        t.name: ProbeResult(name=t.name, kind=t.kind, target=t.target, up=True)
        for t in _probe_targets()
    })
    tools = ControlledTools(tmp_path, probe_targets=_probe_targets(), prober=prober)
    assert "reachable" in tools.probe_env()


def test_probe_env_rejects_target_outside_whitelist(tmp_path):
    tools = ControlledTools(tmp_path, probe_targets=_probe_targets(),
                            prober=_prober_from({}))
    with pytest.raises(ValueError):
        tools.probe_env(["evil.example.com"])


def test_probe_env_subset_by_name(tmp_path):
    seen = {}

    def prober(wanted):
        seen["names"] = [t.name for t in wanted]
        return [ProbeResult(name=t.name, kind=t.kind, target=t.target, up=True)
                for t in wanted]

    tools = ControlledTools(tmp_path, probe_targets=_probe_targets(), prober=prober)
    tools.probe_env(["backend"])
    assert seen["names"] == ["backend"]


def test_probe_env_without_targets_is_informative(tmp_path):
    assert "No environment probes configured" in ControlledTools(tmp_path).probe_env()


# --- worktree guard and controlled commands ----------------------------
def test_guard_worktree_accepts_fixed_shapes():
    guard_worktree_args(["add", "--detach", "D:/wt/t1", "HEAD"])
    guard_worktree_args(["remove", "D:/wt/t1"])
    guard_worktree_args(["list", "--porcelain"])
    guard_worktree_args(["prune"])


def test_guard_worktree_rejects_unknown_subcommand():
    with pytest.raises(SafetyViolation):
        guard_worktree_args(["move", "x"])


def test_guard_worktree_rejects_force_and_branch_flexibility():
    for bad in (
        ["add", "--force", "--detach", "D:/wt/t1", "HEAD"],
        ["add", "--detach", "D:/wt/t1", "main"],
        ["remove", "--force", "D:/wt/t1"],
        ["add", "-f", "D:/wt/t1"],
    ):
        with pytest.raises(SafetyViolation):
            guard_worktree_args(bad)


def test_git_worktree_add_uses_fixed_argv(tmp_path):
    runner = script_runner(
        [("worktree", CommandResult(argv=["git", "worktree"], returncode=0))])
    tools = ControlledTools(tmp_path, runner=runner)
    tools.git_worktree_add(tmp_path / "wt" / "t1")
    assert runner.calls[0][0] == ["git", "worktree", "add", "--detach",
                                 str(tmp_path / "wt" / "t1"), "HEAD"]


def test_git_worktree_list_and_prune_argv(tmp_path):
    runner = script_runner(
        [("worktree", CommandResult(argv=["git", "worktree"], returncode=0,
                                    stdout="worktree D:/stock/code"))])
    tools = ControlledTools(tmp_path, runner=runner)
    assert "D:/stock/code" in tools.git_worktree_list()
    tools.git_worktree_prune()
    assert any(c[0] == ["git", "worktree", "list", "--porcelain"]
               for c in runner.calls)
    assert runner.calls[-1][0] == ["git", "worktree", "prune"]


def test_snapshot_commit_refuses_main_workdir_before_any_git_write(tmp_path):
    runner = script_runner([])
    (tmp_path / ".git").write_text("gitdir: ignored")
    tools = ControlledTools(tmp_path, runner=runner)
    with pytest.raises(SafetyViolation):
        tools.git_snapshot_commit(tmp_path)
    assert runner.calls == []


def test_snapshot_commit_refuses_attached_worktree(tmp_path):
    worktree = tmp_path / "worktree"
    worktree.mkdir()
    (worktree / ".git").write_text("gitdir: ignored")
    runner = script_runner([
        ("symbolic-ref", CommandResult(argv=[], returncode=0, stdout="refs/heads/main")),
    ])
    tools = ControlledTools(tmp_path, runner=runner)
    with pytest.raises(SafetyViolation):
        tools.git_snapshot_commit(worktree)
    assert len(runner.calls) == 1
    assert "symbolic-ref" in runner.calls[0][0]


def test_initialization_unlock_refuses_unmarked_or_main_worktree(tmp_path):
    runner = script_runner([])
    tools = ControlledTools(tmp_path, runner=runner)
    with pytest.raises(SafetyViolation):
        tools.git_worktree_unlock_initialization(tmp_path / "sandbox", cwd=tmp_path)
    (tmp_path.parent / f".{tmp_path.name}.initializing").touch()
    try:
        with pytest.raises(SafetyViolation):
            tools.git_worktree_unlock_initialization(tmp_path, cwd=tmp_path)
    finally:
        (tmp_path.parent / f".{tmp_path.name}.initializing").unlink()
    assert runner.calls == []


def test_sandbox_e2e_uses_fullstack_script(tmp_path):
    runner = script_runner([])  # every check returns rc=0
    tools = ControlledTools(tmp_path, runner=runner)
    tools.run_check(CheckKind.E2E, sandboxed=True)
    assert runner.calls[0][0] == ["npm", "run", "test:e2e:fullstack"]
    # Non-sandbox E2E still uses the Vite-only smoke script.
    tools.run_check(CheckKind.E2E, sandboxed=False)
    assert runner.calls[-1][0] == ["npm", "run", "test:e2e"]

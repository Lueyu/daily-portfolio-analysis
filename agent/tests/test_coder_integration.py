# tests/test_coder_integration.py
"""Real git round-trip for the sandboxed tools (no fake runner, no npm).

Proves the path the harness relies on actually works end to end:
apply a patch -> see it in `git diff` -> reverse it -> worktree is clean.
"""
import shutil
import subprocess

import pytest

from agent_core.coder.tools import ControlledTools


@pytest.fixture()
def git_repo(tmp_path):
    if shutil.which("git") is None:
        pytest.skip("git not available")

    def run(args):
        subprocess.run(["git", *args], cwd=tmp_path, capture_output=True,
                       shell=False, check=True)

    run(["init", "-q"])
    run(["config", "user.email", "test@example.com"])
    run(["config", "user.name", "test"])
    run(["config", "commit.gpgsign", "false"])
    run(["config", "core.autocrlf", "false"])
    (tmp_path / "x.ts").write_text("line\n", encoding="utf-8", newline="\n")
    run(["add", "."])
    run(["commit", "-qm", "init"])
    return tmp_path


PATCH = (
    "--- a/x.ts\n"
    "+++ b/x.ts\n"
    "@@ -1 +1 @@\n"
    "-line\n"
    "+line changed\n"
)


def test_git_apply_and_reverse_roundtrip(git_repo):
    tools = ControlledTools(git_repo)
    applied = tools.git_apply(PATCH)
    assert applied.ok, applied.stderr
    assert "line changed" in (git_repo / "x.ts").read_text(encoding="utf-8")
    assert "changed" in tools.git_diff()

    reversed_ok = tools.git_apply(PATCH, reverse=True)
    assert reversed_ok.ok, reversed_ok.stderr
    assert (git_repo / "x.ts").read_text(encoding="utf-8") == "line\n"
    assert tools.git_diff() == ""

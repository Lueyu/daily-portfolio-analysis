from pathlib import Path

import pytest

from agent_core.coder.models import CheckKind
from agent_core.coder.safety import (
    SafetyViolation,
    guard_git_args,
    npm_run_args,
    safe_join,
    scan_test_cheating,
)

WORK = Path("D:/stock/code").resolve()


def test_safe_join_allows_file_inside_workdir():
    p = safe_join(WORK, "server/modules/multi-agent/rating-rules.ts")
    assert WORK in p.parents


def test_safe_join_rejects_parent_traversal():
    with pytest.raises(SafetyViolation):
        safe_join(WORK, "../../Windows/System32/secret")


def test_safe_join_rejects_absolute_escape():
    with pytest.raises(SafetyViolation):
        safe_join(WORK, "C:/Users/me/.ssh/id_rsa")


@pytest.mark.parametrize(
    "rel",
    [
        ".env",
        ".env.local",
        "agent/.venv/x.py",
        "node_modules/foo/index.js",
        "server/__pycache__/x.pyc",
    ],
)
def test_safe_join_blocks_sensitive_paths(rel):
    with pytest.raises(SafetyViolation):
        safe_join(WORK, rel)


@pytest.mark.parametrize(
    "kind,script",
    [
        (CheckKind.UNIT, "test:unit"),
        (CheckKind.E2E, "test:e2e"),
        (CheckKind.TYPECHECK, "type:check"),
        (CheckKind.LINT, "lint"),
    ],
)
def test_npm_run_args_whitelisted(kind, script):
    args = npm_run_args(kind)
    assert args == ["npm", "run", script]


def test_npm_run_args_no_shell_and_no_freeform():
    # There is no code path that accepts an arbitrary command string.
    with pytest.raises(SafetyViolation):
        npm_run_args("test:unit; rm -rf /")


def test_scan_test_cheating_detects_skip_and_only():
    diff = """+  it.skip('hard case', () => {})
+  test.only('mine', () => {})"""
    hits = scan_test_cheating(diff)
    assert any("skip" in h for h in hits)
    assert any("only" in h for h in hits)


def test_scan_test_cheating_detects_removing_assertion():
    diff = """-    expect(out.rating).toBe('Hold');
+    // assertion removed"""
    hits = scan_test_cheating(diff)
    assert any("assert" in h.lower() or "expect" in h.lower() for h in hits)


def test_scan_test_cheating_clean_additive_patch_is_ok():
    diff = """+  it('caps Buy to Hold', () => {
+    expect(decide(rating).rating).toBe('Hold')
+  })"""
    assert scan_test_cheating(diff) == []


@pytest.mark.parametrize(
    "args",
    [
        ["push"],
        ["push", "origin"],
        ["reset", "--hard"],
        ["commit", "-m", "x"],
        ["merge", "--force"],
        ["checkout", "-f", "main"],
    ],
)
def test_guard_git_blocks_dangerous(args):
    with pytest.raises(SafetyViolation):
        guard_git_args(args)


@pytest.mark.parametrize(
    "args",
    [
        ["status"],
        ["diff"],
        ["stash", "list"],
        ["apply", "x.diff"],
    ],
)
def test_guard_git_allows_readonly_and_apply(args):
    assert guard_git_args(args) is None

# tests/test_coder_sandbox.py
"""WorktreeSandbox lifecycle: create (worktree add + link deps + copy env),
apply/revert delegated to ControlledTools with the sandbox cwd, and teardown
that removes links BEFORE rmtree and then prunes the worktree registry."""
import os
import shutil
from pathlib import Path

import pytest

from agent_core.coder.linker import Linker
from agent_core.coder.models import (
    AcceptanceCriterion,
    CheckKind,
    CommandResult,
    DevTask,
)
from agent_core.coder.sandbox import WorktreeSandbox, SandboxError, prune_stale
from agent_core.coder.tools import ControlledTools


class FakeWorktreeRunner:
    """Pretends to run git. `worktree add` really creates the path so the
    filesystem-only steps (link/copy/teardown) can run for real."""
    def __init__(self, add_rc=0):
        self.calls = []
        self.add_rc = add_rc

    def __call__(self, argv, cwd, timeout=None, stdin=None):
        self.calls.append((list(argv), str(cwd), stdin))
        if "worktree" in argv and "add" in argv:
            path = Path(argv[4])
            if self.add_rc == 0:
                path.mkdir(parents=True, exist_ok=True)
            return CommandResult(argv=argv, returncode=self.add_rc,
                                 stderr="fatal: invalid" if self.add_rc else "")
        if "worktree" in argv and "list" in argv:
            return CommandResult(argv=argv, returncode=0, stdout="worktree /main")
        return CommandResult(argv=argv, returncode=0)


class FakeLinker:
    def __init__(self):
        self.made = []
        self.removed = []

    def make_link(self, link, target):
        self.made.append((Path(link), Path(target)))

    def is_junction(self, path):
        return Path(path) in [p for p, _ in self.made]

    def remove_link(self, path):
        self.removed.append(Path(path))


def _sandbox(tmp, runner, linker, root=None, main=None, **kw):
    main = main or tmp / "main"
    main.mkdir(exist_ok=True)
    (main / "node_modules").mkdir(exist_ok=True)
    (main / ".env").write_text("FLASH_API_KEY=x", encoding="utf-8")
    (main / ".env.local").write_text("SUDA_DATABASE_URL=y", encoding="utf-8")
    tools = ControlledTools(main, runner=runner)
    root = root or tmp / "worktrees"
    return WorktreeSandbox("dev_1", main, root, tools,
                           linker=linker, **kw), main, root


def test_ensure_creates_worktree_links_deps_and_copies_env(tmp_path):
    runner = FakeWorktreeRunner()
    linker = FakeLinker()
    sb, main, root = _sandbox(tmp_path, runner, linker)
    sb.ensure()
    assert sb.path == root / "dev_1"
    # worktree add was issued from the main checkout
    assert any(a[:2] == ["git", "worktree"] and a[2] == "add"
               for a, _c, _s in runner.calls)
    # node_modules junction was requested
    assert linker.made and linker.made[0][0] == sb.path / "node_modules"
    assert linker.made[0][1] == main / "node_modules"
    # env files copied into the sandbox
    assert (sb.path / ".env").read_text(encoding="utf-8") == "FLASH_API_KEY=x"
    assert (sb.path / ".env.local").read_text(encoding="utf-8") == \
        "SUDA_DATABASE_URL=y"


def test_ensure_is_idempotent(tmp_path):
    runner = FakeWorktreeRunner()
    sb, _main, _root = _sandbox(tmp_path, runner, FakeLinker())
    sb.ensure()
    sb.ensure()
    adds = [a for a, _c, _s in runner.calls
            if a[:2] == ["git", "worktree"] and a[2] == "add"]
    assert len(adds) == 1


def test_ensure_raises_when_worktree_add_fails(tmp_path):
    runner = FakeWorktreeRunner(add_rc=1)
    sb, _m, _r = _sandbox(tmp_path, runner, FakeLinker())
    with pytest.raises(SandboxError):
        sb.ensure()


def test_apply_and_revert_run_in_sandbox_cwd(tmp_path):
    runner = FakeWorktreeRunner()
    sb, _m, _r = _sandbox(tmp_path, runner, FakeLinker())
    sb.ensure()
    sb.apply("--- a/x\n+++ b/x\n")
    sb.revert("--- a/x\n+++ b/x\n")
    apply_calls = [a for a, cwd, stdin in runner.calls
                   if a[:2] == ["git", "apply"]]
    assert len(apply_calls) == 2
    # both apply and revert use the sandbox path as cwd
    for a, cwd, _s in [(a, cwd, s) for a, cwd, s in runner.calls
                       if a[:2] == ["git", "apply"]]:
        assert Path(cwd) == sb.path
    # the second call carries -R
    assert "-R" in " ".join(apply_calls[1])


def test_teardown_removes_links_before_tree_and_prunes(tmp_path):
    runner = FakeWorktreeRunner()
    linker = FakeLinker()
    sb, _m, root = _sandbox(tmp_path, runner, linker)
    sb.ensure()
    sb.teardown()
    assert linker.removed  # link teardown was requested
    assert not sb.path.exists()  # sandbox tree removed
    assert any(a[:2] == ["git", "worktree"] and a[2] == "prune"
               for a, _c, _s in runner.calls)
    # main checkout dependencies and env are untouched
    assert (_m / "node_modules").exists()
    assert (_m / ".env").exists()


def test_teardown_scans_and_removes_any_top_level_link(tmp_path):
    """Defence-in-depth: even an unexpected junction at the sandbox root is
    removed before rmtree, so the real target can never be walked into."""
    runner = FakeWorktreeRunner()
    sb, main, root = _sandbox(tmp_path, runner, Linker())
    # Ensure POSIX-style symlink branch on any OS for the scan logic.
    sb.ensure()
    surprise_target = main / "secret_dep"
    surprise_target.mkdir()
    surprise_link = sb.path / "surprise_node_modules"
    try:
        os.symlink(surprise_target, surprise_link, target_is_directory=True)
    except (OSError, NotImplementedError):
        return  # platform forbids it; the Windows junction case is covered in T1
    sb.teardown()
    assert not surprise_link.exists()
    assert surprise_target.exists()


def test_prune_stale_removes_orphan_sandboxes(tmp_path):
    runner = FakeWorktreeRunner()
    linker = FakeLinker()
    main = tmp_path / "main"
    main.mkdir()
    root = tmp_path / "worktrees"
    # active task
    sb = WorktreeSandbox("dev_active", main, root,
                         ControlledTools(main, runner=runner), linker=linker)
    sb.ensure()
    # orphan directory belonging to a task that no longer exists
    orphan = root / "dev_orphan"
    orphan.mkdir(parents=True)
    prune_stale(root, main, ControlledTools(main, runner=runner), linker,
                active_task_ids={"dev_active"})
    assert not orphan.exists()
    assert sb.path.exists()


def test_options_skip_link_and_copy(tmp_path):
    runner = FakeWorktreeRunner()
    linker = FakeLinker()
    sb, main, root = _sandbox(tmp_path, runner, linker,
                              link_dependencies=False, copy_env=False)
    sb.ensure()
    assert linker.made == []
    assert not (sb.path / ".env").exists()


def _a_task(tmp):
    return DevTask(
        id="dev_1", title="t", problem="p",
        acceptance=[AcceptanceCriterion(id="a", description="d",
                                        check=CheckKind.UNIT)],
        workdir=str(tmp / "main"))


def test_latest_patch_reads_newest_diff(tmp_path):
    from agent_core.coder.models import Patch
    from agent_core.coder.task_store import TaskStore
    store = TaskStore(tmp_path / "tasks")
    task = _a_task(tmp_path)
    store.create(task)
    store.save_patch("dev_1", Patch(patch_id="p1", diff="--- a/a.ts\n+++ b/a.ts\n@@\n+1\n"))
    store.save_patch("dev_1", Patch(patch_id="p2", diff="--- a/b.ts\n+++ b/b.ts\n@@\n+2\n"))
    latest = store.latest_patch("dev_1")
    assert "b.ts" in latest.diff
    assert latest.target_files == ["b.ts"]

# tests/test_coder_sandbox.py
"""WorktreeSandbox lifecycle: create (worktree add + link deps + copy env),
apply/revert delegated to ControlledTools with the sandbox cwd, and teardown
that removes links BEFORE rmtree and then prunes the worktree registry."""
import os
import shutil
import subprocess
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


def _git(repo, *args):
    result = subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, check=True)
    return result.stdout.decode("utf-8").strip()


@pytest.fixture
def dirty_repo(tmp_path):
    main = tmp_path / "main"
    main.mkdir()
    _git(main, "init")
    _git(main, "config", "user.name", "Sandbox Test")
    _git(main, "config", "user.email", "sandbox@example.invalid")
    _git(main, "config", "core.autocrlf", "false")
    (main / ".gitignore").write_text(
        ".env*\nnode_modules/\nignored.ts\n", encoding="utf-8")
    for name in ("tracked.ts", "removed.ts", "staged-removed.ts"):
        (main / name).write_text("old\n", encoding="utf-8")
    _git(main, "add", ".")
    _git(main, "commit", "-m", "initial")
    (main / "tracked.ts").write_text("staged\n", encoding="utf-8")
    _git(main, "add", "tracked.ts")
    (main / "tracked.ts").write_bytes(b"working\r\n")
    (main / "removed.ts").unlink()
    _git(main, "rm", "staged-removed.ts")
    (main / "new UI.tsx").write_bytes(b"new UI\n")
    (main / "ignored.ts").write_text("ignored\n", encoding="utf-8")
    (main / ".env").write_text("TEST_PLACEHOLDER=not-a-secret\n", encoding="utf-8")
    return main


def _real_sandbox(main, tmp_path, **kwargs):
    return WorktreeSandbox(
        "dev_snapshot", main, tmp_path / "worktrees", ControlledTools(main),
        link_dependencies=False, **kwargs)


def test_snapshot_includes_working_sources_and_deletions(dirty_repo, tmp_path):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    try:
        sb.ensure()
        assert (sb.path / "tracked.ts").read_bytes() == b"working\r\n"
        assert (sb.path / "new UI.tsx").read_text() == "new UI\n"
        assert not (sb.path / "removed.ts").exists()
        assert not (sb.path / "staged-removed.ts").exists()
        assert not (sb.path / "ignored.ts").exists()
        assert not (sb.path / ".env").exists()
        assert sb.is_clean()
    finally:
        sb.teardown()


def test_snapshot_preserves_main_branch_index_and_working_files(dirty_repo, tmp_path):
    main = dirty_repo
    before_head = _git(main, "rev-parse", "HEAD")
    before_branch = _git(main, "symbolic-ref", "HEAD")
    before_index = (main / ".git" / "index").read_bytes()
    before_diff = _git(main, "diff", "HEAD")
    sb = _real_sandbox(main, tmp_path)
    try:
        sb.ensure()
        assert _git(sb.path, "rev-parse", "HEAD") != before_head
        assert "new UI.tsx" in _git(sb.path, "ls-tree", "--name-only", "HEAD")
        assert ".env" not in _git(sb.path, "ls-tree", "--name-only", "HEAD")
        assert (sb.path / ".env").exists()
    finally:
        sb.teardown()
    assert _git(main, "rev-parse", "HEAD") == before_head
    assert _git(main, "symbolic-ref", "HEAD") == before_branch
    assert (main / ".git" / "index").read_bytes() == before_index
    assert _git(main, "diff", "HEAD") == before_diff
    assert (main / "new UI.tsx").read_text() == "new UI\n"
    assert not sb.path.exists()
    assert str(sb.path).replace("\\", "/") not in _git(main, "worktree", "list")


def test_candidate_apply_revert_is_relative_to_snapshot(dirty_repo, tmp_path):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    diff = (
        "diff --git a/new UI.tsx b/new UI.tsx\n"
        "--- a/new UI.tsx\n+++ b/new UI.tsx\n"
        "@@ -1 +1 @@\n-new UI\n+fixed UI\n")
    try:
        sb.ensure()
        assert sb.apply(diff).ok
        assert not sb.is_clean()
        assert sb.revert(diff).ok
        assert sb.is_clean()
        assert (sb.path / "new UI.tsx").read_text() == "new UI\n"
    finally:
        sb.teardown()


def test_snapshot_does_not_follow_directory_links(dirty_repo, tmp_path):
    external = tmp_path / "external"
    external.mkdir()
    (external / "outside.ts").write_text("keep\n", encoding="utf-8")
    link = dirty_repo / "linked-source"
    Linker().make_link(link, external)
    (dirty_repo / "regular.ts").write_text("include\n", encoding="utf-8")
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    try:
        sb.ensure()
        assert (sb.path / "regular.ts").exists()
        assert not (sb.path / "linked-source").exists()
        sb.teardown()
        assert (external / "outside.ts").read_text() == "keep\n"
    finally:
        sb.teardown()
        Linker().remove_link(link)


def test_snapshot_handles_nested_directory_replaced_with_file(dirty_repo, tmp_path):
    main = dirty_repo
    folder = main / "folder"
    (folder / "nested").mkdir(parents=True)
    (folder / "nested" / "source.ts").write_text("old", encoding="utf-8")
    _git(main, "add", "folder")
    _git(main, "commit", "-m", "tracked directory")
    (folder / "nested" / "source.ts").unlink()
    (folder / "nested").rmdir()
    folder.rmdir()
    folder.write_text("replacement", encoding="utf-8")
    sb = _real_sandbox(main, tmp_path, copy_env=False)
    try:
        sb.ensure()
        assert (sb.path / "folder").read_text() == "replacement"
        assert sb.is_clean()
    finally:
        sb.teardown()


def test_snapshot_skips_unignored_secrets_but_keeps_tracked_ignored_source(
        dirty_repo, tmp_path):
    main = dirty_repo
    (main / ".gitignore").write_text(
        ".env\nignored.ts\ntracked.ts\nnode_modules/\n", encoding="utf-8")
    (main / ".env.unignored").write_text("TEST_PLACEHOLDER=1", encoding="utf-8")
    sb = _real_sandbox(main, tmp_path, copy_env=False)
    try:
        sb.ensure()
        assert (sb.path / "tracked.ts").read_bytes() == b"working\r\n"
        assert not (sb.path / ".env.unignored").exists()
        assert ".env" not in _git(sb.path, "ls-tree", "--name-only", "HEAD")
        assert sb.is_clean()
    finally:
        sb.teardown()


def test_existing_sandbox_keeps_its_snapshot_and_candidate(dirty_repo, tmp_path):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    try:
        sb.ensure()
        baseline = _git(sb.path, "rev-parse", "HEAD")
        (sb.path / "new UI.tsx").write_text("candidate", encoding="utf-8")
        (dirty_repo / "new UI.tsx").write_text("new main edit", encoding="utf-8")
        resumed = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
        resumed.ensure()
        assert _git(resumed.path, "rev-parse", "HEAD") == baseline
        assert (resumed.path / "new UI.tsx").read_text() == "candidate"
        assert not resumed.is_clean()
    finally:
        sb.teardown()


def test_failed_snapshot_is_removed_instead_of_reused(dirty_repo, tmp_path, monkeypatch):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    monkeypatch.setattr(
        sb.tools, "git_snapshot_commit",
        lambda cwd: CommandResult(argv=[], returncode=1, stderr="snapshot failed"))
    with pytest.raises(SandboxError, match="snapshot failed"):
        sb.ensure()
    assert not sb.path.exists()
    assert "dev_snapshot" not in _git(dirty_repo, "worktree", "list")
    assert (dirty_repo / "new UI.tsx").read_text() == "new UI\n"


def test_interrupted_initialization_rebuilds_partial_snapshot(dirty_repo, tmp_path, monkeypatch):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)

    def interrupt_snapshot():
        (sb.path / "tracked.ts").write_text("partial snapshot", encoding="utf-8")
        raise KeyboardInterrupt  # simulate process termination outside exception cleanup

    monkeypatch.setattr(sb, "_snapshot_workspace", interrupt_snapshot)
    with pytest.raises(KeyboardInterrupt):
        sb.ensure()
    resumed = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    try:
        resumed.ensure()
        assert (resumed.path / "tracked.ts").read_bytes() == b"working\r\n"
        assert (resumed.path / "new UI.tsx").read_text() == "new UI\n"
        assert resumed.is_clean()
    finally:
        resumed.teardown()
    assert list((tmp_path / "worktrees").iterdir()) == []


def test_interrupted_env_preparation_rebuilds_incomplete_sandbox(dirty_repo, tmp_path, monkeypatch):
    sb = _real_sandbox(dirty_repo, tmp_path)

    def interrupt_env():
        (sb.path / "unfinished.ts").write_text("partial", encoding="utf-8")
        raise KeyboardInterrupt

    monkeypatch.setattr(sb, "_copy_env", interrupt_env)
    with pytest.raises(KeyboardInterrupt):
        sb.ensure()
    resumed = _real_sandbox(dirty_repo, tmp_path)
    try:
        resumed.ensure()
        assert not (resumed.path / "unfinished.ts").exists()
        assert (resumed.path / ".env").exists()
        assert resumed.is_clean()
    finally:
        resumed.teardown()
    assert list((tmp_path / "worktrees").iterdir()) == []


def test_interrupted_worktree_registration_lock_is_recovered(dirty_repo, tmp_path, monkeypatch):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)

    def interrupt_locked_creation():
        _git(dirty_repo, "worktree", "lock", "--reason", "initializing", str(sb.path))
        raise KeyboardInterrupt

    monkeypatch.setattr(sb, "_snapshot_workspace", interrupt_locked_creation)
    with pytest.raises(KeyboardInterrupt):
        sb.ensure()
    resumed = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    try:
        resumed.ensure()
        assert (resumed.path / "new UI.tsx").read_text() == "new UI\n"
        assert resumed.is_clean()
    finally:
        # Also clean the simulated creation lock when demonstrating the RED.
        subprocess.run(["git", "worktree", "unlock", str(sb.path)],
                       cwd=dirty_repo, capture_output=True)
        resumed.teardown()
    assert "dev_snapshot" not in _git(dirty_repo, "worktree", "list")


def test_interruption_before_worktree_creation_can_retry(dirty_repo, tmp_path, monkeypatch):
    sb = _real_sandbox(dirty_repo, tmp_path, copy_env=False)

    def interrupt_add(*args, **kwargs):
        raise KeyboardInterrupt

    monkeypatch.setattr(sb.tools, "git_worktree_add", interrupt_add)
    with pytest.raises(KeyboardInterrupt):
        sb.ensure()
    assert not sb.path.exists()
    resumed = _real_sandbox(dirty_repo, tmp_path, copy_env=False)
    try:
        resumed.ensure()
        assert (resumed.path / "new UI.tsx").read_text() == "new UI\n"
        assert resumed.is_clean()
    finally:
        resumed.teardown()
    assert list((tmp_path / "worktrees").iterdir()) == []


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

"""Git worktree execution sandbox for the coder persona.

Each dev task gets an isolated checkout under ``<data>/worktrees/<task-id>``
(outside the main repo, so it is never seen as untracked files). The agent
reproduces, explores, applies candidate patches and runs checks there; the
main checkout is untouched until a human approves.

Construction
------------
* ``git worktree add --detach <path> HEAD``  (a clean HEAD checkout)
* junction/symlink the root ``node_modules`` (no slow reinstall)
* copy the gitignored ``.env`` / ``.env.local`` so checks can read config

Teardown safety
---------------
Links are removed *before* the tree is deleted (``shutil.rmtree`` would
otherwise follow a junction into the real dependency folder). Then we
``git worktree prune`` to drop stale registry metadata.
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol

from .linker import Linker
from .models import CommandResult
from .tools import ControlledTools

# Local env files that are gitignored in the main checkout but needed to run
# checks in a clean worktree.
ENV_FILES = (".env", ".env.local")


class SandboxError(Exception):
    """Raised when an isolated worktree cannot be prepared."""


class SandboxPort(Protocol):
    path: Path

    def ensure(self) -> Path: ...
    def apply(self, diff: str) -> CommandResult: ...
    def revert(self, diff: str) -> CommandResult: ...
    def is_clean(self) -> bool: ...
    def teardown(self) -> None: ...


class WorktreeSandbox:
    def __init__(self, task_id: str, main_workdir: Path | str,
                 root: Path | str, tools: ControlledTools,
                 linker: Linker | None = None, *,
                 link_dependencies: bool = True,
                 copy_env: bool = True,
                 env_files: tuple[str, ...] = ENV_FILES):
        self.task_id = task_id
        self.main_workdir = Path(main_workdir)
        self.path = Path(root) / task_id
        self.tools = tools
        self.linker = linker or Linker()
        self.link_dependencies = link_dependencies
        self.copy_env = copy_env
        self.env_files = env_files
        self._links: list[Path] = []
        self._ready = False

    # -- create ------------------------------------------------------------
    def ensure(self) -> Path:
        """Prepare the isolated checkout. Idempotent: safe to call repeatedly.

        Reuses an existing leftover worktree for the same task (e.g. after a
        pause/resume) and only re-ensures the dependency link and env files.
        """
        if self._ready:
            return self.path
        if self.path.exists():
            self._link_deps()
            self._copy_env()
            self._ready = True
            return self.path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        res = self.tools.git_worktree_add(self.path, cwd=self.main_workdir)
        if not res.ok:
            raise SandboxError(
                f"git worktree add failed for {self.task_id}: "
                f"{res.stderr.strip()[-800:]}")
        self._link_deps()
        self._copy_env()
        self._ready = True
        return self.path

    def _link_deps(self) -> None:
        if not self.link_dependencies:
            return
        link = self.path / "node_modules"
        target = self.main_workdir / "node_modules"
        if target.exists() and not self.linker.is_junction(link):
            self.linker.make_link(link, target)
            self._links.append(link)

    def _copy_env(self) -> None:
        if not self.copy_env:
            return
        for name in self.env_files:
            src = self.main_workdir / name
            if src.is_file():
                shutil.copy2(src, self.path / name)

    # -- candidate patch application (verification only) -------------------
    def apply(self, diff: str) -> CommandResult:
        return self.tools.git_apply(diff, cwd=self.path)

    def revert(self, diff: str) -> CommandResult:
        return self.tools.git_apply(diff, cwd=self.path, reverse=True)

    def is_clean(self) -> bool:
        # git_status returns the porcelain stdout (an empty string when clean).
        return self.tools.git_status(cwd=self.path).strip() == ""

    # -- teardown ----------------------------------------------------------
    def _remove_all_links(self) -> None:
        # Release every link we recorded ourselves, then scan the tree for any
        # unexpected link, so rmtree can never follow a junction into the real
        # dependency folder. remove_link is idempotent for non-links.
        candidates: list[Path] = list(self._links)
        if self.path.exists():
            candidates += [
                c for c in self.path.iterdir()
                if c.is_symlink() or self.linker.is_junction(c)
            ]
        for link in dict.fromkeys(candidates):
            self.linker.remove_link(link)
        self._links.clear()

    def teardown(self) -> None:
        if self.path.exists():
            # CRITICAL: strip every link/symlink before rmtree so we never
            # descend into the real dependency folder through a junction.
            self._remove_all_links()
            shutil.rmtree(self.path, ignore_errors=True)
        self.tools.git_worktree_prune(cwd=self.main_workdir)
        self._ready = False


def prune_stale(root: Path | str, main_workdir: Path | str,
                tools: ControlledTools, linker: Linker,
                active_task_ids: set[str]) -> None:
    """Remove sandboxes whose task is not active (crash leftovers).

    Only directories directly under ``root`` whose name is absent from
    ``active_task_ids`` are touched. Links are removed before the tree.
    """
    root = Path(root)
    if not root.exists():
        return
    for child in list(root.iterdir()):
        if not child.is_dir() or child.name in active_task_ids:
            continue
        # A junction's is_dir() is True, so check and remove links first.
        if linker.is_junction(child) or child.is_symlink():
            linker.remove_link(child)
            continue
        for inner in list(child.iterdir()):
            if linker.is_junction(inner) or inner.is_symlink():
                linker.remove_link(inner)
        shutil.rmtree(child, ignore_errors=True)
    tools.git_worktree_prune(cwd=Path(main_workdir))

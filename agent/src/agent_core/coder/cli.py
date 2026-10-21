# agent/src/agent_core/coder/cli.py
"""`agent dev` commands: create, run (pause for approval), approve, inspect.

The new/show paths are fully offline. run/approve build a real harness via
build_harness(); that factory reads the live model settings and is the only
place real network calls are introduced, so it can be swapped in tests.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import typer
from rich.console import Console

from ..config import get_settings
from ..models import ChatService
from .harness import CoderHarness
from .linker import Linker
from .models import AcceptanceCriterion, CheckKind, DevTask, Iteration, TaskStatus
from .sandbox import WorktreeSandbox, prune_stale
from .task_store import TaskStore
from .tools import ControlledTools, build_probe_targets

app = typer.Typer(help="Coding agent: reproduce, fix, verify webapp changes.")
console = Console()


def _emit(payload: dict, *, as_json: bool) -> None:
    """Print a single line of machine-readable JSON, or nothing for humans.

    Human-readable output is emitted by the caller; when ``--json`` is set we
    only emit one JSON object on the last line so callers (e.g. the Nest
    dev-agent backend) can parse it without scraping rich text.
    """
    if as_json:
        console.print(
            json.dumps(payload, ensure_ascii=False), markup=False, soft_wrap=True
        )


def _task_payload(task_id: str, status: TaskStatus) -> dict:
    return {"ok": True, "id": task_id, "status": status.value}


def _store() -> TaskStore:
    return TaskStore(Path(get_settings().coder_data_dir) / "tasks")


def _parse_acceptance(raw: str) -> AcceptanceCriterion:
    """Parse 'id:kind:description[:target]'.

    A fourth segment is an optional target (a file path or free-text hint
    shown to the model). maxsplit=3 keeps any colons inside the target
    (e.g. http://localhost:8080) intact.
    """
    parts = raw.split(":", 3)
    if len(parts) < 3:
        raise typer.BadParameter(
            f"acceptance must be 'id:kind:description[:target]', got {raw!r}")
    crit_id, kind, desc = parts[0], parts[1], parts[2]
    target = parts[3].strip() if len(parts) == 4 else None
    try:
        check = CheckKind(kind.strip())
    except ValueError as exc:
        raise typer.BadParameter(f"unknown check kind: {kind!r}") from exc
    return AcceptanceCriterion(
        id=crit_id.strip(), description=desc.strip(), check=check,
        target=target,
    )


def build_harness(task_id: str) -> CoderHarness:
    """Construct a production harness (real model, real sandboxed tools)."""
    settings = get_settings()
    store = _store()
    task = store.load(task_id)
    chat = ChatService(settings)
    workdir = Path(task.workdir)
    tools = ControlledTools(
        workdir,
        probe_targets=build_probe_targets(settings),
        probe_timeout=settings.probe_timeout_seconds,
    )
    sandbox = None
    if settings.coder_sandbox_enabled:
        sandbox = WorktreeSandbox(
            task_id=task_id,
            main_workdir=workdir,
            root=Path(settings.coder_worktree_dir),
            tools=tools,
            linker=Linker(),
            link_dependencies=settings.coder_link_dependencies,
            copy_env=settings.coder_copy_env_files,
        )
    return CoderHarness(task, chat, tools, store,
                        verify_cwd=workdir, sandbox=sandbox)


@app.command("new")
def new_cmd(
    title: str = typer.Option(..., "--title"),
    problem: str = typer.Option(..., "--problem"),
    acceptance: list[str] = typer.Option(
        ..., "--acceptance", help="'id:kind:description'; repeatable"),
    workdir: str = typer.Option(None, "--workdir"),
    as_json: bool = typer.Option(False, "--json", help="Emit one JSON line."),
):
    """Create a dev task with fixed acceptance criteria."""
    settings = get_settings()
    task = DevTask(
        id=f"dev_{uuid.uuid4().hex[:8]}", title=title, problem=problem,
        acceptance=[_parse_acceptance(a) for a in acceptance],
        workdir=workdir or settings.webapp_workdir,
    )
    _store().create(task)
    if as_json:
        _emit({"ok": True, "id": task.id}, as_json=True)
        return
    console.print(f"[green]created[/] {task.id}")
    console.print("next: [cyan]agent dev run " + task.id + "[/]")


@app.command("run")
def run_cmd(
    task_id: str,
    as_json: bool = typer.Option(False, "--json", help="Emit one JSON line."),
):
    """Run the inner loop until verified/blocked or a patch awaiting approval."""
    h = build_harness(task_id)
    task = h.run(auto_approve=False)
    if as_json:
        _emit(_task_payload(task_id, task.status), as_json=True)
        return
    if task.status == TaskStatus.AWAITING_APPROVAL:
        patches = sorted((Path(get_settings().coder_data_dir) / "tasks"
                          / task_id / "patches").glob("*.diff"))
        console.print("[yellow]patch awaiting approval[/]")
        if patches:
            console.print(f"diff: {patches[-1]}")
        console.print("review it, then: [cyan]agent dev approve " + task_id + "[/]")
    else:
        console.print(f"status: [bold]{task.status.value}[/]")


@app.command("approve")
def approve_cmd(
    task_id: str,
    as_json: bool = typer.Option(False, "--json", help="Emit one JSON line."),
):
    """Apply the proposed patch and run the fixed verification set."""
    h = build_harness(task_id)
    task = h.run(auto_approve=True)
    if as_json:
        _emit(_task_payload(task_id, task.status), as_json=True)
        return
    colour = "green" if task.status == TaskStatus.VERIFIED else "red"
    console.print(f"status: [bold {colour}]{task.status.value}[/]")


@app.command("reject")
def reject_cmd(
    task_id: str,
    reason: str = typer.Option(..., "--reason", help="Why the patch is rejected."),
    as_json: bool = typer.Option(False, "--json", help="Emit one JSON line."),
):
    """Reject the proposed patch; move the task to blocked and remove sandbox."""
    h = build_harness(task_id)
    store = h.store
    task = h.task
    if task.status != TaskStatus.AWAITING_APPROVAL:
        raise typer.BadParameter(
            "can only reject while awaiting approval, "
            f"current={task.status.value}"
        )
    task.transition(TaskStatus.BLOCKED)
    next_index = len(store.read_iterations(task_id))
    store.append_iteration(
        task_id,
        Iteration(
            index=next_index,
            phase="approval",
            action="reject",
            model_calls=0,
            observations=[reason],
            decision="human rejected",
        ),
    )
    store.save(task)
    h._teardown_sandbox()
    if as_json:
        _emit(_task_payload(task_id, task.status), as_json=True)
        return
    console.print(f"status: [bold red]{task.status.value}[/]")


@app.command("show")
def show_cmd(task_id: str):
    """Show the current state and replayable iterations for a task."""
    store = _store()
    task = store.load(task_id)
    console.print(f"[bold]{task.title}[/]  ({task.id})  status={task.status.value}")
    console.print(f"problem: {task.problem}")
    for c in task.acceptance:
        console.print(f"  - [{c.check.value}] {c.description}")
    console.print(f"red_seen={task.red_seen}")
    for it in store.read_iterations(task_id):
        console.print(f"  #{it.index} {it.phase}: {it.decision}")


@app.command("sandbox-prune")
def sandbox_prune_cmd(
    as_json: bool = typer.Option(False, "--json", help="Emit one JSON line."),
):
    """Remove sandbox worktrees that no longer correspond to an active task."""
    settings = get_settings()
    store = _store()
    active = {t for t in store.list_tasks()
              if store.load(t).status in (
                  TaskStatus.NEW, TaskStatus.REPRODUCED, TaskStatus.DIAGNOSED,
                  TaskStatus.PATCHED, TaskStatus.VERIFYING,
                  TaskStatus.AWAITING_APPROVAL)}
    workdir = Path(settings.webapp_workdir)
    tools = ControlledTools(workdir)
    prune_stale(Path(settings.coder_worktree_dir), workdir, tools, Linker(),
                active_task_ids=active)
    msg = {"ok": True, "active": sorted(active)}
    if as_json:
        _emit(msg, as_json=True)
        return
    console.print("[green]stale sandboxes pruned[/]")

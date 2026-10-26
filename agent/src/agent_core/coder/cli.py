# agent/src/agent_core/coder/cli.py
"""`agent dev` commands: create, run (pause for approval), approve, inspect.

The new/show paths are fully offline. run/approve build a real harness via
build_harness(); that factory reads the live model settings and is the only
place real network calls are introduced, so it can be swapped in tests.
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import typer
from rich.console import Console

from ..config import get_settings
from ..models import ChatService, ModelTask
from .budget import BudgetGuard
from .harness import CoderHarness
from .linker import Linker
from .models import AcceptanceCriterion, BudgetConfig, CheckKind, DevTask, Iteration, TaskStatus
from .sandbox import WorktreeSandbox, prune_stale
from .task_store import TaskStore
from .tools import ControlledTools, build_probe_targets

app = typer.Typer(help="Coding agent: reproduce, fix, verify webapp changes.")
console = Console()


def _settings_result(action, *, as_json):
    # Settings bodies/credentials never enter argv or exception logs.
    from pydantic import ValidationError
    try:
        result = action()
    except ValidationError:
        result = {'ok': False, 'message': '环境配置字段不合法，请检查字段类型和范围'}
    except ValueError as exc:
        result = {'ok': False, 'message': str(exc)}
    except Exception:
        result = {'ok': False, 'message': '无法读取或保存操作员配置，请检查文件权限和配置格式'}
    _emit(result, as_json=as_json)
    if not as_json:
        console.print(result.get('message', '配置已读取'))


@app.command('settings')
def settings_cmd(as_json: bool = typer.Option(False, '--json')):
    from ..config import Settings
    from ..operator_settings import read_public_settings
    _settings_result(lambda: read_public_settings(Settings()), as_json=as_json)


@app.command('settings-save')
def settings_save_cmd(as_json: bool = typer.Option(False, '--json')):
    import sys
    from ..config import Settings
    from ..operator_settings import save_settings
    def save():
        raw = sys.stdin.read(262145)
        if len(raw.encode('utf-8')) > 262144:
            raise ValueError('配置请求超过 256 KB')
        try:
            body = json.loads(raw)
        except ValueError:
            raise ValueError('配置请求必须是 JSON') from None
        return save_settings(Settings(), body)
    _settings_result(save, as_json=as_json)


@app.command('settings-test')
def settings_test_cmd(target: str = typer.Option(..., '--target'),
                      server: str | None = typer.Option(None, '--server'),
                      as_json: bool = typer.Option(False, '--json')):
    from ..config import Settings
    from ..operator_settings import test_connection
    _settings_result(lambda: test_connection(Settings(), target, server), as_json=as_json)


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
    if task.runtime_version == 2:
        from .general_harness import GeneralHarness
        from .runtime.network import NetworkPolicy
        return GeneralHarness(task, chat, store,
                              runtime_image=settings.coder_runtime_image,
                              docker_prefix=settings.coder_docker_command,
                              settings=settings, network_policy=NetworkPolicy(
                                  settings.coder_network_mode, tuple(settings.coder_network_allowed_hosts)),
                              supports_tools=chat.supports_tools_for(ModelTask.CODE))
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
                        verify_cwd=workdir, sandbox=sandbox,
                        budget=BudgetGuard(BudgetConfig(
                            max_iterations=settings.coder_max_iterations,
                            max_model_calls=settings.coder_max_model_calls,
                            wallclock_seconds=settings.coder_wallclock_seconds,
                        )),
                        max_probes=settings.coder_max_probes,
                        supports_tools=chat.supports_tools_for(ModelTask.CODE))


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
        runtime_version=2,
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
    resume_budget: bool = typer.Option(
        False, "--resume-budget", help="Resume a blocked task only after an automatic budget stop."),
):
    """Run the inner loop until verified/blocked or a patch awaiting approval."""
    h = build_harness(task_id)
    try:
        task = h.run(auto_approve=False, resume_budget=True) if resume_budget \
            else h.run(auto_approve=False)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
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
    if task.runtime_version == 2:
        h.prepare()
        h.state.setdefault("user_feedback", []).append(reason)
        h._invalidate()
        h._sync_gate()
        h._save()
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


def _runtime_task(task_id: str):
    if not re.fullmatch(r"dev_[a-z0-9]+", task_id):
        raise typer.BadParameter("invalid task id")
    store = _store()
    return store, store.load(task_id), store.root / task_id / "runtime"


@app.command('capabilities')
def capabilities_cmd(as_json: bool = typer.Option(False, '--json')):
    """Inspect effective configuration without calling a model or starting containers."""
    from .integrations import IntegrationManager
    from .runtime.network import NetworkPolicy
    settings = get_settings()
    chat = ChatService(settings)
    integrations = IntegrationManager(settings, Path(settings.webapp_workdir))
    _emit({'ok': True, 'models': chat.coding_capabilities(),
           'network': NetworkPolicy(settings.coder_network_mode, tuple(settings.coder_network_allowed_hosts)).as_dict(),
           'integrations': integrations.capabilities(), 'maxWorkers': settings.coder_max_workers,
           'maxWorkerDepth': settings.coder_max_worker_depth, 'contextBytes': settings.coder_context_bytes}, as_json=True)


@app.command('message')
def message_cmd(task_id: str, text: str = typer.Option(..., '--text'),
                as_json: bool = typer.Option(False, '--json')):
    """Append a user instruction; active loops read it before their next model turn."""
    from .session_control import SessionControl
    _, task, root = _runtime_task(task_id)
    if task.runtime_version != 2:
        raise typer.BadParameter('live messages require runtime v2')
    try:
        row = SessionControl(root / 'control').send(text)
        _emit({'ok': True, 'message': row}, as_json=True)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc


@app.command('decide')
def decide_cmd(task_id: str, request_id: str = typer.Option(..., '--request-id'),
               approve: bool = typer.Option(False, '--approve/--deny'),
               as_json: bool = typer.Option(False, '--json')):
    """Record a one-time human decision without executing the external operation."""
    from .session_control import SessionControl
    _, task, root = _runtime_task(task_id)
    if task.runtime_version != 2:
        raise typer.BadParameter('external approval requires runtime v2')
    try:
        row = SessionControl(root / 'control').decide(request_id, approve)
        _emit({'ok': True, 'approval': row}, as_json=True)
    except ValueError as exc:
        _emit({'ok': False, 'code': 'invalid', 'error': str(exc)}, as_json=True)
        raise typer.Exit(1) from exc


@app.command("runtime-inspect")
def runtime_inspect_cmd(task_id: str, cursor: int = typer.Option(0, min=0),
                        as_json: bool = typer.Option(False, "--json")):
    """Read saved events and source history without starting any model or container."""
    from .general_state import read_events
    _, _, root = _runtime_task(task_id)
    def read(name, default):
        path = root / name
        return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else default
    state = read("state.json", {})
    journal = read("checkpoints/state.json", {})
    result = {"ok": True, "version": state.get("version"), "revision": state.get("revision"),
              "changes": journal.get("changes", []), "pending": state.get("pending"),
              "verification": state.get("verification", []), **read_events(root, cursor)}
    _emit(result, as_json=True)


def _offline_general(task_id: str):
    from .general_harness import GeneralHarness
    from .runtime import NetworkPolicy
    store, task, _ = _runtime_task(task_id)
    if task.runtime_version != 2:
        raise typer.BadParameter("legacy task has no per-change snapshots; create a new task")
    settings = get_settings()
    return GeneralHarness(task, None, store, runtime_image=settings.coder_runtime_image,
                          docker_prefix=settings.coder_docker_command, settings=settings,
                          network_policy=NetworkPolicy(settings.coder_network_mode,
                                                       tuple(settings.coder_network_allowed_hosts)))


@app.command("migrate")
def migrate_cmd(task_id: str, as_json: bool = typer.Option(False, "--json")):
    """Copy a legacy request to v2 using today's main source; retain all old artifacts."""
    store, original, _ = _runtime_task(task_id)
    if original.runtime_version != 1:
        raise typer.BadParameter("only legacy tasks need migration")
    task = DevTask(id=f"dev_{uuid.uuid4().hex[:8]}", title=original.title,
                   problem=original.problem, acceptance=original.acceptance,
                   workdir=original.workdir, runtime_version=2)
    store.create(task)
    store.append_iteration(task.id, Iteration(index=1, phase="migration", action="migrate",
        decision="已复制旧任务需求；新任务从当前主目录开始，旧任务和旧沙箱保留",
        observations=[f"source_task={original.id}"]))
    _emit({**_task_payload(task.id, task.status), "source_id": original.id}, as_json=True)


@app.command("rollback-landing")
def rollback_landing_cmd(task_id: str, as_json: bool = typer.Option(False, "--json")):
    """Conflict-safe reversal of this task's approved main-directory changes."""
    from .general_landing import rollback_landing
    h = None
    try:
        h = _offline_general(task_id)
        h.prepare()
        result = rollback_landing(h)
        _emit({"ok": True, "landing": result}, as_json=True)
    except Exception as exc:
        _emit({"ok": False, "error": str(exc)}, as_json=True)
        raise typer.Exit(1) from exc
    finally:
        if h:
            h.journal.close()


def _change_command(task_id, step):
    from .checkpoints import BusyError, ConflictError
    h = None
    try:
        h = _offline_general(task_id)
        h.prepare()
        change = h.change_history(step)
        h.evidence.event(type(step).__name__, "源码历史已更新，需要重新验证", change)
        _emit({"ok": True, "change": change}, as_json=True)
    except Exception as exc:
        code = "conflict" if isinstance(exc, ConflictError) else "busy" if isinstance(exc, BusyError) else "invalid"
        _emit({"ok": False, "error": str(exc), "code": code}, as_json=True)
        raise typer.Exit(1) from exc
    finally:
        if h:
            h.journal.close()


@app.command("undo")
def undo_cmd(task_id: str, change_id: str = typer.Option(..., "--change-id"),
             expected_revision: str = typer.Option(..., "--expected-revision"),
             as_json: bool = typer.Option(False, "--json")):
    """Undo an independent source change without starting the model."""
    from .general_tools import UndoChange
    _change_command(task_id, UndoChange(change_id=change_id, expected_revision=expected_revision))


@app.command("restore")
def restore_cmd(task_id: str, revision: str = typer.Option(..., "--revision"),
                expected_revision: str = typer.Option(..., "--expected-revision"),
                as_json: bool = typer.Option(False, "--json")):
    """Restore an entire source checkpoint; subsequent source effects are undone."""
    from .general_tools import RestoreCheckpoint
    _change_command(task_id, RestoreCheckpoint(revision=revision, expected_revision=expected_revision))


@app.command("runtime-stop")
def runtime_stop_cmd(task_id: str, as_json: bool = typer.Option(False, "--json")):
    """Quiesce task-owned containers after the parent process has exited."""
    store, task, root = _runtime_task(task_id)
    if task.runtime_version != 2 or not (root / "state.json").exists():
        _emit({"ok": True, "stopped": False}, as_json=True)
        return
    h = _offline_general(task_id)
    try:
        # Acquire ownership before touching runtimes. Recover persisted workers
        # too: a fresh harness has no in-memory manager after Python was killed.
        pending = h.journal.pending()
        if pending:
            h.journal.adopt(pending["id"])
        h.extensions.recover_workers()
        h.prepared = True
        h.stop()
    finally:
        h.journal.close()
    _emit({"ok": True, "stopped": True}, as_json=True)

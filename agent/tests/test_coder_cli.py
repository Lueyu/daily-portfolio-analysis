# tests/test_coder_cli.py
import json

import pytest
from typer.testing import CliRunner

from agent_core import config as config_mod
from agent_core.coder import cli as coder_cli
from agent_core.coder.models import (
    AcceptanceCriterion,
    CheckKind,
    DevTask,
    TaskStatus,
)
from agent_core.coder.task_store import TaskStore

runner = CliRunner()


@pytest.fixture()
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setenv("CODER_DATA_DIR", str(tmp_path / "coder"))
    monkeypatch.setenv("WEBAPP_WORKDIR", str(tmp_path))
    config_mod.get_settings.cache_clear()
    yield tmp_path
    config_mod.get_settings.cache_clear()


def test_new_creates_task_and_show_prints_it(isolated_store):
    r = runner.invoke(coder_cli.app, [
        "new", "--title", "rating cap", "--problem",
        "rating says Hold but action Buy",
        "--acceptance", "ac1:unit:Hold has no buy verbs",
        "--workdir", str(isolated_store),
    ])
    assert r.exit_code == 0, r.stdout
    tasks = TaskStore(isolated_store / "coder" / "tasks").list_tasks()
    assert len(tasks) == 1
    tid = tasks[0]
    r2 = runner.invoke(coder_cli.app, ["show", tid])
    assert r2.exit_code == 0
    assert "rating cap" in r2.stdout
    assert "new" in r2.stdout.lower()


def test_new_rejects_bad_acceptance_spec(isolated_store):
    r = runner.invoke(coder_cli.app, [
        "new", "--title", "t", "--problem", "p",
        "--acceptance", "garbage",
    ])
    assert r.exit_code != 0


def test_new_acceptance_with_optional_target(isolated_store):
    r = runner.invoke(coder_cli.app, [
        "new", "--title", "t", "--problem", "p",
        "--acceptance", "ac1:e2e:login works:tests/login.spec.ts",
        "--json",
    ])
    assert r.exit_code == 0, r.stdout
    tid = json.loads(r.stdout.strip().splitlines()[-1])["id"]
    task = TaskStore(isolated_store / "coder" / "tasks").load(tid)
    criterion = task.acceptance[0]
    assert criterion.check == CheckKind.E2E
    assert criterion.description == "login works"
    assert criterion.target == "tests/login.spec.ts"


def test_new_acceptance_without_target_is_none(isolated_store):
    r = runner.invoke(coder_cli.app, [
        "new", "--title", "t", "--problem", "p",
        "--acceptance", "ac1:unit:Hold has no buy verbs",
        "--json",
    ])
    assert r.exit_code == 0, r.stdout
    tid = json.loads(r.stdout.strip().splitlines()[-1])["id"]
    task = TaskStore(isolated_store / "coder" / "tasks").load(tid)
    assert task.acceptance[0].target is None
    assert task.acceptance[0].description == "Hold has no buy verbs"


class FakeHarness:
    def __init__(self, task):
        self.task = task
        self.calls = []

    def run(self, *, auto_approve):
        self.calls.append(auto_approve)
        self.task.status = (TaskStatus.VERIFIED if auto_approve
                           else TaskStatus.AWAITING_APPROVAL)
        return self.task


def test_run_pauses_and_approve_continues(isolated_store, monkeypatch):
    # Create a task directly, then patch the harness factory to stay offline.
    store = TaskStore(isolated_store / "coder" / "tasks")
    t = DevTask(id="dev_cli1", title="t", problem="p",
                acceptance=[AcceptanceCriterion(id="a", description="d",
                                                check=CheckKind.UNIT)],
                workdir=str(isolated_store))
    store.create(t)

    monkeypatch.setattr(coder_cli, "build_harness",
                        lambda tid: FakeHarness(store.load(tid)))
    r = runner.invoke(coder_cli.app, ["run", "dev_cli1"])
    assert r.exit_code == 0, r.stdout
    assert "approve" in r.stdout.lower()
    r2 = runner.invoke(coder_cli.app, ["approve", "dev_cli1"])
    assert r2.exit_code == 0
    assert "verified" in r2.stdout.lower()


def test_new_json_outputs_id(isolated_store):
    r = runner.invoke(coder_cli.app, [
        "new", "--title", "t", "--problem", "p",
        "--acceptance", "ac1:unit:desc", "--json",
    ])
    assert r.exit_code == 0, r.stdout
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    assert payload["ok"] is True
    assert payload["id"].startswith("dev_")


def test_run_json_reports_status(isolated_store, monkeypatch):
    store = TaskStore(isolated_store / "coder" / "tasks")
    t = DevTask(id="dev_json1", title="t", problem="p",
                acceptance=[AcceptanceCriterion(id="a", description="d",
                                                check=CheckKind.UNIT)],
                workdir=str(isolated_store))
    store.create(t)

    class FakeH:
        def __init__(self, task):
            self.task = task

        def run(self, *, auto_approve):
            self.task.status = TaskStatus.AWAITING_APPROVAL
            return self.task

    monkeypatch.setattr(coder_cli, "build_harness",
                        lambda tid: FakeH(store.load(tid)))
    r = runner.invoke(coder_cli.app, ["run", "dev_json1", "--json"])
    assert r.exit_code == 0, r.stdout
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    assert payload["ok"] is True
    assert payload["id"] == "dev_json1"
    assert payload["status"] == "awaiting_approval"


def _advance_to_awaiting(store: TaskStore, task: DevTask) -> DevTask:
    for st in (TaskStatus.REPRODUCED, TaskStatus.DIAGNOSED, TaskStatus.PATCHED,
               TaskStatus.VERIFYING, TaskStatus.AWAITING_APPROVAL):
        task.transition(st)
    store.save(task)
    return task


def test_reject_blocks_task_and_records_reason(isolated_store):
    store = TaskStore(isolated_store / "coder" / "tasks")
    t = DevTask(id="dev_rej1", title="t", problem="p",
                acceptance=[AcceptanceCriterion(id="a", description="d",
                                                check=CheckKind.UNIT)],
                workdir=str(isolated_store))
    store.create(t)
    _advance_to_awaiting(store, t)

    r = runner.invoke(coder_cli.app,
                      ["reject", "dev_rej1", "--reason", "bad diff", "--json"])
    assert r.exit_code == 0, r.stdout
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    assert payload["ok"] is True
    assert payload["status"] == "blocked"

    saved = store.load("dev_rej1")
    assert saved.status == TaskStatus.BLOCKED
    iters = store.read_iterations("dev_rej1")
    assert iters[-1].decision == "human rejected"
    assert "bad diff" in iters[-1].observations


def test_reject_only_valid_when_awaiting(isolated_store):
    r = runner.invoke(coder_cli.app, [
        "new", "--title", "t", "--problem", "p",
        "--acceptance", "ac1:unit:d", "--json",
    ])
    tid = json.loads(r.stdout.strip().splitlines()[-1])["id"]
    r2 = runner.invoke(coder_cli.app, ["reject", tid, "--reason", "x"])
    assert r2.exit_code != 0


def test_dev_subcommand_registered_on_main_app():
    from agent_core.cli import app
    r = runner.invoke(app, ["dev", "--help"])
    assert r.exit_code == 0
    assert "new" in r.stdout and "run" in r.stdout and "approve" in r.stdout
    assert "reject" in r.stdout

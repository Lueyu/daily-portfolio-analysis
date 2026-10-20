# tests/test_coder_cli.py
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


def test_dev_subcommand_registered_on_main_app():
    from agent_core.cli import app
    r = runner.invoke(app, ["dev", "--help"])
    assert r.exit_code == 0
    assert "new" in r.stdout and "run" in r.stdout and "approve" in r.stdout

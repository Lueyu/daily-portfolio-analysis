"""The offline stop command must recover every child owner after Python exits."""
import json
import subprocess
import sys
import threading

import pytest
from typer.testing import CliRunner

from agent_core.coder import cli
from agent_core.coder.general_harness import GeneralHarness
from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask
from agent_core.coder.task_store import TaskStore
from agent_core.config import Settings


@pytest.fixture
def stop_task(tmp_path, monkeypatch):
    source = tmp_path / 'source'
    source.mkdir()
    store = TaskStore(tmp_path / 'tasks')
    task = DevTask(id='dev_stopchildren', title='stop', problem='stop all child runtimes',
                   workdir=str(source), runtime_version=2,
                   acceptance=[AcceptanceCriterion(id='a', description='works', check=CheckKind.UNIT)])
    store.create(task)
    settings = Settings(_env_file=None, coder_network_mode='allowlist',
                        coder_network_allowed_hosts=['docs.python.org'])
    monkeypatch.setattr(cli, '_store', lambda: store)
    monkeypatch.setattr(cli, 'get_settings', lambda: settings)
    stopped = []

    class Runtime:
        def __init__(self, task_id, workspace, state_dir, **kwargs):
            self.task_id = task_id
            self.network_policy = kwargs.get('network_policy')

        def stop_all(self):
            stopped.append(self.task_id)

        def ensure(self):
            raise AssertionError('offline cleanup must not start runtime containers')

    from agent_core.coder import runtime
    monkeypatch.setattr(runtime, 'ContainerRuntime', Runtime)
    harness = cli._offline_general(task.id)
    (harness.workspace / 'app.txt').write_text('source', encoding='utf-8')
    revision = harness.journal.snapshot()
    harness.state = {'version': 2, 'baseline': revision, 'revision': revision,
                     'verification': [], 'pending': None, 'services': []}
    harness._save()
    yield harness, stopped
    harness.journal.close()


def test_offline_controller_preserves_effective_network_policy(stop_task):
    harness, _ = stop_task
    assert harness.network_policy is not None
    assert harness.network_policy.as_dict() == {'mode': 'allowlist', 'allowed_hosts': ['docs.python.org']}


def test_runtime_stop_recovers_orphan_children_without_starting_model_or_runtime(stop_task):
    harness, stopped = stop_task
    script = (
        'import os,threading; from pathlib import Path; '
        'from agent_core.coder.workers import WorkerManager; '
        'from agent_core.coder.checkpoints import CheckpointStore; '
        'from agent_core.coder.general_state import MANAGED_EXCLUSIONS; '
        f'j=CheckpointStore(Path({str(harness.workspace)!r}),Path({str(harness.journal.root)!r}),'
        'excluded_roots=MANAGED_EXCLUSIONS); '
        f'm=WorkerManager(j,Path({str(harness.state_dir / "workers")!r}),lambda c: threading.Event().wait()); '
        "m.spawn('orphan child'); os._exit(23)"
    )
    crashed = subprocess.run([sys.executable, '-c', script], capture_output=True)
    assert crashed.returncode == 23, crashed.stderr
    response = CliRunner().invoke(cli.app, ['runtime-stop', harness.task.id, '--json'])
    assert response.exit_code == 0, response.output
    records = json.loads((harness.state_dir / 'workers/workers.json').read_text())['workers']
    worker_id = next(iter(records))
    assert worker_id in stopped, 'child container owner survived runtime-stop'
    assert harness.task.id in stopped
    assert records[worker_id]['status'] == 'interrupted'


def test_runtime_stop_refuses_to_take_over_live_worker_controller(stop_task):
    from agent_core.coder.workers import WorkerManager
    harness, stopped = stop_task
    release = threading.Event()

    def runner(context):
        release.wait(5)
        return {'status': 'completed'}

    manager = WorkerManager(harness.journal, harness.state_dir / 'workers', runner)
    try:
        manager.spawn('live child')
        response = CliRunner().invoke(cli.app, ['runtime-stop', harness.task.id, '--json'])
        assert response.exit_code != 0, 'stop must reject an owned live worker controller'
        assert stopped == [], 'live controller runtimes must not be stopped by recovery'
    finally:
        release.set()
        manager.close()

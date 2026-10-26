"""Durable user input and exact one-shot approval contracts."""
import importlib.util
import subprocess
import sys
import pytest


def control(tmp_path):
    assert importlib.util.find_spec('agent_core.coder.session_control'), 'session control missing'
    from agent_core.coder.session_control import SessionControl
    return SessionControl(tmp_path)


def test_messages_survive_restart_and_ack_does_not_drop_later_input(tmp_path):
    c = control(tmp_path)
    first = c.send('keep keyboard support')
    second = c.send('also preserve mobile layout')
    assert [m['text'] for m in control(tmp_path).messages()] == [first['text'], second['text']]
    assert control(tmp_path).messages([first['id']]) == [second]


def test_approval_is_exact_and_can_be_consumed_only_once(tmp_path):
    c = control(tmp_path)
    args = {'server': 'issues', 'tool': 'create', 'arguments': {'title': 'repair'}}
    request = c.request_approval(args, 'Create an issue')
    assert c.authorize(args) == 'pending'
    assert c.request_approval(args, 'retry')['id'] == request['id']
    c.decide(request['id'], True)
    assert c.authorize({**args, 'arguments': {'title': 'different'}}) == 'missing'
    assert control(tmp_path).authorize(args) == 'approved'
    assert c.authorize(args) == 'consumed'
    with pytest.raises(ValueError, match='already'):
        c.decide(request['id'], True)


def test_denial_and_invalid_ids_never_allow_execution(tmp_path):
    c = control(tmp_path)
    request = c.request_approval({'tool': 'write'}, 'External write')
    c.decide(request['id'], False)
    assert c.authorize({'tool': 'write'}) == 'denied'
    with pytest.raises(ValueError):
        c.decide('../other', True)


def test_tool_results_cannot_create_approvals_and_input_is_bounded(tmp_path):
    c = control(tmp_path)
    with pytest.raises(ValueError):
        c.send(' ')
    with pytest.raises(ValueError):
        c.send('x' * 20001)
    with pytest.raises(ValueError):
        c.decide('f' * 32, True)


def test_cli_user_input_and_approval_do_not_construct_model_or_runtime(tmp_path, monkeypatch):
    from agent_core.coder import cli
    from agent_core.coder.models import DevTask, AcceptanceCriterion, CheckKind
    from agent_core.coder.task_store import TaskStore
    from typer.testing import CliRunner
    store = TaskStore(tmp_path / 'tasks')
    task = DevTask(id='dev_session', title='task', problem='repair', workdir=str(tmp_path), runtime_version=2,
                   acceptance=[AcceptanceCriterion(id='a', description='works', check=CheckKind.UNIT)])
    store.create(task)
    monkeypatch.setattr(cli, '_store', lambda: store)
    c = control(store.root / task.id / 'runtime' / 'control')
    request = c.request_approval({'server': 'issues', 'tool': 'create'}, 'Create issue')
    response = CliRunner().invoke(cli.app, ['message', task.id, '--text', 'support keyboard', '--json'])
    assert response.exit_code == 0, response.output
    assert c.messages()[0]['text'] == 'support keyboard'
    response = CliRunner().invoke(cli.app, ['decide', task.id, '--request-id', request['id'], '--approve', '--json'])
    assert response.exit_code == 0, response.output
    assert c.list_approvals()[0]['status'] == 'approved'


def test_failed_decision_publish_can_be_retried_after_restart(tmp_path, monkeypatch):
    from agent_core.coder.task_store import TaskStore
    c = control(tmp_path)
    request = c.request_approval({'server': 'issues', 'tool': 'write'}, 'Write issue')
    original = TaskStore._atomic_write

    def fail_publish(path, content):
        if path.name.endswith('.decision.json'):
            raise OSError('simulated disk write failure')
        return original(path, content)

    with monkeypatch.context() as patch:
        patch.setattr(TaskStore, '_atomic_write', staticmethod(fail_publish))
        with pytest.raises(OSError, match='disk write'):
            c.decide(request['id'], True)
    resumed = control(tmp_path)
    assert resumed.list_approvals()[0]['status'] == 'pending'
    assert resumed.decide(request['id'], True)['status'] == 'approved'


def test_decision_lock_is_released_after_actual_process_exit(tmp_path):
    c = control(tmp_path)
    request = c.request_approval({'server': 'issues', 'tool': 'write'}, 'Write issue')
    lock_path = c._path(request['id'], '.decision.lock')
    script = (
        'import os; from pathlib import Path; '
        'from agent_core.coder.checkpoints.locking import MutationLock; '
        f'lock=MutationLock(Path({str(lock_path)!r})); lock.acquire(); os._exit(23)'
    )
    result = subprocess.run([sys.executable, '-c', script], capture_output=True, timeout=10)
    assert result.returncode == 23, result.stderr
    assert control(tmp_path).decide(request['id'], False)['status'] == 'denied'


def test_live_decision_owner_cannot_be_taken_over(tmp_path):
    from agent_core.coder.checkpoints.locking import MutationLock
    c = control(tmp_path)
    request = c.request_approval({'server': 'issues', 'tool': 'write'}, 'Write issue')
    lock = MutationLock(c._path(request['id'], '.decision.lock'))
    lock.acquire()
    script = (
        'from pathlib import Path; '
        'from agent_core.coder.session_control import SessionControl; '
        f'c=SessionControl(Path({str(tmp_path)!r})); '
        f'\ntry: c.decide({request["id"]!r},True)'
        '\nexcept ValueError: print("busy")'
        '\nelse: raise AssertionError("took over live decision owner")'
    )
    try:
        result = subprocess.run([sys.executable, '-c', script], capture_output=True, text=True, timeout=10)
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == 'busy'
        assert c.list_approvals()[0]['status'] == 'pending'
    finally:
        lock.release()
    assert c.decide(request['id'], True)['status'] == 'approved'

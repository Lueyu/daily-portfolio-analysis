"""Real file/journal integration; fake process adapter only avoids Docker in unit tests."""
import importlib.util
import os
from pathlib import Path

import pytest

from agent_core.coder.gates import GateState
from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask
from agent_core.coder.task_store import TaskStore


class Runtime:
    def __init__(self, workspace):
        self.workspace = workspace
        self.jobs = {}

    def ensure(self):
        pass

    def active_writers(self):
        return []

    def terminal_start(self, command, **kwargs):
        sid = f"session{len(self.jobs)}"
        if command == "partial failure":
            (self.workspace / "partial.txt").write_text("partial")
        result = dict(session_id=sid, status="completed", exit_code=1 if command == "partial failure" else 0,
                      output="1 passed; assertions checked", cursor=30)
        self.jobs[sid] = result
        return result

    def terminal_poll(self, session_id, **kwargs):
        return self.jobs[session_id]

    def stop_all(self):
        pass


@pytest.fixture()
def harness(tmp_path):
    assert importlib.util.find_spec("agent_core.coder.general_harness"), "general harness missing"
    from agent_core.coder.general_harness import GeneralHarness
    source = tmp_path / "source"
    source.mkdir()
    (source / "app.txt").write_text("broken", encoding="utf-8")
    store = TaskStore(tmp_path / "tasks")
    task = DevTask(id="dev_general", title="fix", problem="make app work", workdir=str(source),
                   acceptance=[AcceptanceCriterion(id="a", description="works", check=CheckKind.UNIT)])
    store.create(task)
    return GeneralHarness(task, None, store, runtime_factory=lambda workspace, state: Runtime(workspace))


def act(harness, name, **args):
    return harness.execute(harness.registry.validate(name, args), harness.gate)


def test_pipeline_exit_zero_cannot_hide_failing_test_report(harness, monkeypatch):
    harness.prepare()
    start = harness.runtime.terminal_start

    def piped_report(command, **kwargs):
        result = start(command, **kwargs)
        result.update(exit_code=0, output="# tests 9\n# pass 8\n# fail 1\n# cancelled 0")
        return result

    monkeypatch.setattr(harness.runtime, "terminal_start", piped_report)
    act(harness, "verify", command="node --test 2>&1 | tail -60", criterion_ids=["a"], scope="target")
    act(harness, "verify", command="node --test 2>&1 | tail -60", criterion_ids=[], scope="regression")
    assert all(not check["passed"] for check in harness.state["verification"])
    assert act(harness, "finish", summary="tests passed").signal != "finish"


@pytest.mark.parametrize("failure_at", [2, 3])
def test_post_launch_persistence_error_returns_pollable_session(harness, monkeypatch, failure_at):
    harness.prepare()
    start = harness.runtime.terminal_start
    save = harness.store.save
    saves = []

    def running(command, **kwargs):
        result = start(command, **kwargs)
        result.update(status="running", exit_code=None)
        return result

    def transient_failure(task):
        saves.append(task.id)
        if len(saves) == failure_at:
            raise PermissionError("task metadata is temporarily locked")
        return save(task)

    monkeypatch.setattr(harness.runtime, "terminal_start", running)
    monkeypatch.setattr(harness.store, "save", transient_failure)
    result = act(harness, "terminal_start", command="long check", reason="check")
    assert "session0" in result.observation
    assert "terminal_poll" in result.observation
    assert harness.state["pending"]["session_id"] == "session0"
    blocked = act(harness, "terminal_start", command="must not launch", reason="check")
    assert "session0" in blocked.observation
    assert len(harness.runtime.jobs) == 1
    harness.runtime.jobs["session0"].update(status="completed", exit_code=0)
    act(harness, "terminal_poll", session_id="session0")
    assert harness.state["pending"] is None
    assert harness.journal.pending() is None


def test_prelaunch_persistence_error_releases_checkpoint_without_starting_job(harness, monkeypatch):
    harness.prepare()
    save = harness.store.save
    saves = []

    def fail_once(task):
        saves.append(task.id)
        if len(saves) == 1:
            raise PermissionError("task metadata is temporarily locked")
        return save(task)

    monkeypatch.setattr(harness.store, "save", fail_once)
    def must_not_stop_previews():
        raise AssertionError("a prelaunch persistence error must not stop existing preview services")
    monkeypatch.setattr(harness.runtime, "stop_all", must_not_stop_previews)
    result = act(harness, "terminal_start", command="not started", reason="check")
    assert "PermissionError" in result.observation
    assert not harness.runtime.jobs
    assert harness.state["pending"] is None
    assert harness.journal.pending() is None
    act(harness, "terminal_start", command="next check", reason="check")
    assert len(harness.runtime.jobs) == 1


def test_error_event_persistence_failure_does_not_hide_active_session(harness, monkeypatch):
    harness.prepare()
    start = harness.runtime.terminal_start

    def running(command, **kwargs):
        result = start(command, **kwargs)
        result.update(status="running", exit_code=None)
        return result

    def cannot_record(*args, **kwargs):
        raise PermissionError("event file is locked")

    monkeypatch.setattr(harness.runtime, "terminal_start", running)
    monkeypatch.setattr(harness.evidence, "event", cannot_record)
    result = act(harness, "terminal_start", command="long check", reason="check")
    assert "session0" in result.observation
    assert "terminal_poll" in result.observation
    assert "PermissionError" in result.observation
    assert harness.state["pending"]["session_id"] == "session0"


@pytest.mark.parametrize("failure_at", [3, 4])
def test_completed_terminal_result_survives_settlement_or_event_save_failure(harness, monkeypatch, failure_at):
    import json
    harness.prepare()
    save = harness.store.save
    saves = []

    def fail_once(task):
        saves.append(task.id)
        if len(saves) == failure_at:
            raise PermissionError("task metadata is temporarily locked")
        return save(task)

    monkeypatch.setattr(harness.store, "save", fail_once)
    response = act(harness, "terminal_start", command="completed check", reason="check")
    result = json.loads(response.observation)
    assert result["result"]["session_id"] == "session0"
    assert result["result"]["exit_code"] == 0
    assert "assertions checked" in result["result"]["output"]
    assert "do not repeat" in result["guidance"]
    assert len(harness.runtime.jobs) == 1
    assert harness.state["pending"] is None
    assert harness.journal.pending() is None


def test_failed_verify_report_stays_failed_when_settlement_save_also_fails(harness, monkeypatch):
    harness.prepare()
    start = harness.runtime.terminal_start
    save = harness.store.save
    saves = []

    def failed_report(command, **kwargs):
        result = start(command, **kwargs)
        result.update(exit_code=0, output="# pass 8\n# fail 1")
        return result

    def fail_settlement(task):
        saves.append(task.id)
        if len(saves) == 3:
            raise PermissionError("task metadata is temporarily locked")
        return save(task)

    monkeypatch.setattr(harness.runtime, "terminal_start", failed_report)
    monkeypatch.setattr(harness.store, "save", fail_settlement)
    response = act(harness, "verify", command="node --test | tail -60", criterion_ids=["a"], scope="target")
    assert "session0" in response.observation
    assert harness.state["verification"][-1]["passed"] is False
    assert act(harness, "finish", summary="done").signal != "finish"


def test_model_failure_preserves_task_and_redacts_provider_details(harness):
    import httpx
    import openai
    from agent_core.coder.models import TaskStatus
    class OfflineChat:
        def chat(self, req):
            assert harness.state['modelActivity']['status'] == 'running'
            raise openai.APITimeoutError(request=httpx.Request('POST', 'https://secret.invalid/private'))
    harness.chat = OfflineChat()
    task = harness.run()
    activity = harness.evidence.load('state.json', {})['modelActivity']
    assert task.status == TaskStatus.BLOCKED
    assert activity['status'] == 'failed' and activity['finishedAt']
    assert '超时' in activity['error']
    assert 'secret' not in str(activity)
    assert harness.evidence.load('state.json', {})['revision']


def test_feedback_after_candidate_reenters_loop_and_invalidates_evidence(harness, monkeypatch):
    from agent_core.coder.models import TaskStatus
    from agent_core.coder.react_loop import ReactLoop, LoopSignal
    act(harness, 'verify', command='node --test', criterion_ids=['a'], scope='target')
    act(harness, 'verify', command='node --test', criterion_ids=[], scope='regression')
    harness.state['candidate'] = harness.state['revision']
    harness.task.set_status(TaskStatus.AWAITING_APPROVAL)
    harness._save()
    harness.extensions.control.send('also support keyboard')
    observed = []
    def resume(loop):
        observed.extend(loop.executor.external_inputs())
        assert all(item.get('invalidated') for item in loop.executor.state['verification'])
        return LoopSignal.BLOCKED, 'test stopped after consuming feedback'
    monkeypatch.setattr(ReactLoop, 'run', resume)
    result = harness.run()
    assert observed == ['also support keyboard']
    assert result.status == TaskStatus.BLOCKED


def test_unread_feedback_prevents_landing_old_candidate(harness, monkeypatch):
    from agent_core.coder.models import TaskStatus
    from agent_core.coder import general_landing
    harness.prepare()
    harness.task.set_status(TaskStatus.AWAITING_APPROVAL)
    harness.state['candidate'] = harness.state['revision']
    harness._save()
    harness.extensions.control.send('change the requirement')
    def must_not_land(_):
        raise AssertionError('old candidate must not be applied')
    monkeypatch.setattr(general_landing, 'land_candidate', must_not_land)
    with pytest.raises(ValueError, match='New user input'):
        harness.run(auto_approve=True)


def test_plan_and_memory_persist_across_context_rebuild(harness):
    act(harness, 'update_plan', steps=[{'step': 'reproduce', 'status': 'completed'},
                                     {'step': 'repair', 'status': 'in_progress'}])
    act(harness, 'remember', facts=['defect in app.txt'], next_actions=['write focused assertion'])
    assert 'defect in app.txt' in harness.context_brief()
    assert 'repair' in harness.initial_prompt()
    assert harness.evidence.load('state.json')['plan'][0]['status'] == 'completed'


def test_live_feedback_invalidates_existing_verification(harness):
    act(harness, 'verify', command='node --test', criterion_ids=['a'], scope='target')
    act(harness, 'verify', command='node --test', criterion_ids=[], scope='regression')
    harness.extensions.control.send('also preserve keyboard support')
    assert act(harness, 'finish', summary='done').signal != 'finish'
    assert 'keyboard support' in harness.external_inputs()[0]
    assert not harness.external_inputs()
    assert act(harness, 'finish', summary='done').signal != 'finish'


def test_feedback_replays_after_restart_until_conversation_is_durable(harness):
    from agent_core.coder.general_harness import GeneralHarness
    harness.prepare()
    harness.state['verification'] = [{'revision': harness.state['revision'], 'passed': False,
        'scope': 'target', 'criterion_ids': ['a'], 'output': 'x' * 15000}]
    messages = ['first: preserve authentication', 'second: keyboard', 'third: mobile', 'fourth: theme']
    for text in messages:
        harness.extensions.control.send(text)
    assert harness.external_inputs() == messages
    assert not harness.external_inputs()
    harness.stop()  # Interrupt after delivery but before the model turn is saved.
    resumed = GeneralHarness(harness.store.load(harness.task.id), None, harness.store,
        runtime_factory=lambda workspace, state: Runtime(workspace))
    try:
        resumed.prepare()
        assert resumed.load_context() is None
        assert resumed.external_inputs() == messages
        assert resumed.state['user_feedback'] == messages  # Replaying does not duplicate the audit list.
        assert not resumed.evidence.load('state.json').get('acknowledged_messages')
    finally:
        resumed.stop()


def test_feedback_is_not_acknowledged_if_conversation_write_fails(harness, monkeypatch):
    harness.prepare()
    row = harness.extensions.control.send('keep authentication')
    assert harness.external_inputs() == [row['text']]
    original = harness.evidence.save
    def fail_conversation(name, value):
        if name == 'conversation.json':
            raise OSError('conversation disk write failed')
        return original(name, value)
    monkeypatch.setattr(harness.evidence, 'save', fail_conversation)
    with pytest.raises(OSError, match='conversation disk'):
        harness.save_context([{'role': 'user', 'name': 'user_feedback', 'content': row['text']}])
    assert not harness.evidence.load('state.json').get('acknowledged_messages')


def test_feedback_ack_is_committed_after_conversation_and_excludes_later_input(harness, monkeypatch):
    harness.prepare()
    first = harness.extensions.control.send('keep authentication')
    harness.external_inputs()
    later = harness.extensions.control.send('also mobile')
    messages = [{'role': 'system', 'content': 'agent'}, {'role': 'user', 'content': 'task'},
                {'role': 'user', 'name': 'user_feedback', 'content': first['text']}]
    original = harness.evidence.save
    def check_order(name, value):
        if name == 'state.json' and first['id'] in value.get('acknowledged_messages', []):
            assert harness.evidence.load('conversation.json') == messages
        return original(name, value)
    monkeypatch.setattr(harness.evidence, 'save', check_order)
    harness.save_context(messages)
    assert harness.evidence.load('state.json')['acknowledged_messages'] == [first['id']]
    assert harness.external_inputs() == [later['text']]


def test_conversation_without_ack_replays_safely_after_restart(harness, monkeypatch):
    from agent_core.coder.general_harness import GeneralHarness
    harness.prepare()
    row = harness.extensions.control.send('preserve authentication')
    harness.external_inputs()
    messages = [{'role': 'system', 'content': 'agent'}, {'role': 'user', 'content': 'task'},
                {'role': 'user', 'name': 'user_feedback', 'content': row['text']}]
    original = harness.evidence.save
    def fail_ack(name, value):
        if name == 'state.json' and row['id'] in value.get('acknowledged_messages', []):
            raise OSError('interrupted before acknowledgment')
        return original(name, value)
    with monkeypatch.context() as patch:
        patch.setattr(harness.evidence, 'save', fail_ack)
        with pytest.raises(OSError, match='before acknowledgment'):
            harness.save_context(messages)
    assert harness.load_context() == messages
    assert row['id'] not in harness.state.get('acknowledged_messages', [])
    harness.stop()
    resumed = GeneralHarness(harness.store.load(harness.task.id), None, harness.store,
        runtime_factory=lambda workspace, state: Runtime(workspace))
    try:
        resumed.prepare()
        assert resumed.load_context() == messages
        assert resumed.external_inputs() == [row['text']]
        assert resumed.state['user_feedback'] == [row['text']]
        resumed.save_context(messages)
        assert resumed.evidence.load('state.json')['acknowledged_messages'] == [row['id']]
    finally:
        resumed.stop()


def test_feedback_can_finish_same_turn_after_reverification_without_early_ack(harness):
    harness.prepare()
    row = harness.extensions.control.send('preserve authentication')
    harness.external_inputs()
    act(harness, 'verify', command='node --test', criterion_ids=['a'], scope='target')
    act(harness, 'verify', command='node --test', criterion_ids=[], scope='regression')
    assert act(harness, 'finish', summary='feedback verified').signal == 'finish'
    assert row['id'] not in harness.evidence.load('state.json').get('acknowledged_messages', [])
    harness.extensions.control.send('new requirement while model was responding')
    assert act(harness, 'finish', summary='stale response').signal != 'finish'


def test_delivered_but_unpersisted_feedback_cannot_approve_old_candidate(harness, monkeypatch):
    from agent_core.coder.models import TaskStatus
    from agent_core.coder import general_landing
    harness.prepare()
    harness.task.set_status(TaskStatus.AWAITING_APPROVAL)
    harness.state['candidate'] = harness.state['revision']
    harness.extensions.control.send('change the requirement')
    harness.external_inputs()
    def must_not_land(_):
        raise AssertionError('unpersisted feedback cannot authorize the old candidate')
    monkeypatch.setattr(general_landing, 'land_candidate', must_not_land)
    with pytest.raises(ValueError, match='New user input'):
        harness.run(auto_approve=True)


def test_mcp_external_effect_waits_for_exact_human_approval(harness):
    class Integrations:
        writes = 0

        def call_tool(self, server, tool, arguments, approved=False):
            if not approved:
                return {'approvalRequired': True, 'status': 'approval_required'}
            self.writes += 1
            return {'ok': True, 'content': 'created'}

    integrations = Integrations()
    harness.extensions.integrations = integrations
    args = {'server': 'issues', 'tool': 'create', 'arguments': {'title': 'Repair'}}
    result = act(harness, 'mcp_call', **args)
    assert result.signal == 'paused'
    assert integrations.writes == 0
    request = harness.extensions.control.list_approvals()[0]
    harness.extensions.control.decide(request['id'], True)
    assert act(harness, 'mcp_call', **args).signal == 'continue'
    assert integrations.writes == 1
    act(harness, 'mcp_call', **args)
    assert integrations.writes == 1


def test_capabilities_report_truth_and_visual_tool_rejects_missing_model(harness):
    import json
    capabilities = json.loads(act(harness, 'capabilities').observation)
    assert capabilities['sandbox'] is True
    assert capabilities['workers']['isolation'] == 'independent_source_copy'
    result = act(harness, 'inspect_image', artifact_id='a' * 32, question='is the button visible?')
    assert 'failed' in result.observation.lower()


def test_edits_persist_and_are_individually_reversible(harness):
    result = act(harness, "edit_file", path="app.txt", old_text="broken", new_text="fixed", reason="repair")
    assert "failed" not in result.observation.lower()
    assert (harness.workspace / "app.txt").read_text() == "fixed"
    assert Path(harness.task.workdir, "app.txt").read_text() == "broken"
    change = next(c for c in harness.journal.list_changes() if c["files"])
    result = act(harness, "undo_change", change_id=change["id"], expected_revision=harness.journal.snapshot())
    assert (harness.workspace / "app.txt").read_text() == "broken"


def test_finish_requires_current_target_and_regression_evidence(harness):
    assert act(harness, "finish", summary="done").signal != "finish"
    act(harness, "verify", command="python -m pytest target", criterion_ids=["a"], scope="target")
    assert act(harness, "finish", summary="done").signal != "finish"
    act(harness, "verify", command="python -m pytest", criterion_ids=[], scope="regression")
    assert act(harness, "finish", summary="done").signal == "finish"
    act(harness, "edit_file", path="app.txt", old_text="broken", new_text="fixed", reason="repair")
    assert act(harness, "finish", summary="done").signal != "finish"


def test_failed_command_changes_are_recorded_and_recoverable(harness):
    act(harness, "terminal_start", command="partial failure", reason="try fix")
    assert (harness.workspace / "partial.txt").exists()
    change = next(c for c in harness.journal.list_changes() if "partial.txt" in c["files"])
    assert change["status"] != "completed"
    act(harness, "undo_change", change_id=change["id"], expected_revision=harness.journal.snapshot())
    assert not (harness.workspace / "partial.txt").exists()


def test_unknown_criterion_cannot_unlock_finish(harness):
    result = act(harness, "verify", command="python -m pytest", criterion_ids=["invented"], scope="target")
    assert "criterion" in result.observation.lower()
    assert not harness.runtime.jobs


def test_reject_feedback_reaches_resume_and_invalidates_candidate(harness, monkeypatch):
    from typer.testing import CliRunner
    from agent_core.coder import cli
    from agent_core.coder.models import TaskStatus
    harness.task.runtime_version = 2
    act(harness, "verify", command="node --test", criterion_ids=["a"], scope="target")
    act(harness, "verify", command="node --test", criterion_ids=[], scope="regression")
    harness.task.set_status(TaskStatus.AWAITING_APPROVAL)
    harness._save()
    monkeypatch.setattr(cli, "build_harness", lambda _: harness)
    response = CliRunner().invoke(cli.app, ["reject", harness.task.id, "--reason", "add keyboard support", "--json"])
    assert response.exit_code == 0, response.output
    assert "add keyboard support" in harness.initial_prompt()
    assert act(harness, "finish", summary="same candidate").signal != "finish"


def test_tool_inputs_survive_conversation_compaction(harness):
    import json
    act(harness, "terminal_start", command="node --test", reason="check behavior")
    events = [json.loads(line) for line in (harness.state_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()]
    assert events[-1]["payload"]["inputs"]["command"] == "node --test"


def test_interrupted_event_tail_does_not_break_resume(harness):
    from agent_core.coder.general_state import read_events
    act(harness, "read_file", path="app.txt")
    event_path = harness.state_dir / "events.jsonl"
    iteration_path = harness.store.root / harness.task.id / "iterations" / "iterations.jsonl"
    for path in (event_path, iteration_path):
        path.write_bytes(path.read_bytes().replace(b"\n", b"\r\n"))
        with path.open("ab") as stream:
            stream.write(b'{"partial":"\xe4')
    assert len(read_events(harness.state_dir)["events"]) == 1
    assert len(harness.store.read_iterations(harness.task.id)) == 1
    assert "failed" not in act(harness, "read_file", path="app.txt").observation
    assert len(read_events(harness.state_dir)["events"]) == 2
    assert len(harness.store.read_iterations(harness.task.id)) == 2
    act(harness, "read_file", path="app.txt")
    assert [row["index"] for row in read_events(harness.state_dir)["events"]] == [0, 1, 2]
    assert list(harness.state_dir.glob("*.incomplete-*"))


def test_workspace_survives_new_controller_and_metadata_is_persisted(harness):
    act(harness, "edit_file", path="app.txt", old_text="broken", new_text="fixed", reason="repair")
    from agent_core.coder.general_harness import GeneralHarness
    other = GeneralHarness(harness.task, None, harness.store,
                           runtime_factory=lambda workspace, state: Runtime(workspace))
    other.prepare()
    assert (other.workspace / "app.txt").read_text() == "fixed"
    assert other.journal.list_changes()


def test_undo_invalidates_even_identical_previously_verified_content(harness):
    act(harness, "verify", command="node --test", criterion_ids=["a"], scope="target")
    act(harness, "verify", command="node --test", criterion_ids=[], scope="regression")
    act(harness, "edit_file", path="app.txt", old_text="broken", new_text="fixed", reason="try")
    change = next(c for c in harness.journal.list_changes() if c["files"])
    act(harness, "undo_change", change_id=change["id"], expected_revision=harness.journal.snapshot())
    assert act(harness, "finish", summary="done").signal != "finish"


def test_unmanaged_source_edit_is_rejected(harness):
    result = act(harness, "write_file", path="artifacts/hidden.py", content="lost", reason="edit")
    assert "failed" in result.observation
    assert not (harness.workspace / "artifacts/hidden.py").exists()


def test_browser_envelope_is_unwrapped_and_artifact_is_scoped(harness):
    import json
    import base64
    harness.runtime.browser = lambda payload: {"id": "request", "ok": True, "result": {
        "base64": base64.b64encode(b"png bytes").decode(), "mimeType": "image/png"}}
    result = json.loads(act(harness, "browser", action="screenshot").observation)
    assert len(result["artifact_id"]) == 32
    assert (harness.state_dir / "artifacts" / (result["artifact_id"] + ".png")).read_bytes() == b"png bytes"
    assert result["image_sent_to_model"] is False
    assert "base64" not in result


def test_browser_worker_error_is_tool_error(harness):
    harness.runtime.browser = lambda payload: {"id": "request", "ok": False, "error": "stale ref"}
    assert "failed" in act(harness, "browser", action="snapshot").observation


def test_resume_reconciles_committed_journal_and_stale_pending_state(harness):
    harness.prepare()
    op = harness.journal.begin("test crash", "terminal")
    (harness.workspace / "app.txt").write_text("partial")
    harness.journal.finish(op, "interrupted")
    harness.state["pending"] = {"operation_id": op, "session_id": "lost"}
    harness._save()
    from agent_core.coder.general_harness import GeneralHarness
    resumed = GeneralHarness(harness.task, None, harness.store,
                             runtime_factory=lambda w, s: Runtime(w))
    resumed.prepare()
    assert resumed.state["pending"] is None
    assert resumed.state["revision"] == resumed.journal.snapshot()
    assert "failed" not in act(resumed, "edit_file", path="app.txt", old_text="partial", new_text="fixed", reason="recover").observation


def test_review_diff_does_not_rewrite_source_literals(harness, tmp_path):
    harness.prepare()
    before = harness.journal.snapshot()
    act(harness, "write_file", path="literal.txt", content='const url = "a/before/foo";\n', reason="literal")
    from agent_core.coder.general_state import snapshot_diff
    diff = snapshot_diff(harness.journal, before, harness.journal.snapshot(), tmp_path / "diff")
    assert '+const url = "a/before/foo";' in diff


def test_all_skipped_output_is_not_successful_validation(harness):
    original = harness.runtime.terminal_start
    def skipped(*args, **kwargs):
        result = original(*args, **kwargs)
        result["output"] = "# tests 1\n# pass 0\n# skipped 1\n"
        return result
    harness.runtime.terminal_start = skipped
    act(harness, "verify", command="node --test", criterion_ids=["a"], scope="target")
    act(harness, "verify", command="node --test", criterion_ids=[], scope="regression")
    assert act(harness, "finish", summary="done").signal != "finish"


def test_node24_spec_reporter_is_recognized(harness):
    original = harness.runtime.terminal_start
    def node24(*args, **kwargs):
        result = original(*args, **kwargs)
        result["output"] = "✔ actual assertion\nℹ tests 2\nℹ pass 1\nℹ skipped 1\n"
        return result
    harness.runtime.terminal_start = node24
    act(harness, "verify", command="node --test", criterion_ids=["a"], scope="target")
    act(harness, "verify", command="node --test", criterion_ids=[], scope="regression")
    assert act(harness, "finish", summary="done").signal == "finish"


def test_explicit_workspace_inside_ignored_parent_is_exported(tmp_path):
    import subprocess
    from agent_core.coder.general_state import seed_workspace
    subprocess.run(["git", "init", str(tmp_path)], check=True, capture_output=True)
    (tmp_path / ".gitignore").write_text("generated/\n")
    source = tmp_path / "generated" / "project"
    source.mkdir(parents=True)
    (source / "app.txt").write_text("source")
    seed_workspace(source, tmp_path / "export")
    assert (tmp_path / "export" / "app.txt").read_text() == "source"


@pytest.mark.parametrize("unmanaged", [".env", ".git/config", "nested/.git/config"])
def test_terminal_invalid_files_roll_back_instead_of_permanently_blocking(harness, unmanaged):
    original = harness.runtime.terminal_start
    def create(*args, **kwargs):
        result = original(*args, **kwargs)
        path = harness.workspace / unmanaged
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("unmanaged")
        (harness.workspace / "app.txt").write_text("partial")
        return result
    harness.runtime.terminal_start = create
    result = act(harness, "terminal_start", command="create unsafe", reason="attempt")
    assert "rolled_back" in result.observation
    assert (harness.workspace / "app.txt").read_text() == "broken"
    assert harness.journal.pending() is None
    assert "failed" not in act(harness, "edit_file", path="app.txt", old_text="broken", new_text="fixed", reason="retry").observation


@pytest.mark.skipif(os.getenv("CODER_RUNTIME_INTEGRATION") != "1", reason="requires real Docker image")
@pytest.mark.parametrize("command", ["printf created > .env", "ln -s /etc/passwd linked", "git init -q",
    "rm app.txt && ln -s /etc/passwd app.txt", "rm -r nested && ln -s /tmp nested"])
def test_real_terminal_unsupported_entries_recover_and_next_command_runs(harness, command):
    import json
    from agent_core.coder.runtime import ContainerRuntime
    (harness.main_cwd / "nested").mkdir()
    (harness.main_cwd / "nested" / "leaf.txt").write_text("original")
    harness.runtime = ContainerRuntime(harness.task.id, harness.workspace, harness.state_dir / "engine")
    try:
        result = json.loads(act(harness, "terminal_start", command=command, reason="recovery boundary").observation)
        while result.get("status") == "running":
            result = json.loads(act(harness, "terminal_poll", session_id=result["session_id"], wait_ms=1000).observation)
        assert result["status"] == "failed_rolled_back"
        assert harness.state["pending"] is None
        assert (harness.workspace / "app.txt").read_text() == "broken"
        assert (harness.workspace / "nested" / "leaf.txt").read_text() == "original"
        result = json.loads(act(harness, "terminal_start", command="test -f app.txt", reason="can continue").observation)
        while result.get("status") == "running":
            result = json.loads(act(harness, "terminal_poll", session_id=result["session_id"], wait_ms=1000).observation)
        assert result["exit_code"] == 0
    finally:
        harness.stop()

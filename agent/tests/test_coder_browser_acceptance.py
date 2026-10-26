"""E2E completion needs observed task UI as well as executed assertions."""
import base64
import json

from agent_core.coder.models import CheckKind
from agent_core.coder.general_state import read_events
from agent_core.models.types import ChatResponse, Usage
from test_coder_general_harness import harness, act  # noqa: F401


def ready_checks(harness):
    act(harness, 'verify', command='node --test', scope='target', criterion_ids=['a'])
    act(harness, 'verify', command='node --test', scope='regression')


def browser_fixture(harness, url='http://service-test:8080'):
    harness.prepare()
    harness.task.acceptance[0].check = CheckKind.E2E
    harness.state['services'] = [{'url': 'http://service-test:8080', 'status': 'running'}]
    def browser(payload):
        result = {'url': payload.get('url', url), 'title': 'Task app', 'version': '1.0'}
        if payload['action'] == 'snapshot':
            result['elements'] = [{'ref': '1.0:0', 'role': 'heading', 'name': 'Loaded data'}]
        if payload['action'] == 'screenshot':
            result.update(base64=base64.b64encode(b'png image').decode(), mimeType='image/png')
        if payload['action'] == 'errors':
            result.update(console=[], pageErrors=[], networkFailures=[], httpErrors=[])
        return {'ok': True, 'result': result}
    harness.runtime.browser = browser


def observe_page(harness, url='http://service-test:8080'):
    for action in ('navigate', 'snapshot', 'screenshot', 'errors'):
        args = {'url': url} if action == 'navigate' else {}
        assert 'failed' not in act(harness, 'browser', action=action, **args).observation


def test_e2e_assertions_alone_cannot_claim_the_page_was_verified(harness):
    browser_fixture(harness)
    ready_checks(harness)
    result = act(harness, 'finish', summary='done')
    assert result.signal != 'finish'
    assert 'browser_required_actions' in result.observation
    assert 'screenshot' in result.observation


def test_current_preview_observation_plus_assertions_unlocks_e2e(harness):
    browser_fixture(harness)
    ready_checks(harness)
    observe_page(harness)
    assert act(harness, 'finish', summary='observed and asserted').signal == 'finish'
    assert harness.state['browser_verification']['revision'] == harness.state['revision']
    assert harness.state['browser_verification']['artifact_id']


def test_browser_observation_without_assertions_never_unlocks_e2e(harness):
    browser_fixture(harness)
    observe_page(harness)
    assert act(harness, 'finish', summary='looks good').signal != 'finish'


def test_external_documentation_screenshot_cannot_satisfy_app_e2e(harness):
    browser_fixture(harness, 'https://docs.python.org/')
    ready_checks(harness)
    observe_page(harness, 'https://docs.python.org/')
    assert act(harness, 'finish', summary='documentation viewed').signal != 'finish'


def test_source_edit_requires_new_browser_evidence_even_after_tests_pass(harness):
    browser_fixture(harness)
    ready_checks(harness)
    observe_page(harness)
    act(harness, 'edit_file', path='app.txt', old_text='broken', new_text='fixed', reason='repair')
    ready_checks(harness)
    assert act(harness, 'finish', summary='old screenshot').signal != 'finish'
    observe_page(harness)
    assert act(harness, 'finish', summary='new screenshot').signal == 'finish'


def test_navigation_or_interaction_requires_fresh_observation(harness):
    browser_fixture(harness)
    ready_checks(harness)
    observe_page(harness)
    act(harness, 'browser', action='click', ref='1.0:0')
    assert act(harness, 'finish', summary='before click').signal != 'finish'
    for action in ('snapshot', 'screenshot', 'errors'):
        act(harness, 'browser', action=action)
    assert act(harness, 'finish', summary='after click').signal == 'finish'


def test_failed_browser_call_never_satisfies_evidence(harness):
    browser_fixture(harness)
    ready_checks(harness)
    observe_page(harness)
    harness.runtime.browser = lambda payload: {'ok': False, 'error': 'navigation failed'}
    act(harness, 'browser', action='navigate', url='http://service-test:8080/broken')
    assert act(harness, 'finish', summary='stale good page').signal != 'finish'


def test_model_progress_preserves_public_text_without_hidden_reasoning(harness):
    content = '已确认接口返回空列表，下一步核对请求实际连接的数据源。' * 40
    harness.record_model(ChatResponse(content=content, model='model', tier='pro',
        usage=Usage(), latency_ms=12, reasoning='private reasoning must never be logged'))
    row = read_events(harness.state_dir)['events'][-1]
    assert row['payload']['content'] == content
    assert len(row['summary']) <= 240
    assert 'private reasoning' not in json.dumps(row)


def test_tool_only_response_does_not_emit_placeholder_progress(harness):
    harness.record_model(ChatResponse(content='', model='model', tier='pro', usage=Usage(), latency_ms=12))
    assert not read_events(harness.state_dir)['events']


def test_tool_summary_describes_operation_instead_of_json_envelope(harness):
    act(harness, 'terminal_start', command='node --test', reason='验证数据源选择')
    row = read_events(harness.state_dir)['events'][-1]
    assert 'node --test' in row['summary']
    assert 'session_id' not in row['summary']
    assert row['payload']['inputs']['command'] == 'node --test'


def test_empty_terminal_polls_do_not_fill_activity_with_no_new_information(harness):
    harness.runtime.terminal_start = lambda command, **kwargs: {
        'session_id': 'pending', 'status': 'running', 'output': '', 'cursor': 0}
    harness.runtime.terminal_poll = lambda **kwargs: {
        'session_id': 'pending', 'status': 'running', 'output': '', 'cursor': 0}
    act(harness, 'terminal_start', command='npm test', reason='verify')
    act(harness, 'terminal_poll', session_id='pending')
    act(harness, 'terminal_poll', session_id='pending')
    assert len(read_events(harness.state_dir)['events']) == 1
    harness.runtime.terminal_poll = lambda **kwargs: {
        'session_id': 'pending', 'status': 'completed', 'output': '1 passed', 'exit_code': 0}
    act(harness, 'terminal_poll', session_id='pending')
    rows = read_events(harness.state_dir)['events']
    assert len(rows) == 2
    assert 'npm test' in rows[-1]['summary']


def test_json_tool_protocol_is_not_rendered_as_public_model_commentary(harness):
    harness.supports_tools = False
    harness.record_model(ChatResponse(content='{"action":"read_file","params":{"path":"app.txt"}}',
        model='model', tier='pro', usage=Usage(), latency_ms=12))
    assert not read_events(harness.state_dir)['events']


def test_repeated_nonmutating_shell_probes_trigger_change_of_method(harness):
    from agent_core.coder.react_loop import ReactLoop
    from test_coder_react_loop import FakeChat, tool_resp
    chat = FakeChat([
        *[tool_resp(('terminal_start', {'command': 'ls', 'reason': 'inspect'})) for _ in range(3)],
        tool_resp(('blocked', {'reason': 'need runtime access'})),
    ])
    loop = ReactLoop(task=harness.task, chat=chat, registry=harness.registry, executor=harness,
                     budget=harness.budget, supports_tools=True, gate=harness.gate)
    assert loop.run() == ('blocked', 'need runtime access')
    # Every command has a different session/checkpoint ID. Equal command output
    # still represents the same evidence, so those volatile fields cannot hide a loop.
    assert '没有新增证据' in str(chat.requests[3].messages)
    assert 'read_file' not in {tool['function']['name'] for tool in chat.requests[3].tools}

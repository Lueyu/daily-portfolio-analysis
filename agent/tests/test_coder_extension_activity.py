"""Extension activity describes the action without dumping configuration or documents."""
from types import SimpleNamespace

from agent_core.coder.general_state import read_events
from test_coder_general_harness import harness, act  # noqa: F401


def latest(harness):
    return read_events(harness.state_dir)['events'][-1]


def test_capability_activity_keeps_configuration_in_expandable_payload(harness):
    act(harness, 'capabilities')
    row = latest(harness)
    assert '模型' in row['summary'] and '工具' in row['summary']
    assert not row['summary'].startswith('{')
    assert 'maxConcurrency' not in row['summary']
    assert 'workers' in row['payload'] and 'models' in row['payload']


def test_plan_activity_explains_current_step_and_completed_count(harness):
    act(harness, 'update_plan', steps=[{'step': '复现页面缺少数据', 'status': 'completed'},
                                     {'step': '检查数据连接', 'status': 'in_progress'}])
    row = latest(harness)
    assert '1/2' in row['summary'] and '检查数据连接' in row['summary']
    assert 'in_progress' not in row['summary']
    assert len(row['payload']['plan']) == 2


def test_skills_and_mcp_activity_do_not_dump_returned_content(harness):
    harness.extensions.integrations = SimpleNamespace(
        list_tools=lambda server: {'ok': True, 'tools': [{'name': 'lookup', 'inputSchema': {'private': 'SCHEMA_DETAIL'}}]},
        read_skill=lambda skill: {'ok': True, 'skill': {'name': '数据库排查'}, 'content': 'LONG_SKILL_CONTENT'},
    )
    act(harness, 'mcp_tools', server='docs')
    row = latest(harness)
    assert 'docs' in row['summary'] and '1' in row['summary']
    assert 'SCHEMA_DETAIL' not in row['summary'] and 'SCHEMA_DETAIL' in str(row['payload'])
    act(harness, 'skill_read', skill_id='project/db')
    row = latest(harness)
    assert '数据库排查' in row['summary']
    assert 'LONG_SKILL_CONTENT' not in row['summary']
    assert row['payload']['content'] == 'LONG_SKILL_CONTENT'


def test_worker_activity_shows_status_without_internal_records(harness, monkeypatch):
    monkeypatch.setattr(harness.extensions, '_worker_action', lambda step: {
        'worker_id': 'worker-private-id', 'status': 'completed', 'prompt': '定位启动失败原因',
        'recent_events': [{'payload': 'INTERNAL_RECORD'}], 'baseline_revision': 'PRIVATE_REVISION',
    })
    act(harness, 'agent_poll', worker_id='worker-private-id')
    row = latest(harness)
    assert '完成' in row['summary'] and '定位启动失败原因' in row['summary']
    assert 'INTERNAL_RECORD' not in row['summary'] and 'PRIVATE_REVISION' not in row['summary']


def test_report_progress_emits_public_model_content_without_claiming_verification(harness):
    message = '已确认后端进程未启动，下一步运行最小启动检查。'
    result = act(harness, 'report_progress', message=message)
    row = latest(harness)
    assert row['action'] == 'model'
    assert row['payload']['content'] == message
    assert row['payload']['source'] == 'report_progress'
    assert 'reasoning' not in row['payload']
    assert not result.made_progress and harness.state['verification'] == []


def test_long_exploration_focuses_execution_then_restores_reads_without_stopping(harness):
    from agent_core.coder.react_loop import ReactLoop
    from test_coder_react_loop import FakeChat, tool_resp
    for index in range(36):
        (harness.main_cwd / f'file{index}.txt').write_text(f'evidence {index}')
    reads = lambda start: [tool_resp(('read_file', {'path': f'file{index}.txt'}))
                           for index in range(start, start + 12)]
    chat = FakeChat([
        *reads(0),
        tool_resp(('report_progress', {'message': '已定位启动入口，下一步验证启动命令。'})),
        *reads(12),
        tool_resp(('terminal_start', {'command': 'node --test', 'reason': 'check hypothesis'})),
        *reads(24),
        tool_resp(('blocked', {'reason': 'test complete'})),
    ])
    loop = ReactLoop(task=harness.task, chat=chat, registry=harness.registry, executor=harness,
                     budget=harness.budget, supports_tools=True, gate=harness.gate)
    assert loop.run() == ('blocked', 'test complete')
    reminders = [request for request in chat.requests
                 if any(message.get('name') == 'execution_guidance' for message in request.messages)]
    assert len(reminders) == 3
    for index, request in enumerate(reminders):
        advice = [message for message in request.messages if message.get('name') == 'execution_guidance']
        assert len(advice) == 1
        assert 'report_progress' in advice[0]['content'] and '最小' in advice[0]['content']
        available = {tool['function']['name'] for tool in request.tools}
        assert ('read_file' in available) is (index != 1)
        assert {'terminal_start', 'browser', 'verify', 'blocked'} <= available
    assert not any(message.get('name') == 'execution_guidance' for message in harness.load_context())


def test_resume_restores_exploration_focus_from_saved_tool_history(harness):
    from agent_core.coder.react_loop import ReactLoop
    from test_coder_react_loop import FakeChat, tool_resp
    harness.prepare()
    history = [{'role': 'system', 'content': 'old system'}, {'role': 'user', 'content': 'task'}]
    for index in range(24):
        history += [{'role': 'assistant', 'content': '', 'tool_calls': [{
            'id': str(index), 'type': 'function', 'function': {'name': 'read_file', 'arguments': '{}'}}]},
            {'role': 'tool', 'tool_call_id': str(index), 'name': 'read_file', 'content': 'evidence'}]
    harness.save_context(history)
    chat = FakeChat([tool_resp(('report_progress', {'message': '准备运行复现。'})),
                     tool_resp(('terminal_start', {'command': 'partial failure', 'reason': 'reproduce'})),
                     tool_resp(('blocked', {'reason': 'fixture complete'}))])
    loop = ReactLoop(task=harness.task, chat=chat, registry=harness.registry, executor=harness,
                     budget=harness.budget, supports_tools=True, gate=harness.gate)
    assert loop.run() == ('blocked', 'fixture complete')
    tools = [{tool['function']['name'] for tool in req.tools} for req in chat.requests]
    assert 'read_file' not in tools[0] and 'read_file' not in tools[1]
    # A failed execution also restores reads so the model can diagnose it.
    assert 'read_file' in tools[2]

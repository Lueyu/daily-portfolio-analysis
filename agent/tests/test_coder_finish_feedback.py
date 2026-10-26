"""A missing regression check must never send v2 back to gratuitous patching."""
import json

from test_coder_general_harness import harness, act  # noqa: F401 - pytest fixture


def test_target_only_finish_reports_exact_missing_regression(harness):
    act(harness, 'verify', command='node --test', criterion_ids=['a'], scope='target')
    result = act(harness, 'finish', summary='done')
    assert result.signal != 'finish'
    error = json.loads(result.observation)['error']
    gaps_json = error.split('finish requires current verification: ', 1)[1]
    gaps, _ = json.JSONDecoder().raw_decode(gaps_json)
    assert gaps['regression_required'] is True
    assert gaps['missing_target_ids'] == []
    assert 'apply_patch' not in result.observation


def test_live_loop_can_finish_without_any_artificial_patch(harness):
    from test_coder_react_loop import FakeChat, tool_resp
    from agent_core.coder.react_loop import ReactLoop
    from agent_core.coder.budget import BudgetGuard
    from agent_core.coder.models import BudgetConfig
    chat = FakeChat([
        tool_resp(('verify', {'command': 'node --test', 'criterion_ids': ['a'], 'scope': 'target'})),
        tool_resp(('finish', {'summary': 'premature'})),
        tool_resp(('verify', {'command': 'node --test', 'criterion_ids': [], 'scope': 'regression'})),
        tool_resp(('finish', {'summary': 'verified'})),
    ])
    loop = ReactLoop(task=harness.task, chat=chat, registry=harness.registry, executor=harness,
                     budget=BudgetGuard(BudgetConfig()), supports_tools=True, gate=harness.gate)
    assert loop.run() == ('finish', 'verified')
    observation = str(chat.requests[2].messages)
    assert 'regression_required' in observation
    assert '必须先 apply_patch' not in observation
    assert not any(row['files'] for row in harness.journal.list_changes())

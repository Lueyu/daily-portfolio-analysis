"""Private provider state survives tool turns without becoming public content."""
import json

import httpx
import pytest

from agent_core.coder.scratchpad import Scratchpad
from agent_core.models import ChatRequest, ModelSpec, ModelTask
from agent_core.models.openai_compatible import OpenAICompatibleProvider
from test_coder_stream_completion import Body, call, chunk
from test_coder_general_harness import harness  # noqa: F401


def make_provider(monkeypatch, seen, *, endpoint='https://models.example/v1', model='coder', key='key', stream=True):
    from agent_core.models import openai_compatible as module

    def handler(request):
        seen.append(json.loads(request.content))
        parts = [
            chunk({'role': 'assistant', 'reasoning_content': ' PRIVATE_'}),
            chunk({'reasoning_content': 'REASONING '}),
            # Ark emits the encrypted block separately, with no content.
            chunk({'content': '', 'reasoning_content': '', 'encrypted_content': ' opaque+/signature== '}),
            chunk({'content': 'Public update', 'tool_calls': [call(0, id='one', name='probe', arguments='{}')]}),
            chunk(finish='tool_calls'),
            chunk(usage={'prompt_tokens': 42, 'completion_tokens': 9000, 'total_tokens': 9042,
                         'completion_tokens_details': {'reasoning_tokens': 8900}}),
            b'data: [DONE]\n\n',
        ]
        if stream:
            return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=Body(parts))
        return httpx.Response(200, json={'id': 'reply', 'model': model, 'object': 'chat.completion', 'created': 1,
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'Public update',
                'reasoning_content': ' PRIVATE_REASONING ', 'encrypted_content': ' opaque+/signature== '},
                'finish_reason': 'stop'}]})

    client = httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)
    monkeypatch.setattr(module, 'DefaultHttpxClient', lambda **_: client)
    return OpenAICompatibleProvider('coder', endpoint, key, model,
        spec=ModelSpec('coder', model, 128000, supports_streaming=stream), sleep=lambda _: None)


def request(messages=None):
    return ChatRequest(task=ModelTask.CODE, messages=messages or [{'role': 'user', 'content': 'fix'}], tools=[
        {'type': 'function', 'function': {'name': 'probe', 'parameters': {'type': 'object', 'properties': {}}}}])


def saved_turn(response):
    pad = Scratchpad('system', 'task')
    pad.assistant_tool_calls(response.content, [{'id': 'one', 'type': 'function', 'function': {
        'name': 'probe', 'arguments': '{}'}}], continuation=response.private_continuation)
    pad.tool_result('one', 'probe', 'observed')
    return pad


@pytest.mark.parametrize('stream', [True, False])
def test_exact_private_fields_return_only_to_bound_provider(monkeypatch, stream):
    seen = []
    p = make_provider(monkeypatch, seen, stream=stream)
    result = p.chat(request())
    assert result.reasoning == '' and result.content == 'Public update'
    assert 'PRIVATE_REASONING' not in repr(result) and 'signature' not in repr(result)
    pad = saved_turn(result)
    # Disk round-trip is the same format used for private conversation memory.
    resumed = Scratchpad('fresh system', 'fresh task')
    resumed.restore(json.loads(json.dumps(pad.messages)))
    p.chat(request(resumed.messages))
    assistant = seen[-1]['messages'][2]
    assert assistant['reasoning_content'] == ' PRIVATE_REASONING '
    assert assistant['encrypted_content'] == ' opaque+/signature== '
    assert '_provider_continuation' not in json.dumps(seen[-1])


@pytest.mark.parametrize('change', [{'endpoint': 'https://other.example/v1'}, {'model': 'fallback'}, {'key': 'other-key'}])
def test_fallback_or_changed_endpoint_model_credential_never_receives_private_fields(monkeypatch, change):
    original = make_provider(monkeypatch, [])
    pad = saved_turn(original.chat(request()))
    seen = []
    destination = make_provider(monkeypatch, seen, **change)
    destination.chat(request(pad.messages))
    assert all('reasoning_content' not in m and 'encrypted_content' not in m for m in seen[0]['messages'])
    assert 'PRIVATE_REASONING' not in json.dumps(seen[0])
    assert 'signature' not in json.dumps(seen[0])


def test_public_summary_omits_private_state_and_compacts_whole_turn(monkeypatch):
    from agent_core.coder.scratchpad import _encoded_size
    from agent_core.models.context import request_tokens
    result = make_provider(monkeypatch, []).chat(request())
    pad = saved_turn(result)
    with_private = _encoded_size(pad.messages)
    assert request_tokens(pad.messages) >= 8900
    public = [{k: v for k, v in m.items() if k != '_provider_continuation'} for m in pad.messages]
    assert with_private > _encoded_size(public)
    # The opaque block represents more model context than its compressed bytes.
    assert with_private >= 8900
    pad.max_context_bytes = 1000
    pad.compact()
    serialized = json.dumps(pad.messages)
    assert 'PRIVATE_REASONING' not in serialized and 'signature' not in serialized
    assert 'probe' in serialized and 'observed' in serialized
    assert not any(m.get('tool_call_id') or m.get('tool_calls') for m in pad.messages)


def test_pending_tool_turn_never_truncates_private_block(monkeypatch):
    result = make_provider(monkeypatch, []).chat(request())
    pad = Scratchpad('system', 'task', max_context_bytes=1000)
    pad.assistant_tool_calls('', [{'id': 'one', 'type': 'function', 'function': {'name': 'probe', 'arguments': '{}'}}],
                             continuation=result.private_continuation)
    original = json.loads(json.dumps(pad.messages[2]))
    pad.compact()
    assert pad.messages[2] == original


def test_raw_private_fields_without_binding_are_never_forwarded(monkeypatch):
    seen = []
    p = make_provider(monkeypatch, seen)
    p.chat(request([{'role': 'assistant', 'content': 'ok', 'reasoning_content': 'PRIVATE_REASONING',
                     'encrypted_content': 'signature'}]))
    assert seen[0]['messages'] == [{'role': 'assistant', 'content': 'ok'}]


def test_opaque_reasoning_budget_is_checked_before_sending(monkeypatch):
    from dataclasses import replace
    seen = []
    p = make_provider(monkeypatch, seen)
    pad = saved_turn(p.chat(request()))
    p.spec = replace(p.spec, context_window=2000, max_output_tokens=512)
    with pytest.raises(ValueError, match='context window'):
        p.chat(request(pad.messages))
    assert len(seen) == 1
    # A different model does not receive or reserve the original private state.
    fallback = make_provider(monkeypatch, seen, model='fallback')
    fallback.spec = replace(fallback.spec, context_window=2000, max_output_tokens=512)
    fallback.chat(request(pad.messages))
    assert len(seen) == 2


def test_full_loop_persists_private_continuation_but_never_publishes_it(harness):
    from agent_core.coder.react_loop import ReactLoop
    from agent_core.coder.general_state import read_events
    from test_coder_react_loop import FakeChat, tool_resp
    first = tool_resp(('report_progress', {'message': 'Public tool progress'}))
    first.content = 'Public model progress'
    first.private_continuation = {'binding': 'private-binding', 'fields': {
        'reasoning_content': 'PRIVATE_REASONING', 'encrypted_content': 'PRIVATE_SIGNATURE'}, 'reasoning_tokens': 2}
    chat = FakeChat([first, tool_resp(('blocked', {'reason': 'fixture complete'}))])
    loop = ReactLoop(task=harness.task, chat=chat, registry=harness.registry, executor=harness,
                     budget=harness.budget, supports_tools=True, gate=harness.gate)
    assert loop.run() == ('blocked', 'fixture complete')
    assert 'PRIVATE_REASONING' in json.dumps(harness.load_context())
    assert 'PRIVATE_SIGNATURE' in json.dumps(chat.requests[1].messages)
    public = json.dumps(read_events(harness.state_dir))
    assert 'Public model progress' in public and 'Public tool progress' in public
    assert 'PRIVATE_REASONING' not in public and 'PRIVATE_SIGNATURE' not in public
    iterations = (harness.state_dir.parent / 'iterations' / 'iterations.jsonl').read_text(encoding='utf-8')
    assert 'PRIVATE_REASONING' not in iterations and 'PRIVATE_SIGNATURE' not in iterations


def test_code_stream_api_never_publishes_private_reasoning(monkeypatch):
    p = make_provider(monkeypatch, [])
    chunks = list(p.stream_chat(request()))
    assert all(not c.delta_reasoning for c in chunks)
    assert 'PRIVATE_REASONING' not in repr(chunks)
    assert any(c.delta_content == 'Public update' for c in chunks)

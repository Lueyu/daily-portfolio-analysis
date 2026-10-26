"""CODE tool calls are executable only after a complete SSE response."""
import json

import httpx
import openai
import pytest

from agent_core.models import ChatRequest, ModelSpec, ModelTask
from agent_core.models.openai_compatible import OpenAICompatibleProvider


def chunk(delta=None, finish=None, usage=None):
    data = {'id': 'completion-1', 'object': 'chat.completion.chunk', 'created': 1, 'model': 'coder',
            'choices': [] if usage else [{'index': 0, 'delta': delta or {}, 'finish_reason': finish}]}
    if usage:
        data['usage'] = usage
    return ('data: ' + json.dumps(data) + '\n\n').encode()


def call(index, *, id=None, name=None, arguments=''):
    value = {'index': index, 'function': {'arguments': arguments}}
    if id:
        value.update(id=id, type='function')
    if name:
        value['function']['name'] = name
    return value


def completion_chunks():
    return [
        chunk({'role': 'assistant', 'content': '公开进度', 'reasoning_content': 'PRIVATE_REASONING'}),
        chunk({'tool_calls': [call(0, id='first', name='write_file', arguments='{"pa'),
                              call(1, id='second', name='report_progress', arguments='{"message":')]}),
        chunk({'tool_calls': [call(0, arguments='th":"src/a.ts","content":"hello"}'),
                              call(1, arguments='"ready"}')]}),
        chunk(finish='tool_calls'),
        chunk(usage={'prompt_tokens': 42, 'completion_tokens': 17, 'total_tokens': 59}),
        b'data: [DONE]\n\n',
    ]


class Body(httpx.SyncByteStream):
    def __init__(self, parts, failure=None):
        self.parts = parts
        self.failure = failure
        self.closed = False

    def __iter__(self):
        yield from self.parts
        if self.failure:
            raise self.failure

    def close(self):
        self.closed = True


def provider(monkeypatch, handler, **kwargs):
    from agent_core.models import openai_compatible as module
    client = httpx.Client(transport=httpx.MockTransport(handler), trust_env=False)
    monkeypatch.setattr(module, 'DefaultHttpxClient', lambda **_: client)
    return OpenAICompatibleProvider('coder', 'https://models.example/v1', 'test-key', 'coder',
        spec=ModelSpec('coder', 'coder', 128000), sleep=lambda _: None, **kwargs)


def request():
    return ChatRequest(task=ModelTask.CODE, messages=[{'role': 'user', 'content': 'fix'}], tools=[
        {'type': 'function', 'function': {'name': name, 'parameters': {'type': 'object', 'properties': {}}}}
        for name in ('write_file', 'report_progress')])


def test_complete_stream_aggregates_interleaved_tools_and_usage_without_reasoning(monkeypatch):
    seen = []
    body = Body(completion_chunks())
    def handler(req):
        seen.append(json.loads(req.content))
        return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=body)
    result = provider(monkeypatch, handler).chat(request())
    assert seen[0]['stream'] is True
    assert seen[0]['stream_options'] == {'include_usage': True}
    assert result.content == '公开进度'
    assert result.reasoning == ''
    assert [(c.id, c.name, c.arguments) for c in result.tool_calls] == [
        ('first', 'write_file', {'path': 'src/a.ts', 'content': 'hello'}),
        ('second', 'report_progress', {'message': 'ready'}),
    ]
    assert result.usage.prompt_tokens == 42 and result.usage.completion_tokens == 17
    assert body.closed


@pytest.mark.parametrize('ending', ['connection_error', 'eof', 'invalid_json', 'length'])
def test_incomplete_stream_never_returns_partial_tool_calls_or_retries(monkeypatch, ending):
    parts = [chunk({'role': 'assistant', 'tool_calls': [call(0, id='first', name='write_file', arguments='{"path":') ]})]
    failure = httpx.ReadError('PRIVATE_PROVIDER_DETAIL') if ending == 'connection_error' else None
    if ending == 'invalid_json':
        parts += [chunk(finish='tool_calls'), b'data: [DONE]\n\n']
    if ending == 'length':
        parts += [chunk(finish='length'), b'data: [DONE]\n\n']
    calls = []
    body = Body(parts, failure)
    def handler(req):
        calls.append(req)
        return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=body)
    p = provider(monkeypatch, handler, max_attempts=3)
    with pytest.raises(openai.OpenAIError) as caught:
        p.chat(request())
    assert 'PRIVATE_PROVIDER_DETAIL' not in str(caught.value)
    assert 'write_file' not in str(caught.value)
    assert len(calls) == 1 and body.closed


def test_establishment_failure_can_retry_before_any_chunk(monkeypatch):
    calls = []
    def handler(req):
        calls.append(req)
        if len(calls) == 1:
            return httpx.Response(503, json={'error': {'message': 'unavailable'}})
        return httpx.Response(200, headers={'content-type': 'text/event-stream'}, stream=Body(completion_chunks()))
    result = provider(monkeypatch, handler, max_attempts=2).chat(request())
    assert len(calls) == 2 and result.attempts == 2 and len(result.tool_calls) == 2


def test_non_code_chat_keeps_non_streaming_path(monkeypatch):
    seen = []
    def handler(req):
        seen.append(json.loads(req.content))
        return httpx.Response(200, json={'id': 'reply', 'model': 'coder', 'object': 'chat.completion', 'created': 1,
            'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'ok'}, 'finish_reason': 'stop'}]})
    result = provider(monkeypatch, handler).chat(ChatRequest(messages=[{'role': 'user', 'content': 'hello'}]))
    assert result.content == 'ok' and not seen[0].get('stream')

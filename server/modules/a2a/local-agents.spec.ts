import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAgentsService } from './local-agents.service';
import { LocalAgentError, type LocalAgentExecution } from './local-agents.types';

interface Rpc { id: number; method: string; params: Record<string, unknown> }
interface Fixture {
  calls: Rpc[];
  origin: string;
  registry: string;
  service: LocalAgentsService;
}
async function fixture(handle: (rpc: Rpc, request: IncomingMessage) => unknown,
  run: (value: Fixture) => Promise<void>, cardOverride?: (origin: string) => unknown): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'squabble-a2a-'));
  const registry = join(directory, 'agents.json');
  const previous = process.env.A2A_AGENTS_FILE;
  const calls: Rpc[] = [];
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/card') {
      response.end(JSON.stringify(cardOverride ? cardOverride(origin) : { name: 'Local research',
        supportedInterfaces: [{ url: `${origin}/rpc`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
        capabilities: {}, skills: [], defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'] }));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString()) as Rpc;
    calls.push(rpc);
    try { response.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: handle(rpc, request) })); }
    catch { response.statusCode = 500; response.end('provider-secret'); }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture server unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  await writeFile(registry, JSON.stringify([{ id: 'local', name: 'Local research', cardUrl: `${origin}/card`,
    token: 'fixture-token', owners: ['alice'] }]));
  process.env.A2A_AGENTS_FILE = registry;
  try { await run({ calls, origin, registry, service: new LocalAgentsService() }); }
  finally {
    if (previous === undefined) delete process.env.A2A_AGENTS_FILE;
    else process.env.A2A_AGENTS_FILE = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}
function task(state: string, extra: Record<string, unknown> = {}) {
  return { id: 'remote-task', contextId: 'remote-context', status: { state }, ...extra };
}
function options(extra: Partial<LocalAgentExecution> = {}): LocalAgentExecution {
  return { agentId: 'local', messageId: 'message-1', prompt: 'Research AAPL',
    onTask: async () => undefined, onProgress: async () => undefined,
    shouldContinue: async () => true, ...extra };
}

test('registry lists only exact owners, exposes no credentials, and discovery does not execute work', async () => {
  await fixture(() => { throw new Error('must not call'); }, async ({ service, calls }) => {
    assert.deepEqual(await service.list('alice'), [{ id: 'local', name: 'Local research', protocol: 'a2a', available: true }]);
    assert.deepEqual(await service.list('bob'), []);
    await assert.rejects(() => service.test('bob', 'local'), /A2A_AGENT_NOT_FOUND/);
    assert.deepEqual(await service.test('alice', 'local'), { ok: true, protocol: 'a2a', version: '1.0' });
    assert.equal(calls.length, 0);
  });
});

test('SDK sends nonblocking task, persists its reference before polling and accepts artifacts with unknown usage', async () => {
  let persisted = false;
  await fixture((rpc, request) => {
    assert.equal(request.headers.authorization, 'Bearer fixture-token');
    assert.equal(request.headers['a2a-version'], '1.0');
    if (rpc.method === 'SendMessage') {
      assert.equal((rpc.params.configuration as Record<string, unknown>).returnImmediately, true);
      return { task: task('TASK_STATE_WORKING', { status: { state: 'TASK_STATE_WORKING',
        message: { messageId: 'progress', role: 'ROLE_AGENT', parts: [{ text: 'Checking filings' }] } } }) };
    }
    assert.equal(rpc.method, 'GetTask');
    assert.equal(persisted, true);
    return task('TASK_STATE_COMPLETED', { artifacts: [{ artifactId: 'report',
      parts: [{ text: 'Research complete' }, { data: { content: 'Report', sources: [] } }] }] });
  }, async ({ service, calls }) => {
    const progress: string[] = [];
    const result = await service.execute('alice', options({ onTask: async (ref) => {
      assert.deepEqual(ref, { taskId: 'remote-task', contextId: 'remote-context' }); persisted = true;
    }, onProgress: async (text) => { progress.push(text); } }));
    assert.equal(result.text, 'Research complete');
    assert.equal(result.usageTokens, null);
    assert.deepEqual(result.data, { content: 'Report', sources: [] });
    assert.deepEqual(progress, ['Checking filings']);
    assert.deepEqual(calls.map((call) => call.method), ['SendMessage', 'GetTask']);
  });
});

test('resuming a completed task only retrieves it and preserves reported usage', async () => {
  await fixture((rpc) => {
    assert.equal(rpc.method, 'GetTask');
    return task('TASK_STATE_COMPLETED', { metadata: { usage: { totalTokens: 123 } },
      artifacts: [{ artifactId: 'report', parts: [{ text: 'Saved report' }] }] });
  }, async ({ service, calls }) => {
    const result = await service.execute('alice', options({ remoteTaskId: 'remote-task', contextId: 'remote-context' }));
    assert.equal(result.usageTokens, 123);
    assert.equal(calls.length, 1);
  });
});

test('input-required keeps remote task and question, then only explicit new input continues the same task', async () => {
  await fixture((rpc) => {
    if (rpc.method === 'GetTask') return task('TASK_STATE_INPUT_REQUIRED', {
      status: { state: 'TASK_STATE_INPUT_REQUIRED', message: { role: 'ROLE_AGENT', parts: [{ text: 'Which horizon?' }] } },
    });
    assert.equal((rpc.params.message as Record<string, unknown>).taskId, 'remote-task');
    assert.equal((rpc.params.message as Record<string, unknown>).contextId, 'remote-context');
    return { task: task('TASK_STATE_COMPLETED', { artifacts: [{ artifactId: 'report', parts: [{ text: 'Updated report' }] }] }) };
  }, async ({ service, calls }) => {
    const progress: string[] = [];
    const resume = options({ remoteTaskId: 'remote-task', contextId: 'remote-context',
      onProgress: async (text) => { progress.push(text); } });
    await assert.rejects(() => service.execute('alice', resume), (error: unknown) => error instanceof LocalAgentError
      && error.code === 'A2A_INPUT_REQUIRED' && error.taskId === 'remote-task');
    assert.deepEqual(progress, ['Which horizon?']);
    assert.equal(calls.length, 1);
    assert.equal((await service.execute('alice', { ...resume, resumeInput: true })).text, 'Updated report');
    assert.deepEqual(calls.map((call) => call.method), ['GetTask', 'GetTask', 'SendMessage']);
  });
});

test('pause cancels the known task and an ambiguous dispatch is never retried', async () => {
  await fixture((rpc) => rpc.method === 'CancelTask' ? task('TASK_STATE_CANCELED')
    : { task: task('TASK_STATE_WORKING') }, async ({ service, calls }) => {
    let checks = 0;
    await assert.rejects(() => service.execute('alice', options({ shouldContinue: async () => ++checks === 1 })), /A2A_CANCELLED/);
    assert.deepEqual(calls.map((call) => call.method), ['SendMessage', 'CancelTask']);
  });
  await fixture(() => { throw new Error('secret'); }, async ({ service, calls }) => {
    await assert.rejects(() => service.execute('alice', options()), (error: unknown) => error instanceof LocalAgentError
      && error.code === 'A2A_DISPATCH_UNCERTAIN' && !error.message.includes('secret'));
    assert.equal(calls.length, 1);
  });
});

test('foreign card endpoint and unsupported protocol are rejected before credentialed RPC', async () => {
  await fixture(() => ({}), async ({ service, calls }) => {
    await assert.rejects(() => service.test('alice', 'local'), /A2A_PROTOCOL_UNSUPPORTED/);
    assert.equal(calls.length, 0);
  }, () => ({ name: 'Other agent', supportedInterfaces: [{ url: 'https://other.example/rpc',
    protocolBinding: 'JSONRPC', protocolVersion: '1.0' }] }));
});

test('wildcard owner registration fails closed', async () => {
  await fixture(() => ({}), async ({ registry, service, origin }) => {
    await writeFile(registry, JSON.stringify([{ id: 'local', name: 'unsafe', cardUrl: `${origin}/card`, owners: ['*'] }]));
    await assert.rejects(() => service.list('bob'), /A2A_CONFIG_INVALID/);
  });
});

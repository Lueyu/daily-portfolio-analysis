import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Task, TaskState } from '@a2a-js/sdk';
import { ServerCallContext } from '@a2a-js/sdk/server';
import { createBridge, reportPart } from './server';
import { codexArgs, redact } from './runner';
import { DiskTaskStore } from './store';

const token = 'local-test-token-01234567890123456789';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('official A2A transport authenticates, publishes artifacts and cancels native work without a second result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'squabble-bridge-test-'));
  let release: () => void = () => {};
  let canceled = false;
  const bridge = await createBridge({ token, binary: 'unused', root, publicUrl: 'http://127.0.0.1:4310',
    timeoutMs: 1000, maxConcurrent: 1 }, async (_prompt, options) => {
    await new Promise<void>((resolve, reject) => {
      release = resolve;
      options.signal.addEventListener('abort', () => { canceled = true; reject(new Error('canceled')); }, { once: true });
    });
    return { text: JSON.stringify({ content: 'Verified public facts', sources: [], privateReasoning: 'must not publish' }), totalTokens: 120 };
  });
  const server = bridge.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'A2A-Version': '1.0' };
  let sequence = 0;
  const rpc = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(`${base}/a2a`, { method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }) });
    assert.equal(response.status, 200);
    return await response.json() as { result?: Record<string, unknown>; error?: unknown };
  };
  const send = async () => rpc('SendMessage', { message: { messageId: `message-${sequence}`,
    role: 'ROLE_USER', parts: [{ text: 'Research a company using public facts' }] },
    configuration: { returnImmediately: true } });
  const get = async (id: string) => {
    const response = await rpc('GetTask', { id });
    assert.ok(response.result, JSON.stringify(response));
    return response.result as { status: { state: string }; artifacts?: unknown[]; metadata?: unknown };
  };
  const waitFor = async (id: string, state: string) => {
    for (let i = 0; i < 100; i++) { const task = await get(id); if (task.status.state === state) return task; await delay(10); }
    assert.fail(`Did not reach ${state}`);
  };
  try {
    assert.equal((await fetch(`${base}/.well-known/agent-card.json`)).status, 401);
    const card = await (await fetch(`${base}/.well-known/agent-card.json`, { headers })).json() as Record<string, unknown>;
    assert.ok(card.supportedInterfaces); assert.ok(card.securityRequirements);
    const sent = await send(); assert.ok(sent.result, JSON.stringify(sent));
    const first = sent.result.task as { id: string };
    await waitFor(first.id, 'TASK_STATE_WORKING');
    const busy = await send(); const busyTask = busy.result?.task as { id: string };
    await waitFor(busyTask.id, 'TASK_STATE_REJECTED');
    release();
    const completed = await waitFor(first.id, 'TASK_STATE_COMPLETED');
    assert.match(JSON.stringify(completed.artifacts), /Verified public facts/);
    assert.match(JSON.stringify(completed.artifacts), /totalTokens/);
    assert.deepEqual(completed.metadata, { usage: { totalTokens: 120 } });
    assert.doesNotMatch(JSON.stringify(completed), /privateReasoning|must not publish/);
    const next = await send(); const second = next.result?.task as { id: string };
    await waitFor(second.id, 'TASK_STATE_WORKING');
    await rpc('CancelTask', { id: second.id });
    const terminal = await waitFor(second.id, 'TASK_STATE_CANCELED');
    assert.equal(canceled, true); assert.ok(!terminal.artifacts?.length);
    const reopened = new DiskTaskStore(join(root, 'tasks')); await reopened.initialize();
    assert.equal((await reopened.load(first.id, new ServerCallContext()))?.status?.state, TaskState.TASK_STATE_COMPLETED);
  } finally {
    await bridge.shutdown(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test('restart preserves results and marks interrupted tasks failed instead of dispatching them again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'squabble-bridge-restart-'));
  try {
    const original = new DiskTaskStore(root); await original.initialize();
    await original.save(Task.fromJSON({ id: 'task-1', contextId: 'room-1', status: { state: 'TASK_STATE_WORKING' } }), new ServerCallContext());
    const reopened = new DiskTaskStore(root); await reopened.initialize();
    const task = await reopened.load('task-1', new ServerCallContext());
    assert.equal(task?.status?.state, TaskState.TASK_STATE_FAILED); assert.equal(task?.metadata?.interrupted, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Codex launch uses read-only argv and stdin; artifacts omit unknown model-internal fields', () => {
  const args = codexArgs('C:/safe workspace', 'C:/safe workspace/final.txt');
  assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules')); assert.equal(args.at(-1), '-');
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.equal(redact(`token=${token} Bearer secret-token sk-abcdefghijklmno`, [token]),
    'token=[redacted] Bearer [redacted] [redacted]');
  assert.deepEqual(reportPart('{"content":"Public findings","reasoning_content":"secret"}'),
    { data: { content: 'Public findings' }, mediaType: 'application/json' });
  assert.deepEqual(reportPart('# Public report'), { text: '# Public report', mediaType: 'text/markdown' });
});

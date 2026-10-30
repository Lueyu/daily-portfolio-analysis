import assert from 'node:assert/strict';
import { test } from 'node:test';
import axios from 'axios';
import { LlmService } from '../multi-agent/llm.service';
import { BudgetExceededException, estimateInputTokens, settleTokenUsage } from '../llm-budget/llm-budget.rules';
import type { BudgetReservation, LlmBudgetService, ReserveBudgetRequest } from '../llm-budget/llm-budget.service';
import type { SettingsService } from './settings.service';

const settings = (model = 'test') => ({ getLlmConfig: async () => ({
  source: 'server', baseUrl: 'https://provider.invalid/v1', fastModel: model, slowModel: model, apiKey: 'private',
}) }) as SettingsService;

test('pausing a council stops retry reservations after an in-flight provider failure', async () => {
  const harness = budgetHarness();
  const original = axios.defaults.adapter;
  let calls = 0;
  let running = true;
  axios.defaults.adapter = async (config) => {
    calls += 1; running = false;
    return { status: 503, statusText: '', headers: {}, config, data: {} };
  };
  try {
    await assert.rejects(new LlmService(settings(), harness.service).chatFast([{ role: 'user', content: 'fact' }], 'alice', {
      taskId: 'paused-council', shouldContinue: async () => running,
    }), /cancelled/);
    assert.equal(calls, 1);
    assert.equal(harness.reservations.length, 1);
    assert.equal(harness.settlements[0].failed, true);
  } finally { axios.defaults.adapter = original; }
});

function budgetHarness() {
  const reservations: Array<BudgetReservation & { owner: string; request: ReserveBudgetRequest }> = [];
  const settlements: Array<{ owner: string; id: string; failed: boolean; charged: number }> = [];
  return { reservations, settlements, service: {
    async reserve(owner: string, request: ReserveBudgetRequest) {
      const inputTokens = estimateInputTokens(request.messages);
      if (inputTokens > 6000) throw new BudgetExceededException('input_tokens', request.taskId);
      const maxOutputTokens = Math.min(request.maxOutputTokens ?? 1000, 1000);
      const reservation = { id: String(reservations.length), taskId: request.taskId!, inputTokens,
        maxOutputTokens, reservedTokens: inputTokens + maxOutputTokens, owner, request };
      reservations.push(reservation);
      return reservation;
    },
    async settle(owner: string, id: string, usage?: unknown, failed = false) {
      const settled = settleTokenUsage(reservations[Number(id)], failed ? undefined : usage);
      settlements.push({ owner, id, failed, charged: settled.chargedTokens });
      return settled;
    },
  } as unknown as LlmBudgetService };
}

test('LLM retries each reserve and settle separately with one stable task and bounded output', async () => {
  const harness = budgetHarness();
  const service = new LlmService(settings(), harness.service);
  const original = axios.defaults.adapter;
  const bodies: Record<string, unknown>[] = [];
  axios.defaults.adapter = async config => {
    bodies.push(JSON.parse(String(config.data)));
    return { status: bodies.length === 1 ? 503 : 200, statusText: '', headers: {}, config,
      data: { choices: [{ message: { content: 'OK' } }] } };
  };
  try {
    const result = await service.chatFast([{ role: 'user', content: 'fact' }], 'alice', {
      taskId: 'run-1', purpose: 'council', maxOutputTokens: 5000,
    });
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every(body => body.max_tokens === 1000));
    assert.equal(harness.reservations.length, 2);
    assert.ok(harness.reservations.every(row => row.owner === 'alice' && row.taskId === 'run-1'));
    assert.deepEqual(harness.settlements.map(row => row.failed), [true, false]);
    assert.equal(result.totalTokens, harness.reservations[1].reservedTokens);
  } finally { axios.defaults.adapter = original; }
});

test('budget denial, oversized input, and unavailable accounting never send HTTP', async () => {
  const original = axios.defaults.adapter;
  let httpCalls = 0;
  axios.defaults.adapter = async () => { httpCalls += 1; throw new Error('must not send'); };
  try {
    const harness = budgetHarness();
    await assert.rejects(() => new LlmService(settings(), harness.service).chatFast(
      [{ role: 'user', content: 'x'.repeat(7000) }], 'alice'), BudgetExceededException);
    const denied = { reserve: async () => { throw new BudgetExceededException('daily_calls', 't'); } };
    await assert.rejects(() => new LlmService(settings(), denied as unknown as LlmBudgetService)
      .chatFast([{ role: 'user', content: 'fact' }], 'alice'), BudgetExceededException);
    const offline = { reserve: async () => { throw new Error('database offline'); } };
    await assert.rejects(() => new LlmService(settings(), offline as unknown as LlmBudgetService)
      .chatFast([{ role: 'user', content: 'fact' }], 'alice'), /database offline/);
    assert.equal(httpCalls, 0);
  } finally { axios.defaults.adapter = original; }
});

test('JSON calls budget injected instructions and use compatible reasoning-model output bounds', async () => {
  const harness = budgetHarness();
  const service = new LlmService(settings('gpt-5.1'), harness.service);
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async config => {
    const body = JSON.parse(String(config.data));
    assert.equal(body.max_completion_tokens, 200);
    assert.equal(body.max_tokens, undefined);
    return { status: 200, statusText: '', headers: {}, config, data: {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    } };
  };
  try {
    assert.deepEqual(await service.chatSlowJSON([{ role: 'user', content: 'fact' }], 'alice', {
      taskId: 'json-task', maxOutputTokens: 200,
    }), { data: { ok: true }, tokens: 30 });
    assert.equal(harness.reservations[0].request.messages.length, 2);
    assert.equal(harness.reservations[0].taskId, 'json-task');
  } finally { axios.defaults.adapter = original; }
});

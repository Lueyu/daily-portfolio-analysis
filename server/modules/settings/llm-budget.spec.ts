import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GlobalExceptionFilter } from '../../common/filters/exception.filter';
import { SettingsController } from './settings.controller';
import { LlmBudgetController } from '../llm-budget/llm-budget.controller';
import {
  BudgetExceededException,
  DEFAULT_LLM_BUDGET,
  estimateInputTokens,
  normalizeBudgetSettings,
  settleTokenUsage,
} from '../llm-budget/llm-budget.rules';

test('budget validation rejects malformed, unbounded, and contradictory settings', () => {
  assert.deepEqual(normalizeBudgetSettings(DEFAULT_LLM_BUDGET), DEFAULT_LLM_BUDGET);
  for (const patch of [
    { dailyTokenLimit: '60000' }, { dailyCallLimit: 1.5 }, { maxOutputTokens: 0 },
    { monthlyTokenLimit: Infinity }, { inputUsdPerMillion: -1 }, { maxCallsPerTask: null },
    { perTaskTokenLimit: 60001 }, { extra: true }, { inputUsdPerMillion: '1' },
  ]) {
    assert.throws(() => normalizeBudgetSettings({ ...DEFAULT_LLM_BUDGET, ...patch }));
  }
  assert.throws(() => normalizeBudgetSettings(null));
  assert.throws(() => normalizeBudgetSettings({ dailyTokenLimit: 60000 }));
});

test('budget API derives ownership from authentication and ignores caller-supplied owner', async () => {
  const calls: unknown[] = [];
  const controller = new LlmBudgetController({
    getSettings: async (owner: string) => { calls.push(['get', owner]); },
    saveSettings: async (owner: string, body: unknown) => { calls.push(['save', owner, body]); },
    getUsage: async (owner: string) => { calls.push(['usage', owner]); },
  } as never);
  const req = { userContext: { userId: 'alice' }, body: { owner: 'bob' } } as never;
  await controller.get(req);
  await controller.save(req, DEFAULT_LLM_BUDGET);
  await controller.usage(req);
  assert.deepEqual(calls, [['get', 'alice'], ['save', 'alice', DEFAULT_LLM_BUDGET], ['usage', 'alice']]);
});

test('global error envelope preserves safe budget code, reason and task id', () => {
  let status: number;
  let payload: { error: { code: string; reason: string; taskId: string } };
  const response = { headersSent: false, status(value: number) { status = value; return this; },
    json(value: typeof payload) { payload = value; } };
  new GlobalExceptionFilter().catch(new BudgetExceededException('task_calls', 'analysis:run'), {
    switchToHttp: () => ({ getResponse: () => response }),
  } as never);
  assert.equal(status!, 429);
  assert.equal(payload!.error.code, 'LLM_BUDGET_EXCEEDED');
  assert.equal(payload!.error.reason, 'task_calls');
  assert.equal(payload!.error.taskId, 'analysis:run');
});

test('model connection tests retain budget denial and request only a small bounded output', async () => {
  const exceeded = new BudgetExceededException('daily_tokens', 'test');
  const controller = new SettingsController({ getSettings: async () => ({ llm: { engine: 'llm' } }) } as never, {
    chatFast: async (_messages: unknown, owner: string, options: { maxOutputTokens: number; purpose: string }) => {
      assert.equal(owner, 'alice');
      assert.equal(options.maxOutputTokens, 16);
      assert.equal(options.purpose, 'connection-test');
      throw exceeded;
    },
  } as never);
  await assert.rejects(() => controller.testLlm({ userContext: { userId: 'alice' } } as never),
    error => error === exceeded);
});

test('model connection tests explain invalid credentials or parameters without echoing provider content', async () => {
  const controller = new SettingsController({ getSettings: async () => ({ llm: { engine: 'llm' } }) } as never, {
    chatFast: async () => { throw new Error('LLM provider returned HTTP 401'); },
  } as never);
  const result = await controller.testLlm({ userContext: { userId: 'alice' } } as never, { language: 'zh-CN' });
  assert.equal(result.ok, false);
  assert.match(result.message, /鉴权失败.*401.*API Key/);
});

test('input estimation includes UTF8 and framing without silently truncating facts', () => {
  const messages = [{ role: 'user', content: '事实🧪' }];
  assert.ok(estimateInputTokens(messages) >= Buffer.byteLength(JSON.stringify(messages), 'utf8'));
  assert.ok(estimateInputTokens([{ role: 'user', content: 'a'.repeat(10000) }]) > 10000);
  assert.throws(() => estimateInputTokens([{ role: 'user', content: 17 }]));
});

test('missing, partial, impossible or malformed provider usage keeps the full reservation', () => {
  const reservation = { inputTokens: 200, maxOutputTokens: 100, reservedTokens: 300 };
  for (const usage of [undefined, {}, { prompt_tokens: 5 },
    { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    { prompt_tokens: -1, completion_tokens: 1 },
    { prompt_tokens: 5, completion_tokens: 5, total_tokens: 2 },
    { prompt_tokens: '5', completion_tokens: 5 },
  ]) {
    assert.deepEqual(settleTokenUsage(reservation, usage), {
      inputTokens: 200, outputTokens: 100, chargedTokens: 300, known: false,
    });
  }
  assert.deepEqual(settleTokenUsage(reservation, {
    prompt_tokens: 20, completion_tokens: 10, total_tokens: 40,
  }), { inputTokens: 20, outputTokens: 20, chargedTokens: 40, known: true });
  assert.deepEqual(settleTokenUsage(reservation, {
    prompt_tokens: 400, completion_tokens: 100, total_tokens: 500,
  }), { inputTokens: 400, outputTokens: 100, chargedTokens: 500, known: true });
});

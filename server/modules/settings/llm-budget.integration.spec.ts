import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { LlmBudgetService } from '../llm-budget/llm-budget.service';
import { BudgetExceededException, DEFAULT_LLM_BUDGET } from '../llm-budget/llm-budget.rules';

// Only an explicitly supplied disposable database may be used by this suite.
test('Postgres budgets serialize workers, isolate owners, persist usage and reject oversized input', {
  skip: !process.env.BUDGET_TEST_DATABASE_URL,
}, async () => {
  const client = postgres(process.env.BUDGET_TEST_DATABASE_URL!, { max: 8 });
  const alice = randomUUID();
  const bob = randomUUID();
  try {
    for (const statement of readFileSync('scripts/db/07_llm_budget.sql', 'utf8').split(';').filter(s => s.trim())) {
      await client.unsafe(statement);
    }
    await client`insert into users (id, username, password_hash) values
      (${alice}, ${`ba-${alice.slice(0, 8)}`}, 'test'), (${bob}, ${`bb-${bob.slice(0, 8)}`}, 'test')`;
    const one = new LlmBudgetService(drizzle(client));
    const two = new LlmBudgetService(drizzle(client));
    await one.saveSettings(alice, { ...DEFAULT_LLM_BUDGET, dailyCallLimit: 2, maxCallsPerTask: 2 });
    const request = { taskId: 'same-task', purpose: 'test', model: 'fake', messages: [{ role: 'user', content: 'fact' }] };
    const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, index) =>
      (index % 2 ? one : two).reserve(alice, request)));
    const allowed = attempts.filter(result => result.status === 'fulfilled');
    assert.equal(allowed.length, 2);
    const blocked = attempts.filter(result => result.status === 'rejected');
    assert.ok(blocked.every(result => result.status === 'rejected'
      && result.reason instanceof BudgetExceededException));
    const first = allowed[0];
    assert.equal(first.status, 'fulfilled');
    if (first.status !== 'fulfilled') throw new Error('Missing reservation');
    const reservation = first.value;
    assert.ok(reservation.reservedTokens > 1000);
    await assert.rejects(() => two.settle(bob, reservation.id, { prompt_tokens: 1, completion_tokens: 1 }));
    await one.settle(alice, reservation.id, undefined, true);
    // A late duplicate response cannot release an ambiguous failed attempt.
    await two.settle(alice, reservation.id, { prompt_tokens: 1, completion_tokens: 1 });
    const usage = await two.getUsage(alice);
    assert.equal(usage.dayCalls, 2);
    assert.equal(usage.dayTokens, reservation.reservedTokens * 2);
    assert.equal(usage.recent.find(row => row.id === reservation.id)?.status, 'failed_unknown');
    assert.equal((await one.getUsage(bob)).dayCalls, 0);
    const bobReservation = await two.reserve(bob, request);
    await two.settle(bob, bobReservation.id, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
    assert.equal((await one.getUsage(bob)).dayTokens, 15);
    await assert.rejects(() => one.reserve(bob, { ...request, messages: [{ role: 'user', content: 'a'.repeat(7000) }] }),
      (error: unknown) => error instanceof BudgetExceededException && error.reason === 'input_tokens');
    assert.equal((await one.getUsage(bob)).dayCalls, 1);
    const larger = await one.reserve(bob, { ...request, taskId: 'provider-overrun' });
    await one.settle(bob, larger.id, { prompt_tokens: 100000, completion_tokens: 100000, total_tokens: 200000 });
    assert.equal((await two.getUsage(bob)).dayTokens, 200015, 'provider usage must never be clamped to reservation');
    await assert.rejects(() => two.reserve(bob, { ...request, taskId: 'after-overrun' }),
      (error: unknown) => error instanceof BudgetExceededException && error.reason === 'daily_tokens');
  } finally {
    await client`delete from users where id in (${alice}, ${bob})`;
    await client.end();
  }
});

test('Postgres task, daily, monthly caps and optional cost estimates use persisted charged usage', {
  skip: !process.env.BUDGET_TEST_DATABASE_URL,
}, async (t) => {
  const client = postgres(process.env.BUDGET_TEST_DATABASE_URL!, { max: 3 });
  const owner = randomUUID();
  try {
    await client`insert into users (id, username, password_hash) values
      (${owner}, ${`bc-${owner.slice(0, 8)}`}, 'test')`;
    const service = new LlmBudgetService(drizzle(client));
    const limits = { ...DEFAULT_LLM_BUDGET, maxInputTokens: 100, maxOutputTokens: 100,
      perTaskTokenLimit: 300, dailyTokenLimit: 600, monthlyTokenLimit: 700 };
    const request = { taskId: 'bounded-task', purpose: 'test', model: 'fake', messages: [{ role: 'user', content: 'hi' }] };
    const reason = (expected: string) => (error: unknown) =>
      error instanceof BudgetExceededException && error.reason === expected;
    await service.saveSettings(owner, limits);
    const first = await service.reserve(owner, request);
    await assert.rejects(() => service.reserve(owner, request), reason('task_tokens'));
    await service.settle(owner, first.id, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 });
    assert.equal((await service.getUsage(owner)).estimatedCostUsd, null);
    await service.saveSettings(owner, { ...limits, inputUsdPerMillion: 2, outputUsdPerMillion: 4, maxCallsPerTask: 1 });
    assert.equal((await service.getUsage(owner)).estimatedCostUsd, 0.00006);
    await assert.rejects(() => service.reserve(owner, request), reason('task_calls'));
    await service.saveSettings(owner, limits);
    await client`update llm_budget_usage set charged_tokens = 550 where owner = ${owner}`;
    await assert.rejects(() => service.reserve(owner, { ...request, taskId: 'different-task' }), reason('daily_tokens'));
    const [{ day }] = await client`select extract(day from current_timestamp at time zone 'UTC')::integer as day`;
    await t.test('month cap includes earlier UTC days after the daily counter resets', { skip: Number(day) === 1 }, async () => {
      await client`update llm_budget_usage set charged_tokens = 650,
        created_at = date_trunc('month', current_timestamp at time zone 'UTC') at time zone 'UTC'
        where owner = ${owner}`;
      await assert.rejects(() => service.reserve(owner, { ...request, taskId: 'new-day-task' }), reason('monthly_tokens'));
      const used = await service.getUsage(owner);
      assert.equal(used.dayTokens, 0);
      assert.equal(used.monthTokens, 650);
    });
  } finally {
    await client`delete from users where id = ${owner}`;
    await client.end();
  }
});

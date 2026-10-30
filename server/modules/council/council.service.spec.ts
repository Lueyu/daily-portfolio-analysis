import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { builderProfiles } from '../../database/schema';
import { councilSessions } from '../../database/council.schema';
import { CouncilService } from './council.service';
import type { BuilderConfig } from '../../../shared/api.interface';

const url = process.env.COUNCIL_TEST_DATABASE_URL;
const dbTest = url ? test : test.skip;
const client = url ? postgres(url, { max: 4, onnotice: () => undefined }) : null;
const db = client ? drizzle(client) : null;
const owner = randomUUID();
const other = randomUUID();
let profileId = '';
const config: BuilderConfig = { name: 'Council integration', template: 'balanced', tickers: ['AAPL'], minimumRating: 'Buy', customPrompt: '', maxOrderPct: 5, dailyLossLimitPct: 3, maxOrdersPerDay: 4, notifyOnProposal: false, priceRules: [{ ticker: 'AAPL', buyAtOrBelow: 101 }] };
const candidate = { ticker: 'AAPL', side: 'buy' as const, quantity: 2, price: 100, reason: 'Investor price rule: 100 reached buy trigger 101' };
const portfolio = { totalValue: 1000, totalMv: 0, cash: 1000, cashRatio: 100, holdings: [], companyExposures: {} };

before(async () => {
  if (!client) return;
  await client.unsafe(readFileSync('scripts/db/08_investment_council.sql', 'utf8'));
  const [row] = await db.insert(builderProfiles).values({ owner, config }).returning();
  profileId = row.id;
});
after(async () => {
  if (!client) return;
  await db.delete(councilSessions).where(eq(councilSessions.owner, owner));
  await db.delete(builderProfiles).where(eq(builderProfiles.owner, owner));
  await client.end();
});

function service(chat = async () => ({ data: { decision: 'wait', summary: 'Need verified data', evidenceIds: [], dissent: [], nextReviewCondition: 'financials' }, tokens: 5 }), configured = true) {
  return new CouncilService(db, {
    isConfigured: async () => configured, chatFastJSON: chat, chatSlowJSON: chat,
  } as never, { collectEvidence: async () => [
    { role: 'fundamental', evidenceType: 'price', title: 'quote', content: '100 USD', relevanceScore: 1, sourceName: 'provider' },
    { role: 'fundamental', evidenceType: 'other', title: 'financials missing', content: 'unavailable', relevanceScore: 0, sourceName: 'Data Unavailable' },
  ] } as never, { getPortfolioContext: async () => portfolio } as never,
  { listRuns: async () => ({ items: [], total: 0 }) } as never);
}
async function completed(svc: CouncilService, id: string) {
  for (let i = 0; i < 300; i++) {
    const session = await svc.getSession(owner, id);
    if (session.status !== 'running') return session;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Council did not finish');
}

dbTest('cross-owner session reads, steering, pause and run all refuse access', async () => {
  const svc = service();
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  for (const fn of [() => svc.getSession(other, session.id), () => svc.addMessage(other, session.id, 'steer'), () => svc.pauseSession(other, session.id), () => svc.runSession(other, session.id)]) {
    await assert.rejects(fn, /not found/i);
  }
  assert.deepEqual(await svc.listSessions(other), []);
});

dbTest('missing model publishes an honest basic wait report without invented member messages', async () => {
  const svc = service(undefined, false);
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await svc.runSession(owner, session.id);
  const result = await completed(svc, session.id);
  assert.equal(result.reports[0].engine, 'basic');
  assert.equal(result.reports[0].decision, 'wait');
  assert.equal(result.messages.filter((item) => ['researcher', 'challenger', 'manager'].includes(item.role)).length, 0);
});

dbTest('budget errors publish wait and preserve the session task budget', async () => {
  const svc = service(async () => { throw new Error('LLM_BUDGET_EXCEEDED'); });
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await svc.runSession(owner, session.id);
  const result = await completed(svc, session.id);
  assert.equal(result.reports[0].decision, 'wait');
  assert.match(result.reports[0].summary, /budget|unavailable|complete/i);
});

dbTest('pause during an in-flight call prevents report approval and a manager call', async () => {
  let release: () => void;
  let calls = 0;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const svc = service(async () => { calls++; await barrier; return { data: { decision: 'wait', summary: 'Wait', evidenceIds: [] }, tokens: 4 }; });
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await svc.runSession(owner, session.id);
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 10));
  await svc.pauseSession(owner, session.id);
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const paused = await svc.getSession(owner, session.id);
  assert.equal(paused.status, 'paused');
  assert.equal(paused.reports.length, 0);
  assert.equal(calls, 2);
});

dbTest('steering invalidates old revision, reuses taskId, persists partial messages and yields one current report', async () => {
  let release: () => void;
  let calls = 0;
  const taskIds: string[] = [];
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const svc = service(async (...args: unknown[]) => {
    calls++;
    taskIds.push((args[2] as { taskId: string }).taskId);
    if (calls <= 2) await barrier;
    return { data: { decision: 'wait', summary: 'Wait for facts', evidenceIds: [] }, tokens: 4 };
  });
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await svc.runSession(owner, session.id);
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 10));
  await svc.addMessage(owner, session.id, 'Consider downside cash flow');
  release();
  const result = await completed(svc, session.id);
  assert.equal(new Set(taskIds).size, 1);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].revision, result.revision);
  assert.ok(result.messages.some((item) => item.role === 'user'));
  assert.ok(result.messages.some((item) => item.revision < result.revision && item.role === 'researcher'));
});

dbTest('unchanged wait candidates reuse saved result without additional model calls', async () => {
  let calls = 0;
  const svc = service(async () => { calls++; return { data: { decision: 'wait', summary: 'Wait', evidenceIds: [] }, tokens: 4 }; });
  const profile = { id: profileId, config, version: 1, status: 'active' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const first = await svc.reviewCandidate(owner, profile, candidate);
  const second = await svc.reviewCandidate(owner, profile, { ...candidate, price: 100.01 });
  assert.equal(first.approved, false);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(calls, 3);
});

dbTest('default prompts stay within the default conservative input budget', async () => {
  const { estimateInputTokens, DEFAULT_LLM_BUDGET } = await import('../llm-budget/llm-budget.rules');
  const captures: number[] = [];
  const svc = service(async (...args: unknown[]) => {
    const prompt = args[0] as Array<{ role: string; content: string }>;
    captures.push(estimateInputTokens([...prompt, { role: 'system', content: '你必须严格按照用户要求的 JSON 格式输出，不要添加任何解释、说明或 markdown 格式。只输出合法的 JSON 字符串。' }]));
    return { data: { decision: 'wait', summary: 'Need verified data', evidenceIds: [] }, tokens: 5 };
  });
  Reflect.set(svc, 'evidence', { collectEvidence: async () => Array.from({ length: 12 }, (_, i) => ({
    role: i < 8 ? 'fundamental' : 'news', evidenceType: i === 0 ? 'price' : 'other',
    title: `实际证据 ${i}`, content: '企业报表与估值数据缺少充分证据，当前结论需等待后续财报披露。'.repeat(12),
    sourceName: i % 2 === 0 ? 'provider' : 'Data Unavailable', relevanceScore: i % 2 === 0 ? 1 : 0,
  })) });
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'zh-CN' });
  await svc.runSession(owner, session.id);
  await completed(svc, session.id);
  assert.equal(captures.length, 3);
  for (const size of captures) assert.ok(size <= DEFAULT_LLM_BUDGET.maxInputTokens, `prompt size ${size}`);
});

dbTest('duplicate run requests across service instances start only one council job', async () => {
  let release: () => void;
  let calls = 0;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const chat = async () => { calls++; await barrier; return { data: { decision: 'wait', summary: 'Wait', evidenceIds: [] }, tokens: 4 }; };
  const first = service(chat);
  const second = service(chat);
  const session = await first.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await first.runSession(owner, session.id);
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 10));
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? first : second).runSession(owner, session.id)));
  assert.equal(calls, 2);
  release();
  const result = await completed(first, session.id);
  assert.equal(calls, 3);
  assert.equal(result.reports.length, 1);
});

dbTest('pause followed immediately by resume drains old calls and finishes the current revision', async () => {
  let release: () => void;
  let calls = 0;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const svc = service(async () => { calls++; if (calls <= 2) await barrier;
    return { data: { decision: 'wait', summary: 'Wait', evidenceIds: [] }, tokens: 4 }; });
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await svc.runSession(owner, session.id);
  while (!calls) await new Promise((resolve) => setTimeout(resolve, 10));
  await svc.pauseSession(owner, session.id);
  await svc.runSession(owner, session.id);
  release();
  const result = await completed(svc, session.id);
  assert.equal(result.status, 'completed');
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].revision, result.revision);
  assert.equal(calls, 5);
});

dbTest('repeated steering cannot create unbounded automatic restarts', async () => {
  let calls = 0;
  let sessionId = '';
  const svc = service(async () => {
    calls++;
    if (calls % 2 === 1) await svc.addMessage(owner, sessionId, `Revision ${calls}`);
    return { data: { decision: 'wait', summary: 'Wait', evidenceIds: [] }, tokens: 4 };
  });
  sessionId = (await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' })).id;
  await svc.runSession(owner, sessionId);
  const result = await completed(svc, sessionId);
  assert.ok(calls <= 6);
  assert.equal(result.reports.at(-1)?.decision, 'wait');
  assert.match(result.reports.at(-1)?.summary ?? '', /Steering changed repeatedly/);
});

dbTest('rule-only approval preserves exact candidate and changed quote cannot reuse that approval', async () => {
  let calls = 0;
  const svc = service(async (...args: unknown[]) => {
    calls++;
    const data = JSON.parse((args[0] as Array<{ content: string }>)[1].content);
    return { data: { decision: 'approve', summary: 'Rule-only approval; financial evidence remains missing.',
      evidenceIds: [data.evidence[0].id], dissent: ['No research forecast'], nextReviewCondition: 'Review next scheduled trigger' }, tokens: 4 };
  });
  const profile = { id: profileId, config, version: 1, status: 'active' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  const exact = { ...candidate, quantity: 3 };
  const first = await svc.reviewCandidate(owner, profile, exact);
  assert.equal(first.approved, true);
  const same = await svc.reviewCandidate(owner, profile, exact);
  assert.equal(same.reportId, first.reportId);
  assert.equal(calls, 3);
  const changed = await svc.reviewCandidate(owner, profile, { ...exact, price: 100.01 });
  assert.equal(changed.approved, true);
  assert.notEqual(changed.reportId, first.reportId);
  assert.equal(calls, 6);
  const stored = await svc.getSession(owner, changed.sessionId);
  assert.deepEqual(stored.reports[0].candidate, { ...exact, price: 100.01 });
});

dbTest('research-driven model approval is forced to wait when critical financial evidence is missing', async () => {
  const svc = service(async (...args: unknown[]) => {
    const data = JSON.parse((args[0] as Array<{ content: string }>)[1].content);
    return { data: { decision: 'approve', summary: 'Model attempts approval', evidenceIds: [data.evidence[0].id] }, tokens: 4 };
  });
  const session = await svc.createSession(owner, { profileId, ticker: 'AAPL', language: 'en' });
  await svc.runSession(owner, session.id);
  const stored = await completed(svc, session.id);
  assert.equal(stored.reports[0].decision, 'wait');
  assert.match(stored.reports[0].summary, /Critical research evidence is missing/);
});

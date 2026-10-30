import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray } from 'drizzle-orm';
import { agentRuns, deepReport } from '../../database/schema';
import { McpService } from '../mcp/mcp.service';

test('external agents can only read research owned by their authenticated investor', {
  skip: !process.env.COUNCIL_TEST_DATABASE_URL,
}, async () => {
  const client = postgres(process.env.COUNCIL_TEST_DATABASE_URL!);
  const db = drizzle(client);
  const owners = [randomUUID(), randomUUID()];
  const ticker = 'TEST' + randomUUID().slice(0, 8).toUpperCase();
  try {
    const runs = await db.insert(agentRuns).values(owners.map((owner) => ({ owner, ticker, triggerType: 'manual', status: 'completed' }))).returning();
    await db.insert(deepReport).values([
      { owner: owners[0], runId: runs[0].id, ticker, coreThesis: 'Own private report', createdAt: new Date('2026-01-01') },
      { owner: owners[1], runId: runs[1].id, ticker, coreThesis: 'Other investor private report', createdAt: new Date('2026-01-02') },
    ]);
    const service = new McpService(db, {} as never, {} as never, {} as never);
    const result = await service.callTool({ userId: owners[0], sessionId: randomUUID(), name: 'Agent',
      dailyLimitUsd: 0, permission: 'read_only', approvalMode: 'require_approval' }, 'get_research_report', { ticker });
    assert.equal((result as { coreThesis: string }).coreThesis, 'Own private report');
  } finally {
    await db.delete(deepReport).where(inArray(deepReport.owner, owners));
    await db.delete(agentRuns).where(inArray(agentRuns.owner, owners));
    await client.end();
  }
});

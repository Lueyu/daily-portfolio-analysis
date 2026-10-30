import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AgentBuilderService } from './agent-builder.service';
import { normalizeBuilderConfig, normalizeCouncil } from './agent-builder.rules';

test('Builder council activation validates selected member connections without requiring a default key', async () => {
  const config = normalizeBuilderConfig({ name: 'Team', template: 'balanced', tickers: ['AAPL'], minimumRating: 'Buy',
    customPrompt: 'Check risk', maxOrderPct: 5, dailyLossLimitPct: 3, maxOrdersPerDay: 1, notifyOnProposal: false,
    council: { ...normalizeCouncil(), enabled: true, members: normalizeCouncil().members.map((member) => ({ ...member,
      connectionId: '123e4567-e89b-42d3-a456-426614174000' })) } });
  let validated = false;
  const builder = new AgentBuilderService(null as never, {
    validateConnectionIds: async (owner: string, ids: string[]) => { assert.equal(owner, 'owner'); assert.equal(ids.length, 3); validated = true; },
    isConfigured: async (_owner: string, connectionId?: string) => Boolean(connectionId),
  } as never);
  await builder.assertCanActivate('owner', config);
  assert.equal(validated, true);
  await assert.rejects(builder.assertCanActivate('owner', { ...config, council: { ...config.council!, enabled: false } }), /model/i);
});

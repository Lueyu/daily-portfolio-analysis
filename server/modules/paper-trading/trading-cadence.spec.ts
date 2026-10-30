import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cadenceRejection, elapsedTradingDays, marketDate, normalizeCadence, reviewDue } from './trading-cadence';

test('market dates respect New York DST and Asia rather than UTC midnight', () => {
  const time = new Date('2026-10-30T01:00:00Z');
  assert.equal(marketDate('US', time), '2026-10-29');
  assert.equal(marketDate('HK', time), '2026-10-30');
});
test('cooldown counts weekdays and does not consume weekends', () => {
  assert.equal(elapsedTradingDays('2026-10-30', '2026-11-02'), 1);
  assert.equal(elapsedTradingDays('2026-10-30', '2026-11-04'), 3);
});
test('unchanged declined candidates wait until their scheduled review', () => {
  assert.equal(reviewDue('same', 'same', '2026-10-26', '2026-10-30', 5), false);
  assert.equal(reviewDue('same', 'new-evidence', '2026-10-26', '2026-10-30', 5), true);
  assert.equal(reviewDue('same', 'same', '2026-10-26', '2026-11-02', 5), true);
});
test('low frequency defaults and invalid zero/NaN limits', () => {
  assert.deepEqual(normalizeCadence(), { reviewEveryTradingDays: 5, maxOrdersPerWeek: 2, cooldownTradingDays: 3, maxWeeklyTurnoverPct: 10 });
  assert.throws(() => normalizeCadence({ ...normalizeCadence(), maxOrdersPerWeek: 0 }));
  assert.throws(() => normalizeCadence({ ...normalizeCadence(), maxWeeklyTurnoverPct: NaN }));
});
test('weekly cap, reversing cooldown and aggregate turnover block orders', () => {
  const config = normalizeCadence();
  const now = new Date('2026-10-30T14:00:00Z');
  const fill = { ticker: 'AAPL', market: 'US' as const, createdAt: new Date('2026-10-29T15:00:00Z'), notionalUsd: 30, status: 'filled' };
  const base = { market: 'US' as const, ticker: 'AAPL', notionalUsd: 40, equityUsd: 1000, orders: [fill], now };
  assert.match(cadenceRejection(config, base) ?? '', /cooldown/);
  assert.match(cadenceRejection(config, { ...base, ticker: 'MSFT', orders: [fill, { ...fill, ticker: 'NVDA' }] }) ?? '', /weekly_order_cap/);
  assert.match(cadenceRejection(config, { ...base, ticker: 'MSFT', notionalUsd: 80 }) ?? '', /weekly_turnover/);
  assert.equal(cadenceRejection(config, { ...base, ticker: 'MSFT' }), null);
  assert.equal(cadenceRejection(config, { ...base, ticker: 'MSFT', orders: [{ ...fill, status: 'rejected_risk' }] }), null);
});

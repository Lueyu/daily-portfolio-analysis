import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { INDEX_DEFINITIONS, parseIndexQuote, calculateMarketMood } from './market-overview.logic';
import { MarketOverviewService } from './market-overview.service';

const now = new Date('2026-10-30T07:00:00Z');
function fixture(symbol: string, value: string, previous: string, time: string): string {
  const fields = Array<string>(34).fill('');
  fields[3] = value;
  fields[4] = previous;
  fields[30] = time;
  return `v_${symbol}="${fields.join('~')}";`;
}

test('parses native index points and percent using the prior close, keeping provider time', () => {
  const quote = parseIndexQuote(fixture('us.INX', '5100', '5000', '2026-10-29 16:32:47'), INDEX_DEFINITIONS[0], now);
  assert.equal(quote.value, 5100);
  assert.equal(quote.change, 100);
  assert.equal(quote.changePercent, 2);
  assert.equal(quote.sessionDate, '2026-10-29');
  assert.equal(quote.quoteTime, '2026-10-29 16:32:47');
  assert.equal(quote.timeZone, 'America/New_York');
  assert.equal(quote.status, 'available');
});

test('handles GBK-decoded CN compact and HK slash dates and rejects bad numeric/time values', () => {
  assert.equal(parseIndexQuote(fixture('sh000001', '3600', '3500', '20261030145236'), INDEX_DEFINITIONS[5], now).quoteTime, '2026-10-30 14:52:36');
  assert.equal(parseIndexQuote(fixture('hkHSI', '23000', '23500', '2026/10/30 14:37:36'), INDEX_DEFINITIONS[3], now).sessionDate, '2026-10-30');
  for (const values of [['', '5000', '20261030145236'], ['5000', '0', '20261030145236'], ['Infinity', '5000', '20261030145236'], ['5100', '5000', 'not-a-date']]) {
    assert.equal(parseIndexQuote(fixture('us.INX', values[0], values[1], values[2]), INDEX_DEFINITIONS[0], now).status, 'unavailable');
  }
  assert.equal(parseIndexQuote('', INDEX_DEFINITIONS[0], now).status, 'unavailable');
});

test('old provider snapshots are marked stale and excluded from the mood estimate', () => {
  const quote = parseIndexQuote(fixture('us.INX', '5100', '5000', '2026-10-01 16:00:00'), INDEX_DEFINITIONS[0], now);
  assert.equal(quote.status, 'stale');
  assert.equal(quote.issue, 'outdated_quote');
  assert.equal(calculateMarketMood('US', [quote]).score, null);
});

test('mood uses same-session valid indices, is bounded and reports partial coverage', () => {
  const quotes = INDEX_DEFINITIONS.slice(0, 3).map((definition, index) => parseIndexQuote(
    fixture(definition.symbol, index === 0 ? '6000' : '5500', '5000', index === 2 ? '2026-10-28 16:00:00' : '2026-10-29 16:00:00'), definition, now,
  ));
  const mood = calculateMarketMood('US', quotes);
  assert.equal(mood.score, 100);
  assert.equal(mood.covered, 2);
  assert.equal(mood.total, 3);
  assert.equal(mood.averageChangePercent, 15);
  assert.equal(mood.sessionDate, '2026-10-29');
  assert.equal(calculateMarketMood('US', quotes.slice(0, 1)).score, null);
  const falling = quotes.map(quote => ({ ...quote, sessionDate: '2026-10-29', changePercent: -4 }));
  assert.equal(calculateMarketMood('US', falling).score, 0);
});

test('parallel requests share one upstream fetch and cached responses avoid repeat requests', async (context) => {
  const time = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const body = INDEX_DEFINITIONS.map(item => fixture(item.symbol, '5100', '5000', time)).join('\n');
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(body));
  const service = new MarketOverviewService();
  const [first, second] = await Promise.all([service.getOverview(), service.getOverview()]);
  assert.equal(first, second);
  assert.equal(first.indices.length, 8);
  assert.equal(first.moods[0].score, 90);
  assert.equal(await service.getOverview(), first);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('expired cache falls back to marked stale values after failure, without inventing a mood', async (context) => {
  const time = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const body = INDEX_DEFINITIONS.map(item => fixture(item.symbol, '5100', '5000', time)).join('\n');
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => new Response(body));
  const service = new MarketOverviewService();
  const first = await service.getOverview();
  const originalNow = Date.now();
  context.mock.method(Date, 'now', () => originalNow + 61_000);
  fetchMock.mock.mockImplementation(async () => { throw new Error('Offline'); });
  const stale = await service.getOverview();
  assert.equal(stale.indices[0].value, first.indices[0].value);
  assert.equal(stale.indices[0].retrievedAt, first.indices[0].retrievedAt);
  assert.equal(stale.indices[0].status, 'stale');
  assert.equal(stale.indices[0].issue, 'fetch_failed');
  assert.equal(stale.moods[0].score, null);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('unavailable first request returns honest empty values instead of zero returns', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  const result = await new MarketOverviewService().getOverview();
  assert.equal(result.indices.length, 8);
  assert.ok(result.indices.every(quote => quote.value === null && quote.changePercent === null && quote.issue === 'fetch_failed'));
  assert.ok(result.moods.every(mood => mood.score === null));
});

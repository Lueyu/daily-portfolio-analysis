import test from 'node:test';
import assert from 'node:assert/strict';
import { of } from 'rxjs';
import { FxService } from './fx.service';

test('keyless FX refresh stores the provider date and validated positive rates', async () => {
  const date = new Date().toISOString().slice(0, 10);
  const inserted: Array<{ rateDate: string; base: string; quote: string; rate: string }> = [];
  const db = { insert: () => ({ values: (row: typeof inserted[number]) => {
    inserted.push(row);
    return { onConflictDoUpdate: async () => undefined };
  } }) };
  const http = { get: (url: string) => {
    assert.match(url, /api\.frankfurter\.dev/);
    return of({ data: { date, rates: { HKD: 7.8, CNY: 6.7 } } });
  } };
  const service = new FxService(db as never, http as never);
  assert.equal(await service.refreshRates(), 2);
  assert.deepEqual(inserted.map(row => [row.rateDate, row.quote]), [[date, 'HKD'], [date, 'CNY']]);
});

test('FX refresh rejects an out-of-date provider snapshot', async () => {
  const db = { insert: () => { throw new Error('must not persist stale rates'); } };
  const http = { get: () => of({ data: { date: '2020-01-01', rates: { HKD: 7.8, CNY: 6.7 } } }) };
  const service = new FxService(db as never, http as never);
  assert.equal(await service.refreshRates(), 0);
});

test('latest FX lookup refuses old cached rates when upstream is unavailable', async () => {
  const old = [{ rate: '8.0', date: '2020-01-01' }];
  const db = { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => old }) }) }) }) };
  const http = { get: () => { throw new Error('offline'); } };
  const service = new FxService(db as never, http as never);
  assert.equal(await service.getLatestRate('USD', 'HKD'), null);
});

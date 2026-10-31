import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostgresJsDatabase } from '../../common/platform';
import { SystemUpdateService } from './system-update.service';

test('only the first account can inspect Docker update controls', async () => {
  const previousMode = process.env.SQUABBLE_UPDATE_MODE;
  const previousFetch = globalThis.fetch;
  const rows = [{ id: 'installation-owner' }];
  const query = { from: () => query, orderBy: () => query, limit: async () => rows };
  const database = { select: () => query } as unknown as PostgresJsDatabase;
  try {
    process.env.SQUABBLE_UPDATE_MODE = 'docker';
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        tag_name: 'v2.3.0',
        html_url: 'https://github.com/Lueyu/squabble/releases/tag/v2.3.0',
      }),
    })) as unknown as typeof fetch;
    const service = new SystemUpdateService(database);
    await assert.rejects(service.status('another-user'), /installation owner/u);
    const status = await service.status('installation-owner');
    assert.equal(status.enabled, true);
    assert.equal(status.available?.version, '2.3.0');
  } finally {
    if (previousMode === undefined) delete process.env.SQUABBLE_UPDATE_MODE;
    else process.env.SQUABBLE_UPDATE_MODE = previousMode;
    globalThis.fetch = previousFetch;
  }
});

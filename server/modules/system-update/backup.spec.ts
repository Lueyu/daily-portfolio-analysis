import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdateBackup } from './backup';

test('backup preserves the database dump and persistent secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'squabble-update-test-'));
  try {
    const secrets = join(root, 'secrets');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(secrets);
    await writeFile(join(secrets, 'jwt.key'), 'jwt');
    await writeFile(join(secrets, 'settings.key'), 'settings');
    const directory = await createUpdateBackup(join(root, 'backups'), secrets, async (destination) => {
      await writeFile(destination, 'database');
    });
    assert.equal(await readFile(join(directory, 'database.dump'), 'utf8'), 'database');
    assert.equal(await readFile(join(directory, 'jwt.key'), 'utf8'), 'jwt');
    assert.equal(await readFile(join(directory, 'settings.key'), 'utf8'), 'settings');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed dump leaves no backup that looks complete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'squabble-update-test-'));
  try {
    await assert.rejects(createUpdateBackup(join(root, 'backups'), join(root, 'secrets'), async () => {
      throw new Error('dump failed');
    }), /dump failed/u);
    assert.deepEqual(await readdir(join(root, 'backups')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

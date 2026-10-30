const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { ensureSettingsKey } = require('./ensure-settings-key.cjs');

test('Docker settings key is generated once and reused across starts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'squabble-settings-test-'));
  const keyFile = join(directory, 'settings.key');
  try {
    const first = ensureSettingsKey('', keyFile);
    const second = ensureSettingsKey('', keyFile);
    assert.equal(first.length, 64);
    assert.equal(second, first);
    assert.equal(readFileSync(keyFile, 'utf8').trim(), first);
    assert.equal(ensureSettingsKey('provided-private-key-with-32-chars', keyFile),
      'provided-private-key-with-32-chars');
  } finally {
    if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
  }
});

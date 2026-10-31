const assert = require('node:assert/strict');
const { test } = require('node:test');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const helperPath = join(__dirname, 'ensure-jwt-secret.cjs');

test('local JWT secret is generated once and reused across starts', () => {
  assert.ok(existsSync(helperPath), 'JWT secret helper is missing');
  const { ensureJwtSecret } = require(helperPath);
  const directory = mkdtempSync(join(tmpdir(), 'squabble-jwt-test-'));
  const keyFile = join(directory, 'jwt.key');
  try {
    const first = ensureJwtSecret('', keyFile);
    const second = ensureJwtSecret('', keyFile);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(second, first);
    assert.equal(readFileSync(keyFile, 'utf8').trim(), first);
  } finally {
    if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
  }
});

test('explicit JWT secret is used without replacing a generated local secret', () => {
  assert.ok(existsSync(helperPath), 'JWT secret helper is missing');
  const { ensureJwtSecret } = require(helperPath);
  const directory = mkdtempSync(join(tmpdir(), 'squabble-jwt-test-'));
  const keyFile = join(directory, 'jwt.key');
  try {
    const generated = ensureJwtSecret('', keyFile);
    assert.equal(ensureJwtSecret('explicit-independent-jwt-secret-123456', keyFile),
      'explicit-independent-jwt-secret-123456');
    assert.equal(ensureJwtSecret('', keyFile), generated);
  } finally {
    if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
  }
});

test('known demo JWT secret and corrupt saved key are rejected', () => {
  assert.ok(existsSync(helperPath), 'JWT secret helper is missing');
  const { ensureJwtSecret } = require(helperPath);
  const directory = mkdtempSync(join(tmpdir(), 'squabble-jwt-test-'));
  const keyFile = join(directory, 'jwt.key');
  try {
    assert.throws(() => ensureJwtSecret('change-me-in-production-0123456789abcdef', keyFile));
    writeFileSync(keyFile, 'not-a-generated-secret\n');
    assert.throws(() => ensureJwtSecret('', keyFile), /JWT|secret|key/i);
  } finally {
    if (directory.startsWith(tmpdir())) rmSync(directory, { recursive: true, force: true });
  }
});

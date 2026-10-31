const { randomBytes } = require('node:crypto');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');

const KNOWN_DEMO_SECRET = 'change-me-in-production-0123456789abcdef';

/** Keep local browser sessions valid across app container restarts. */
function ensureJwtSecret(explicitKey, keyFile) {
  if (explicitKey) {
    if (explicitKey.length < 16 || explicitKey === KNOWN_DEMO_SECRET) {
      throw new Error('JWT_SECRET must be a private value of at least 16 characters');
    }
    return explicitKey;
  }

  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
  let stored;
  try {
    stored = readFileSync(keyFile, 'utf8').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const generated = randomBytes(32).toString('hex');
    try {
      writeFileSync(keyFile, `${generated}\n`, { flag: 'wx', mode: 0o600 });
      stored = generated;
    } catch (writeError) {
      if (writeError.code !== 'EEXIST') throw writeError;
      stored = readFileSync(keyFile, 'utf8').trim();
    }
  }
  if (!/^[0-9a-f]{64}$/u.test(stored)) {
    throw new Error('Saved JWT secret is invalid; restore the secrets volume');
  }
  return stored;
}

module.exports = { ensureJwtSecret };

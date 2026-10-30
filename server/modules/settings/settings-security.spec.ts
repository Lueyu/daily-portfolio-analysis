import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decryptSecret,
  encryptSecret,
  makePublicLookup,
  normalizePublicLlmBaseUrl,
} from './settings-security';

test('API secrets round-trip through authenticated encryption without plaintext', () => {
  const secret = 'sk-private-user-token';
  const stored = encryptSecret(secret, 'different-secret-with-enough-length');
  assert.ok(!stored.includes(secret));
  assert.equal(decryptSecret(stored, 'different-secret-with-enough-length'), secret);
  assert.throws(() => decryptSecret(stored, 'a-different-secret-with-enough-length'));
});

test('connection-time resolver rejects a DNS answer containing a private IP', async () => {
  const guardedLookup = makePublicLookup(async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ]);
  await new Promise<void>((resolve, reject) => {
    guardedLookup('api.openai.com', {}, (error) => {
      try {
        assert.ok(error);
        assert.match(error.message, /public HTTPS host/u);
        resolve();
      } catch (assertionError) {
        reject(assertionError);
      }
    });
  });
});

test('OpenAI-compatible endpoint must use a public HTTPS host', async () => {
  assert.equal(
    await normalizePublicLlmBaseUrl(
      'https://api.openai.com/v1/',
      async () => [{ address: '8.8.8.8', family: 4 }],
    ),
    'https://api.openai.com/v1',
  );
  await assert.rejects(() => normalizePublicLlmBaseUrl('http://api.openai.com/v1'));
  await assert.rejects(() => normalizePublicLlmBaseUrl('https://localhost/v1'));
  await assert.rejects(() => normalizePublicLlmBaseUrl('https://127.0.0.1/v1'));
  await assert.rejects(() => normalizePublicLlmBaseUrl('https://api.openai.com/v1?secret=x'));
  await assert.rejects(() => normalizePublicLlmBaseUrl('https://u:p@api.openai.com/v1'));
  await assert.rejects(() => normalizePublicLlmBaseUrl(
    'https://api.openai.com/v1',
    async () => [{ address: '10.0.0.2', family: 4 }],
  ));
});

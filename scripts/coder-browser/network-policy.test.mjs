import assert from 'node:assert/strict';
import { test } from 'node:test';

test('external navigation requires a configured egress proxy and domain allowlist', async () => {
  const { createNetworkPolicy } = await import('./network-policy.mjs');
  const preview = 'http://service-123:8080';
  const policy = createNetworkPolicy([preview], ['docs.example.com', '*.assets.example.com'], 'http://egress-proxy:3128');
  assert.equal(policy.allows(`${preview}/page`), true);
  assert.equal(policy.allows('https://docs.example.com/guide'), true);
  assert.equal(policy.allows('https://cdn.assets.example.com/main.js'), true);
  assert.equal(policy.allows('wss://docs.example.com/live', true), true);
  for (const url of ['https://assets.example.com', 'https://docs.example.com.attacker.org',
    'http://127.0.0.1', 'http://169.254.169.254', 'file:///etc/passwd', 'data:text/plain,secret',
    'https://user:secret@docs.example.com', 'https://docs.example.com:8443']) {
    assert.equal(policy.allows(url), false, url);
  }
  assert.throws(() => createNetworkPolicy([], ['docs.example.com'], ''), /proxy/i);
});

test('offline browser only accepts explicitly provided task preview origins', async () => {
  const { createNetworkPolicy } = await import('./network-policy.mjs');
  const policy = createNetworkPolicy(['http://service-123:8080'], [], '');
  assert.equal(policy.allows('http://service-123:8080/test'), true);
  assert.equal(policy.allows('https://docs.example.com'), false);
  assert.equal(policy.allows('http://service-other:8080'), false);
});

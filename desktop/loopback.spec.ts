import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

const securityPromise = import('./loopback.cts').catch(() => null);

test('desktop HTTP guard permits only its exact loopback Host and Origin', async () => {
  const security = await securityPromise;
  assert.ok(security?.desktopRequestGuard);
  const server = createServer((request, response) => {
    security.desktopRequestGuard('http://127.0.0.1:43210')(request, response, () => {
      response.writeHead(200);
      response.end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const statusFor = (headers: Record<string, string>): Promise<number> => new Promise((resolve, reject) => {
    const call = request({ host: '127.0.0.1', port, path: '/', headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    call.on('error', reject);
    call.end();
  });
  try {
    assert.equal(await statusFor({ Host: '127.0.0.1:43210', Origin: 'http://127.0.0.1:43210' }), 200);
    assert.equal(await statusFor({ Host: 'squabble.evil.test:43210' }), 403);
    assert.equal(await statusFor({ Host: '127.0.0.1:43210', Origin: 'https://evil.test' }), 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

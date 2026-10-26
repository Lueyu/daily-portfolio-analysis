const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');

test('host browser policy rejects writes, exfiltration, arbitrary API and redirects', () => {
  const { allowedRequest } = require('./host-inspect.cjs');
  const base = 'http://127.0.0.1:8080';
  assert.equal(allowedRequest({ url: base + '/', method: 'GET' }, base), true);
  assert.equal(allowedRequest({ url: base + '/api/portfolio/holdings', method: 'GET' }, base), true);
  for (const request of [
    { url: base + '/api/portfolio/holdings', method: 'POST' },
    { url: base + '/api/portfolio/holdings', method: 'DELETE' },
    { url: 'http://127.0.0.1:5432/', method: 'GET' },
    { url: 'https://attacker.example/', method: 'GET' },
    { url: base + '/api/admin/destroy', method: 'GET' },
    { url: base + '/.env.local', method: 'GET' },
    { url: base + '/@fs/C:/Users/private.txt', method: 'GET' },
    { url: base + '/', method: 'GET', redirected: true },
  ]) assert.equal(allowedRequest(request, base), false, JSON.stringify(request));
});

test('isolated real browser reports only summaries and blocks page writes', { timeout: 30000 }, async () => {
  const { inspect } = require('./host-inspect.cjs');
  const calls = [];
  const server = http.createServer((request, response) => {
    calls.push({ method: request.method, url: request.url });
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<main><h1>PRIVATE_ACCOUNT</h1><table><tr><td>PRIVATE_BALANCE</td></tr></table>
        <script>fetch('/api/portfolio/holdings');fetch('/api/destroy',{method:'POST'}).catch(()=>{});
        fetch('/private').catch(()=>{});console.error('PRIVATE_TOKEN');</script></main>`);
    } else if (request.url === '/api/portfolio/holdings') {
      response.setHeader('Content-Type', 'application/json'); response.end('{"items":[{"name":"SECRET"}]}');
    } else { response.statusCode = 500; response.end('PRIVATE_ERROR'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await inspect({ origin: `http://127.0.0.1:${server.address().port}` });
    const withoutImage = { ...result, base64: undefined };
    const text = JSON.stringify(withoutImage);
    for (const secret of ['PRIVATE_ACCOUNT', 'PRIVATE_BALANCE', 'PRIVATE_TOKEN', 'PRIVATE_ERROR', 'SECRET']) {
      assert.equal(text.includes(secret), false);
    }
    assert.equal(result.ok, true);
    assert.equal(result.dom.tables, 1);
    assert.ok(result.consoleErrors >= 1); // Aborted unsafe fetches also log browser errors.
    assert.equal(result.screenshotRedacted, true);
    assert.ok(Buffer.from(result.base64, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(calls.some(call => call.method !== 'GET' || call.url === '/private'), false);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

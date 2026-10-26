import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

const workerPath = fileURLToPath(new URL('./worker.mjs', import.meta.url));
let fixture;
let forbidden;
let origin;
let forbiddenOrigin;
let forbiddenRequests = 0;

before(async () => {
  forbidden = createServer((_req, res) => { forbiddenRequests += 1; res.end('forbidden'); });
  await new Promise(resolve => forbidden.listen(0, '127.0.0.1', resolve));
  forbiddenOrigin = `http://127.0.0.1:${forbidden.address().port}`;
  fixture = createServer((req, res) => {
    if (req.url === '/api/database-error') {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'database unavailable' }));
      return;
    }
    if (req.url === '/async-data') {
      res.setHeader('content-type', 'text/html');
      res.end('<p id="data">Loading data</p><script>setTimeout(() => '
        + 'document.querySelector("#data").textContent="Loaded 3 records", 350)</script>');
      return;
    }
    if (req.url === '/chain' || req.url === '/same') {
      res.writeHead(302, { location: req.url === '/chain' ? '/redirect' : '/' });
      res.end();
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `${forbiddenOrigin}/redirected` });
      res.end();
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><title>Browser fixture</title><style>
      body { background: rgb(255,255,255); } button { color: rgb(230,230,230); background: rgb(255,255,255); }
      #clipped { width: 50px; white-space: nowrap; overflow: hidden; }
      </style></head><body><h1>Browser contract</h1><label>Name <input id="name"></label>
      <select aria-label="Choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
      <button id="save" onclick="document.querySelector('#result').textContent='Saved '+document.querySelector('#name').value">Save</button>
      <p id="result">Waiting</p><p id="clipped">This toolbar is clipped by narrow width</p>
      <button onclick="console.error('fixture console error');setTimeout(()=>{throw new Error('fixture page error')},0);fetch('${forbiddenOrigin}/blocked').catch(()=>{})">Trigger errors</button>
      <button onclick="document.querySelector('#save').replaceWith(document.createElement('button'))">Replace button</button>
      <a href="${forbiddenOrigin}/escape">External link</a><div style="height:1800px">Tall content</div>
      <script>window.addEventListener('load',()=>console.log('fixture loaded'));</script></body></html>`);
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${fixture.address().port}`;
});

after(async () => {
  await Promise.all([fixture, forbidden].map(server => new Promise(resolve => server.close(resolve))));
});

function createWorker(allowedOrigins = [origin], external = {}) {
  const child = spawn(process.execPath, [workerPath], {
    env: { ...process.env, AGENT_BROWSER_ALLOWED_ORIGINS: JSON.stringify(allowedOrigins),
      AGENT_BROWSER_ALLOWED_HOSTS: JSON.stringify(external.hosts || []),
      AGENT_BROWSER_EGRESS_PROXY: external.proxy || '' },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const pending = new Map();
  let nextId = 0;
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  createInterface({ input: child.stdout }).on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch { assert.fail(`Non-JSON stdout: ${line}`); }
    const entry = pending.get(response.id);
    assert.ok(entry, `Unexpected response ID: ${response.id}`);
    pending.delete(response.id);
    clearTimeout(entry.timeout);
    entry.resolve(response);
  });
  child.on('exit', code => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error(`Worker exited ${code}: ${stderr}`));
    }
    pending.clear();
  });
  const request = (action, parameters = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${action}`)); }, 20_000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ id, action, ...parameters })}\n`);
  });
  return {
    request,
    async ok(action, parameters) {
      const response = await request(action, parameters);
      assert.equal(response.ok, true, JSON.stringify(response));
      return response.result;
    },
    async close() {
      if (child.exitCode === null && !child.killed) {
        await request('close').catch(() => {});
        child.stdin.end();
        child.kill();
      }
    },
  };
}

async function refFor(worker, name, role) {
  const snapshot = await worker.ok('snapshot');
  const element = snapshot.elements.find(item => item.name === name && (!role || item.role === role));
  assert.ok(element, `${name} missing in ${JSON.stringify(snapshot)}`);
  assert.ok(element.ref && snapshot.version);
  return element.ref;
}

test('real browser navigates and operates versioned semantic elements', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  const nav = await worker.ok('navigate', { url: origin });
  assert.equal(nav.title, 'Browser fixture');
  await worker.ok('fill', { ref: await refFor(worker, 'Name', 'textbox'), text: 'Ada' });
  await worker.ok('press', { ref: await refFor(worker, 'Name', 'textbox'), key: 'End' });
  await worker.ok('select', { ref: await refFor(worker, 'Choice', 'combobox'), value: 'b' });
  await worker.ok('click', { ref: await refFor(worker, 'Save', 'button') });
  const snapshot = await worker.ok('snapshot');
  assert.ok(snapshot.elements.some(item => item.name === 'Saved Ada'));
  const scrolled = await worker.ok('scroll', { x: 0, y: 600 });
  assert.ok(scrolled.scrollY > 0);
});

test('stale references fail after DOM mutation or fresh snapshot', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  await worker.ok('navigate', { url: origin });
  const snapshot = await worker.ok('snapshot');
  const save = snapshot.elements.find(item => item.name === 'Save');
  const replace = snapshot.elements.find(item => item.name === 'Replace button');
  await worker.ok('click', { ref: replace.ref });
  let response = await worker.request('click', { ref: save.ref });
  assert.equal(response.ok, false);
  assert.match(response.error, /stale/i);
  const input = await refFor(worker, 'Name');
  await worker.ok('snapshot');
  response = await worker.request('fill', { ref: input, text: 'bad' });
  assert.equal(response.ok, false);
  assert.match(response.error, /stale/i);
});

test('styles expose low contrast and clipped layout evidence', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  await worker.ok('navigate', { url: origin });
  const button = await worker.ok('styles', { ref: await refFor(worker, 'Save'), properties: ['border-radius'] });
  assert.equal(button.styles.color, 'rgb(230, 230, 230)');
  assert.equal(button.styles.backgroundColor, 'rgb(255, 255, 255)');
  assert.ok(button.contrastRatio < 2);
  assert.equal(typeof button.styles['border-radius'], 'string');
  const clipped = await worker.ok('styles', { ref: await refFor(worker, 'This toolbar is clipped by narrow width') });
  assert.ok(clipped.layout.scrollWidth > clipped.layout.clientWidth);
  assert.equal(clipped.styles.overflowX, 'hidden');
});

test('input and scroll changes invalidate the prior observation even without DOM mutation', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  await worker.ok('navigate', { url: origin });
  const input = await refFor(worker, 'Name', 'textbox');
  await worker.ok('fill', { ref: input, text: 'Changed' });
  assert.equal((await worker.request('fill', { ref: input, text: 'stale' })).ok, false);
  const button = await refFor(worker, 'Save', 'button');
  await worker.ok('scroll', { y: 400 });
  assert.equal((await worker.request('click', { ref: button })).ok, false);
});

test('screenshot returns PNG bytes and refuses caller-selected file paths', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  await worker.ok('navigate', { url: origin });
  const shot = await worker.ok('screenshot', { fullPage: false });
  assert.equal(shot.mimeType, 'image/png');
  const bytes = Buffer.from(shot.base64, 'base64');
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(shot.width, 1280);
  assert.equal(shot.height, 900);
  const invalid = await worker.request('screenshot', { path: '../outside.png' });
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /unsupported.*path/i);
});

test('network isolation blocks navigation, redirects, subrequests and local files', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  const beforeCount = forbiddenRequests;
  for (const url of [forbiddenOrigin, 'file:///etc/passwd', 'data:text/html,secret']) {
    const response = await worker.request('navigate', { url });
    assert.equal(response.ok, false);
    assert.match(response.error, /not allowed/i);
  }
  const redirect = await worker.request('navigate', { url: `${origin}/redirect` });
  assert.equal(redirect.ok, false);
  const chain = await worker.request('navigate', { url: `${origin}/chain` });
  assert.equal(chain.ok, false);
  assert.equal(forbiddenRequests, beforeCount);
  assert.equal((await worker.ok('navigate', { url: `${origin}/same` })).title, 'Browser fixture');
  await worker.ok('navigate', { url: origin });
  await worker.ok('click', { ref: await refFor(worker, 'Trigger errors') });
  const errors = await worker.ok('errors');
  assert.ok(errors.console.some(item => item.text.includes('fixture console error')));
  assert.ok(errors.pageErrors.some(item => item.message.includes('fixture page error')));
  assert.ok(errors.networkFailures.some(item => item.url.startsWith(forbiddenOrigin)));
  assert.equal(forbiddenRequests, beforeCount);
  assert.equal((await worker.request('evaluate', { script: 'process.exit()' })).ok, false);
});

test('empty allowlist denies network by default', async t => {
  const worker = createWorker([]);
  t.after(() => worker.close());
  const response = await worker.request('navigate', { url: origin });
  assert.equal(response.ok, false);
  assert.match(response.error, /not allowed/i);
});

test('HTTP errors are visible even when the request completes successfully', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  await worker.ok('navigate', { url: `${origin}/api/database-error` });
  const errors = await worker.ok('errors');
  assert.ok(errors.httpErrors?.some(item => item.status === 503
    && item.method === 'GET' && item.url === `${origin}/api/database-error`));
  assert.equal(errors.url, `${origin}/api/database-error`);
  await worker.ok('navigate', { url: origin });
  assert.equal((await worker.ok('errors')).httpErrors.length, 0);
});

test('wait_for observes asynchronously loaded text without arbitrary scripts or polling', async t => {
  const worker = createWorker();
  t.after(() => worker.close());
  await worker.ok('navigate', { url: `${origin}/async-data` });
  await worker.ok('wait_for', { text: 'Loaded 3 records', timeout_ms: 2000 });
  const snapshot = await worker.ok('snapshot');
  assert.ok(snapshot.elements.some(item => item.text === 'Loaded 3 records'));
  assert.equal((await worker.request('wait_for', { text: 'missing', timeout_ms: 100 })).ok, false);
  assert.equal((await worker.request('wait_for', { text: 'loaded', timeout_ms: 100000 })).ok, false);
});

test('public pages are fetched through the egress proxy and cross-host redirects stay blocked', async t => {
  const requests = [];
  const proxy = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === 'http://docs.example.com/redirect') {
      res.writeHead(302, { location: 'http://notallowed.example.com/private' });
      res.end();
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<title>External documentation</title><h1>Documentation from proxy</h1>');
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proxy.close(resolve)));
  const worker = createWorker([], { hosts: ['docs.example.com'], proxy: `http://127.0.0.1:${proxy.address().port}` });
  t.after(() => worker.close());
  const page = await worker.ok('navigate', { url: 'http://docs.example.com/guide' });
  assert.equal(page.title, 'External documentation');
  assert.ok(requests.includes('http://docs.example.com/guide'));
  const redirect = await worker.request('navigate', { url: 'http://docs.example.com/redirect' });
  assert.equal(redirect.ok, false);
  assert.equal(requests.some(url => url.includes('notallowed.example.com')), false);
});

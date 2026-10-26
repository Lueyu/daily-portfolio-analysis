const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  isProjectListener,
  occupiedLoopbackPorts,
  localEnvironment,
  parseDatabaseUrl,
  safeDatabaseTarget,
  databaseMode,
  parseBackendMessage,
  parseErrorSqlstate,
  postgresProtocolReady,
  waitForPostgres,
  startLocalDatabase,
  ensureLocalDatabase,
  acquireDbMutex,
  runGuard,
} = require('./dev-local-guard.cjs');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const projectRoot = 'D:/stock/code';
const projectVite = {
  pid: 12,
  commandLine: 'node D:\\stock\\code\\node_modules\\vite\\bin\\vite.js',
  createdAt: '2026-10-22T10:00:00Z',
};

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}
// server.close() only resolves once every connection is ended. A peer that
// never closes (or only half-closes) would otherwise stall the cleanup step,
// so destroy tracked server-side sockets first.
function close(server) {
  return new Promise((resolve) => {
    for (const socket of server._sockets || []) socket.destroy();
    server.close(resolve);
  });
}

// A TCP server whose connection handler receives the raw socket; useful to
// emulate a PostgreSQL protocol response or a non-PG service.
function tcpServer(onConnection) {
  const server = net.createServer((socket) => onConnection(socket));
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server._sockets = sockets;
  return server;
}

function int32be(n) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
}

// Valid PostgreSQL v3 AuthenticationOk: type 'R' (0x52), length 8, code 0.
function authOkFrame() {
  return Buffer.concat([Buffer.from([0x52]), int32be(8), int32be(0)]);
}

// Valid PostgreSQL v3 ErrorResponse carrying a chosen SQLSTATE in the 'C' field.
function errorFrame(sqlstate) {
  const payload = Buffer.concat([
    Buffer.from('SERROR\0', 'utf8'),
    Buffer.from(`C${sqlstate}\0`, 'utf8'),
    Buffer.from('Mboom\0', 'utf8'),
    Buffer.from([0]),
  ]);
  return Buffer.concat([Buffer.from([0x45]), int32be(4 + payload.length), payload]);
}

// An ErrorResponse frame with a well-formed header but NO 'C' SQLSTATE field.
function errorFrameNoSqlstate() {
  const payload = Buffer.concat([Buffer.from('SERROR\0', 'utf8'), Buffer.from('Mboom\0', 'utf8'), Buffer.from([0])]);
  return Buffer.concat([Buffer.from([0x45]), int32be(4 + payload.length), payload]);
}

// No-op mutex for orchestration tests that don't exercise the real lock file.
const noopMutex = async () => () => {};

// ---------------------------------------------------------------------------
// existing guard behavior (regression surface)
// ---------------------------------------------------------------------------

test('recognizes this checkout while rejecting another project and stale recorded pids', () => {
  assert.equal(isProjectListener({ ...projectVite }, projectRoot, []), true);
  assert.equal(
    isProjectListener({ pid: 12, commandLine: 'node D:\\other\\node_modules\\vite\\bin\\vite.js' }, projectRoot, []),
    false,
  );
  const record = { pid: 12, commandLine: 'node node_modules/vite/bin/vite.js', createdAt: '2026-10-22T10:00:00Z' };
  assert.equal(isProjectListener({ ...record, createdAt: '2026-10-22T10:00:01Z' }, projectRoot, [record]), false);
  assert.equal(isProjectListener(record, projectRoot, [record]), true);
});

test('detects an existing IPv4 service even if a second launch would bind IPv6', async () => {
  const server = net.createServer();
  await listen(server);
  try {
    const port = server.address().port;
    assert.deepEqual(await occupiedLoopbackPorts([port]), [port]);
  } finally { await close(server); }
});

test('keeps local subprocesses UTF-8 and bypasses proxies only for loopback', () => {
  const env = localEnvironment({ NO_PROXY: 'example.com', SERVER_HOST: 'localhost' });
  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PYTHONIOENCODING, 'utf-8');
  assert.equal(env.SERVER_HOST, '127.0.0.1');
  assert.equal(env.CLIENT_DEV_HOST, '127.0.0.1');
  assert.equal(env.NO_PROXY, 'example.com,localhost,127.0.0.1,::1');
});

// ---------------------------------------------------------------------------
// database URL / mode classification
// ---------------------------------------------------------------------------

test('parses loopback and remote database URLs', () => {
  assert.deepEqual(
    parseDatabaseUrl('postgres://postgres@127.0.0.1:5432/portfolio?schema=workspace_aadkwdme7deas'),
    { host: '127.0.0.1', port: 5432, isLoopback: true },
  );
  assert.deepEqual(parseDatabaseUrl('postgres://postgres@localhost/portfolio?schema=x'),
    { host: 'localhost', port: 5432, isLoopback: true });
  assert.deepEqual(parseDatabaseUrl('postgres://user:secret@db.example.com:5544/app'),
    { host: 'db.example.com', port: 5544, isLoopback: false });
  assert.equal(parseDatabaseUrl(''), null);
  assert.equal(parseDatabaseUrl('localhost'), null);
});

test('classifies the database mode from URL and framework switches', () => {
  assert.equal(databaseMode('postgres://postgres@127.0.0.1:5432/x', {}), 'local');
  assert.equal(databaseMode('postgres://user@db.example.com:5432/x', {}), 'remote');
  assert.equal(databaseMode(undefined, {}), 'none');
  assert.equal(databaseMode('postgres://postgres@127.0.0.1:5432/x', { DEPRECATED_SKIP_INIT_DB_CONNECTION: 'true' }), 'none');
  assert.equal(databaseMode('postgres://postgres@127.0.0.1:5432/x', { FORCE_FRAMEWORK_DISABLE_DATAPASS: 'true' }), 'none');
});

test('safeDatabaseTarget never exposes credentials, path or query', () => {
  assert.equal(safeDatabaseTarget('postgres://alice:secret@127.0.0.1:5432/app?schema=private'), '127.0.0.1:5432');
  assert.equal(safeDatabaseTarget('postgres://user@db.example.com:5544/app'), 'db.example.com:5544');
  assert.equal(safeDatabaseTarget('not-a-url'), null);
});

// ---------------------------------------------------------------------------
// PostgreSQL protocol frame validation
// ---------------------------------------------------------------------------

test('parseBackendMessage validates full frames and distinguishes recovery states', () => {
  assert.deepEqual(parseBackendMessage(authOkFrame()), { state: 'ready' });
  assert.deepEqual(parseBackendMessage(errorFrame('57P03')), { state: 'recovering' });
  assert.deepEqual(parseBackendMessage(errorFrame('28P01')), { state: 'ready' });
  // an E response without a valid 5-char SQLSTATE is not proof of health
  assert.deepEqual(parseBackendMessage(errorFrameNoSqlstate()), { state: 'invalid' });
  // incomplete: needs the full frame before a verdict
  assert.deepEqual(parseBackendMessage(authOkFrame().subarray(0, 4)), { state: 'incomplete' });
  assert.deepEqual(parseBackendMessage(errorFrame('57P03').subarray(0, 8)), { state: 'incomplete' });
  // invalid: a non-PG byte stream cannot carry a plausible length
  assert.deepEqual(parseBackendMessage(Buffer.from('hello world')), { state: 'invalid' });
  // invalid: declared length out of protocol bounds
  assert.deepEqual(parseBackendMessage(Buffer.concat([Buffer.from([0x52]), int32be(5)])), { state: 'invalid' });
});

test('parseErrorSqlstate extracts the C field or returns null', () => {
  const payload = Buffer.from('SERROR\0C57P03\0Mboom\0\0', 'utf8');
  assert.equal(parseErrorSqlstate(payload), '57P03');
  assert.equal(parseErrorSqlstate(Buffer.from('SERROR\0\0', 'utf8')), null);
});

test('postgresProtocolReady accepts a real PostgreSQL-style auth frame', async () => {
  const server = tcpServer((socket) => { socket.on('data', () => socket.write(authOkFrame())); });
  await listen(server);
  try {
    assert.equal(await postgresProtocolReady('127.0.0.1', server.address().port, 1000), 'ready');
  } finally { await close(server); }
});

test('postgresProtocolReady reports recovering for 57P03, not ready', async () => {
  const server = tcpServer((socket) => { socket.on('data', () => socket.write(errorFrame('57P03'))); });
  await listen(server);
  try {
    assert.equal(await postgresProtocolReady('127.0.0.1', server.address().port, 1000), 'recovering');
  } finally { await close(server); }
});

test('postgresProtocolReady rejects a non-PostgreSQL TCP listener', async () => {
  const server = tcpServer((socket) => { socket.on('data', () => socket.write(Buffer.from('hello world'))); });
  await listen(server);
  try {
    assert.equal(await postgresProtocolReady('127.0.0.1', server.address().port, 1000), 'unavailable');
  } finally { await close(server); }
});

test('postgresProtocolReady converges when the peer ends without data', async () => {
  const server = tcpServer((socket) => socket.end());
  await listen(server);
  try {
    assert.equal(await postgresProtocolReady('127.0.0.1', server.address().port, 2000), 'unavailable');
  } finally { await close(server); }
});

test('postgresProtocolReady converges via hard timeout on a silent peer', async () => {
  const server = tcpServer(() => { /* accept but never reply nor close */ });
  await listen(server);
  try {
    assert.equal(await postgresProtocolReady('127.0.0.1', server.address().port, 300), 'unavailable');
  } finally { await close(server); }
});

test('waitForPostgres waits until protocol becomes ready', async () => {
  let opened = false;
  const server = tcpServer((socket) => {
    socket.on('data', () => socket.write(opened ? authOkFrame() : Buffer.from('xx')));
  });
  await listen(server);
  const port = server.address().port;
  try {
    setTimeout(() => { opened = true; }, 300);
    assert.equal(await waitForPostgres(`postgres://postgres@127.0.0.1:${port}/x`, 2000), true);
  } finally { await close(server); }
});

// ---------------------------------------------------------------------------
// ensureLocalDatabase: probe-before-start, remote/none no-op, config chain
// ---------------------------------------------------------------------------

test('healthy database already present needs no starter (no Scoop PG_BIN/PGDATA)', async () => {
  let started = false;
  const result = await ensureLocalDatabase({
    env: { SUDA_DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/x' },
    root: '/tmp',
    platform: 'win32',
    probe: async () => 'ready', // healthy PG at the configured target
    start: () => { started = true; throw new Error('must not run'); },
  });
  assert.deepEqual(result, { mode: 'local', ready: true });
  assert.equal(started, false);
});

test('recovering database is waited on, never re-started', async () => {
  let started = false;
  let calls = 0;
  const result = await ensureLocalDatabase({
    env: { SUDA_DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/x' },
    root: '/tmp',
    platform: 'win32',
    probe: async () => { calls += 1; return calls === 1 ? 'recovering' : 'ready'; },
    start: () => { started = true; throw new Error('must not restart a recovering instance'); },
  });
  assert.deepEqual(result, { mode: 'local', ready: true });
  assert.equal(started, false);
});

test('non-PG TCP cannot impersonate readiness and start failure is reported', async () => {
  const result = await ensureLocalDatabase({
    env: { SUDA_DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/x' },
    root: '/tmp',
    platform: 'win32',
    probe: async () => 'unavailable', // target open but not PostgreSQL
    start: () => { throw new Error('no supported PG binaries'); },
  });
  assert.deepEqual(result, { mode: 'local', ready: false, startFailed: true });
});

test('local mode starts the supported instance then reports ready', async () => {
  let started = false;
  let calls = 0;
  const result = await ensureLocalDatabase({
    env: { SUDA_DATABASE_URL: 'postgres://postgres@127.0.0.1:5432/x' },
    root: '/tmp',
    platform: 'win32',
    probe: async () => { calls += 1; return calls === 1 ? 'unavailable' : 'ready'; },
    start: () => { started = true; },
  });
  assert.deepEqual(result, { mode: 'local', ready: true });
  assert.equal(started, true);
});

test('never touches a local server for remote or none database modes', async () => {
  let started = false;
  const start = () => { started = true; throw new Error('must not run'); };
  const probe = async () => { throw new Error('must not probe'); };
  const remote = await ensureLocalDatabase({
    env: { SUDA_DATABASE_URL: 'postgres://u@db.example.com:5432/x' },
    root: '/tmp', platform: 'win32', start, probe,
  });
  assert.deepEqual(remote, { mode: 'remote', ready: true });
  assert.equal(started, false);

  const none = await ensureLocalDatabase({ env: {}, root: '/tmp', platform: 'win32', start, probe });
  assert.deepEqual(none, { mode: 'none', ready: true });
  assert.equal(started, false);
});

test('on non-Windows it probes the target without invoking a Windows starter', async () => {
  const server = tcpServer((socket) => { socket.on('data', () => socket.write(authOkFrame())); });
  await listen(server);
  try {
    let started = false;
    const result = await ensureLocalDatabase({
      env: { SUDA_DATABASE_URL: `postgres://postgres@127.0.0.1:${server.address().port}/x` },
      root: '/tmp', platform: 'linux', start: () => { started = true; },
    });
    assert.deepEqual(result, { mode: 'local', ready: true });
    assert.equal(started, false);
  } finally { await close(server); }
});

test('startLocalDatabase passes the merged environment (PG_BIN/PGDATA chain) to the starter', () => {
  const env = { PG_BIN: 'C:\\pg\\bin', PGDATA: 'C:\\pg\\data', SUDA_DATABASE_URL: 'postgres://u@127.0.0.1/x' };
  const calls = [];
  startLocalDatabase('/tmp', env, (file, args, options) => {
    calls.push({ file, args, options });
    return Buffer.alloc(0);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'powershell.exe');
  assert.equal(calls[0].args[calls[0].args.length - 1], path.join('/tmp', 'scripts', 'db', 'start-db.ps1'));
  assert.equal(calls[0].options.env, env); // same object = merged env reaches the script
  assert.equal(calls[0].options.cwd, '/tmp');
});

// ---------------------------------------------------------------------------
// short-lived database mutex
// ---------------------------------------------------------------------------

test('acquireDbMutex releases immediately so a later run can re-acquire', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-mutex-'));
  try {
    const lockPath = path.join(tmp, 'logs', 'dev-local-db.lock.json');
    const release1 = await acquireDbMutex(tmp, { token: 't1', timeoutMs: 500, pollMs: 10 });
    release1();
    assert.equal(fs.existsSync(lockPath), false, 'release must remove the mutex file');
    const release2 = await acquireDbMutex(tmp, { token: 't2', timeoutMs: 500, pollMs: 10 });
    release2();
    assert.equal(fs.existsSync(lockPath), false);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('acquireDbMutex steals a stale lock left by a dead pid', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-mutex-'));
  try {
    const lockPath = path.join(tmp, 'logs', 'dev-local-db.lock.json');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, token: 'dead' }));
    const release = await acquireDbMutex(tmp, { token: 'me', timeoutMs: 500, pollMs: 10 });
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.equal(lock.pid, process.pid);
    release();
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('acquireDbMutex throws on timeout instead of proceeding without the lock', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-mutex-'));
  try {
    const lockPath = path.join(tmp, 'logs', 'dev-local-db.lock.json');
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: 'holder' }));
    await assert.rejects(
      () => acquireDbMutex(tmp, { token: 'me', timeoutMs: 120, pollMs: 10 }),
      /Timed out waiting for another dev:local database recovery/,
    );
    // the live holder's lock must not be stolen
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).token, 'holder');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------------------
// full launch orchestration (runGuard)
// ---------------------------------------------------------------------------

// Regression: the database gate must run BEFORE the "already listening" reuse
// return. This is the exact real-world failure — frontend/backend up, DB down.
test('own services listening + DB down: gates the DB before reuse and never spawns', async () => {
  let ensureCalls = 0;
  let spawned = false;
  let captured = '';
  const result = await runGuard({
    root: projectRoot,
    platform: 'win32',
    env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000', SUDA_DATABASE_URL: 'postgres://alice:secret@127.0.0.1:5432/app' },
    checkPorts: async () => [8080],
    listListeners: () => [{ ...projectVite }],
    dbMutex: noopMutex,
    ensureDb: async () => { ensureCalls += 1; return { mode: 'local', ready: false }; },
    spawnChild: () => { spawned = true; throw new Error('must not spawn'); },
    stderr: (m) => { captured += m; },
  });
  assert.equal(result.code, 1);
  assert.equal(ensureCalls, 1, 'database gate must run even when services already listen');
  assert.equal(spawned, false);
  assert.ok(!captured.includes('secret'));
  assert.ok(!captured.includes('alice'));
  assert.ok(captured.includes('127.0.0.1:5432'));
});

// The reported regression: a live launcher+web are running and DB went down.
// The process-lifetime launcher lock must NOT be consulted on the reuse path,
// so DB recovery still happens and the running web is reused — not re-spawned.
test('live launcher+web + DB down: recovers DB via a short mutex, reuses stack, never touches launcher lock', async () => {
  const events = [];
  const result = await runGuard({
    root: projectRoot,
    platform: 'win32',
    env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000', SUDA_DATABASE_URL: 'postgres://u@127.0.0.1:5432/x' },
    checkPorts: async () => [8080],
    listListeners: () => [{ ...projectVite }],
    dbMutex: async () => { events.push('mutex-acquire'); return () => events.push('mutex-release'); },
    ensureDb: async () => { events.push('ensureDb'); return { mode: 'local', ready: true }; },
    lock: async () => { throw new Error('launcher lock must not be consulted on the reuse path'); },
    spawnChild: () => { throw new Error('must not spawn a second stack'); },
    stdout: () => {},
  });
  assert.equal(result.code, 0);
  // mutex is acquired, released immediately after the gate, and the launcher
  // lock is never touched even though it would still be held by the old launcher.
  assert.deepEqual(events, ['mutex-acquire', 'ensureDb', 'mutex-release']);
});

test('own services listening + DB recovered: reuses the stack without a second spawn', async () => {
  let spawned = false;
  let out = '';
  const result = await runGuard({
    root: projectRoot,
    platform: 'win32',
    env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000', SUDA_DATABASE_URL: 'postgres://u@127.0.0.1:5432/x' },
    checkPorts: async () => [8080],
    listListeners: () => [{ ...projectVite }],
    dbMutex: noopMutex,
    ensureDb: async () => ({ mode: 'local', ready: true }),
    spawnChild: () => { spawned = true; throw new Error('must not spawn'); },
    stdout: (m) => { out += m; },
  });
  assert.equal(result.code, 0);
  assert.equal(spawned, false);
  assert.ok(out.includes('already has a dev service'));
});

test('fresh start: DB mutex wraps the gate, launcher lock runs after, spawn gets merged env', async () => {
  const env = { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000', SUDA_DATABASE_URL: 'postgres://u@127.0.0.1:5432/x', PG_BIN: 'C:\\pg\\bin' };
  const events = [];
  let spawnedEnv = null;
  const result = await runGuard({
    root: projectRoot,
    env,
    checkPorts: async () => [],
    dbMutex: async () => { events.push('mutex-acquire'); return () => events.push('mutex-release'); },
    ensureDb: async () => { events.push('ensureDb'); return { mode: 'local', ready: true }; },
    lock: async () => { events.push('lock'); return { running: false }; },
    spawnChild: (childEnv) => { events.push('spawn'); spawnedEnv = childEnv; },
  });
  assert.equal(result.code, 0);
  // ordering proves the short mutex fully encloses only the DB gate, and the
  // process-lifetime launcher lock only guards the fresh spawn that follows.
  assert.deepEqual(events, ['mutex-acquire', 'ensureDb', 'mutex-release', 'lock', 'spawn']);
  assert.ok(spawnedEnv);
  assert.equal(spawnedEnv.PG_BIN, 'C:\\pg\\bin');
  assert.equal(spawnedEnv.SUDA_DATABASE_URL, 'postgres://u@127.0.0.1:5432/x');
});

test('DB start failure aborts without spawning the stack', async () => {
  let spawned = false;
  let captured = '';
  const result = await runGuard({
    root: projectRoot,
    env: { SUDA_DATABASE_URL: 'postgres://u@127.0.0.1:5432/x' },
    checkPorts: async () => [],
    dbMutex: noopMutex,
    lock: async () => ({ running: false }),
    ensureDb: async () => ({ mode: 'local', ready: false, startFailed: true }),
    spawnChild: () => { spawned = true; },
    stderr: (m) => { captured += m; },
  });
  assert.equal(result.code, 1);
  assert.equal(spawned, false);
  assert.ok(captured.includes('start-db.ps1'), 'must point at the non-destructive starter');
  assert.ok(!captured.includes('rebuild-local.ps1'), 'must never suggest a destructive rebuild');
});

test('unrelated occupied ports still abort before any DB work', async () => {
  let ensureCalls = 0;
  let mutexCalls = 0;
  const result = await runGuard({
    root: projectRoot,
    env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000' },
    checkPorts: async () => [8080],
    listListeners: () => [{ pid: 99, commandLine: 'node D:\\other\\server.js', createdAt: '2026-10-22T10:00:00Z' }],
    dbMutex: async () => { mutexCalls += 1; return () => {}; },
    ensureDb: async () => { ensureCalls += 1; return { mode: 'none', ready: true }; },
    spawnChild: () => { throw new Error('must not spawn'); },
  });
  assert.equal(result.code, 1);
  assert.equal(ensureCalls, 0, 'unrelated occupied port must fail before database work');
  assert.equal(mutexCalls, 0, 'unrelated occupied port must fail before taking the DB mutex');
});

test('existing launcher lock aborts a fresh spawn without spawning', async () => {
  const result = await runGuard({
    root: projectRoot,
    env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000' },
    checkPorts: async () => [],
    dbMutex: noopMutex,
    ensureDb: async () => ({ mode: 'none', ready: true }),
    lock: async () => ({ running: true }),
    spawnChild: () => { throw new Error('must not spawn'); },
  });
  assert.equal(result.code, 1);
});

test('DB mutex timeout fails the run: no ensureDb, no spawn', async () => {
  let ensureCalls = 0;
  let spawned = false;
  let captured = '';
  const result = await runGuard({
    root: projectRoot,
    env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000', SUDA_DATABASE_URL: 'postgres://u@127.0.0.1:5432/x' },
    checkPorts: async () => [],
    dbMutex: async () => { throw new Error('Timed out waiting for another dev:local database recovery'); },
    ensureDb: async () => { ensureCalls += 1; return { mode: 'local', ready: true }; },
    lock: async () => { throw new Error('must not reach the launcher lock'); },
    spawnChild: () => { spawned = true; },
    stderr: (m) => { captured += m; },
  });
  assert.equal(result.code, 1);
  assert.equal(ensureCalls, 0, 'a lost mutex must never proceed to DB preparation');
  assert.equal(spawned, false);
  assert.ok(captured.includes('Timed out'));
});

test('an ensureDb failure still releases an acquired DB mutex', async () => {
  let released = false;
  await assert.rejects(
    () => runGuard({
      root: projectRoot,
      env: { CLIENT_DEV_PORT: '8080', SERVER_PORT: '3000', SUDA_DATABASE_URL: 'postgres://u@127.0.0.1:5432/x' },
      checkPorts: async () => [],
      dbMutex: async () => () => { released = true; },
      ensureDb: async () => { throw new Error('probe exploded'); },
      spawnChild: () => { throw new Error('must not spawn'); },
    }),
    /probe exploded/,
  );
  assert.equal(released, true, 'an acquired mutex must be released on the failure path');
});

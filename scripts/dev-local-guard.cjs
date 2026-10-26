#!/usr/bin/env node
/** Single local dev stack per checkout; the vendor launcher stays untouched. */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');

const normalized = (value) => String(value || '').replace(/\\/g, '/').toLowerCase();

function isProjectListener(processInfo, root, records) {
  const command = normalized(processInfo.commandLine);
  const project = normalized(root).replace(/\/$/, '') + '/';
  if (command.includes(project) && /(?:vite[\\/]bin[\\/]vite|@nestjs[\\/]cli|dist[\\/]server[\\/]main)/.test(command)) return true;
  return records.some((record) => record.pid === processInfo.pid &&
    record.commandLine === processInfo.commandLine &&
    Number.isFinite(Date.parse(record.createdAt)) &&
    Date.parse(record.createdAt) === Date.parse(processInfo.createdAt));
}

async function occupiedLoopbackPorts(ports) {
  const checks = await Promise.all([...new Set(ports)].map(async (port) => {
    const occupied = await Promise.all(['127.0.0.1', '::1'].map((host) => new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const finish = (value) => { socket.destroy(); resolve(value); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    })));
    return occupied.some(Boolean) ? port : null;
  }));
  return checks.filter((port) => port !== null);
}

function localEnvironment(input) {
  const env = { ...input, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  for (const key of ['SERVER_HOST', 'CLIENT_DEV_HOST']) {
    if (!env[key] || ['localhost', '127.0.0.1', '::1'].includes(env[key])) env[key] = '127.0.0.1';
  }
  const exclusions = new Set((env.NO_PROXY || env.no_proxy || '').split(',').filter(Boolean));
  for (const host of ['localhost', '127.0.0.1', '::1']) exclusions.add(host);
  env.NO_PROXY = [...exclusions].join(',');
  env.no_proxy = env.NO_PROXY;
  return env;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

// ---------------------------------------------------------------------------
// Local database dependency
// ---------------------------------------------------------------------------

function parseDatabaseUrl(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  const match = /^postgres(?:ql)?:\/\/(?:([^:@/]+)(?::([^@/]*))?@)?(\[[^\]]+\]|[^:/?]+)(?::(\d+))?(\/[^?]*)?(?:\?(.*))?$/.exec(input);
  if (!match) return null;
  const host = (match[3] || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const port = match[4] ? Number(match[4]) : 5432;
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return { host, port, isLoopback };
}

// Never expose credentials/path/query in diagnostics — only host:port.
function safeDatabaseTarget(url) {
  const parsed = parseDatabaseUrl(url);
  return parsed ? `${parsed.host}:${parsed.port}` : null;
}

// Local means the backend must reach a loopback PostgreSQL (start/verify it here).
// Remote means the platform/cloud database — never touch a local server for it.
// none means the stack runs without a database (minimal mode or no URL configured).
function databaseMode(url, env = process.env) {
  if (env.FORCE_FRAMEWORK_DISABLE_DATAPASS === 'true') return 'none';
  if (env.DEPRECATED_SKIP_INIT_DB_CONNECTION === 'true') return 'none';
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return 'none';
  return parsed.isLoopback ? 'local' : 'remote';
}

// Minimal PostgreSQL v3 startup packet so the server answers with a backend
// message ('R' auth, 'E' error, etc.). A random TCP listener cannot produce
// these bytes, so this distinguishes a live PostgreSQL from any open port.
function buildStartupPacket(user = 'postgres', database = 'postgres') {
  let body = Buffer.alloc(4);
  body.writeInt32BE(196608, 0); // protocol 3.0
  for (const [key, value] of [['user', user], ['database', database], ['client_encoding', 'UTF8']]) {
    body = Buffer.concat([body, Buffer.from(`${key}\0${value}\0`, 'utf8')]);
  }
  body = Buffer.concat([body, Buffer.from([0])]);
  const header = Buffer.alloc(4);
  header.writeInt32BE(body.length + 4, 0);
  return Buffer.concat([header, body]);
}

// SQLSTATEs emitted while PostgreSQL cannot yet accept normal connections:
// crash recovery / starting up / shutting down / admin shutdown. These prove the
// server is real but NOT ready; they must not be treated as success.
const RECOVERY_SQLSTATES = new Set(['57P01', '57P02', '57P03', '57P04']);

// Extract the SQLSTATE ('C') field from an ErrorResponse payload.
function parseErrorSqlstate(payload) {
  let i = 0;
  while (i < payload.length) {
    const codeByte = payload[i];
    if (codeByte === 0) return null; // message terminator reached
    const code = String.fromCharCode(codeByte);
    i += 1;
    const end = payload.indexOf(0, i);
    if (end === -1) return null;
    const value = payload.subarray(i, end).toString('utf8');
    if (code === 'C') return value;
    i = end + 1;
  }
  return null;
}

// Validate a complete PostgreSQL v3 backend frame: 1-byte type + 4-byte length
// (length includes itself) + payload. Returns:
//   { state: 'ready' }      — 'R' auth request, or 'E' with a definitive
//                             non-recovery SQLSTATE (PG is up and responsive).
//   { state: 'recovering' } — 'E' with 57P01..57P04 (crash recovery/starting).
//   { state: 'invalid' }    — not a valid PG backend frame.
//   { state: 'incomplete' } — need more bytes before the frame is complete.
function parseBackendMessage(buffer) {
  if (buffer.length < 5) return { state: 'incomplete' };
  const type = String.fromCharCode(buffer[0]);
  const length = buffer.readInt32BE(1);
  if (length < 8 || length > 1048576) return { state: 'invalid' };
  if (buffer.length < 1 + length) return { state: 'incomplete' };
  const payload = buffer.subarray(5, 1 + length);
  if (type === 'R') return { state: 'ready' };
  if (type === 'E') {
    const sqlstate = parseErrorSqlstate(payload);
    // A valid SQLSTATE is exactly five alphanumeric characters. An ErrorResponse
    // missing the 'C' field (or with a truncated payload) is NOT proof of a
    // healthy PostgreSQL, so it must not be treated as ready.
    if (!/^[0-9A-Z]{5}$/.test(sqlstate || '')) return { state: 'invalid' };
    return RECOVERY_SQLSTATES.has(sqlstate) ? { state: 'recovering' } : { state: 'ready' };
  }
  return { state: 'invalid' };
}

// Protocol-level readiness probe. Resolves to one of:
//   'ready'       — live PostgreSQL accepted the startup (auth or a definitive
//                   non-recovery error such as bad credentials/database).
//   'recovering'  — live PostgreSQL answered 57P01..57P04 (starting/recovering).
//   'unavailable' — no PG at the target (refused/timeout/close) or non-PG bytes.
// A single hard timer is the total deadline and the socket always converges via
// error/close/end, so a peer that never sends data cannot stall us.
function postgresProtocolReady(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    let buffer = Buffer.alloc(0);
    const finish = (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      if (socket) socket.destroy();
      resolve(state);
    };
    const hardTimer = setTimeout(() => finish('unavailable'), timeoutMs);
    socket = net.createConnection({ host, port });
    socket.once('error', () => finish('unavailable'));
    socket.once('close', () => finish('unavailable'));
    socket.once('end', () => finish('unavailable'));
    socket.once('connect', () => socket.write(buildStartupPacket()));
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const verdict = parseBackendMessage(buffer);
      if (verdict.state === 'ready') finish('ready');
      else if (verdict.state === 'recovering') finish('recovering');
      else if (verdict.state === 'invalid') finish('unavailable');
      // 'incomplete' → keep buffering until the full frame arrives or close/timeout.
    });
  });
}

async function waitForPostgres(url, timeoutMs = 30_000, probe = postgresProtocolReady) {
  const parsed = parseDatabaseUrl(url);
  if (!parsed) return false;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe(parsed.host, parsed.port, 1000) === 'ready') return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

// Start the local PostgreSQL via the idempotent start-db.ps1 (start only —
// never rebuild or drop data). `env` is the merged launch environment so
// PG_BIN/PGDATA etc. from .env/.env.local reach the script.
function startLocalDatabase(root, env, exec = execFileSync) {
  const script = path.join(root, 'scripts', 'db', 'start-db.ps1');
  exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
    cwd: root, env, stdio: 'inherit', windowsHide: true, timeout: 180_000,
  });
}

// Gate for the local database dependency:
//  - remote/none modes: no-op, never touch a local server.
//  - local mode: first probe the configured target. A healthy PostgreSQL that is
//    already there (service, container, custom port) needs no starter — even
//    when no Scoop PG_BIN/PGDATA exists. A recovering server is waited on, not
//    re-started. Only when nothing is at the target do we start the supported
//    local instance (idempotent) and wait until the protocol is ready.
async function ensureLocalDatabase({
  env, root, platform = process.platform,
  start = startLocalDatabase, probe = postgresProtocolReady,
} = {}) {
  const mode = databaseMode(env.SUDA_DATABASE_URL, env);
  if (mode !== 'local') return { mode, ready: true };
  const parsed = parseDatabaseUrl(env.SUDA_DATABASE_URL);
  if (!parsed) return { mode, ready: false };

  const state = await probe(parsed.host, parsed.port, 1500);
  if (state === 'ready') return { mode, ready: true };
  if (state === 'recovering') {
    // A PostgreSQL is already up but starting/recovering: wait for it instead of
    // launching a competing instance against the same data directory/port.
    const ready = await waitForPostgres(env.SUDA_DATABASE_URL, 30_000, probe);
    return { mode, ready };
  }
  // 'unavailable': nothing healthy at the target → start the supported instance.
  if (platform === 'win32') {
    try { start(root, env); }
    catch { return { mode, ready: false, startFailed: true }; }
  }
  const ready = await waitForPostgres(env.SUDA_DATABASE_URL, 30_000, probe);
  return { mode, ready };
}

// ---------------------------------------------------------------------------
// Launch orchestration
// ---------------------------------------------------------------------------

function windowsListeners(ports) {
  // Only numeric ports enter this fixed PowerShell query; command lines stay data.
  const safePorts = ports.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  if (!safePorts.length) return [];
  const query = `$ErrorActionPreference='Stop'; $ports=@(${safePorts.join(',')}); @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in $ports } | ForEach-Object { $p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$_.OwningProcess); [pscustomobject]@{pid=$p.ProcessId;commandLine=$p.CommandLine;createdAt=$p.CreationDate.ToUniversalTime().ToString('o')} }) | ConvertTo-Json -Compress`;
  try {
    const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000,
    });
    const parsed = JSON.parse(result || '[]');
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return []; }
}

// Per-checkout launcher lock (file under <root>/logs). Returns { running: true }
// when another live launcher owns it; otherwise acquires it and returns
// { running: false }. Release happens on process exit.
function defaultLock(root, token = randomUUID()) {
  const lockPath = path.join(root, 'logs', 'dev-local.lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const acquire = () => fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
  try { acquire(); }
  catch (cause) {
    if (cause.code !== 'EEXIST') throw cause;
    const lock = readJson(lockPath, null);
    let alive = true;
    if (Number.isInteger(lock?.pid) && lock.pid > 0) {
      try { process.kill(lock.pid, 0); }
      catch (error) { alive = error.code !== 'ESRCH'; }
    }
    if (alive) return { running: true };
    fs.unlinkSync(lockPath);
    acquire();
  }
  const release = () => { if (readJson(lockPath, null)?.token === token) fs.unlinkSync(lockPath); };
  process.once('exit', release);
  return { running: false };
}

// Short-lived mutual exclusion around database recovery/start. Unlike the
// process-lifetime launcher lock, this is released as soon as the DB gate
// finishes, so a later `dev:local` (even while the launcher+web are still
// alive) can re-enter DB recovery. A stale lock from a dead pid is stolen;
// a live holder is waited on. The default wait covers the whole gate window
// (start-db.ps1 timeout of 180s plus the 30s readiness wait), so a slow
// recovery is waited out instead of failing early or racing a second pg_ctl.
// On timeout we FAIL explicitly rather than proceeding without the mutex.
async function acquireDbMutex(root, { token = randomUUID(), timeoutMs = 240_000, pollMs = 200 } = {}) {
  const lockPath = path.join(root, 'logs', 'dev-local-db.lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
      const release = () => {
        try { if (readJson(lockPath, null)?.token === token) fs.unlinkSync(lockPath); } catch { /* already gone */ }
      };
      process.once('exit', release); // safety net if the process dies mid-gate
      return release;
    } catch (cause) {
      if (cause.code !== 'EEXIST') throw cause;
      const lock = readJson(lockPath, null);
      let alive = true;
      if (Number.isInteger(lock?.pid) && lock.pid > 0) {
        try { process.kill(lock.pid, 0); }
        catch (error) { alive = error.code !== 'ESRCH'; }
      }
      if (!alive) {
        try { fs.unlinkSync(lockPath); } catch { /* raced */ }
        continue;
      }
      if (Date.now() >= deadline) {
        // Never proceed without the mutex: doing so could run two pg_ctl
        // against the same data directory. Fail explicitly instead.
        throw new Error('Timed out waiting for another dev:local database recovery. Retry once it completes; no second PostgreSQL instance was started.');
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

// Pure orchestration: decide reuse vs fresh start, gate the database dependency,
// and return a code (plus the spawned child when fresh). Side effects are
// injectable so the full path is unit-testable.
async function runGuard({
  root, env, platform = process.platform,
  checkPorts = occupiedLoopbackPorts,
  listListeners = windowsListeners,
  recordsFile = null,
  ensureDb = ensureLocalDatabase,
  lock = defaultLock,
  dbMutex = acquireDbMutex,
  spawnChild = () => { throw new Error('spawnChild not provided'); },
  stdout = (message) => process.stdout.write(message),
  stderr = (message) => process.stderr.write(message),
} = {}) {
  const ports = [Number(env.CLIENT_DEV_PORT) || 8080, Number(env.SERVER_PORT) || 3000];
  const occupied = await checkPorts(ports);

  let ownListening = false;
  if (occupied.length) {
    const records = recordsFile ? readJson(recordsFile, []) : [];
    const listeners = platform === 'win32' ? listListeners(occupied) : [];
    ownListening = listeners.some((listener) => isProjectListener(listener, root, records));
    if (!ownListening) {
      stderr(`[dev-local] Port(s) ${occupied.join(', ')} are already occupied. No service was started or stopped; choose unused local ports or reuse the existing service.\n`);
      return { code: 1 };
    }
  }

  // Database dependency gate — runs for BOTH reusing an existing stack and a
  // fresh spawn: the web services may already be up while PostgreSQL is down.
  // Serialized by a SHORT-LIVED mutex released immediately after the gate, so
  // two concurrent `dev:local` runs cannot both probe-fail and run pg_ctl,
  // while a later run can still re-enter recovery even if launcher+web are
  // already alive (the process-lifetime launcher lock is NOT consulted here).
  let releaseDb;
  try {
    releaseDb = await dbMutex(root);
  } catch (error) {
    stderr(`[dev-local] ${error.message}\n`);
    return { code: 1 };
  }
  let db;
  try {
    db = await ensureDb({ env, root, platform });
  } finally {
    releaseDb();
  }
  if (!db.ready) {
    const target = safeDatabaseTarget(env.SUDA_DATABASE_URL) || 'unknown';
    if (db.startFailed) {
      stderr('[dev-local] Could not start the local PostgreSQL server. Check that PostgreSQL is installed and PG_BIN/PGDATA resolve (see scripts\\db\\start-db.ps1), or point SUDA_DATABASE_URL at a remote database.\n');
    } else {
      stderr(`[dev-local] Local database at ${target} is not ready. Start it with scripts\\db\\start-db.ps1 or point SUDA_DATABASE_URL at a remote database.\n`);
    }
    return { code: 1 };
  }

  if (ownListening) {
    stdout(`[dev-local] This checkout already has a dev service on port(s) ${occupied.join(', ')}. Reuse http://localhost:${ports[0]}${env.CLIENT_BASE_PATH || '/'}; no second stack was started.\n`);
    return { code: 0 };
  }

  // Fresh spawn only: the process-lifetime launcher lock prevents a duplicate
  // stack. It is never consulted on the reuse path above, so an already-running
  // launcher+web cannot block database recovery.
  const lockResult = await lock(root);
  if (lockResult.running) {
    stderr('[dev-local] A launcher for this checkout is already running. Wait for it or reuse its browser URL.\n');
    return { code: 1 };
  }

  const child = spawnChild(env);
  return { code: 0, child };
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const parsed = {};
  for (const file of ['.env', '.env.local']) {
    try { Object.assign(parsed, dotenv.parse(fs.readFileSync(path.join(root, file)))); }
    catch { /* Optional files are handled by the vendor launcher too. */ }
  }
  const env = localEnvironment({ ...parsed, ...process.env });
  const result = await runGuard({
    root, env,
    recordsFile: path.join(root, 'logs', 'runtime-processes.json'),
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
    spawnChild: (childEnv) => spawn(process.execPath, [path.join(root, 'scripts', 'dev-local.js')], {
      cwd: root, env: childEnv, stdio: 'inherit', windowsHide: true,
    }),
  });
  const child = result.child;
  if (child) {
    child.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
    child.once('exit', (code) => { process.exitCode = code ?? 1; });
  } else {
    process.exitCode = result.code;
  }
}

module.exports = {
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
  defaultLock,
  runGuard,
};
if (require.main === module) void main().catch((error) => {
  process.stderr.write(`[dev-local] ${error.message}\n`);
  process.exitCode = 1;
});

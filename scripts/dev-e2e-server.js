#!/usr/bin/env node
/**
 * dev-e2e-server.js — deterministic Nest backend for the fullstack E2E suite.
 *
 * The regular `npm run dev:local` runs the *real* Python coding agent, whose
 * `dev run` calls an LLM (slow, non-deterministic, spends tokens). The dev
 * console end-to-end tests instead drive a deterministic fake agent that
 * implements the same CLI/work-product contract.
 *
 * This script:
 *   1. Loads .env.local / .env (DB URL, local dev identity) via dotenv.
 *   2. Points AGENT_DEV_BIN at the current node executable and AGENT_DEV_BIN_ARGS
 *      at e2e/fixtures/fake-agent.cjs, so spawned children run the fake agent.
 *   3. Uses a throwaway tasks directory (cleaned on every boot).
 *   4. Starts `nest start` on SERVER_PORT (3000) with CSRF disabled.
 *
 * It deliberately skips env pull and skills sync (offline, reproducible).
 * Playwright starts it as a webServer; the Vite dev server (which proxies /api
 * and HTML to this backend) is the other webServer.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
process.chdir(root);

// 1. Load local env the same way dev-local does (.env.local then .env).
const dotenv = require('dotenv');
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, '.env') });

// 2. Deterministic coding-agent driver.
const tasksDir = path.join(os.tmpdir(), 'stock-agent-e2e-tasks');
fs.rmSync(tasksDir, { recursive: true, force: true });
fs.mkdirSync(tasksDir, { recursive: true });

process.env.NODE_ENV = 'development';
// Match scripts/dev-local.js: fullstack mode (MIAODA_APP_TYPE=3) makes the
// preset mount the /api + HTML proxy and the Nest view pipeline behave as in
// local dev. Without it Vite serves /dev itself and returns 404.
if (!process.env.MIAODA_APP_TYPE) process.env.MIAODA_APP_TYPE = '3';
process.env.MIAODA_LOCAL_DEV = '1';
process.env.SERVER_PORT = process.env.SERVER_PORT || '3000';
process.env.DISABLE_CSRF = 'true';
process.env.AGENT_DEV_ENABLED = 'true';
process.env.AGENT_DEV_BIN = process.execPath;
process.env.AGENT_DEV_BIN_ARGS = JSON.stringify([
  path.join(root, 'e2e', 'fixtures', 'fake-agent.cjs'),
]);
process.env.AGENT_DEV_TASKS_DIR = tasksDir;
process.env.AGENT_DEV_WORKDIR = root;

process.stderr.write(
  `[dev-e2e] fake-agent node=${process.execPath}\n[dev-e2e] tasksDir=${tasksDir}\n`,
);

const isWin = process.platform === 'win32';

// 3a. Compile the server once (npx needs a shell on Windows; this is a
//      synchronous, short-lived build so it leaves nothing behind).
process.stderr.write('[dev-e2e] building server (nest build)...\n');
const build = spawnSync('npx', ['nest', 'build'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

// 3b. Run the compiled server directly with the current node executable.
//      Avoid `npx nest start` + shell:true: that creates a cmd -> npx -> node
//      chain whose leaf node keeps port 3000 after Playwright stops the
//      webServer. A single direct child is torn down cleanly.
const serverEntry = path.join(root, 'dist', 'server', 'main');
const child = spawn(process.execPath, ['--enable-source-maps', serverEntry], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
  shell: false,
});

// On Windows, spawning through `npx` (shell:true) creates a cmd -> npx -> node
// tree. Killing only the immediate child leaves the compiled server running and
// holding port 3000, so tear down the whole tree with taskkill /T.
const killTree = () => {
  if (child.pid === undefined || child.killed) return;
  try {
    if (isWin) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
};

const shutdown = () => {
  killTree();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', killTree);
child.on('exit', (code) => process.exit(code ?? 0));

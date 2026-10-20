/**
 * @file playwright.fullstack.config.ts
 * @description Fullstack Playwright config for the local coding-agent console.
 *
 * Isolation matters here: a developer often already has the normal dev stack
 * running (Nest on 3000, Vite on 8080) and that backend uses the *real* Python
 * agent. To avoid colliding with it — and to avoid "EADDRINUSE followed by the
 * tests silently hitting the real backend" — this suite uses dedicated ports:
 *   - NestJS backend on :3099, started via scripts/dev-e2e-server.js. It loads
 *     .env.local for the database/local identity, but swaps the coding agent
 *     for the deterministic fake agent (e2e/fixtures/fake-agent.cjs) so a
 *     "run" never calls an LLM.
 *   - Vite dev server on :8090, with SERVER_PORT=3099 so the preset proxies
 *     /api and HTML to the test backend rather than the developer's.
 *
 * The browser opens the SPA route `/dev`; the Vite HTML proxy forwards it to
 * Nest, which renders the page and the React router mounts DevTasksPage.
 *
 * Run with: npm run test:e2e:fullstack
 */
import { defineConfig, devices } from '@playwright/test';

const NEST_PORT = '3099';
const VITE_PORT = '8090';
const NEST_ORIGIN = `http://localhost:${NEST_PORT}`;
const VITE_ORIGIN = `http://localhost:${VITE_PORT}`;

// Both servers must proxy/serve against the isolated backend port.
// MIAODA_APP_TYPE=3 enables the preset's fullstack proxy + view pipeline;
// MIAODA_LOCAL_DEV=1 mirrors scripts/dev-local.js for local identity/csrf.
const testEnv = {
  ...process.env,
  SERVER_PORT: NEST_PORT,
  MIAODA_APP_TYPE: '3',
  MIAODA_LOCAL_DEV: '1',
};

export default defineConfig({
  testDir: './e2e/fullstack',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: VITE_ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Deterministic backend with the fake agent; fresh on every run.
      command: 'node scripts/dev-e2e-server.js',
      env: testEnv,
      url: `${NEST_ORIGIN}/api/dev/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // Dedicated Vite on 8090, proxying to the test backend on 3099.
      command: `npx vite --config vite.config.ts --port ${VITE_PORT} --strictPort`,
      env: testEnv,
      url: `${VITE_ORIGIN}/client/index.html`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});

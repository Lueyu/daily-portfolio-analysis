/**
 * @file playwright.config.ts
 * @description Playwright end-to-end configuration.
 *
 * Vite runs with the repo root as its root, so the frontend HTML entry is
 * physically served at /client/index.html (dev server on port 8080).
 *
 * Scope of the webServer here: Vite only. The app is a fullstack project
 * whose dev homepage `/` is proxied to the NestJS server (which renders the
 * page and requires a database). The C0 smoke test therefore only verifies
 * that the frontend bundle compiles and React mounts, using the physical
 * entry /client/index.html. Business-flow E2E that needs the full
 * server+client+database stack (via `node scripts/dev-local.js`) is added in
 * C1 as a separate project.
 *
 * `webServer.command` invokes Vite directly instead of `npm run dev:client`,
 * because that script uses the Unix-style `NODE_ENV=development vite` prefix,
 * which is not valid under Windows cmd. `vite` defaults to development mode.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = '8080';
const ORIGIN = `http://localhost:${PORT}`;
// Physical HTML entry Vite serves directly without the NestJS proxy.
const ENTRY_URL = `${ORIGIN}/client/index.html`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --config vite.config.ts',
    url: ENTRY_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

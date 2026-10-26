/** Runtime UI fixture tests reuse the existing local stack; they never start a second Vite. */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/fullstack',
  testMatch: 'runtime-panel.spec.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: 'output/playwright/runtime-results',
  use: {
    baseURL: process.env.RUNTIME_UI_BASE_URL || 'http://127.0.0.1:8080',
    // Trace HTML resources trigger this workspace's Vite watcher; keep screenshots as evidence.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

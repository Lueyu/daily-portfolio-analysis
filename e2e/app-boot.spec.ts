import { expect, test } from '@playwright/test';

/**
 * Frontend bundle smoke test (Vite only, no backend required).
 *
 * Opens the physical dev entry /client/index.html and verifies that:
 *   1. the JS bundle loads and the page does not hard-crash;
 *   2. React actually mounts real DOM into #root (not a white screen).
 *
 * Note: with Vite alone the SPA router has no matching route for this path,
 * so it renders the app's NotFound screen. That is fine here — the screen is
 * still produced by the fully mounted React/provider stack (toolkit shell,
 * router, error boundary, UI components), which is what this smoke test
 * guards. Business flows (login, holdings, ratings) need the full
 * server+client+database stack and are covered by a separate project from C1.
 *
 * The page title is intentionally not asserted: in dev the platform leaves
 * the literal `{{appName}}` placeholder (replaced at deploy time).
 */
test('frontend bundle compiles and React mounts', async ({ page }) => {
  await page.goto('/client/index.html');

  const root = page.locator('#root');
  await expect(root).toBeAttached();

  // A mounted React tree renders substantial DOM; an empty/tiny #root means
  // the bundle failed to boot or the error boundary wiped the screen.
  await expect
    .poll(async () => root.evaluate((el) => el.innerHTML.trim().length), {
      timeout: 30_000,
    })
    .toBeGreaterThan(100);

  // The toolkit error boundary's fatal fallback must not be showing.
  await expect(page.getByText('页面出错了')).toHaveCount(0);
});

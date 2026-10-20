/**
 * Full-stack E2E for the local coding-agent console.
 *
 * The backend (started by playwright.fullstack.config.ts) runs the
 * deterministic fake agent instead of the real Python/LLM agent, so these
 * tests assert the complete human-in-the-loop loop without model calls:
 *
 *   create -> run -> awaiting_approval -> inspect patch -> approve -> verified
 *   create -> run -> awaiting_approval -> reject (reason)    -> blocked
 *
 * Requests go through the Vite dev server (8080) and are proxied to Nest
 * (3000), exercising the same path as a developer using the console.
 */
import { test, expect, type Page } from '@playwright/test';

/** Open the console, fill the new-task modal, and land on the detail view. */
async function createTask(page: Page, title: string): Promise<void> {
  await page.goto('/dev');
  await expect(page.getByRole('heading', { name: '开发控制台' })).toBeVisible();

  await page.getByRole('button', { name: '新建开发任务' }).click();
  await expect(page.getByRole('dialog', { name: '新建开发任务' })).toBeVisible();

  await page.getByLabel('标题').fill(title);
  await page.getByLabel('问题描述').fill('评级被硬性风控改成 Hold，但保存的操作建议仍然是买入，二者矛盾。');
  // The acceptance check kind defaults to "unit"; only the description is
  // required for a deterministic run.
  await page.getByPlaceholder(/怎样算通过/).fill('评级为 Hold 时，操作建议不能是买入。');

  await page.getByRole('button', { name: '创建任务' }).click();
  // Creating a task opens its detail view directly.
  await expect(page.getByRole('button', { name: '开始运行' })).toBeVisible();
}

test('approve path: create → run → review patch → approve → verified', async ({ page }) => {
  test.setTimeout(90_000);
  await createTask(page, 'E2E 批准闭环');

  await page.getByRole('button', { name: '开始运行' }).click();
  // The fake agent reproduces, diagnoses and patches almost immediately; the
  // detail view polls every 1.5s and should arrive at the approval gate.
  await expect(page.getByText('待审批', { exact: true })).toBeVisible({ timeout: 30_000 });

  // Inspect the generated diff before approving. The file name also appears in
  // the diff body (--- a/ +++ b/), so assert on the exact path Badge to avoid
  // matching multiple elements (strict-mode violation).
  await page.getByRole('tab', { name: /补丁/ }).click();
  await expect(
    page.getByText('server/modules/multi-agent/pipeline.service.ts', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: '批准并继续验证' }).click();
  await page.getByRole('button', { name: '确认批准' }).click();

  await expect(page.getByText('已验证', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/任务已结束/)).toBeVisible();
});

test('reject path: create → run → reject with reason → blocked', async ({ page }) => {
  test.setTimeout(90_000);
  await createTask(page, 'E2E 拒绝闭环');

  await page.getByRole('button', { name: '开始运行' }).click();
  await expect(page.getByText('待审批', { exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '拒绝补丁' }).click();
  await expect(page.getByRole('dialog', { name: '拒绝补丁' })).toBeVisible();
  await page.getByPlaceholder(/这个改动绕过/).fill('改动与本次问题无关，也缺少边界条件处理。');
  // The confirm button stays disabled until a reason is provided.
  await page.getByRole('button', { name: '确认拒绝' }).click();

  await expect(page.getByText('已阻断', { exact: true })).toBeVisible({ timeout: 30_000 });
});

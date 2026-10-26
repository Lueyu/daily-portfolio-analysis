/** Deterministic browser acceptance of the coding-agent conversation. */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const PROBLEM: string = '评级被硬性风控改成 Hold，但保存的操作建议仍然是买入，二者矛盾。';

test('sandbox tsconfig creation and cleanup do not reload the conversation', async ({ page }) => {
  const probeRoot = path.resolve(process.cwd(), 'agent', 'data', 'watch-probe-' + randomUUID());
  const dataRoot = path.resolve(process.cwd(), 'agent', 'data') + path.sep;
  if (!probeRoot.startsWith(dataRoot)) throw new Error('watch probe must stay inside agent/data');
  const probeFile = path.join(probeRoot, 'tsconfig.json');
  await page.goto('/dev');
  await expect(page.getByRole('textbox', { name: '任务描述', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '任务描述', exact: true }).fill('尚未发送的描述必须保留');
  let navigations = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigations += 1; });
  await mkdir(probeRoot);
  try {
    await writeFile(probeFile, '{}\n', 'utf8');
    await page.waitForResponse((response) => response.url().endsWith('/api/dev/tasks') && response.ok());
    await unlink(probeFile);
    await page.waitForResponse((response) => response.url().endsWith('/api/dev/tasks') && response.ok());
    await expect(page.getByRole('textbox', { name: '任务描述', exact: true })).toHaveValue('尚未发送的描述必须保留');
    expect(navigations).toBe(0);
  } finally {
    await unlink(probeFile).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(probeRoot);
  }
});

function taskDetail(page: Page): Locator {
  return page.getByRole('region', { name: '任务详情', exact: true });
}

async function openDisclosure(parent: Locator, name: RegExp): Promise<Locator> {
  const summary: Locator = parent.locator('summary').filter({ hasText: name });
  const disclosure: Locator = summary.locator('..');
  if (await disclosure.getAttribute('open') === null) await summary.click();
  return disclosure;
}

async function createTask(page: Page, title: string, waitForApproval: boolean = true): Promise<string> {
  await page.goto('/dev');
  await expect(page.getByRole('heading', { name: 'Coding Agent', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  await page.getByRole('textbox', { name: '任务描述', exact: true }).fill(`${title}\n${PROBLEM}`);
  const acceptance: Locator = await openDisclosure(page.locator('main'), /^验收要求$/);
  await acceptance.getByRole('textbox', { name: '验收标准', exact: true }).fill('评级为 Hold 时，操作建议不能是买入。');
  await page.getByRole('button', { name: '发送任务', exact: true }).click();
  await expect(page).toHaveURL(/\?task=dev_[a-z0-9]+$/);
  await expect(taskDetail(page)).toContainText(title);
  await expect(taskDetail(page).getByText(PROBLEM, { exact: false })).toBeVisible();
  if (waitForApproval) await runToApproval(page);
  return new URL(page.url()).searchParams.get('task')!;
}

async function runToApproval(page: Page): Promise<void> {
  const detail: Locator = taskDetail(page);
  await expect(detail.getByText(/候选修改已准备好/)).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByRole('button', { name: '批准并应用' })).toBeEnabled();
}

async function openPatchReview(page: Page): Promise<Locator> {
  return openDisclosure(taskDetail(page), /^查看改动（\d+）$/);
}

async function openExecution(page: Page): Promise<Locator> {
  return openDisclosure(taskDetail(page), /^执行记录（\d+）$/);
}

async function expectNoPageOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('a pending creation locks task navigation and sends only one create request', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const existingTitle: string = 'E2E 创建期间保留已有任务';
  await createTask(page, existingTitle);
  await page.getByRole('button', { name: '新建任务', exact: true }).click();
  let createPosts: number = 0;
  let releaseCreate: () => void = () => undefined;
  const createReleased: Promise<void> = new Promise((resolve) => { releaseCreate = resolve; });
  await page.route('**/api/dev/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    createPosts += 1;
    await createReleased;
    await route.continue();
  });
  const message: Locator = page.getByRole('textbox', { name: '任务描述', exact: true });
  await message.fill('E2E 慢创建只发送一次');
  try {
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await expect.poll(() => createPosts).toBe(1);
    await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '打开任务：' + existingTitle, exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '发送任务', exact: true })).toBeDisabled();
    await page.locator('form').filter({ has: message }).evaluate((element) => (element as HTMLFormElement).requestSubmit());
    expect(createPosts).toBe(1);
    releaseCreate();
    await expect(taskDetail(page)).toContainText('E2E 慢创建只发送一次');
    await expect(page.getByRole('button', { name: '新建任务', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '打开任务：' + existingTitle, exact: true })).toBeEnabled();
    expect(createPosts).toBe(1);
  } finally {
    releaseCreate();
  }
});

test('a creation finishing after global navigation does not replace the new route', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/dev');
  let createdId: string = '';
  let releaseCreate: () => void = () => undefined;
  const createReleased: Promise<void> = new Promise((resolve) => { releaseCreate = resolve; });
  await page.route('**/api/dev/tasks', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    const task: { id: string } = await response.json();
    createdId = task.id;
    await createReleased;
    await route.fulfill({ response });
  });
  await page.getByRole('textbox', { name: '任务描述', exact: true }).fill('E2E 离开后完成创建');
  try {
    await page.getByRole('button', { name: '发送任务', exact: true }).click();
    await expect.poll(() => createdId).toMatch(/^dev_[a-z0-9]+$/);
    await page.getByRole('link', { name: '关注', exact: true }).click();
    await expect(page).toHaveURL(/\/watchlist$/);
    releaseCreate();
    await expect.poll(async () => {
      const response = await page.request.get('/api/dev/tasks/' + createdId);
      const task: { status: string } = await response.json();
      return task.status;
    }).toBe('awaiting_approval');
    await expect(page).toHaveURL(/\/watchlist$/);
  } finally {
    releaseCreate();
  }
});

test('approve path: conversation hides technical records until expanded and lands the reviewed patch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id: string = await createTask(page, 'E2E 批准闭环');
  const detail: Locator = taskDetail(page);
  await expect(detail.getByText(id, { exact: true })).toBeHidden();
  await expect(detail.getByRole('heading', { name: '验收门状态' })).toBeHidden();
  await expect(detail.getByText(/SAVED_OUTPUT_END_MARKER/)).toBeHidden();
  await expect(detail.getByText(/FINAL_PATCH_HYPOTHESIS/)).toBeHidden();
  await expect(detail.getByText(/本进程累计模型调用/).first()).toBeHidden();
  await expect(detail.getByText('react', { exact: true }).first()).toBeHidden();
  await expect(detail.getByRole('region', { name: '补丁差异' })).toBeHidden();
  await page.screenshot({ path: test.info().outputPath('conversation-desktop.png'), fullPage: true });

  const metadata: Locator = await openDisclosure(detail, /^任务详情与验收$/);
  await expect(metadata.getByRole('heading', { name: '验收门状态' })).toBeVisible();
  await expect(metadata.getByText('已复现失败', { exact: true })).toBeVisible();
  await expect(metadata.getByText('已通过', { exact: true })).toBeVisible();
  await expect(metadata.getByText('验收通过，待人工审批', { exact: true })).toBeVisible();

  const execution: Locator = await openExecution(page);
  await expect(execution.getByText(/SAVED_OUTPUT_END_MARKER/)).toBeHidden();
  await expect(execution.getByText(/本进程累计模型调用/).first()).toBeHidden();
  await execution.locator('summary').filter({ hasText: /^读取文件/ }).first().click();
  await expect(execution.getByText("action still reads the model's original Buy", { exact: true })).toBeVisible();
  await execution.locator('summary').filter({ hasText: /^运行检查$/ }).first().click();
  await expect(execution.getByText(/SAVED_OUTPUT_END_MARKER/)).toBeVisible();
  await expect(execution.getByText(/saved check line 80:/)).toBeVisible();
  const review: Locator = await openPatchReview(page);
  await expect(review.getByText('server/modules/multi-agent/pipeline.service.ts', { exact: true })).toBeVisible();
  await expect(review).toContainText('FINAL_PATCH_HYPOTHESIS');
  await expect(review).toContainText('actionForRating(finalRating)');
  await expect(page.getByRole('region', { name: '开发任务列表' })
    .getByRole('button', { name: '打开任务：E2E 批准闭环', exact: true })).toContainText('待审批');
  await review.getByRole('region', { name: '补丁差异' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('conversation-desktop-diff.png'), fullPage: true });

  await detail.getByRole('button', { name: '批准并应用' }).click();
  const confirmation: Locator = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('单元测试');
  await expect(confirmation).not.toContainText('全部验收');
  await confirmation.getByRole('button', { name: '确认批准' }).click();
  await expect(detail.getByText(/修改已应用到主工作区，落地检查已通过/)).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByText(/候选修改已准备好/)).toBeHidden();
  await expect(detail.getByRole('button', { name: '批准并应用' })).toHaveCount(0);
  const landed: Locator = await openExecution(page);
  await landed.locator('summary').last().click();
  await expect(landed.getByText('landing', { exact: true })).toBeVisible();
});

test('reject path: a required reason is saved and a rejected task cannot resume', async ({ page }) => {
  await createTask(page, 'E2E 拒绝闭环');
  const detail: Locator = taskDetail(page);
  await detail.getByRole('button', { name: '拒绝补丁' }).click();
  const dialog: Locator = page.getByRole('dialog', { name: '拒绝补丁' });
  await expect(dialog.getByRole('button', { name: '确认拒绝' })).toBeDisabled();
  const reason: string = '改动与本次问题无关，也缺少边界条件处理。';
  await dialog.getByPlaceholder(/这个改动绕过/).fill(reason);
  await dialog.getByRole('button', { name: '确认拒绝' }).click();
  await expect(detail.getByText(/任务已停止，需要处理阻断原因/)).toBeVisible();
  await expect(detail.getByRole('button', { name: /开始运行|继续运行|批准并应用/ })).toHaveCount(0);
  const execution: Locator = await openExecution(page);
  await execution.locator('summary').last().click();
  await expect(execution.getByText('reason: ' + reason, { exact: true })).toBeVisible();
  await expect(execution.getByText('approval', { exact: true })).toBeVisible();
});

test('legacy artifacts keep missing gate fields and unknown phases available on demand', async ({ page }) => {
  const id: string = await createTask(page, 'E2E legacy 兼容工件', false);
  await page.route('**/api/dev/tasks/' + id, async (route) => {
    const response = await route.fetch();
    const body: Record<string, unknown> = await response.json();
    delete body.execution;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const detail: Locator = taskDetail(page);
  await expect(detail.getByRole('button', { name: '继续运行' })).toBeVisible();
  await expect(detail.getByText(/当前没有在执行/)).toBeVisible();
  await expect(detail.getByText('UNKNOWN_PHASE_OBSERVATION', { exact: true })).toBeHidden();
  const metadata: Locator = await openDisclosure(detail, /^任务详情与验收$/);
  await expect(metadata.getByText('未记录', { exact: true })).toHaveCount(2);
  const execution: Locator = await openExecution(page);
  await expect(execution.getByText('future_phase_v2', { exact: true })).toBeHidden();
  await execution.locator('summary').last().click();
  await expect(execution.locator('code').filter({ hasText: /^future_phase_v2$/ })).toBeVisible();
  await expect(execution.locator('code').filter({ hasText: /^future_tool_v2$/ })).toBeVisible();
  await expect(execution.getByText('UNKNOWN_PHASE_OBSERVATION', { exact: true })).toBeVisible();
});

test('historical patches retain their hypotheses and a failed fetch clears the old diff', async ({ page }) => {
  const id: string = await createTask(page, 'E2E history 历史补丁');
  const review: Locator = await openPatchReview(page);
  await expect(review).toContainText('FINAL_PATCH_HYPOTHESIS');
  await expect(review).toContainText('actionForRating(finalRating)');
  let failOldPatch: boolean = true;
  await page.route('**/api/dev/tasks/' + id + '/patches/0001', async (route) => {
    if (!failOldPatch) return route.continue();
    await route.fulfill({ status: 503, json: { error: { message: 'E2E 补丁读取失败' } } });
  });
  await review.getByRole('combobox', { name: '选择补丁' }).click();
  await page.getByRole('option', { name: '0001', exact: true }).click();
  await expect(review).toContainText('E2E 补丁读取失败');
  await expect(review).not.toContainText('actionForRating(finalRating)');
  await expect(review).not.toContainText('FINAL_PATCH_HYPOTHESIS');
  failOldPatch = false;
  await review.getByRole('button', { name: '重试加载补丁' }).click();
  await expect(review).toContainText('FIRST_PATCH_HYPOTHESIS');
  await expect(review).toContainText('actionForInitialRating(rating)');
  await expect(review).not.toContainText('FINAL_PATCH_HYPOTHESIS');
});

test('task switching, search, folded status filter and reload preserve selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const firstTitle: string = 'E2E 切换任务 A';
  const secondTitle: string = 'E2E budget 切换任务 B';
  await createTask(page, firstTitle);
  const secondId: string = await createTask(page, secondTitle, false);
  const list: Locator = page.getByRole('region', { name: '开发任务列表' });
  const detail: Locator = taskDetail(page);
  await expect(detail.getByText(/上次执行被旧的次数或时间限制中断/)).toBeVisible();
  await list.getByRole('button', { name: '打开任务：' + firstTitle, exact: true }).click();
  await expect(detail).toContainText(firstTitle);
  const review: Locator = await openPatchReview(page);
  await expect(review).toContainText('actionForRating(finalRating)');
  await list.getByRole('button', { name: '打开任务：' + secondTitle, exact: true }).click();
  await expect(detail).toContainText(secondTitle);
  await expect(detail.getByText(/actionForRating\(finalRating\)/)).toBeHidden();
  await expect(detail.getByRole('button', { name: '继续运行' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp('task=' + secondId + '$'));
  await expect(detail).toContainText(secondTitle);
  await list.getByRole('textbox', { name: '搜索任务' }).fill('切换任务');
  await expect(list.getByRole('combobox', { name: '筛选任务状态' })).toBeHidden();
  await openDisclosure(list, /^筛选任务$/);
  await list.getByRole('combobox', { name: '筛选任务状态' }).click();
  await page.getByRole('option', { name: '待审批', exact: true }).click();
  await expect(list.getByRole('button', { name: '打开任务：' + firstTitle, exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: '打开任务：' + secondTitle, exact: true })).toHaveCount(0);
});

test('initial detail request failure can be retried from a deep link', async ({ page }) => {
  const title: string = 'E2E 详情重试';
  const id: string = await createTask(page, title);
  let failDetail: boolean = true;
  await page.route('**/api/dev/tasks/' + id, async (route) => {
    if (!failDetail) return route.continue();
    await route.fulfill({ status: 503, json: { error: { message: 'E2E 首次详情加载失败' } } });
  });
  await page.reload();
  await expect(page.getByText('E2E 首次详情加载失败', { exact: false })).toBeVisible();
  const retry: Locator = page.getByRole('button', { name: '重试加载任务' });
  await expect(retry).toBeVisible();
  failDetail = false;
  await retry.click();
  await expect(taskDetail(page)).toContainText(title);
  await expect(page.getByText('E2E 首次详情加载失败', { exact: false })).toHaveCount(0);
});

test('budget-stopped tasks resume explicitly and preserve the old stop record', async ({ page }) => {
  await createTask(page, 'E2E budget 恢复旧任务', false);
  const detail: Locator = taskDetail(page);
  await expect(detail.getByText(/上次执行被旧的次数或时间限制中断/)).toBeVisible();
  await detail.getByRole('button', { name: '继续运行' }).click();
  await runToApproval(page);
  const execution: Locator = await openExecution(page);
  await execution.locator('summary').filter({ hasText: /^任务停止$/ }).click();
  await expect(execution.getByText('iteration budget reached', { exact: true })).toBeVisible();
  await execution.locator('summary').filter({ hasText: /^恢复任务$/ }).click();
  await expect(execution.getByText('resumed automatic budget stop', { exact: true })).toBeVisible();
});

test('a running task can be stopped without erasing saved progress', async ({ page }) => {
  const id: string = await createTask(page, 'E2E hold 手动停止', false);
  const detail: Locator = taskDetail(page);
  await expect(detail.getByText(/正在处理任务/)).toBeVisible();
  const stop: Locator = detail.getByRole('button', { name: '停止运行', exact: true });
  await expect(stop).toBeEnabled();
  await expect.poll(async () => {
    const response = await page.request.get('/api/dev/tasks/' + id);
    const body: { iterations: unknown[] } = await response.json();
    return body.iterations.length;
  }).toBeGreaterThan(0);
  await stop.click();
  await expect(detail.getByText(/已停止运行，已有记录已保留/)).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByRole('button', { name: '停止运行', exact: true })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: '继续运行' })).toBeEnabled();
  const execution: Locator = await openExecution(page);
  await execution.locator('summary').filter({ hasText: /^读取文件/ }).click();
  await expect(execution.getByText('HOLD_PROGRESS_PRESERVED', { exact: true })).toBeVisible();
});

test('accepted resume stays locked while detail polling remains serial', async ({ page }) => {
  const id: string = await createTask(page, 'E2E budget 慢详情动作锁', false);
  const detail: Locator = taskDetail(page);
  await expect(detail.getByText(/上次执行被旧的次数或时间限制中断/)).toBeVisible();
  let accepted: boolean = false;
  let postCount: number = 0;
  let heldRequests: number = 0;
  let inFlight: number = 0;
  let maxInFlight: number = 0;
  let releaseDetail: () => void = () => undefined;
  const detailReleased: Promise<void> = new Promise<void>((resolve) => { releaseDetail = resolve; });
  await page.route('**/api/dev/tasks/' + id + '/run', async (route) => {
    postCount += 1;
    const response = await route.fetch();
    accepted = true;
    await route.fulfill({ response });
  });
  await page.route('**/api/dev/tasks/' + id, async (route) => {
    if (!accepted) return route.continue();
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const response = await route.fetch();
      heldRequests += 1;
      await detailReleased;
      await route.fulfill({ response });
    } finally {
      inFlight -= 1;
    }
  });
  const resume: Locator = detail.getByRole('button', { name: '继续运行' });
  try {
    await resume.click();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);
    await expect(resume).toBeDisabled();
    await detail.getByRole('button', { name: '刷新记录' }).click();
    await detail.getByRole('button', { name: '刷新记录' }).click();
    await expect(resume).toBeDisabled();
    await resume.evaluate((button: HTMLButtonElement) => button.click());
  } finally {
    releaseDetail();
  }
  await runToApproval(page);
  expect(postCount).toBe(1);
  expect(maxInFlight).toBe(1);
});

for (const theme of ['light', 'dark'] as const) {
  test(`highlighted status-filter text has readable contrast in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((value: string) => localStorage.setItem('pt-theme', value), theme);
    await page.goto('/dev');
    const list: Locator = page.getByRole('region', { name: '开发任务列表' });
    await openDisclosure(list, /^筛选任务$/);
    await list.getByRole('combobox', { name: '筛选任务状态' }).click();
    const option: Locator = page.getByRole('option', { name: '全部状态', exact: true });
    await expect(option).toBeVisible();
    await option.hover();
    await expect(option).toHaveAttribute('data-highlighted', '');
    const contrast: number = await option.evaluate((element: HTMLElement) => {
      const canvas: HTMLCanvasElement = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context: CanvasRenderingContext2D = canvas.getContext('2d')!;
      const rgba = (color: string): number[] => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      };
      const blend = (front: number[], back: number[]): number[] => front.slice(0, 3)
        .map((value: number, index: number) => value * front[3] / 255 + back[index] * (1 - front[3] / 255));
      const ancestors: Element[] = [];
      for (let current: Element | null = element; current; current = current.parentElement) ancestors.push(current);
      let background: number[] = [255, 255, 255];
      for (const ancestor of ancestors.reverse()) background = blend(rgba(getComputedStyle(ancestor).backgroundColor), background);
      const foreground: number[] = blend(rgba(getComputedStyle(element).color), background);
      const luminance = (color: number[]): number => color.map((channel: number) => {
        const value: number = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum: number, value: number, index: number) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const text: number = luminance(foreground);
      const backdrop: number = luminance(background);
      return (Math.max(text, backdrop) + 0.05) / (Math.min(text, backdrop) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
}

test('375px dark conversation switches between task list and detail without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('pt-theme', 'dark'));
  const title: string = 'E2E 手机暗色布局';
  await createTask(page, title);
  const detail: Locator = taskDetail(page);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expectNoPageOverflow(page);
  await page.screenshot({ path: test.info().outputPath('conversation-mobile-dark.png'), fullPage: true });
  await openPatchReview(page);
  await expect(detail.getByText(/actionForRating\(finalRating\)/)).toBeVisible();
  await expectNoPageOverflow(page);
  const colors = await detail.getByRole('region', { name: '补丁差异' }).evaluate((panel: HTMLElement) => ({
    color: getComputedStyle(panel).color,
    background: getComputedStyle(panel).backgroundColor,
  }));
  const backgroundChannels: number[] = colors.background.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const textChannels: number[] = colors.color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  expect(Math.max(...backgroundChannels)).toBeLessThan(80);
  expect(Math.min(...textChannels)).toBeGreaterThan(150);
  await detail.getByRole('region', { name: '补丁差异' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('conversation-mobile-dark-diff.png'), fullPage: true });
  await detail.getByRole('button', { name: '返回任务列表' }).click();
  const list: Locator = page.getByRole('region', { name: '开发任务列表' });
  await expect(list).toBeVisible();
  await expectNoPageOverflow(page);
  await list.getByRole('button', { name: '打开任务：' + title, exact: true }).click();
  await expect(detail).toContainText(title);
  await expectNoPageOverflow(page);
});

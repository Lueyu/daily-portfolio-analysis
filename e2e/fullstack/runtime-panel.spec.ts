/** Browser regression tests for the runtime UI; all agent endpoints are deterministic fixtures. */
import { test, expect, type Locator, type Page, type Request } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DevAgentChange, DevAgentRuntimeSnapshot, DevAgentToolEvent } from '../../shared/api.interface';
import type { DevTaskDetail } from '../../client/src/pages/Dev/types';

const TASK_A = 'dev_runtime_a';
const TASK_B = 'dev_runtime_b';
const ARTIFACT = 'a'.repeat(32);
const REVISION = 'b'.repeat(64);
const BEFORE = 'c'.repeat(64);
const AFTER_UNDO = 'd'.repeat(64);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2ZrN0AAAAASUVORK5CYII=', 'base64');
const change: DevAgentChange = {
  id: 'e'.repeat(32), before: BEFORE, after: REVISION, status: 'completed',
  reason: '修复保存时的评级和操作建议', tool: 'EditFile', files: ['client/src/save.ts'],
};

function event(index: number, payload: Record<string, unknown> = {}): DevAgentToolEvent {
  return { index, action: 'TerminalPoll', summary: 'fixture output', createdAt: '2026-10-26T01:00:00Z', payload };
}
function task(id: string): DevTaskDetail {
  return {
    id, title: id === TASK_A ? '运行记录示例 A' : '运行记录示例 B', problem: '查看终端和浏览器证据，再审阅每次源码修改。',
    workdir: '/workspace', branch: '', status: 'blocked', red_seen: true, diagnosis_rethink_count: 0,
    created_at: '2026-10-26T01:00:00Z', updated_at: '2026-10-26T01:00:00Z', iterations: [],
    acceptance: [{ id: 'ac-1', check: 'unit', description: '保存后的评级和操作建议一致' }],
    latestPatch: null, patchCount: 0, execution: { state: 'idle', command: null, error: null },
  };
}
interface RuntimeFixture {
  tasks: Record<string, DevTaskDetail>;
  snapshots: Record<string, DevAgentRuntimeSnapshot>;
  cursors: Array<{ taskId: string; cursor: number }>;
  artifactRequests: Request[];
  mutations: Array<{ path: string; body: unknown }>;
  taskReads: number;
  mutationError: string | null;
  holdRuntime: Promise<void> | null;
  png: Buffer;
}

async function installFixture(page: Page): Promise<RuntimeFixture> {
  const fixture: RuntimeFixture = {
    tasks: { [TASK_A]: task(TASK_A), [TASK_B]: task(TASK_B) },
    snapshots: {
      [TASK_A]: { version: 1, revision: REVISION, changes: [change], cursor: 2, pending: null, verification: [], events: [
        event(0, { output: 'TERMINAL_OUTPUT_VISIBLE_AFTER_EXPANSION\n2 passed', status: 'completed', exit_code: 0 }),
        { ...event(1, { artifact_id: ARTIFACT }), action: 'Browser' },
      ] },
      [TASK_B]: { version: 1, revision: BEFORE, changes: [], cursor: 1, pending: null, verification: [],
        events: [event(0, { output: 'ONLY_TASK_B_OUTPUT', status: 'completed', exit_code: 0 })] },
    },
    cursors: [], artifactRequests: [], mutations: [], taskReads: 0, mutationError: null, holdRuntime: null, png: PNG,
  };
  await page.route('**/api/dev/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/health')) {
      return route.fulfill({ json: { enabled: true, binExists: true, tasksDirExists: true, binPath: '/fixture', tasksDir: '/fixture' } });
    }
    if (url.pathname.endsWith('/tasks')) {
      return route.fulfill({ json: Object.values(fixture.tasks).map((record: DevTaskDetail) => ({
        id: record.id, title: record.title, status: record.status, redSeen: true, iterationCount: 0,
        updatedAt: record.updated_at, execution: record.execution,
      })) });
    }
    const taskId: string = url.pathname.split('/tasks/')[1]?.split('/')[0] ?? '';
    if (!fixture.tasks[taskId]) throw new Error(`Unexpected task API: ${url.pathname}`);
    if (url.pathname.endsWith('/runtime')) {
      const cursor: number = Number(url.searchParams.get('cursor'));
      fixture.cursors.push({ taskId, cursor });
      if (fixture.holdRuntime) await fixture.holdRuntime;
      const snapshot: DevAgentRuntimeSnapshot = fixture.snapshots[taskId];
      const selected: DevAgentToolEvent[] = snapshot.events.filter((row: DevAgentToolEvent) => row.index >= cursor).slice(0, 100);
      return route.fulfill({ json: { ...snapshot, events: selected, cursor: selected.at(-1)?.index + 1 || cursor } });
    }
    if (url.pathname.includes('/artifacts/')) {
      expect(url.pathname.split('/artifacts/')[1]).toBe(ARTIFACT);
      fixture.artifactRequests.push(request);
      return route.fulfill({ contentType: 'image/png', body: fixture.png });
    }
    if (request.method() === 'POST') {
      fixture.mutations.push({ path: url.pathname, body: request.postDataJSON() });
      if (fixture.mutationError) return route.fulfill({ status: 409, json: { error: { message: fixture.mutationError } } });
      fixture.snapshots[taskId] = { ...fixture.snapshots[taskId], revision: AFTER_UNDO };
      return route.fulfill({ json: { ok: true } });
    }
    fixture.taskReads += 1;
    return route.fulfill({ json: fixture.tasks[taskId] });
  });
  return fixture;
}

function runtimePanel(page: Page): Locator {
  return page.locator('details').filter({ has: page.locator(':scope > summary').filter({ hasText: '运行与修改记录' }) });
}
async function openRuntime(page: Page): Promise<Locator> {
  const panel: Locator = runtimePanel(page);
  await panel.locator(':scope > summary').click();
  await expect(panel.getByRole('heading', { name: '源码修改' })).toBeVisible();
  return panel;
}
async function screenshot(page: Page, name: string): Promise<void> {
  const directory: string = path.resolve('output/playwright');
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, name), fullPage: true, animations: 'disabled' });
}

test.use({ viewport: { width: 1440, height: 1050 } });

test('v2 conversation accepts steering, shows worker plans and asks approval for exact external actions', async ({ page }) => {
  const fixture = await installFixture(page);
  fixture.tasks[TASK_A].runtime_version = 2;
  fixture.snapshots[TASK_A] = { ...fixture.snapshots[TASK_A], version: 2,
    plan: [{ step: '检查键盘操作', status: 'in_progress' }],
    workers: [{ worker_id: 'dev_child', prompt: '检查回归', status: 'completed', summary: '已通过断言' }],
    approvals: [{ id: ARTIFACT, summary: 'issues / create', arguments: { title: '修复键盘操作' },
      status: 'pending', createdAt: '2026-10-26' }], messages: [], waitingFor: ARTIFACT };
  await page.goto(`/dev?task=${TASK_A}`);
  await expect(page.getByText('外部操作需要你批准', { exact: true })).toBeVisible();
  await expect(page.getByText('检查键盘操作', { exact: true })).not.toBeVisible();
  await page.getByText('计划与并行任务', { exact: true }).click();
  await expect(page.getByText('检查键盘操作', { exact: true })).toBeVisible();
  await expect(page.getByText('已通过断言', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '批准这次操作', exact: true }).click();
  await expect.poll(() => fixture.mutations.some((row) => row.path.endsWith(`/approvals/${ARTIFACT}`)
    && (row.body as { approve: boolean }).approve)).toBe(true);
  await page.getByLabel('补充指示', { exact: true }).fill('保留手机布局');
  await page.getByRole('button', { name: '发送补充指示', exact: true }).click();
  await expect.poll(() => fixture.mutations.some((row) => row.path.endsWith('/messages')
    && (row.body as { text: string }).text === '保留手机布局')).toBe(true);
  await screenshot(page, 'agent-capabilities-session.png');
});

test('runtime details stay collapsed, then load terminal evidence and the authenticated screenshot on demand', async ({ page }) => {
  const fixture: RuntimeFixture = await installFixture(page);
  await page.goto(`/dev?task=${TASK_A}`);
  const panel: Locator = runtimePanel(page);
  await expect(panel.locator(':scope > summary')).toBeVisible();
  expect(await panel.getAttribute('open')).toBeNull();
  expect(fixture.cursors).toEqual([]);
  await openRuntime(page);
  await expect(panel.getByRole('button', { name: '撤销这次修改', exact: true })).toBeEnabled();
  await expect(panel.getByText('TERMINAL_OUTPUT_VISIBLE_AFTER_EXPANSION', { exact: false })).toHaveCount(0);
  expect(fixture.artifactRequests).toHaveLength(0);
  await panel.locator('summary').filter({ hasText: '读取终端输出' }).click();
  await expect(panel.getByLabel('终端或工具输出')).toContainText('TERMINAL_OUTPUT_VISIBLE_AFTER_EXPANSION');
  fixture.png = await page.screenshot();
  await panel.locator('summary').filter({ hasText: '浏览器操作' }).click();
  const image: Locator = panel.getByRole('img', { name: '该次浏览器操作保存的页面截图' });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  expect(fixture.artifactRequests).toHaveLength(1);
  const artifactRequest: Request = fixture.artifactRequests[0];
  const headers: Record<string, string> = await artifactRequest.allHeaders();
  const cookie = (await page.context().cookies()).find((entry) => entry.name === 'suda-csrf-token');
  expect(cookie?.value).toBeTruthy();
  expect(headers['x-suda-csrf-token']).toBe(cookie?.value);
  // Route fulfillment occurs before Chromium's network layer attaches its cookie header.
  // The Axios request must still carry the session's CSRF value, unlike a raw image URL.
  expect(cookie?.domain).toBe('127.0.0.1');
  await screenshot(page, 'runtime-panel-expanded.png');
});

test('undo preserves the revision contract and displays a later-edit conflict', async ({ page }) => {
  const fixture: RuntimeFixture = await installFixture(page);
  fixture.mutationError = 'Undo conflicts with later edits: client/src/save.ts';
  await page.goto(`/dev?task=${TASK_A}`);
  const panel: Locator = await openRuntime(page);
  await panel.getByRole('button', { name: '撤销这次修改', exact: true }).click();
  const dialog: Locator = page.getByRole('dialog');
  await expect(dialog).toContainText('保留之后对其他文件的修改');
  await dialog.getByRole('button', { name: '确认撤销这次修改' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Undo conflicts with later edits');
  expect(fixture.mutations).toEqual([{ path: `/api/dev/tasks/${TASK_A}/changes/undo`, body: {
    changeId: change.id, expectedRevision: REVISION,
  } }]);
  await screenshot(page, 'runtime-panel-undo-conflict.png');
});

test('restore explains removal of later edits, sends the before revision, and refreshes task state', async ({ page }) => {
  const fixture: RuntimeFixture = await installFixture(page);
  await page.goto(`/dev?task=${TASK_A}`);
  const panel: Locator = await openRuntime(page);
  await panel.getByRole('button', { name: '恢复到这次修改前', exact: true }).click();
  const dialog: Locator = page.getByRole('dialog');
  await expect(dialog).toContainText('本次以及之后的源码修改都会被移除');
  await screenshot(page, 'runtime-panel-restore-dialog.png');
  const readsBefore: number = fixture.taskReads;
  await dialog.getByRole('button', { name: '确认恢复整个版本' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(panel.getByRole('status')).toContainText('已恢复到修改前的版本');
  expect(fixture.mutations).toEqual([{ path: `/api/dev/tasks/${TASK_A}/checkpoints/restore`, body: {
    revision: BEFORE, expectedRevision: REVISION,
  } }]);
  await expect.poll(() => fixture.taskReads).toBeGreaterThan(readsBefore);
});

test('switching tasks resets the event cursor and ignores an in-flight response from the old task', async ({ page }) => {
  const fixture: RuntimeFixture = await installFixture(page);
  await page.goto(`/dev?task=${TASK_A}`);
  const firstPanel: Locator = await openRuntime(page);
  await expect(firstPanel.getByRole('button', { name: '撤销这次修改', exact: true })).toBeEnabled();
  let release: () => void = () => undefined;
  fixture.holdRuntime = new Promise<void>((resolve) => { release = resolve; });
  await firstPanel.getByRole('button', { name: '刷新运行记录' }).click();
  await expect.poll(() => fixture.cursors.some((row) => row.taskId === TASK_A && row.cursor === 2)).toBe(true);
  await page.getByRole('button', { name: '打开任务：运行记录示例 B', exact: true }).click();
  await expect(page.getByRole('heading', { name: '运行记录示例 B', exact: true })).toBeVisible();
  const secondPanel: Locator = runtimePanel(page);
  await expect(secondPanel.locator(':scope > summary')).toBeVisible();
  expect(await secondPanel.getAttribute('open')).toBeNull();
  fixture.holdRuntime = null;
  release();
  await openRuntime(page);
  await expect(secondPanel).toContainText('暂无源码修改记录');
  await secondPanel.locator('summary').filter({ hasText: '读取终端输出' }).click();
  await expect(secondPanel.getByLabel('终端或工具输出')).toContainText('ONLY_TASK_B_OUTPUT');
  await expect(secondPanel).not.toContainText('TERMINAL_OUTPUT_VISIBLE_AFTER_EXPANSION');
  expect(fixture.cursors.find((row) => row.taskId === TASK_B)?.cursor).toBe(0);
});

test('incremental event pages remain bounded and active work disables source mutations', async ({ page }) => {
  const fixture: RuntimeFixture = await installFixture(page);
  fixture.snapshots[TASK_A].events = Array.from({ length: 202 }, (_, index: number) => event(index, { output: `OUTPUT_${index}` }));
  fixture.snapshots[TASK_A].pending = { session_id: 'active' };
  fixture.tasks[TASK_A].execution = { state: 'running', command: 'run', error: null };
  await page.goto(`/dev?task=${TASK_A}`);
  const panel: Locator = await openRuntime(page);
  await expect(panel).toContainText('当前显示最近 200 条记录');
  expect(fixture.cursors.slice(0, 3).map((row) => row.cursor)).toEqual([0, 100, 200]);
  await expect(panel.getByRole('button', { name: '撤销这次修改', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '恢复到这次修改前', exact: true })).toBeDisabled();
  const entries: Locator = panel.locator('summary').filter({ hasText: '读取终端输出' });
  await expect(entries).toHaveCount(200);
  await entries.first().click();
  await expect(panel.getByLabel('终端或工具输出')).toHaveText('OUTPUT_2');
  expect(fixture.mutations).toHaveLength(0);
});

test('v2 acceptance and approval describe isolated validation without a mandatory failing-test gate', async ({ page }) => {
  const fixture: RuntimeFixture = await installFixture(page);
  fixture.tasks[TASK_A] = {
    ...fixture.tasks[TASK_A], runtime_version: 2, status: 'awaiting_approval', verify_state: 'passed',
    sandbox_dirty: true, patchCount: 1,
  };
  await page.goto(`/dev?task=${TASK_A}`);
  await page.locator('summary').filter({ hasText: '任务详情与验收' }).click();
  const detail: Locator = page.getByRole('region', { name: '任务详情', exact: true });
  await expect(detail.getByText('失败复现证据', { exact: true })).toHaveCount(0);
  await expect(detail.getByText('目标与回归验证', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '批准并应用', exact: true }).click();
  const dialog: Locator = page.getByRole('alertdialog');
  await expect(dialog).toContainText('隔离副本');
  await expect(dialog).not.toContainText('重新运行单元测试');
  await screenshot(page, 'runtime-v2-approval-dialog.png');
});

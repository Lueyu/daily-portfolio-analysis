/** Browser checks of the operator UI; service responses are isolated from real tasks and secrets. */
import { expect, test, type Page } from '@playwright/test';
import type { DevAgentRuntimeSnapshot, DevAgentSettings, DevAgentSettingsInput } from '../shared/api.interface';

const settings: DevAgentSettings = {
  ok: true, settingsPath: 'C:/operator/settings.json', applyMode: 'next_run',
  models: {
    primary: { model: 'test-coder', baseUrl: 'https://models.example/v1', apiKeyConfigured: true,
      supportsImages: false, contextWindow: 128000, maxOutputTokens: 8192 },
    vision: { model: 'test-vision', baseUrl: 'https://models.example/v1', apiKeyConfigured: false,
      supportsImages: true, contextWindow: 128000, maxOutputTokens: 8192 },
  },
  mcp: { configPath: 'C:/operator/mcp.json', servers: [{
    name: 'docs', url: 'https://docs.example/mcp', headersEnv: { Authorization: 'DOCS_AUTH' },
    allowedTools: ['search_docs'], readOnlyTools: ['search_docs'], timeoutSeconds: 30, maxResultChars: 24000,
    credentialStatus: { DOCS_AUTH: true },
  }] },
};

async function mockWorkbench(page: Page, options: { modelActivity?: DevAgentRuntimeSnapshot['modelActivity']; running?: boolean } = {}): Promise<{ writes: DevAgentSettingsInput[] }> {
  const writes: DevAgentSettingsInput[] = [];
  await page.route('**/api/dev/**', async (route) => {
    const pathname: string = new URL(route.request().url()).pathname;
    let body: unknown;
    if (pathname.endsWith('/health')) body = { enabled: true, binExists: true, tasksDirExists: true };
    else if (pathname.endsWith('/settings/test')) body = { ok: true, message: 'MCP 连接成功', tools: [{ name: 'search_docs', description: '搜索文档' }] };
    else if (pathname.endsWith('/settings')) {
      if (route.request().method() === 'PUT') writes.push(route.request().postDataJSON() as DevAgentSettingsInput);
      body = settings;
    } else if (pathname.endsWith('/runtime')) body = {
      version: 2, revision: 'test-revision', changes: [], cursor: 5, pending: null, verification: [], messages: [],
      modelActivity: options.modelActivity,
      events: [
        { index: 0, action: 'model', summary: '模型返回工具决策', createdAt: '2026-10-26T01:00:00Z', payload: {} },
        { index: 1, action: 'model', summary: '开始检查', createdAt: '2026-10-26T01:00:01Z', payload: { content: '我会先复现数据加载失败，再检查环境变量。' } },
        { index: 2, action: 'TerminalStart', summary: '执行命令', createdAt: '2026-10-26T01:00:02Z', payload: { inputs: { command: 'npm run dev:local' }, output: 'COLLAPSED_TERMINAL_OUTPUT' } },
        { index: 3, action: 'TerminalPoll', summary: '轮询', createdAt: '2026-10-26T01:00:03Z', payload: { status: 'running', output: '' } },
        { index: 4, action: 'Browser', summary: '打开页面', createdAt: '2026-10-26T01:00:04Z', payload: { inputs: { action: 'navigate', url: 'http://preview:8080/holdings' }, artifact_id: 'a'.repeat(32) } },
      ],
    };
    else if (pathname.endsWith('/tasks/dev_workbench')) body = {
      id: 'dev_workbench', title: '数据库加载排查', problem: '运行 dev:local 后看不到数据', status: 'blocked',
      runtime_version: 2, workdir: '/workspace', branch: '', acceptance: [], iterations: [], patchCount: 0,
      latestPatch: null, canResume: true, created_at: '', updated_at: '',
      execution: options.running ? { state: 'running', command: 'run', error: null } : { state: 'idle', command: null, error: null },
    };
    else if (pathname.endsWith('/tasks')) body = [];
    else body = {};
    await route.fulfill({ json: body });
  });
  return { writes };
}

test('public progress, concrete actions and browser evidence are visible without protocol noise', async ({ page }) => {
  await mockWorkbench(page);
  await page.goto('/dev?task=dev_workbench');
  const conversation = page.getByRole('region', { name: '任务对话与操作' });
  await expect(conversation.getByText('我会先复现数据加载失败，再检查环境变量。')).toBeVisible();
  await expect(conversation.getByText(/npm run dev:local/)).toBeVisible();
  await expect(conversation.getByText(/http:\/\/preview:8080\/holdings/)).toBeVisible();
  await expect(conversation.getByText(/模型返回工具决策|规划下一步|读取终端输出/)).toHaveCount(0);
  await expect(conversation.getByText('COLLAPSED_TERMINAL_OUTPUT')).toHaveCount(0);
  await conversation.locator('summary').filter({ hasText: 'npm run dev:local' }).click();
  await expect(conversation.getByLabel('终端或工具输出')).toHaveText('COLLAPSED_TERMINAL_OUTPUT');
  await expect(page.getByText('模型与可用能力', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('workbench-conversation.png'), fullPage: true });
});

test('pending model responses are status text without adding chat events', async ({ page }) => {
  await mockWorkbench(page, { running: true, modelActivity: { status: 'running', startedAt: '2026-10-26T01:00:05Z' } });
  await page.goto('/dev?task=dev_workbench');
  await expect(page.getByRole('status').filter({ hasText: '正在等待模型响应' })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止运行', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '任务对话与操作' }).getByText(/等待模型响应/)).toHaveCount(0);
});

test('settings are separate from the chat and preserve existing secrets during edits', async ({ page }) => {
  const { writes } = await mockWorkbench(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dev');
  await page.getByRole('button', { name: '打开 Agent 设置' }).click();
  const dialog = page.getByRole('dialog', { name: 'Agent 设置' });
  await expect(dialog.getByLabel('API Key · 已配置')).toHaveValue('');
  await dialog.getByLabel('模型 ID', { exact: true }).first().fill('new-coder-model');
  await expect(dialog.getByRole('button', { name: '测试编程模型' })).toBeDisabled();
  await dialog.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(dialog.getByText(/设置已保存/)).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].models?.primary?.model).toBe('new-coder-model');
  expect(writes[0].models?.primary?.apiKey).toBeUndefined();
  expect(writes[0].mcp?.credentials).toEqual({});
  await dialog.getByRole('tab', { name: 'MCP 服务', exact: true }).click();
  await dialog.getByRole('button', { name: '测试连接 · docs', exact: true }).click();
  await expect(dialog.getByText('MCP 连接成功')).toBeVisible();
  await expect(dialog.getByText('搜索文档', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('workbench-settings-mobile.png'), fullPage: true });
});

import { describe, expect, it } from 'vitest';
import type { DevAgentSettings } from '@shared/api.interface';
import { createSettingsDraft, buildSettingsUpdate } from './dev-settings';

const settings: DevAgentSettings = {
  ok: true, settingsPath: '/operator/settings.json', applyMode: 'next_run',
  models: {
    primary: { model: 'coder', baseUrl: 'https://models.test/v1', apiKeyConfigured: true,
      supportsImages: false, contextWindow: 128000, maxOutputTokens: 8192 },
    vision: { model: 'vision', baseUrl: 'https://models.test/v1', apiKeyConfigured: false,
      supportsImages: true, contextWindow: 128000, maxOutputTokens: 8192 },
  },
  mcp: { configPath: '/operator/mcp.json', servers: [{
    name: 'github', url: 'https://mcp.test/mcp',
    headersEnv: { Authorization: 'GITHUB_AUTH', 'X-MCP-Readonly': 'GITHUB_READONLY' },
    allowedTools: ['get_file_contents'], readOnlyTools: ['get_file_contents'],
    timeoutSeconds: 30, maxResultChars: 24000,
    credentialStatus: { GITHUB_AUTH: true, GITHUB_READONLY: true },
  }] },
};

describe('operator settings form', () => {
  it('never fabricates masked secrets and preserves all configured authentication header references', () => {
    const draft = createSettingsDraft(settings);
    const update = buildSettingsUpdate(draft);
    expect(draft.models.primary.apiKey).toBe('');
    expect(update.models?.primary?.apiKey).toBeUndefined();
    expect(update.mcp?.credentials).toEqual({});
    expect(update.mcp?.servers[0].headersEnv).toEqual(settings.mcp.servers[0].headersEnv);
    expect(update.mcp?.servers[0].readOnlyTools).toEqual(['get_file_contents']);
  });

  it('writes only newly entered secrets and keeps explicit removal separate', () => {
    const draft = createSettingsDraft(settings);
    draft.models.vision.apiKey = 'new-key';
    draft.models.primary.clearApiKey = true;
    draft.servers[0].headers[0].value = 'Bearer new-token';
    const update = buildSettingsUpdate(draft);
    expect(update.models?.vision?.apiKey).toBe('new-key');
    expect(update.models?.primary?.clearApiKey).toBe(true);
    expect(update.mcp?.credentials).toEqual({ GITHUB_AUTH: 'Bearer new-token' });
  });

  it('rejects duplicate service names and read-only tools that are not allowed', () => {
    const draft = createSettingsDraft(settings);
    draft.servers.push({ ...draft.servers[0] });
    expect(() => buildSettingsUpdate(draft)).toThrow('服务名称不能重复');
    draft.servers.pop();
    draft.servers[0].readOnlyTools = ['create_issue'];
    expect(() => buildSettingsUpdate(draft)).toThrow('只读工具必须在允许调用的工具列表中');
  });
});

import type {
  DevAgentSettings, DevAgentSettingsInput, DevAgentModelSettings, DevAgentModelSettingsInput,
  DevAgentMcpSettingsInput,
} from '@shared/api.interface';

export interface ModelDraft extends DevAgentModelSettings { apiKey: string; clearApiKey: boolean }
export interface HeaderDraft { header: string; variable: string; value: string; configured: boolean }
export interface McpDraft extends Omit<DevAgentMcpSettingsInput, 'headersEnv'> {
  headers: HeaderDraft[];
  allowedToolsText?: string;
  readOnlyToolsText?: string;
}
export interface SettingsDraft { models: { primary: ModelDraft; vision: ModelDraft }; servers: McpDraft[] }

export function createSettingsDraft(settings: DevAgentSettings): SettingsDraft {
  return {
    models: {
      primary: { ...settings.models.primary, apiKey: '', clearApiKey: false },
      vision: { ...settings.models.vision, apiKey: '', clearApiKey: false },
    },
    servers: settings.mcp.servers.map((server): McpDraft => ({
      name: server.name, url: server.url, allowedTools: server.allowedTools,
      readOnlyTools: server.readOnlyTools, timeoutSeconds: server.timeoutSeconds,
      maxResultChars: server.maxResultChars,
      headers: Object.entries(server.headersEnv).map(([header, variable]): HeaderDraft => ({
        header, variable, value: '', configured: server.credentialStatus[variable] === true,
      })),
    })),
  };
}

export function buildSettingsUpdate(draft: SettingsDraft): DevAgentSettingsInput {
  const modelInput = (model: ModelDraft): DevAgentModelSettingsInput => ({
    model: model.model.trim(), baseUrl: model.baseUrl.trim(), supportsImages: model.supportsImages,
    contextWindow: model.contextWindow, maxOutputTokens: model.maxOutputTokens,
    ...(model.apiKey.trim() ? { apiKey: model.apiKey.trim() } : {}),
    ...(model.clearApiKey ? { clearApiKey: true } : {}),
  });
  const credentials: Record<string, string> = {};
  const names: Set<string> = new Set();
  const servers: DevAgentMcpSettingsInput[] = draft.servers.map((server: McpDraft): DevAgentMcpSettingsInput => {
    const name: string = server.name.trim();
    if (names.has(name)) throw new Error('MCP 服务名称不能重复');
    names.add(name);
    const allowedTools: string[] | null = server.allowedTools === null ? null
      : splitToolNames(server.allowedToolsText ?? server.allowedTools.join(', '));
    const readOnlyTools: string[] = splitToolNames(server.readOnlyToolsText ?? server.readOnlyTools.join(', '));
    if (allowedTools !== null && readOnlyTools.some((tool: string) => !allowedTools.includes(tool))) {
      throw new Error(`${name}：只读工具必须在允许调用的工具列表中`);
    }
    const headersEnv: Record<string, string> = {};
    for (const row of server.headers) {
      const header: string = row.header.trim();
      const variable: string = row.variable.trim();
      if (!header || !variable) throw new Error(`${name}：请填写完整的认证请求头和变量名称`);
      if (Object.keys(headersEnv).some((key: string) => key.toLowerCase() === header.toLowerCase())) {
        throw new Error(`${name}：认证请求头不能重复`);
      }
      headersEnv[header] = variable;
      if (row.value.trim()) {
        if (credentials[variable] && credentials[variable] !== row.value.trim()) {
          throw new Error(`${variable}：同一变量填写了不同的值`);
        }
        credentials[variable] = row.value.trim();
      }
    }
    return { name, url: server.url.trim(), headersEnv, allowedTools,
      readOnlyTools, timeoutSeconds: server.timeoutSeconds, maxResultChars: server.maxResultChars };
  });
  return { models: { primary: modelInput(draft.models.primary), vision: modelInput(draft.models.vision) },
    mcp: { servers, credentials } };
}

export function splitToolNames(text: string): string[] {
  return [...new Set(text.split(/[,，\n]/).map((name: string) => name.trim()).filter(Boolean))];
}

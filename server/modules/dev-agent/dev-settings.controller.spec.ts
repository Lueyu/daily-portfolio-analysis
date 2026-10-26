import { describe, it, expect, vi } from 'vitest';
import type { Request } from 'express';
import { assertLocalSettingsRequest, DevSettingsController } from './dev-settings.controller';
import type { DevAgentConfig } from './dev-agent.config';

vi.mock('@lark-apaas/fullstack-nestjs-core', () => ({ NeedLogin: () => () => undefined }));

const request = (origin = 'http://localhost:8080', remoteAddress = '127.0.0.1'): Request => ({
  socket: { remoteAddress }, headers: { origin, host: 'localhost:3000' },
} as Request);

describe('operator settings boundary', () => {
  it('accepts localhost and rejects remote/cross-site requests', () => {
    expect(() => assertLocalSettingsRequest(request())).not.toThrow();
    expect(() => assertLocalSettingsRequest(request('https://evil.example'))).toThrow();
    expect(() => assertLocalSettingsRequest(request('http://localhost:8080', '10.0.0.2'))).toThrow();
  });

  it('sends secrets via stdin and returns only the sanitized child response', async () => {
    const exec = vi.fn().mockResolvedValue({ returnCode: 0, stdout: '{"ok":true}', stderr: '' });
    const controller = new DevSettingsController({ enabled: true } as DevAgentConfig, { exec });
    const input = { models: { primary: { apiKey: 'private-test-secret' } } };
    expect(await controller.save(request(), input)).toEqual({ ok: true });
    expect(exec.mock.calls[0][0]).toEqual(['settings-save']);
    expect(exec.mock.calls[0][1].stdin).toBe(JSON.stringify(input));
  });

  it('never exposes child stderr containing credentials', async () => {
    const exec = vi.fn().mockResolvedValue({ returnCode: 1, stdout: '', stderr: 'private-test-secret' });
    const controller = new DevSettingsController({ enabled: true } as DevAgentConfig, { exec });
    await expect(controller.read(request())).rejects.toThrow('设置命令执行失败');
    await expect(controller.read(request())).rejects.not.toThrow('private-test-secret');
  });
});

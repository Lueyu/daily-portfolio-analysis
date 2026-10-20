import { describe, it, expect } from 'vitest';
import { loadDevAgentConfig, DEFAULT_RUN_TIMEOUT_MS } from './dev-agent.config';

describe('loadDevAgentConfig', () => {
  it('is disabled by default and derives paths from the repo root', () => {
    const cfg = loadDevAgentConfig({}, '/repo/root');
    expect(cfg.enabled).toBe(false);
    expect(cfg.workdir).toBe('/repo/root');
    expect(cfg.tasksDir.replace(/\\/g, '/')).toContain('agent/data/coder/tasks');
    expect(cfg.binPath).toContain('.venv');
    expect(cfg.binPath.split(/[\\/]/).pop()).toMatch(/^agent(\.exe)?$/);
    expect(cfg.runTimeoutMs).toBe(DEFAULT_RUN_TIMEOUT_MS);
  });

  it('enables only when AGENT_DEV_ENABLED equals the literal string "true"', () => {
    expect(loadDevAgentConfig({ AGENT_DEV_ENABLED: '1' }, '/r').enabled).toBe(false);
    expect(loadDevAgentConfig({ AGENT_DEV_ENABLED: 'true' }, '/r').enabled).toBe(true);
  });

  it('honours explicit overrides for every path and timeout', () => {
    const cfg = loadDevAgentConfig(
      {
        AGENT_DEV_ENABLED: 'true',
        AGENT_DEV_BIN: '/custom/agent.exe',
        AGENT_DEV_TASKS_DIR: '/custom/tasks',
        AGENT_DEV_WORKDIR: '/custom/work',
        AGENT_DEV_RUN_TIMEOUT_MS: '5000',
      },
      '/r',
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.binPath).toBe('/custom/agent.exe');
    expect(cfg.tasksDir).toBe('/custom/tasks');
    expect(cfg.workdir).toBe('/custom/work');
    expect(cfg.runTimeoutMs).toBe(5000);
  });

  it('falls back to the default timeout for a non-numeric override', () => {
    const cfg = loadDevAgentConfig({ AGENT_DEV_RUN_TIMEOUT_MS: 'abc' }, '/r');
    expect(cfg.runTimeoutMs).toBe(DEFAULT_RUN_TIMEOUT_MS);
  });
});

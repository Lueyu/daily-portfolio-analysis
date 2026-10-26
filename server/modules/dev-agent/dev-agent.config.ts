/**
 * @file dev-agent.config.ts
 * @description Configuration for the local Coding-Agent console.
 *
 * The feature is OFF by default and only enabled in local development
 * (`AGENT_DEV_ENABLED=true` in `.env.local`). It must stay off in the cloud
 * FaaS runtime, where there is no git working tree or Python runtime.
 */
import path from 'node:path';

export const DEFAULT_RUN_TIMEOUT_MS = 0; // Long-running work has no default total time limit.
export const SHORT_COMMAND_TIMEOUT_MS = 30_000;

export interface DevAgentConfig {
  enabled: boolean;
  /** Absolute path to the Python agent executable. */
  binPath: string;
  /**
   * Extra arguments placed right after the executable, before the command.
   * Empty for the packaged agent; lets an interpreter run a script (e.g.
   * `node` + `e2e/fixtures/fake-agent.cjs` in deterministic E2E tests).
   */
  binArgs: string[];
  /** Directory holding `<task-id>/task.json` work products. */
  tasksDir: string;
  /** Working directory the agent is allowed to operate in. */
  workdir: string;
  /** Optional wall-clock cap for run/approve; zero/null disables it. */
  runTimeoutMs: number | null;
}

/** Default executable path, selected per platform. */
function defaultBinPath(root: string): string {
  return process.platform === 'win32'
    ? path.join(root, 'agent', '.venv', 'Scripts', 'agent.exe')
    : path.join(root, 'agent', '.venv', 'bin', 'agent');
}

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RUN_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_RUN_TIMEOUT_MS;
}

/** Parse the optional AGENT_DEV_BIN_ARGS JSON array; never throw on bad input. */
function parseBinArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Build config from an environment map. Pure and easy to unit test: pass the
 * env and an explicit repo root; no process globals are touched directly.
 */
export function loadDevAgentConfig(
  env: NodeJS.ProcessEnv = process.env,
  root: string = process.cwd(),
): DevAgentConfig {
  const workdir = env.AGENT_DEV_WORKDIR ? env.AGENT_DEV_WORKDIR : root;
  return {
    enabled: env.AGENT_DEV_ENABLED === 'true',
    binPath: env.AGENT_DEV_BIN ? env.AGENT_DEV_BIN : defaultBinPath(root),
    binArgs: parseBinArgs(env.AGENT_DEV_BIN_ARGS),
    tasksDir: env.AGENT_DEV_TASKS_DIR
      ? env.AGENT_DEV_TASKS_DIR
      : path.join(root, 'agent', 'data', 'coder', 'tasks'),
    workdir,
    runTimeoutMs: parseTimeout(env.AGENT_DEV_RUN_TIMEOUT_MS),
  };
}

/**
 * DI token for the resolved dev-agent configuration. A plain string token is
 * used because the config is a plain object produced by a factory, not a class.
 */
export const DEV_AGENT_CONFIG = 'DevAgentConfig';

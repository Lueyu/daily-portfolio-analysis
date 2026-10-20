/**
 * @file agent-process.runner.ts
 * @description Spawn the local Python agent executable safely.
 *
 * Safety properties:
 * - only a fixed whitelist of subcommands can run (new/run/approve/reject);
 * - arguments are passed as an argv array with `shell: false`, so no shell
 *   interpolation or command injection is possible;
 * - `--json` is always appended by the runner (callers cannot forget it);
 * - the child runs with a fixed cwd and a wall-clock timeout after which it
 *   is killed.
 */
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { DEV_AGENT_CONFIG, type DevAgentConfig } from './dev-agent.config';
import type { ProcessResult } from './dev-agent.types';

export interface SpawnedChild {
  stdout: { on(event: 'data', cb: (chunk: Buffer) => void): void } | null;
  stderr: { on(event: 'data', cb: (chunk: Buffer) => void): void } | null;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  kill(): void;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => SpawnedChild;

const ALLOWED_SUBCOMMANDS = new Set(['new', 'run', 'approve', 'reject']);

export interface RunnerConfig {
  binPath: string;
  workdir: string;
  runTimeoutMs: number;
}

export interface AgentProcessRunner {
  exec(argv: string[], opts?: { timeoutMs?: number }): Promise<ProcessResult>;
}

/** DI token, since the interface type is erased at runtime. */
export const AGENT_PROCESS_RUNNER = 'AgentProcessRunner';

@Injectable()
export class ChildProcessRunner implements AgentProcessRunner {
  constructor(@Inject(DEV_AGENT_CONFIG) private readonly config: DevAgentConfig) {}

  /** Indirection so tests can substitute a fake child process. */
  protected spawnChild(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): SpawnedChild {
    return spawn(command, args, options) as unknown as SpawnedChild;
  }

  async exec(argv: string[], opts?: { timeoutMs?: number }): Promise<ProcessResult> {
    const sub = argv[0];
    if (!sub || !ALLOWED_SUBCOMMANDS.has(sub)) {
      throw new BadRequestException(
        `agent subcommand not allowed: ${sub ?? '(none)'}`,
      );
    }
    const args = [...argv.slice(1), '--json'];
    const timeoutMs = opts?.timeoutMs ?? this.config.runTimeoutMs;

    return new Promise<ProcessResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = this.spawnChild(this.config.binPath, [sub, ...args], {
        cwd: this.config.workdir,
        shell: false,
        env: process.env,
      });

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`agent ${sub} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ returnCode: code ?? -1, stdout, stderr });
      });
    });
  }
}

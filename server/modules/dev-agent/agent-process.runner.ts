/**
 * @file agent-process.runner.ts
 * @description Spawn the local Python agent executable safely.
 *
 * Safety properties:
 * - only a fixed whitelist of subcommands can run (new/run/approve/reject);
 * - arguments are passed as an argv array with `shell: false`, so no shell
 *   interpolation or command injection is possible;
 * - `--json` is always appended by the runner (callers cannot forget it);
 * - the child runs with a fixed cwd; run/approve have no default total timeout,
 *   while short commands retain a deadline and owned runs support explicit stop.
 */
import { execFile, spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { DEV_AGENT_CONFIG, SHORT_COMMAND_TIMEOUT_MS, type DevAgentConfig } from './dev-agent.config';
import type { ProcessResult } from './dev-agent.types';

export interface SpawnedChild {
  pid?: number;
  stdin?: { end(data: string): void; on?(event: 'error', cb: () => void): void } | null;
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

const ALLOWED_SUBCOMMANDS = new Set([
  'new', 'run', 'approve', 'reject', 'undo', 'restore', 'runtime-stop', 'message', 'decide', 'capabilities',
  'settings', 'settings-save', 'settings-test',
]);

export interface RunnerConfig {
  binPath: string;
  workdir: string;
  runTimeoutMs: number | null;
}

export interface RunnerOptions {
  /** Sensitive configuration is sent through a pipe, never process arguments. */
  stdin?: string;
  timeoutMs?: number | null;
  signal?: AbortSignal;
  /** Retryable cancellation control; failed attempts do not end process ownership. */
  onStopReady?: (stop: () => Promise<void>) => void;
}

export interface AgentProcessRunner {
  exec(argv: string[], opts?: RunnerOptions): Promise<ProcessResult>;
}

function abortError(sub: string): Error {
  return Object.assign(new Error(`agent ${sub} stopped`), { name: 'AbortError' });
}

/** DI token, since the interface type is erased at runtime. */
export const AGENT_PROCESS_RUNNER = 'AgentProcessRunner';

@Injectable()
export class ChildProcessRunner implements AgentProcessRunner {
  private readonly logger = new Logger('ChildProcessRunner');
  constructor(@Inject(DEV_AGENT_CONFIG) private readonly config: DevAgentConfig) {}

  /** Indirection so tests can substitute a fake child process. */
  protected spawnChild(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): SpawnedChild {
    return spawn(command, args, options) as unknown as SpawnedChild;
  }

  /** Terminate only the process tree created by this runner. */
  protected async terminateChild(child: SpawnedChild): Promise<void> {
    if (!child.pid) {
      child.kill();
      return;
    }
    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return;
    }
    // POSIX children start in their own process group so descendants are included.
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause;
    }
  }

  async exec(argv: string[], opts?: RunnerOptions): Promise<ProcessResult> {
    const sub = argv[0];
    if (!sub || !ALLOWED_SUBCOMMANDS.has(sub)) {
      throw new BadRequestException(
        `agent subcommand not allowed: ${sub ?? '(none)'}`,
      );
    }
    if (opts?.signal?.aborted) throw abortError(sub);
    // Optional interpreter args first (e.g. a script path), then the `dev`
    // command group (`agent dev new`), and always --json last.
    const args = [
      ...this.config.binArgs,
      'dev',
      sub,
      ...argv.slice(1),
      '--json',
    ];
    const defaultTimeout: number | null = sub === 'run' || sub === 'approve'
      ? this.config.runTimeoutMs : SHORT_COMMAND_TIMEOUT_MS;
    const timeoutMs: number | null = opts?.timeoutMs === undefined ? defaultTimeout : opts.timeoutMs;

    return new Promise<ProcessResult>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      let stopping = false;
      let termination: Promise<void> | null = null;
      let isClosed = false;
      let closeCode: number | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let markClosed: () => void = () => undefined;
      const closed: Promise<void> = new Promise((done) => { markClosed = done; });

      const child = this.spawnChild(this.config.binPath, args, {
        cwd: this.config.workdir,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: process.env,
      });

      if (opts?.stdin !== undefined) {
        child.stdin?.on?.('error', () => undefined); // A failed child is reported by close/error below.
        child.stdin?.end(opts.stdin);
      }

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      const cleanup = (): void => {
        clearTimeout(timer);
        opts?.signal?.removeEventListener('abort', onAbort);
      };
      const terminate = (reason: Error): Promise<void> => {
        if (settled) return Promise.resolve();
        if (termination) return termination;
        stopping = true;
        cleanup();
        termination = (async () => {
          try {
            await this.terminateChild(child);
            await closed;
            settled = true;
            cleanup();
            reject(reason);
          } catch (cause: unknown) {
            // taskkill can race with a natural exit. A confirmed close is enough
            // to finish normally; otherwise retain this process and its lock.
            if (isClosed) {
              settled = true;
              cleanup();
              resolve({ returnCode: closeCode ?? -1, stdout, stderr });
              return;
            }
            stopping = false;
            termination = null;
            throw cause;
          }
        })();
        return termination;
      };
      const requestStop = (reason: Error): void => {
        void terminate(reason).catch((cause: unknown) => {
          this.logger.error('Unable to stop agent process; ownership retained',
            cause instanceof Error ? cause.stack : undefined);
        });
      };
      const onAbort = (): void => requestStop(abortError(sub));

      child.on('error', (err) => {
        markClosed();
        if (settled || stopping) return;
        settled = true;
        cleanup();
        reject(err);
      });

      child.on('close', (code) => {
        isClosed = true;
        closeCode = code;
        markClosed();
        if (settled || stopping) return;
        settled = true;
        cleanup();
        resolve({ returnCode: code ?? -1, stdout, stderr });
      });
      if (timeoutMs !== null && timeoutMs > 0) {
        timer = setTimeout(() => requestStop(new Error(`agent ${sub} timed out after ${timeoutMs}ms`)), timeoutMs);
      }
      opts?.onStopReady?.(() => terminate(abortError(sub)));
      opts?.signal?.addEventListener('abort', onAbort, { once: true });
      if (opts?.signal?.aborted) onAbort();
    });
  }
}

/**
 * @file dev-agent.service.ts
 * @description Orchestration layer between HTTP and the local Python Coder.
 *
 * Responsibilities:
 * - gate the feature behind the config flag;
 * - read task work products through TaskArtifactReader;
 * - build whitelisted argv and spawn the agent through AgentProcessRunner;
 * - serialise long-running commands per task with an in-flight lock.
 *
 * `run` and `approve` are long lived (the agent makes model calls and runs
 * tests), so they are fire-and-forget: the HTTP call returns immediately and
 * the UI polls the artifact files. `new` and `reject` are fast and awaited so
 * the caller gets the new id / resulting status directly.
 */
import { existsSync } from 'node:fs';
import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  type CommandJson,
  type CreateDevTaskInput,
  type DevAgentHealth,
  type DevTaskStatus,
  type DevTaskSummary,
  type DevTaskDetail,
  type Iteration,
  type PatchDetail,
  TERMINAL_STATUSES,
} from './dev-agent.types';
import type { DevAgentConfig } from './dev-agent.config';
import type { AgentProcessRunner } from './agent-process.runner';
import type { ProcessResult } from './dev-agent.types';
import { TaskArtifactReader } from './task-artifact.reader';

@Injectable()
export class DevAgentService {
  private readonly logger = new Logger('DevAgentService');
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly config: DevAgentConfig,
    private readonly reader: TaskArtifactReader,
    private readonly runner: AgentProcessRunner,
  ) {}

  /** Health is reported even when disabled so the UI can show the reason. */
  health(): DevAgentHealth {
    return {
      enabled: this.config.enabled,
      binExists: existsSync(this.config.binPath),
      tasksDirExists: existsSync(this.config.tasksDir),
      binPath: this.config.binPath,
      tasksDir: this.config.tasksDir,
    };
  }

  private requireEnabled(): void {
    if (!this.config.enabled) {
      throw new ServiceUnavailableException(
        'dev agent is disabled (set AGENT_DEV_ENABLED=true locally)',
      );
    }
  }

  private parseJson(res: ProcessResult, cmd: string): CommandJson {
    const line = res.stdout.trim().split('\n').pop()?.trim();
    if (res.returnCode !== 0 || !line) {
      throw new InternalServerErrorException(
        `agent ${cmd} failed (exit ${res.returnCode}): ${res.stderr || 'no output'}`,
      );
    }
    try {
      return JSON.parse(line) as CommandJson;
    } catch {
      throw new InternalServerErrorException(
        `agent ${cmd} returned non-JSON output: ${line}`,
      );
    }
  }

  /** Replace ASCII colons in the description so they cannot split the
   *  `id:kind:description[:target]` spec; targets keep their own colons. */
  private static buildAcceptanceSpec(a: CreateDevTaskInput['acceptance'][number]): string {
    const safeDescription = a.description.replace(/:/g, '：');
    const base = `${a.id}:${a.kind}:${safeDescription}`;
    return a.target ? `${base}:${a.target}` : base;
  }

  // ---------------------------------------------------------------- read side

  async listTasks(): Promise<DevTaskSummary[]> {
    this.requireEnabled();
    return this.reader.listTasks();
  }

  async getTask(id: string): Promise<DevTaskDetail> {
    this.requireEnabled();
    return this.reader.getTask(id);
  }

  async getIterations(id: string): Promise<Iteration[]> {
    this.requireEnabled();
    return this.reader.getIterations(id);
  }

  async getPatch(id: string, patchId: string): Promise<PatchDetail> {
    this.requireEnabled();
    return this.reader.getPatch(id, patchId);
  }

  // --------------------------------------------------------------- write side

  async createTask(input: CreateDevTaskInput): Promise<{ id: string }> {
    this.requireEnabled();
    const argv = ['new', '--title', input.title, '--problem', input.problem];
    for (const a of input.acceptance) {
      argv.push('--acceptance', DevAgentService.buildAcceptanceSpec(a));
    }
    if (input.workdir) {
      argv.push('--workdir', input.workdir);
    }
    const res = await this.runner.exec(argv);
    const payload = this.parseJson(res, 'new');
    if (!payload.id) {
      throw new InternalServerErrorException('agent new returned no task id');
    }
    return { id: payload.id };
  }

  /** Start the reproduction/fix loop. Returns immediately; UI polls. */
  async startRun(id: string): Promise<void> {
    this.requireEnabled();
    this.beginOrReject(id);
    try {
      const detail = await this.reader.getTask(id);
      if (TERMINAL_STATUSES.has(detail.status)) {
        throw new ConflictException(`task already ${detail.status}`);
      }
      this.runDetached(id, ['run', id]);
    } catch (e) {
      this.inFlight.delete(id);
      throw e;
    }
  }

  /** Apply the awaiting patch and re-verify. Returns immediately; UI polls. */
  async approve(id: string): Promise<void> {
    this.requireEnabled();
    this.beginOrReject(id);
    try {
      const detail = await this.reader.getTask(id);
      if (detail.status !== 'awaiting_approval') {
        throw new ConflictException(
          `can only approve while awaiting approval, current=${detail.status}`,
        );
      }
      this.runDetached(id, ['approve', id]);
    } catch (e) {
      this.inFlight.delete(id);
      throw e;
    }
  }

  /** Reject the awaiting patch. Fast and offline, so awaited. */
  async reject(id: string, reason: string): Promise<{ status: DevTaskStatus }> {
    this.requireEnabled();
    this.beginOrReject(id);
    try {
      const detail = await this.reader.getTask(id);
      if (detail.status !== 'awaiting_approval') {
        throw new ConflictException(
          `can only reject while awaiting approval, current=${detail.status}`,
        );
      }
      const res = await this.runner.exec(['reject', id, '--reason', reason]);
      const payload = this.parseJson(res, 'reject');
      return { status: payload.status ?? 'blocked' };
    } finally {
      this.inFlight.delete(id);
    }
  }

  // ------------------------------------------------------------------ helpers

  /** Acquire the per-task lock synchronously, before any await, so two
   *  concurrent requests cannot both pass the state checks. */
  private beginOrReject(id: string): void {
    if (this.inFlight.has(id)) {
      throw new ConflictException('task is already running');
    }
    this.inFlight.add(id);
  }

  /** Run a command without blocking the HTTP request; release the lock after. */
  private runDetached(id: string, argv: string[]): void {
    void this.runner
      .exec(argv)
      .then((res) => {
        try {
          this.parseJson(res, argv[0]);
        } catch (e) {
          this.logger.error(`background ${argv[0]} for ${id} failed: ${(e as Error).message}`);
        }
      })
      .catch((e: unknown) => {
        this.logger.error(`background ${argv[0]} for ${id} errored: ${String(e)}`);
      })
      .finally(() => {
        this.inFlight.delete(id);
      });
  }
}

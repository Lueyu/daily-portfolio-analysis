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
  BadRequestException,
  ConflictException,
  Inject,
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
import { DEV_AGENT_CONFIG, type DevAgentConfig } from './dev-agent.config';
import { AGENT_PROCESS_RUNNER, type AgentProcessRunner } from './agent-process.runner';
import type { ProcessResult } from './dev-agent.types';
import { TaskArtifactReader } from './task-artifact.reader';
import type {
  DevAgentExecution, DevAgentRuntimeSnapshot, DevAgentUndoInput, DevAgentRestoreInput,
} from '@shared/api.interface';

@Injectable()
export class DevAgentService {
  private readonly logger = new Logger('DevAgentService');
  private readonly inFlight = new Set<string>();
  private readonly executions = new Map<string, DevAgentExecution>();
  private readonly activeRuns = new Map<string, {
    stopReady: Promise<(() => Promise<void>) | null>;
    completion: Promise<void>;
  }>();

  constructor(
    @Inject(DEV_AGENT_CONFIG) private readonly config: DevAgentConfig,
    private readonly reader: TaskArtifactReader,
    @Inject(AGENT_PROCESS_RUNNER) private readonly runner: AgentProcessRunner,
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
    const tasks: DevTaskSummary[] = await this.reader.listTasks();
    return tasks.map((task: DevTaskSummary) => ({
      ...task, execution: this.executionFor(task.id),
    }));
  }

  async getTask(id: string): Promise<DevTaskDetail> {
    this.requireEnabled();
    const task: DevTaskDetail = await this.reader.getTask(id);
    return { ...task, execution: this.executionFor(id) };
  }

  async getIterations(id: string): Promise<Iteration[]> {
    this.requireEnabled();
    return this.reader.getIterations(id);
  }

  async getPatch(id: string, patchId: string): Promise<PatchDetail> {
    this.requireEnabled();
    return this.reader.getPatch(id, patchId);
  }

  async getRuntime(id: string, cursor = 0): Promise<DevAgentRuntimeSnapshot> {
    this.requireEnabled();
    return this.reader.getRuntime(id, cursor);
  }

  async capabilities(): Promise<Record<string, unknown>> {
    this.requireEnabled();
    const response: ProcessResult = await this.runner.exec(['capabilities']);
    return this.parseJson(response, 'capabilities') as unknown as Record<string, unknown>;
  }

  async sendMessage(id: string, text: string): Promise<void> {
    this.requireEnabled();
    if (typeof text !== 'string' || !text.trim() || text.length > 20000) {
      throw new BadRequestException('message must contain 1–20000 characters');
    }
    const task: DevTaskDetail = await this.reader.getTask(id);
    if (task.runtime_version !== 2 || task.status === 'verified') {
      throw new ConflictException('create a new task to continue this completed or legacy task');
    }
    if (this.executionFor(id).command === 'approve' && this.inFlight.has(id)) {
      throw new ConflictException('wait for the current landing operation before sending a new instruction');
    }
    const result: ProcessResult = await this.runner.exec(['message', id, '--text', text.trim()]);
    this.parseJson(result, 'message');
    // Inbox files are immutable; they can be added while the source controller runs.
    if (!this.inFlight.has(id)) await this.startRun(id);
    else {
      const active = this.activeRuns.get(id);
      if (active) void active.completion.then(async (): Promise<void> => {
        // The last finish check may have raced with this inbox write. Resume
        // only on normal completion and only if the controller did not read it.
        if (this.inFlight.has(id) || ['stopped', 'failed'].includes(this.executionFor(id).state)) return;
        const runtime: DevAgentRuntimeSnapshot = await this.reader.getRuntime(id);
        if ((runtime.unreadMessageCount ?? 0) > 0) await this.startRun(id);
      }).catch((cause: unknown) => {
        const error: string = cause instanceof Error ? cause.message : 'unable to continue queued instruction';
        this.executions.set(id, { state: 'failed', command: 'run', error });
        this.logger.error(`queued instruction for ${id} could not resume: ${error}`,
          cause instanceof Error ? cause.stack : undefined);
      });
    }
  }

  async decideExternal(id: string, requestId: string, approve: boolean): Promise<void> {
    this.requireEnabled();
    if (!/^[a-f0-9]{32}$/.test(requestId) || typeof approve !== 'boolean') {
      throw new BadRequestException('invalid external approval decision');
    }
    this.beginOrReject(id);
    try {
      const task: DevTaskDetail = await this.reader.getTask(id);
      if (task.runtime_version !== 2 || task.status === 'verified') {
        throw new ConflictException('task cannot accept this decision');
      }
      const result: ProcessResult = await this.runner.exec([
        'decide', id, '--request-id', requestId, approve ? '--approve' : '--deny',
      ]);
      this.parseRuntimeCommand(result, 'decide');
    } finally { this.inFlight.delete(id); }
    await this.startRun(id);
  }

  async getArtifact(id: string, artifactId: string): Promise<Buffer> {
    this.requireEnabled();
    return this.reader.getArtifact(id, artifactId);
  }

  async undoChange(id: string, input: DevAgentUndoInput): Promise<DevAgentRuntimeSnapshot> {
    if (!/^[a-f0-9]{32}$/.test(input.changeId)) throw new BadRequestException('invalid change id');
    return this.mutateRuntime(id, 'undo', input.expectedRevision, ['--change-id', input.changeId]);
  }

  async restoreCheckpoint(id: string, input: DevAgentRestoreInput): Promise<DevAgentRuntimeSnapshot> {
    if (!/^[a-f0-9]{64}$/.test(input.revision)) throw new BadRequestException('invalid checkpoint revision');
    return this.mutateRuntime(id, 'restore', input.expectedRevision, ['--revision', input.revision]);
  }

  private async mutateRuntime(
    id: string, command: 'undo' | 'restore', expectedRevision: string, args: string[],
  ): Promise<DevAgentRuntimeSnapshot> {
    this.requireEnabled();
    if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new BadRequestException('invalid expected revision');
    this.beginOrReject(id);
    try {
      const runtime: DevAgentRuntimeSnapshot = await this.reader.getRuntime(id);
      if (runtime.version !== 2) throw new ConflictException('task has no general runtime history');
      if (runtime.pending) throw new ConflictException('stop the pending runtime operation before changing history');
      if (runtime.revision !== expectedRevision) throw new ConflictException('runtime revision changed; refresh before retrying');
      const result: ProcessResult = await this.runner.exec([command, id, ...args, '--expected-revision', expectedRevision]);
      this.parseRuntimeCommand(result, command);
      return await this.reader.getRuntime(id);
    } finally { this.inFlight.delete(id); }
  }

  private parseRuntimeCommand(result: ProcessResult, command: string): void {
    const line: string = result.stdout.trim().split('\n').pop()?.trim() ?? '';
    let payload: { ok?: boolean; error?: string; code?: string };
    try { payload = JSON.parse(line) as typeof payload; }
    catch { throw new InternalServerErrorException(`agent ${command} failed: ${result.stderr || 'invalid JSON output'}`); }
    if (payload.ok === false) {
      const message: string = payload.error || `agent ${command} failed`;
      if (payload.code === 'invalid') throw new BadRequestException(message);
      throw new ConflictException(message);
    }
    if (result.returnCode !== 0 || payload.ok !== true) {
      throw new InternalServerErrorException(`agent ${command} failed: ${result.stderr || 'unsuccessful response'}`);
    }
  }

  // --------------------------------------------------------------- write side

  async createTask(input: CreateDevTaskInput): Promise<DevTaskDetail> {
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
    // The CLI has written task.json by now; return the full detail so the
    // client can navigate straight into it without a second round trip.
    return this.getTask(payload.id);
  }

  /** Start the reproduction/fix loop. Returns immediately; UI polls. */
  async startRun(id: string): Promise<void> {
    this.requireEnabled();
    this.beginOrReject(id);
    try {
      const detail = await this.reader.getTask(id);
      if (TERMINAL_STATUSES.has(detail.status) && !detail.canResume) {
        throw new ConflictException(`task already ${detail.status}`);
      }
      this.launch(id, 'run', detail.canResume ? ['--resume-budget'] : []);
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
      this.launch(id, 'approve');
    } catch (e) {
      this.inFlight.delete(id);
      throw e;
    }
  }

  /** Stop only a run owned by this process; approval may be landing a patch. */
  async stop(id: string): Promise<void> {
    this.requireEnabled();
    const active = this.activeRuns.get(id);
    if (!active || this.executions.get(id)?.command !== 'run') {
      throw new ConflictException('only a running task owned by this process can be stopped');
    }
    const stop = await active.stopReady;
    if (!stop) throw new ConflictException('agent process is no longer running');
    await stop();
    await active.completion;
    if (this.executions.get(id)?.state === 'failed') {
      throw new InternalServerErrorException('agent process could not be stopped');
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

  private executionFor(id: string): DevAgentExecution {
    return { ...(this.executions.get(id) ?? { state: 'idle', command: null, error: null }) };
  }

  /** Only this process's commands affect execution; Python artifacts stay read-only. */
  private launch(id: string, command: 'run' | 'approve', extraArgs: string[] = []): void {
    let provideStop: (stop: (() => Promise<void>) | null) => void = () => undefined;
    const stopReady: Promise<(() => Promise<void>) | null> = new Promise((resolve) => { provideStop = resolve; });
    this.executions.set(id, { state: 'running', command, error: null });
    const completion: Promise<void> = Promise.resolve().then(() => (
      this.runDetached(id, command, extraArgs, provideStop)
    ));
    this.activeRuns.set(id, { stopReady, completion });
  }

  private async runDetached(
    id: string, command: 'run' | 'approve', extraArgs: string[],
    provideStop: (stop: (() => Promise<void>) | null) => void,
  ): Promise<void> {
    try {
      const result: ProcessResult = await this.runner.exec([command, id, ...extraArgs], { onStopReady: provideStop });
      this.parseJson(result, command);
      this.executions.delete(id);
    } catch (cause: unknown) {
      if (cause instanceof Error && cause.name === 'AbortError') {
        try {
          const task: DevTaskDetail = await this.reader.getTask(id);
          if (task.runtime_version === 2) {
            const cleanup: ProcessResult = await this.runner.exec(['runtime-stop', id]);
            this.parseRuntimeCommand(cleanup, 'runtime-stop');
          }
        } catch (cleanupCause: unknown) {
          const error: string = cleanupCause instanceof Error ? cleanupCause.message : 'runtime cleanup failed';
          this.executions.set(id, { state: 'failed', command, error });
          this.logger.error(`runtime cleanup for ${id} failed: ${error}`,
            cleanupCause instanceof Error ? cleanupCause.stack : undefined);
          return;
        }
        this.executions.set(id, { state: 'stopped', command, error: null });
        return;
      }
      const message: string = cause instanceof Error
        ? cause.message
        : typeof cause === 'string' ? cause : 'Unknown agent execution failure';
      // Python tracebacks end with the actionable exception; retain both ends.
      const error: string = message.length > 1000
        ? `${message.slice(0, 150)}\n...[truncated]...\n${message.slice(-800)}`
        : message;
      this.executions.set(id, { state: 'failed', command, error });
      this.logger.error(`background ${command} for ${id} failed: ${error}`,
        cause instanceof Error ? cause.stack : undefined);
    } finally {
      provideStop(null);
      this.activeRuns.delete(id);
      this.inFlight.delete(id);
    }
  }
}

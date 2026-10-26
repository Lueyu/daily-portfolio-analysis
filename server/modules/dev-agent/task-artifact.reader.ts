/**
 * @file task-artifact.reader.ts
 * @description Read-only access to the Python Coder's on-disk work products.
 *
 * Directory layout (produced by the Python `TaskStore`, the source of truth):
 *   <tasksDir>/<task-id>/task.json
 *   <tasksDir>/<task-id>/iterations/iterations.jsonl
 *   <tasksDir>/<task-id>/patches/NNNN.diff
 *
 * This class never writes. All ids are validated and resolved paths are
 * checked to stay inside the tasks directory, so request input cannot be used
 * to read arbitrary files (path traversal).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DEV_AGENT_CONFIG, type DevAgentConfig } from './dev-agent.config';
import type {
  DevTask,
  DevTaskDetail,
  DevTaskSummary,
  Iteration,
  PatchDetail,
  PatchMeta,
} from './dev-agent.types';
import type {
  DevAgentChange, DevAgentRuntimeSnapshot, DevAgentToolEvent,
  DevAgentExternalApproval, DevAgentUserMessage, DevAgentWorker,
} from '@shared/api.interface';

const TASK_ID_RE = /^dev_[a-z0-9]+$/;
const PATCH_ID_RE = /^\d{4}$/;
const RESUMABLE_BLOCKS: ReadonlySet<string> = new Set([
  'iteration budget reached',
  'model call budget reached',
  'wall-clock time budget reached',
  'too many read-only probes without progress',
]);

function canResume(task: DevTask, iterations: Iteration[]): boolean {
  if (task.runtime_version === 2) return task.status === 'blocked';
  const last: Iteration | undefined = iterations.at(-1);
  return task.status === 'blocked' && last?.phase === 'block' && RESUMABLE_BLOCKS.has(last.decision);
}

/** Parse changed file paths from a unified diff (`+++ b/path`). */
export function parseDiffFiles(diff: string): string[] {
  const files: string[] = [];
  const re = /^\+\+\+ b\/(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(diff)) !== null) {
    files.push(m[1]);
  }
  return [...new Set(files)];
}

@Injectable()
export class TaskArtifactReader {
  private readonly tasksDir: string;

  constructor(@Inject(DEV_AGENT_CONFIG) config: DevAgentConfig) {
    this.tasksDir = path.resolve(config.tasksDir);
  }

  /** Validate the id and resolve it inside the tasks directory. */
  private taskDir(id: string): string {
    if (!TASK_ID_RE.test(id)) {
      throw new BadRequestException(`invalid task id: ${id}`);
    }
    const resolved = path.resolve(this.tasksDir, id);
    if (!resolved.startsWith(path.resolve(this.tasksDir) + path.sep)) {
      throw new BadRequestException(`invalid task id: ${id}`);
    }
    return resolved;
  }

  private patchPath(id: string, patchId: string): string {
    if (!PATCH_ID_RE.test(patchId)) {
      throw new BadRequestException(`invalid patch id: ${patchId}`);
    }
    const file = path.resolve(this.taskDir(id), 'patches', `${patchId}.diff`);
    const patchesRoot = path.resolve(this.tasksDir, id, 'patches');
    if (!file.startsWith(patchesRoot + path.sep)) {
      throw new BadRequestException(`invalid patch id: ${patchId}`);
    }
    return file;
  }

  /** Resolve every existing component before reading, including optional files. */
  private async runtimePath(id: string, parts: string[]): Promise<string> {
    const requested: string = this.taskDir(id);
    let root: string;
    let dir: string;
    try {
      root = await fs.realpath(this.tasksDir);
      dir = await fs.realpath(requested);
    } catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException(`task not found: ${id}`);
      }
      throw cause;
    }
    if (dir !== path.join(root, id)) throw new BadRequestException('task path is redirected');
    let current: string = dir;
    for (const part of parts) {
      current = path.join(current, part);
      try { current = await fs.realpath(current); }
      catch (cause: unknown) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      }
      if (!current.startsWith(dir + path.sep)) {
        throw new BadRequestException('runtime path escapes task directory');
      }
    }
    return current;
  }

  private async optionalRuntimeJson<T>(id: string, parts: string[], fallback: T): Promise<T> {
    const file: string = await this.runtimePath(id, parts);
    try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
    catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw cause;
    }
  }

  async getRuntime(id: string, cursor = 0): Promise<DevAgentRuntimeSnapshot> {
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new BadRequestException('invalid runtime cursor');
    const taskFile: string = await this.runtimePath(id, ['task.json']);
    const task: DevTask = await this.readJsonFile<DevTask>(taskFile);
    const state = await this.optionalRuntimeJson<Partial<DevAgentRuntimeSnapshot> & {
      waiting_for?: string; acknowledged_messages?: string[];
    }>(
      id, ['runtime', 'state.json'], {},
    );
    const checkpoint = await this.optionalRuntimeJson<{ changes?: DevAgentChange[] }>(
      id, ['runtime', 'checkpoints', 'state.json'], {},
    );
    const eventsFile: string = await this.runtimePath(id, ['runtime', 'events.jsonl']);
    let raw = '';
    try { raw = await fs.readFile(eventsFile, 'utf8'); }
    catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
    // A writer can be appending the final row while polling; only consume complete rows.
    const complete: string[] = raw.split('\n').slice(0, -1).filter((line: string) => line.trim() !== '');
    const events: DevAgentToolEvent[] = complete.map((line: string) => JSON.parse(line) as DevAgentToolEvent);
    const selected: DevAgentToolEvent[] = events.filter((event: DevAgentToolEvent) => event.index >= cursor).slice(0, 100);
    const nextCursor: number = selected.length === 0 ? cursor : selected[selected.length - 1].index + 1;
    const [messages, approvals, workerState] = await Promise.all([
      this.controlRecords<DevAgentUserMessage>(id, 'inbox'),
      this.controlRecords<DevAgentExternalApproval>(id, 'approvals'),
      this.optionalRuntimeJson<{ workers?: Record<string, DevAgentWorker> }>(
        id, ['runtime', 'workers', 'workers.json'], {}),
    ]);
    for (const approval of approvals) {
      const decision = await this.optionalRuntimeJson<{ status?: DevAgentExternalApproval['status'] }>(
        id, ['runtime', 'control', 'approvals', `${approval.id}.decision.json`], {});
      approval.status = decision.status ?? 'pending';
      const consumed: string = await this.runtimePath(id, ['runtime', 'control', 'approvals', `${approval.id}.consumed`]);
      try { await fs.access(consumed); approval.status = 'consumed'; }
      catch (cause: unknown) { if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause; }
    }
    return {
      version: state.version ?? null, revision: state.revision ?? null,
      changes: checkpoint.changes ?? [], events: selected,
      cursor: nextCursor, pending: state.pending ?? null, verification: state.verification ?? [],
      ...((task.runtime_version === 2 || state.version === 2) ? {
        plan: state.plan ?? [], memory: state.memory, capabilities: state.capabilities,
        workers: Object.values(workerState.workers ?? {}), approvals, messages,
        waitingFor: state.waiting_for ?? null,
          modelActivity: state.modelActivity,
        unreadMessageCount: messages.filter((message: DevAgentUserMessage) =>
          !(state.acknowledged_messages ?? []).includes(message.id)).length,
      } : {}),
    };
  }

  private async controlRecords<T extends { id: string; createdAt: string }>(id: string, kind: string): Promise<T[]> {
    const directory: string = await this.runtimePath(id, ['runtime', 'control', kind]);
    let names: string[];
    try { names = await fs.readdir(directory); }
    catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw cause;
    }
    const rows: T[] = await Promise.all(names.filter((name: string) => /^[a-f0-9]{32}\.json$/.test(name))
      .map(async (name: string): Promise<T> => {
        const file: string = await this.runtimePath(id, ['runtime', 'control', kind, name]);
        const row: T = await this.readJsonFile<T>(file);
        if (row.id !== name.slice(0, -5)) throw new BadRequestException('invalid control record');
        return row;
      }));
    return rows.sort((a: T, b: T) => a.createdAt.localeCompare(b.createdAt));
  }

  async getArtifact(id: string, artifactId: string): Promise<Buffer> {
    if (!/^[a-f0-9]{32}$/.test(artifactId)) throw new BadRequestException('invalid artifact id');
    const file: string = await this.runtimePath(id, ['runtime', 'artifacts', `${artifactId}.png`]);
    try {
      const data: Buffer = await fs.readFile(file);
      if (!data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        throw new BadRequestException('artifact is not a PNG');
      }
      return data;
    } catch (cause: unknown) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException(`artifact not found: ${artifactId}`);
      }
      throw cause;
    }
  }

  private async readJsonFile<T>(file: string): Promise<T> {
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException(`file not found: ${path.basename(file)}`);
      }
      throw e;
    }
    return JSON.parse(raw) as T;
  }

  private async readIterations(id: string, dir: string): Promise<Iteration[]> {
    const file = path.join(dir, 'iterations', 'iterations.jsonl');
    let raw: string;
    try {
      raw = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Iteration);
  }

  private async listPatchIds(dir: string): Promise<string[]> {
    const patchesDir = path.join(dir, 'patches');
    try {
      const entries = await fs.readdir(patchesDir);
      return entries
        .filter((f) => f.endsWith('.diff') && PATCH_ID_RE.test(f.replace(/\.diff$/, '')))
        .map((f) => f.replace(/\.diff$/, ''))
        .sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  private patchMeta(
    patchId: string,
    ids: string[],
    iterations: Iteration[],
  ): Pick<PatchMeta, 'patchId' | 'hypothesis' | 'createdAt'> {
    const proposals: Iteration[] = iterations.filter((iteration: Iteration) => (
      iteration.phase === 'patch' ||
      (iteration.phase === 'react' && iteration.action === 'apply_patch')
    ) && /^patch proposed(?:;|$)/.test(iteration.decision));
    // TaskStore saves each accepted proposal under the next continuous number.
    // Missing logs/files or numbering gaps make positional attribution unsafe.
    const reliable: boolean = proposals.length === ids.length && ids.every(
      (id: string, index: number) => Number(id) === index + 1,
    );
    const proposal: Iteration | undefined = reliable ? proposals[ids.indexOf(patchId)] : undefined;
    return {
      patchId,
      hypothesis: proposal?.hypothesis ?? '',
      createdAt: proposal?.created_at ?? null,
    };
  }

  async listTasks(): Promise<DevTaskSummary[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.tasksDir, { withFileTypes: true }).then((d) =>
        d.filter((e) => e.isDirectory() && TASK_ID_RE.test(e.name)).map((e) => e.name),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
    const rows: DevTaskSummary[] = [];
    for (const id of entries) {
      const dir = path.resolve(this.tasksDir, id);
      const task = await this.readJsonFile<DevTask>(path.join(dir, 'task.json'));
      const iterations = await this.readIterations(id, dir);
      rows.push({
        id: task.id,
        title: task.title,
        status: task.status,
        redSeen: task.red_seen,
        iterationCount: iterations.length,
        updatedAt: task.updated_at,
        canResume: canResume(task, iterations),
      });
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return rows;
  }

  async getTask(id: string): Promise<DevTaskDetail> {
    const dir = this.taskDir(id);
    const taskFile = path.join(dir, 'task.json');
    let task: DevTask;
    try {
      task = await this.readJsonFile<DevTask>(taskFile);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new NotFoundException(`task not found: ${id}`);
      }
      throw e;
    }
    const iterations = await this.readIterations(id, dir);
    const patchIds = await this.listPatchIds(dir);
    const meta = patchIds.length > 0
      ? this.patchMeta(patchIds[patchIds.length - 1], patchIds, iterations)
      : null;
    let latestPatch: PatchMeta | null = null;
    if (meta) {
      const diff = await fs.readFile(
        path.join(dir, 'patches', `${meta.patchId}.diff`),
        'utf8',
      );
      latestPatch = {
        patchId: meta.patchId,
        targetFiles: parseDiffFiles(diff),
        hypothesis: meta.hypothesis,
        createdAt: meta.createdAt,
      };
    }
    return { ...task, iterations, latestPatch, patchCount: patchIds.length, canResume: canResume(task, iterations) };
  }

  async getIterations(id: string): Promise<Iteration[]> {
    const dir = this.taskDir(id);
    await this.ensureTaskExists(id, dir);
    return this.readIterations(id, dir);
  }

  async getPatch(id: string, patchId: string): Promise<PatchDetail> {
    const file = this.patchPath(id, patchId);
    let diff: string;
    try {
      diff = await fs.readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new NotFoundException(`patch not found: ${patchId}`);
      }
      throw e;
    }
    // Hypothesis/created_at come from the matching patch iteration when present.
    const dir = this.taskDir(id);
    const iterations = await this.readIterations(id, dir);
    const patchIds: string[] = await this.listPatchIds(dir);
    const meta = this.patchMeta(patchId, patchIds, iterations);
    return {
      patchId,
      targetFiles: parseDiffFiles(diff),
      hypothesis: meta?.hypothesis ?? '',
      diff,
    };
  }

  private async ensureTaskExists(id: string, dir: string): Promise<void> {
    try {
      await fs.access(path.join(dir, 'task.json'));
    } catch {
      throw new NotFoundException(`task not found: ${id}`);
    }
  }
}

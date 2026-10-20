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
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type {
  DevTask,
  DevTaskDetail,
  DevTaskSummary,
  Iteration,
  PatchDetail,
  PatchMeta,
} from './dev-agent.types';

const TASK_ID_RE = /^dev_[a-z0-9]+$/;
const PATCH_ID_RE = /^\d{4}$/;

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

export class TaskArtifactReader {
  constructor(private readonly tasksDir: string) {}

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

  private latestPatchMeta(
    ids: string[],
    iterations: Iteration[],
  ): { patchId: string; hypothesis: string; createdAt: string | null } | null {
    if (ids.length === 0) return null;
    const patchId = ids[ids.length - 1];
    let hypothesis = '';
    let createdAt: string | null = null;
    for (let i = iterations.length - 1; i >= 0; i--) {
      if (iterations[i].phase === 'patch') {
        hypothesis = iterations[i].hypothesis ?? '';
        createdAt = iterations[i].created_at ?? null;
        break;
      }
    }
    return { patchId, hypothesis, createdAt };
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
    const meta = this.latestPatchMeta(patchIds, iterations);
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
    return { ...task, iterations, latestPatch, patchCount: patchIds.length };
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
    const meta = this.latestPatchMeta([patchId], iterations);
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

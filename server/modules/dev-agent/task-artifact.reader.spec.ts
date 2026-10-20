import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaskArtifactReader } from './task-artifact.reader';
import type { DevAgentConfig } from './dev-agent.config';
import type { DevTask } from './dev-agent.types';

/** Minimal config: the reader only touches tasksDir. */
function readerConfig(tasksDir: string): DevAgentConfig {
  return {
    enabled: true,
    binPath: '',
    tasksDir,
    workdir: '',
    runTimeoutMs: 1,
  };
}

const DIFF = [
  'diff --git a/server/x.ts b/server/x.ts',
  '--- a/server/x.ts',
  '+++ b/server/x.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

function baseTask(overrides: Partial<DevTask> = {}): DevTask {
  return {
    id: 'dev_abc123',
    title: 'rating cap',
    problem: 'rating says Hold but action Buy',
    acceptance: [{ id: 'ac1', description: 'consistent', check: 'unit' }],
    workdir: '/repo',
    branch: '',
    status: 'awaiting_approval',
    red_seen: true,
    diagnosis_rethink_count: 0,
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:05:00Z',
    ...overrides,
  };
}

describe('TaskArtifactReader', () => {
  let root: string;
  let reader: TaskArtifactReader;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-tasks-'));
    reader = new TaskArtifactReader(readerConfig(root));
    const dir = path.join(root, 'dev_abc123');
    await fs.mkdir(path.join(dir, 'iterations'), { recursive: true });
    await fs.mkdir(path.join(dir, 'patches'), { recursive: true });
    await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(baseTask()));
    await fs.writeFile(
      path.join(dir, 'iterations', 'iterations.jsonl'),
      [
        JSON.stringify({ index: 0, phase: 'diagnose', hypothesis: '', action: 'ask',
          model_calls: 2, observations: ['o'], decision: 'need patch',
          created_at: '2026-10-20T10:02:00Z' }),
        JSON.stringify({ index: 1, phase: 'patch', hypothesis: 'h1', action: 'apply_patch',
          model_calls: 1, observations: ['files: server/x.ts'],
          decision: 'patch proposed; awaiting approval',
          created_at: '2026-10-20T10:04:00Z' }),
      ].join('\n') + '\n',
    );
    await fs.writeFile(path.join(dir, 'patches', '0001.diff'), DIFF);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('lists tasks as summaries sorted by updated_at desc', async () => {
    const older = baseTask({ id: 'dev_older', status: 'new',
      updated_at: '2026-10-19T00:00:00Z' });
    const dir = path.join(root, 'dev_older');
    await fs.mkdir(path.join(dir, 'iterations'), { recursive: true });
    await fs.mkdir(path.join(dir, 'patches'), { recursive: true });
    await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(older));

    const rows = await reader.listTasks();
    expect(rows.map((r) => r.id)).toEqual(['dev_abc123', 'dev_older']);
    expect(rows[0]).toMatchObject({
      id: 'dev_abc123', title: 'rating cap', status: 'awaiting_approval',
      redSeen: true, iterationCount: 2,
    });
  });

  it('returns task detail with iterations and latest patch metadata', async () => {
    const detail = await reader.getTask('dev_abc123');
    expect(detail.status).toBe('awaiting_approval');
    expect(detail.iterations).toHaveLength(2);
    expect(detail.patchCount).toBe(1);
    expect(detail.latestPatch).toEqual({
      patchId: '0001',
      targetFiles: ['server/x.ts'],
      hypothesis: 'h1',
      createdAt: '2026-10-20T10:04:00Z',
    });
  });

  it('reads iterations and the patch diff text', async () => {
    const iters = await reader.getIterations('dev_abc123');
    expect(iters[1].decision).toContain('awaiting approval');
    const patch = await reader.getPatch('dev_abc123', '0001');
    expect(patch.targetFiles).toEqual(['server/x.ts']);
    expect(patch.diff).toContain('+new');
  });

  it('handles a task with no patches yet', async () => {
    const t = baseTask({ id: 'dev_clean', status: 'new' });
    const dir = path.join(root, 'dev_clean');
    await fs.mkdir(path.join(dir, 'iterations'), { recursive: true });
    await fs.mkdir(path.join(dir, 'patches'), { recursive: true });
    await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(t));
    const detail = await reader.getTask('dev_clean');
    expect(detail.latestPatch).toBeNull();
    expect(detail.patchCount).toBe(0);
    expect(detail.iterations).toEqual([]);
  });

  it('throws NotFound for a missing task', async () => {
    await expect(reader.getTask('dev_zzz')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects malformed task ids and patch ids (path traversal / injection)', async () => {
    await expect(reader.getTask('../x')).rejects.toBeInstanceOf(BadRequestException);
    await expect(reader.getTask('dev_x;rm')).rejects.toBeInstanceOf(BadRequestException);
    await expect(reader.getPatch('dev_abc123', '../../a')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns an empty list when the tasks directory does not exist', async () => {
    const missing = new TaskArtifactReader(readerConfig(path.join(root, 'does-not-exist')));
    await expect(missing.listTasks()).resolves.toEqual([]);
  });
});

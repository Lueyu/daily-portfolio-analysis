import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TaskArtifactReader } from './task-artifact.reader';
import type { DevAgentConfig } from './dev-agent.config';
import type { DevTask, Iteration } from './dev-agent.types';

/** Minimal config: the reader only touches tasksDir. */
function readerConfig(tasksDir: string): DevAgentConfig {
  return {
    enabled: true,
    binPath: '',
    binArgs: [],
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

  it('returns durable plan, messages and one-shot external approval status', async () => {
    const runtime = path.join(root, 'dev_abc123', 'runtime');
    const approvals = path.join(runtime, 'control', 'approvals');
    const inbox = path.join(runtime, 'control', 'inbox');
    await fs.mkdir(approvals, { recursive: true });
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(runtime, 'state.json'), JSON.stringify({ version: 2,
      plan: [{ step: '修复', status: 'in_progress' }], waiting_for: 'a'.repeat(32) }));
    await fs.writeFile(path.join(approvals, `${'a'.repeat(32)}.json`), JSON.stringify({
      id: 'a'.repeat(32), summary: 'Create issue', arguments: { tool: 'create' }, createdAt: '2026-10-26' }));
    await fs.writeFile(path.join(approvals, `${'a'.repeat(32)}.decision.json`), JSON.stringify({ status: 'approved' }));
    await fs.writeFile(path.join(approvals, `${'a'.repeat(32)}.consumed`), 'used');
    await fs.writeFile(path.join(inbox, `${'b'.repeat(32)}.json`), JSON.stringify({
      id: 'b'.repeat(32), text: '保留键盘操作', createdAt: '2026-10-26' }));
    const result = await reader.getRuntime('dev_abc123');
    expect(result.plan?.[0].step).toBe('修复');
    expect(result.approvals?.[0].status).toBe('consumed');
    expect(result.messages?.[0].text).toBe('保留键盘操作');
    expect(result.waitingFor).toBe('a'.repeat(32));
  });

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

  async function writeProposals(proposals: Partial<Iteration>[]): Promise<void> {
    const iterations: Iteration[] = proposals.map((proposal: Partial<Iteration>, index: number) => ({
      index, phase: 'react', action: 'apply_patch', hypothesis: `hypothesis ${index + 1}`,
      model_calls: 1, observations: [], decision: 'patch proposed',
      created_at: `2026-10-20T10:0${index + 1}:00Z`, ...proposal,
    }));
    await fs.writeFile(path.join(root, 'dev_abc123', 'iterations', 'iterations.jsonl'),
      iterations.map((iteration: Iteration) => JSON.stringify(iteration)).join('\n') + '\n');
  }

  it('matches current proposals to their saved historical patch and ignores rejected attempts', async () => {
    await writeProposals([
      { hypothesis: 'first candidate' },
      { hypothesis: 'rejected candidate', decision: 'rejected test-weakening patch' },
      { hypothesis: 'second candidate' },
    ]);
    await fs.writeFile(path.join(root, 'dev_abc123', 'patches', '0002.diff'), DIFF);
    expect((await reader.getPatch('dev_abc123', '0001')).hypothesis).toBe('first candidate');
    expect((await reader.getPatch('dev_abc123', '0002')).hypothesis).toBe('second candidate');
    expect((await reader.getTask('dev_abc123')).latestPatch).toMatchObject({
      patchId: '0002', hypothesis: 'second candidate', createdAt: '2026-10-20T10:03:00Z',
    });
  });

  it('matches legacy patch iterations to their own historical candidate', async () => {
    await writeProposals([
      { phase: 'patch', hypothesis: 'old first', decision: 'patch proposed; awaiting approval' },
      { phase: 'patch', hypothesis: 'old second', decision: 'patch proposed; awaiting approval' },
    ]);
    await fs.writeFile(path.join(root, 'dev_abc123', 'patches', '0002.diff'), DIFF);
    expect((await reader.getPatch('dev_abc123', '0001')).hypothesis).toBe('old first');
    expect((await reader.getTask('dev_abc123')).latestPatch?.hypothesis).toBe('old second');
  });

  it('leaves metadata empty when the saved patch and proposal counts differ', async () => {
    await fs.writeFile(path.join(root, 'dev_abc123', 'patches', '0002.diff'), DIFF);
    expect((await reader.getPatch('dev_abc123', '0001')).hypothesis).toBe('');
    expect((await reader.getTask('dev_abc123')).latestPatch).toMatchObject({
      patchId: '0002', hypothesis: '', createdAt: null,
    });
  });

  it('leaves metadata empty for unreliable patch numbering', async () => {
    await writeProposals([{ phase: 'patch' }, { phase: 'patch' }]);
    await fs.writeFile(path.join(root, 'dev_abc123', 'patches', '0003.diff'), DIFF);
    expect((await reader.getPatch('dev_abc123', '0001')).hypothesis).toBe('');
    expect((await reader.getTask('dev_abc123')).latestPatch).toMatchObject({
      patchId: '0003', hypothesis: '', createdAt: null,
    });
  });

  it('preserves a patch diff when proposal metadata is absent', async () => {
    await writeProposals([]);
    expect((await reader.getPatch('dev_abc123', '0001')).diff).toBe(DIFF);
    expect((await reader.getTask('dev_abc123')).latestPatch).toMatchObject({
      patchId: '0001', hypothesis: '', createdAt: null,
    });
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

  it('reads incremental runtime events and checkpoint history without invoking Python', async () => {
    const dir = path.join(root, 'dev_abc123', 'runtime');
    await fs.mkdir(path.join(dir, 'checkpoints'), { recursive: true });
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({
      version: 2, revision: 'a'.repeat(64), pending: { command: 'npm test' }, verification: [],
    }));
    const change = { id: 'c'.repeat(32), before: 'b'.repeat(64), after: 'a'.repeat(64),
      status: 'applied', reason: 'fix', tool: 'apply_patch', files: ['src/a.ts'] };
    await fs.writeFile(path.join(dir, 'checkpoints', 'state.json'), JSON.stringify({ changes: [change] }));
    await fs.writeFile(path.join(dir, 'events.jsonl'), [0, 1].map((index: number) => JSON.stringify({
      index, action: 'exec_command', summary: `event ${index}`, createdAt: '', payload: { stdout: 'ok' },
    })).join('\n') + '\n');
    const result = await reader.getRuntime('dev_abc123', 1);
    expect(result).toMatchObject({ version: 2, revision: 'a'.repeat(64), changes: [change], cursor: 2 });
    expect(result.events.map((event) => event.index)).toEqual([1]);
    expect(result.pending).toEqual({ command: 'npm test' });
  });

  it('returns an empty runtime snapshot for historical tasks', async () => {
    expect(await reader.getRuntime('dev_abc123')).toEqual({
      version: null, revision: null, changes: [], events: [], cursor: 0, pending: null, verification: [],
    });
  });

  it('rejects invalid runtime ids, cursors and artifact identifiers', async () => {
    await expect(reader.getRuntime('../dev_abc123')).rejects.toBeInstanceOf(BadRequestException);
    await expect(reader.getRuntime('dev_abc123', -1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(reader.getArtifact('dev_abc123', '../../task.json')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects runtime directories redirected outside the task by a junction', async () => {
    const outside = path.join(root, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'state.json'), '{"version":2}');
    await fs.symlink(outside, path.join(root, 'dev_abc123', 'runtime'), 'junction');
    await expect(reader.getRuntime('dev_abc123')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns only a validated PNG artifact within the task runtime', async () => {
    const dir = path.join(root, 'dev_abc123', 'runtime', 'artifacts');
    await fs.mkdir(dir, { recursive: true });
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    await fs.writeFile(path.join(dir, `${'a'.repeat(32)}.png`), png);
    expect(await reader.getArtifact('dev_abc123', 'a'.repeat(32))).toEqual(png);
    await expect(reader.getArtifact('dev_abc123', 'b'.repeat(32))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bounds each event page and leaves an incomplete appended row for the next poll', async () => {
    const dir = path.join(root, 'dev_abc123', 'runtime');
    await fs.mkdir(dir);
    const rows = Array.from({ length: 101 }, (_, index: number) => ({
      index, action: 'exec_command', summary: '', createdAt: '', payload: {},
    }));
    await fs.writeFile(path.join(dir, 'events.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n{"index":101');
    const first = await reader.getRuntime('dev_abc123', 0);
    expect(first.events).toHaveLength(100);
    expect(first.cursor).toBe(100);
    const second = await reader.getRuntime('dev_abc123', first.cursor);
    expect(second.events.map((event) => event.index)).toEqual([100]);
    expect(second.cursor).toBe(101);
  });

  it('rejects a task-directory junction and artifacts redirected outside the task', async () => {
    await fs.symlink(path.join(root, 'dev_abc123'), path.join(root, 'dev_linked'), 'junction');
    await expect(reader.getRuntime('dev_linked')).rejects.toBeInstanceOf(BadRequestException);
    const dir = path.join(root, 'dev_abc123', 'runtime');
    const outside = path.join(root, 'outside');
    await fs.mkdir(dir);
    await fs.mkdir(outside);
    await fs.symlink(outside, path.join(dir, 'artifacts'), 'junction');
    await expect(reader.getArtifact('dev_abc123', 'a'.repeat(32))).rejects.toBeInstanceOf(BadRequestException);
  });
});

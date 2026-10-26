import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DevAgentService } from './dev-agent.service';
import type { AgentProcessRunner, RunnerOptions } from './agent-process.runner';
import type { ProcessResult } from './dev-agent.types';
import type { DevAgentConfig } from './dev-agent.config';
import { TaskArtifactReader } from './task-artifact.reader';
import type { DevTask } from './dev-agent.types';

function task(overrides: Partial<DevTask> = {}): DevTask {
  return {
    id: 'dev_abc123',
    title: 't',
    problem: 'p',
    acceptance: [{ id: 'ac1', description: 'd', check: 'unit' }],
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

/** A controllable fake runner: records argv, can hang until explicitly released. */
class FakeRunner implements AgentProcessRunner {
  calls: string[][] = [];
  hang = false;
  private waiters: ((p: ProcessResult) => void)[] = [];
  private rejecters: ((error: Error) => void)[] = [];
  nextResult: ProcessResult | null = null;
  stopFailures = 0;
  deferStopControl = false;

  exec(argv: string[], opts?: RunnerOptions): Promise<ProcessResult> {
    this.calls.push(argv);
    if (this.hang && (argv[0] === 'run' || argv[0] === 'approve')) {
      return new Promise((resolve, reject) => {
        this.waiters.push(resolve);
        this.rejecters.push(reject);
        const stop = async (): Promise<void> => {
          if (this.stopFailures > 0) {
            this.stopFailures -= 1;
            throw new Error('cannot terminate process');
          }
          reject(Object.assign(new Error('agent run stopped'), { name: 'AbortError' }));
        };
        if (this.deferStopControl) setImmediate(() => opts?.onStopReady?.(stop));
        else opts?.onStopReady?.(stop);
        opts?.signal?.addEventListener('abort', () => { void stop().catch(reject); }, { once: true });
      });
    }
    return Promise.resolve(
      this.nextResult ?? {
        returnCode: 0,
        stdout: JSON.stringify({ ok: true, id: 'dev_abc123', status: 'awaiting_approval' }),
        stderr: '',
      },
    );
  }

  release(result: ProcessResult): void {
    this.rejecters.shift();
    this.waiters.shift()?.(result);
  }

  fail(error: Error): void {
    this.waiters.shift();
    this.rejecters.shift()?.(error);
  }
}

describe('DevAgentService', () => {
  let root: string;
  let tasksDir: string;
  let runner: FakeRunner;
  let cfg: DevAgentConfig;
  let service: DevAgentService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-svc-'));
    tasksDir = path.join(root, 'tasks');
    await fs.mkdir(tasksDir, { recursive: true });
    const binPath = path.join(root, 'agent.exe');
    writeFileSync(binPath, '');
    cfg = {
      enabled: true,
      binPath,
      binArgs: [],
      tasksDir,
      workdir: root,
      runTimeoutMs: 1000,
    };
    runner = new FakeRunner();
    service = new DevAgentService(cfg, new TaskArtifactReader(cfg), runner);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writeTask(t: DevTask): Promise<void> {
    const dir = path.join(tasksDir, t.id);
    await fs.mkdir(path.join(dir, 'iterations'), { recursive: true });
    await fs.mkdir(path.join(dir, 'patches'), { recursive: true });
    await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(t));
  }

  it('reports the feature disabled without throwing', () => {
    const disabled = new DevAgentService(
      { ...cfg, enabled: false },
      new TaskArtifactReader(cfg),
      runner,
    );
    expect(disabled.health().enabled).toBe(false);
  });

  it('queues bounded user instructions through the CLI without changing source', async () => {
    await writeTask(task({ runtime_version: 2, status: 'blocked' }));
    await service.sendMessage('dev_abc123', '保留键盘操作');
    expect(runner.calls[0]).toEqual(['message', 'dev_abc123', '--text', '保留键盘操作']);
    expect(runner.calls.some((call) => call[0] === 'run')).toBe(true);
    await expect(service.sendMessage('dev_abc123', ' ')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only accepts a concrete external approval request id', async () => {
    await writeTask(task({ runtime_version: 2, status: 'blocked' }));
    await expect(service.decideExternal('dev_abc123', '../escape', true)).rejects.toBeInstanceOf(BadRequestException);
    await service.decideExternal('dev_abc123', 'a'.repeat(32), false);
    expect(runner.calls[0]).toEqual(['decide', 'dev_abc123', '--request-id', 'a'.repeat(32), '--deny']);
    expect(runner.calls.some((call) => call[0] === 'run')).toBe(true);
  });

  it('resumes an unread message that races with the final model step', async () => {
    await writeTask(task({ runtime_version: 2, status: 'diagnosed' }));
    runner.hang = true;
    await service.startRun('dev_abc123');
    const inbox = path.join(tasksDir, 'dev_abc123', 'runtime', 'control', 'inbox');
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(path.join(inbox, `${'c'.repeat(32)}.json`), JSON.stringify({
      id: 'c'.repeat(32), text: 'late instruction', createdAt: '2026-10-26' }));
    await service.sendMessage('dev_abc123', 'late instruction');
    runner.hang = false;
    runner.release({ returnCode: 0, stdout: '{"ok":true}', stderr: '' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(runner.calls.filter((call) => call[0] === 'run')).toHaveLength(2);
  });

  it('rejects new instructions while the reviewed candidate is being landed', async () => {
    await writeTask(task({ runtime_version: 2, status: 'awaiting_approval' }));
    runner.hang = true;
    await service.approve('dev_abc123');
    await expect(service.sendMessage('dev_abc123', '还有一个新要求')).rejects.toBeInstanceOf(ConflictException);
    expect(runner.calls.some((call) => call[0] === 'message')).toBe(false);
    runner.hang = false;
    runner.release({ returnCode: 0, stdout: '{"ok":true}', stderr: '' });
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('refuses data access while disabled with 503', async () => {
    const disabled = new DevAgentService(
      { ...cfg, enabled: false },
      new TaskArtifactReader(cfg),
      runner,
    );
    await expect(disabled.listTasks()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('reports enabled health with bin and tasks dir present', () => {
    const h = service.health();
    expect(h.enabled).toBe(true);
    expect(h.binExists).toBe(true);
    expect(h.tasksDirExists).toBe(true);
  });

  it('creates a task and returns the full detail (with optional target)', async () => {
    // The CLI writes task.json before returning; seed the artifact so the
    // service can read back the full detail it returns to the client.
    await writeTask(task({ id: 'dev_new1', status: 'new', red_seen: false }));
    runner.nextResult = {
      returnCode: 0,
      stdout: JSON.stringify({ ok: true, id: 'dev_new1' }),
      stderr: '',
    };
    const out = await service.createTask({
      title: 'rating cap',
      problem: 'Hold but action Buy',
      acceptance: [
        { id: 'ac1', kind: 'unit', description: 'Hold: no buy' },
        { id: 'ac2', kind: 'e2e', description: 'login works', target: 'tests/x.spec.ts' },
      ],
    });
    expect(out.id).toBe('dev_new1');
    expect(out.status).toBe('new');
    expect(out.iterations).toEqual([]);
    expect(out.patchCount).toBe(0);
    expect(out.latestPatch).toBeNull();
    const argv = runner.calls[0];
    expect(argv[0]).toBe('new');
    expect(argv).toContain('ac1:unit:Hold： no buy');
    expect(argv).toContain('ac2:e2e:login works:tests/x.spec.ts');
    // The runner appends --json itself; the service only passes the inputs.
    expect(argv).not.toContain('--json');
  });

  it('surfaces a non-zero create exit as 500 with stderr', async () => {
    runner.nextResult = { returnCode: 2, stdout: '', stderr: 'boom' };
    await expect(
      service.createTask({
        title: 't', problem: 'p',
        acceptance: [{ id: 'a', kind: 'unit', description: 'd' }],
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  const runResult = (status: string): ProcessResult => ({
    returnCode: 0,
    stdout: JSON.stringify({ ok: true, id: 'dev_abc123', status }),
    stderr: '',
  });

  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('reports idle when this process has not started an artifact marked verifying', async () => {
    await writeTask(task({ status: 'verifying' }));
    expect((await service.getTask('dev_abc123')).execution).toEqual({
      state: 'idle', command: null, error: null,
    });
    expect((await service.listTasks())[0].execution).toEqual({
      state: 'idle', command: null, error: null,
    });
  });

  it('exposes a pending run in detail and list, then returns to idle without rewriting artifacts', async () => {
    const original: DevTask = task({ status: 'diagnosed' });
    await writeTask(original);
    runner.hang = true;
    await service.startRun('dev_abc123');
    const running = { state: 'running', command: 'run', error: null };
    expect((await service.getTask('dev_abc123')).execution).toEqual(running);
    expect((await service.listTasks())[0].execution).toEqual(running);
    await expect(service.approve('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    await expect(service.reject('dev_abc123', 'stop')).rejects.toBeInstanceOf(ConflictException);

    runner.release(runResult('awaiting_approval'));
    await tick();
    expect((await service.getTask('dev_abc123')).execution).toEqual({
      state: 'idle', command: null, error: null,
    });
    expect(JSON.parse(await fs.readFile(path.join(tasksDir, original.id, 'task.json'), 'utf8')))
      .toEqual(original);
  });

  it('exposes pending approval and rejects duplicate approval before returning to idle', async () => {
    await writeTask(task());
    runner.hang = true;
    await service.approve('dev_abc123');
    expect((await service.getTask('dev_abc123')).execution).toEqual({
      state: 'running', command: 'approve', error: null,
    });
    await expect(service.approve('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    runner.release(runResult('verified'));
    await tick();
    expect((await service.listTasks())[0].execution).toEqual({
      state: 'idle', command: null, error: null,
    });
  });

  it('preserves a bounded failed run error and clears it when retry starts', async () => {
    await writeTask(task());
    runner.hang = true;
    await service.startRun('dev_abc123');
    runner.release({ returnCode: 2, stdout: '', stderr: 'broken '.repeat(200) });
    await tick();
    const failed = (await service.getTask('dev_abc123')).execution;
    expect(failed).toMatchObject({ state: 'failed', command: 'run' });
    expect(failed?.error).toContain('agent run failed (exit 2): broken');
    expect(failed?.error?.length).toBeLessThanOrEqual(1000);
    expect((await service.listTasks())[0].execution).toEqual(failed);

    await service.startRun('dev_abc123');
    expect((await service.getTask('dev_abc123')).execution).toEqual({
      state: 'running', command: 'run', error: null,
    });
    runner.release(runResult('awaiting_approval'));
    await tick();
  });

  it('retains the command context and provider exception at the end of a long traceback', async () => {
    await writeTask(task());
    runner.hang = true;
    await service.startRun('dev_abc123');
    const providerError = 'RateLimitError: Error code: 429 - SetLimitExceeded: model usage limit reached';
    runner.release({
      returnCode: 1,
      stdout: '',
      stderr: `Traceback (most recent call last):\n${'  framework traceback frame\n'.repeat(100)}${providerError}`,
    });
    await tick();

    const failed = (await service.getTask('dev_abc123')).execution;
    expect(failed).toMatchObject({ state: 'failed', command: 'run' });
    expect(failed?.error).toContain('agent run failed (exit 1): Traceback');
    expect(failed?.error).toContain(providerError);
    expect(failed?.error?.length).toBeLessThanOrEqual(1000);
    expect((await service.listTasks())[0].execution).toEqual(failed);
  });

  it('reports invalid background JSON as failed', async () => {
    await writeTask(task());
    runner.hang = true;
    await service.approve('dev_abc123');
    runner.release({ returnCode: 0, stdout: 'not json', stderr: '' });
    await tick();
    expect((await service.getTask('dev_abc123')).execution).toEqual({
      state: 'failed', command: 'approve',
      error: 'agent approve returned non-JSON output: not json',
    });
  });

  it('reports rejected runner execution using only the error message', async () => {
    await writeTask(task());
    runner.hang = true;
    await service.approve('dev_abc123');
    runner.fail(Object.assign(new Error('spawn failed'), { env: { TOKEN: 'private-value' } }));
    await tick();
    expect((await service.getTask('dev_abc123')).execution).toEqual({
      state: 'failed', command: 'approve', error: 'spawn failed',
    });
    await service.approve('dev_abc123');
    expect((await service.getTask('dev_abc123')).execution?.error).toBeNull();
    runner.release(runResult('verified'));
    await tick();
  });

  it('rejects a second concurrent run with 409 and releases the lock afterwards', async () => {
    await writeTask(task({ status: 'awaiting_approval' }));
    runner.hang = true;

    const first = service.startRun('dev_abc123');
    await expect(service.startRun('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    await first; // first has now reached the hanging exec
    expect(runner.calls).toHaveLength(1);
    runner.release(runResult('awaiting_approval'));
    await tick();

    // Lock released: a subsequent run is accepted and re-acquires the lock.
    runner.hang = true;
    const second = service.startRun('dev_abc123');
    await expect(service.startRun('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    await second;
    runner.release(runResult('awaiting_approval'));
    await tick();
  });

  it('refuses to run a task already in a terminal state', async () => {
    await writeTask(task({ status: 'verified' }));
    await expect(service.startRun('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
  });

  it('approves only while awaiting approval, then spawns approve in background', async () => {
    await writeTask(task({ status: 'new' }));
    await expect(service.approve('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    expect(runner.calls).toHaveLength(0);

    await writeTask(task({ status: 'awaiting_approval' }));
    runner.hang = true;
    await service.approve('dev_abc123');
    expect(runner.calls[0][0]).toBe('approve');
    expect(runner.calls[0][1]).toBe('dev_abc123');
    runner.release(runResult('verified'));
    await tick();
  });

  it('rejects a patch synchronously and forwards the reason', async () => {
    await writeTask(task({ status: 'awaiting_approval' }));
    runner.nextResult = {
      returnCode: 0,
      stdout: JSON.stringify({ ok: true, id: 'dev_abc123', status: 'blocked' }),
      stderr: '',
    };
    const out = await service.reject('dev_abc123', 'bad diff');
    expect(out.status).toBe('blocked');
    const argv = runner.calls[0];
    expect(argv).toEqual(['reject', 'dev_abc123', '--reason', 'bad diff']);
  });

  it('rejects a patch only while awaiting approval', async () => {
    await writeTask(task({ status: 'new' }));
    await expect(service.reject('dev_abc123', 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('lists tasks from the artifact reader', async () => {
    await writeTask(task());
    const rows = await service.listTasks();
    expect(rows.map((r) => r.id)).toEqual(['dev_abc123']);
  });

  it.each([
    'iteration budget reached', 'model call budget reached',
    'wall-clock time budget reached', 'too many read-only probes without progress',
  ])('resumes only a saved budget block: %s', async (reason: string) => {
    await writeTask(task({ status: 'blocked' }));
    await fs.writeFile(path.join(tasksDir, 'dev_abc123', 'iterations', 'iterations.jsonl'),
      JSON.stringify({ index: 1, phase: 'block', decision: reason }) + '\n');
    expect((await service.getTask('dev_abc123')).canResume).toBe(true);
    expect((await service.listTasks())[0].canResume).toBe(true);
    await service.startRun('dev_abc123');
    expect(runner.calls[0]).toEqual(['run', 'dev_abc123', '--resume-budget']);
    await tick();
  });

  it('does not resume a rejected task even when an earlier iteration exhausted a budget', async () => {
    await writeTask(task({ status: 'blocked' }));
    await fs.writeFile(path.join(tasksDir, 'dev_abc123', 'iterations', 'iterations.jsonl'), [
      { index: 1, phase: 'block', decision: 'iteration budget reached' },
      { index: 2, phase: 'block', decision: 'user rejected patch' },
    ].map((row) => JSON.stringify(row)).join('\n'));
    expect((await service.getTask('dev_abc123')).canResume).toBe(false);
    await expect(service.startRun('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
  });

  it('stops an owned run, preserves artifacts, and releases its lock', async () => {
    const original: DevTask = task({ status: 'diagnosed' });
    await writeTask(original);
    runner.hang = true;
    await service.startRun(original.id);
    await service.stop(original.id);
    expect((await service.getTask(original.id)).execution).toEqual({
      state: 'stopped', command: 'run', error: null,
    });
    expect(JSON.parse(await fs.readFile(path.join(tasksDir, original.id, 'task.json'), 'utf8')))
      .toEqual(original);
    await service.startRun(original.id);
    expect((await service.getTask(original.id)).execution?.state).toBe('running');
    runner.release(runResult('awaiting_approval'));
    runner.release(runResult('awaiting_approval'));
    await tick();
  });

  it('refuses to stop approval or a run this process does not own', async () => {
    await writeTask(task());
    await expect(service.stop('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    runner.hang = true;
    await service.approve('dev_abc123');
    await expect(service.stop('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    expect((await service.getTask('dev_abc123')).execution?.state).toBe('running');
    runner.release(runResult('verified'));
    await tick();
  });

  it('retains ownership after a failed stop and permits retrying the same process', async () => {
    await writeTask(task({ status: 'diagnosed' }));
    runner.hang = true;
    runner.stopFailures = 1;
    await service.startRun('dev_abc123');
    await expect(service.stop('dev_abc123')).rejects.toThrow();
    expect((await service.getTask('dev_abc123')).execution?.state).toBe('running');
    await expect(service.startRun('dev_abc123')).rejects.toBeInstanceOf(ConflictException);
    expect(runner.calls).toHaveLength(1);
    await service.stop('dev_abc123');
    expect((await service.getTask('dev_abc123')).execution?.state).toBe('stopped');
  });

  it('waits for stop control when stop is requested immediately after launch', async () => {
    await writeTask(task({ status: 'diagnosed' }));
    runner.hang = true;
    runner.deferStopControl = true;
    await service.startRun('dev_abc123');
    await service.stop('dev_abc123');
    expect((await service.getTask('dev_abc123')).execution?.state).toBe('stopped');
  });

  async function writeRuntime(): Promise<void> {
    await writeTask(task({ status: 'blocked', runtime_version: 2 }));
    const dir = path.join(tasksDir, 'dev_abc123', 'runtime');
    await fs.mkdir(path.join(dir, 'checkpoints'), { recursive: true });
    await fs.writeFile(path.join(dir, 'state.json'), JSON.stringify({ version: 2, revision: 'a'.repeat(64) }));
    await fs.writeFile(path.join(dir, 'checkpoints', 'state.json'), JSON.stringify({ changes: [
      { id: 'c'.repeat(32), before: 'b'.repeat(64), after: 'a'.repeat(64), status: 'applied',
        reason: 'fix', tool: 'apply_patch', files: ['a.ts'] },
    ] }));
  }

  it('inspects runtime directly without starting a process or model', async () => {
    await writeRuntime();
    expect((await service.getRuntime('dev_abc123', 0)).version).toBe(2);
    expect(runner.calls).toEqual([]);
  });

  it('rejects stale mutations and invalid ids before invoking Python', async () => {
    await writeRuntime();
    await expect(service.undoChange('dev_abc123', { changeId: 'c'.repeat(32), expectedRevision: 'b'.repeat(64) }))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.undoChange('../bad', { changeId: 'c'.repeat(32), expectedRevision: 'a'.repeat(64) }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.restoreCheckpoint('dev_abc123', { revision: '../HEAD', expectedRevision: 'a'.repeat(64) }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(runner.calls).toEqual([]);
  });

  it('runs only an offline mutation and rejects an overlapping mutation while busy', async () => {
    await writeRuntime();
    runner.hang = true;
    const pending = service.undoChange('dev_abc123', { changeId: 'c'.repeat(32), expectedRevision: 'a'.repeat(64) });
    await expect(service.restoreCheckpoint('dev_abc123', { revision: 'b'.repeat(64), expectedRevision: 'a'.repeat(64) }))
      .rejects.toBeInstanceOf(ConflictException);
    while (runner.calls.length === 0) await tick();
    expect(runner.calls).toEqual([['undo', 'dev_abc123', '--change-id', 'c'.repeat(32), '--expected-revision', 'a'.repeat(64)]]);
    runner.release({ returnCode: 0, stdout: '{"ok":true}', stderr: '' });
    await pending;
  });

  it('surfaces a runtime undo conflict and releases the mutation lock', async () => {
    await writeRuntime();
    runner.nextResult = { returnCode: 1, stdout: '{"ok":false,"error":"overlapping file changes"}', stderr: '' };
    await expect(service.undoChange('dev_abc123', { changeId: 'c'.repeat(32), expectedRevision: 'a'.repeat(64) }))
      .rejects.toThrow('overlapping file changes');
    runner.nextResult = { returnCode: 0, stdout: '{"ok":true}', stderr: '' };
    await service.restoreCheckpoint('dev_abc123', { revision: 'b'.repeat(64), expectedRevision: 'a'.repeat(64) });
    expect(runner.calls[1][0]).toBe('restore');
  });

  it('allows resuming a general runtime block and stops its owned runtime after abort', async () => {
    await writeRuntime();
    expect((await service.getTask('dev_abc123')).canResume).toBe(true);
    runner.hang = true;
    await service.startRun('dev_abc123');
    await expect(service.undoChange('dev_abc123', { changeId: 'c'.repeat(32), expectedRevision: 'a'.repeat(64) }))
      .rejects.toBeInstanceOf(ConflictException);
    await service.stop('dev_abc123');
    expect(runner.calls).toEqual([['run', 'dev_abc123', '--resume-budget'], ['runtime-stop', 'dev_abc123']]);
  });

  it('rejects a pending runtime writer before starting a history command', async () => {
    await writeRuntime();
    await fs.writeFile(path.join(tasksDir, 'dev_abc123', 'runtime', 'state.json'), JSON.stringify({
      version: 2, revision: 'a'.repeat(64), pending: { session_id: 'active' },
    }));
    await expect(service.undoChange('dev_abc123', { changeId: 'c'.repeat(32), expectedRevision: 'a'.repeat(64) }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(runner.calls).toEqual([]);
  });

  it('reports cleanup failure instead of claiming an aborted runtime has stopped', async () => {
    await writeRuntime();
    runner.hang = true;
    await service.startRun('dev_abc123');
    runner.nextResult = { returnCode: 1, stdout: '{"ok":false,"error":"container did not stop","code":"busy"}', stderr: '' };
    await expect(service.stop('dev_abc123')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect((await service.getTask('dev_abc123')).execution).toMatchObject({
      state: 'failed', error: 'container did not stop',
    });
  });
});

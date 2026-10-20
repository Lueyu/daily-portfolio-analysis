import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DevAgentService } from './dev-agent.service';
import type { AgentProcessRunner } from './agent-process.runner';
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
  nextResult: ProcessResult | null = null;

  exec(argv: string[]): Promise<ProcessResult> {
    this.calls.push(argv);
    if (this.hang) {
      return new Promise((resolve) => this.waiters.push(resolve));
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
    this.waiters.shift()?.(result);
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
    cfg = { enabled: true, binPath, tasksDir, workdir: root, runTimeoutMs: 1000 };
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

  it('creates a task and builds the acceptance spec (with optional target)', async () => {
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
});

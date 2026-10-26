import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn, type SpawnOptions } from 'node:child_process';
import { BadRequestException } from '@nestjs/common';
import {
  ChildProcessRunner,
  type SpawnedChild,
  type SpawnFn,
} from './agent-process.runner';
import type { DevAgentConfig } from './dev-agent.config';

function makeFakeChild(): SpawnedChild & { emit: (e: string, ...a: unknown[]) => void; killed: boolean } {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const bus = new EventEmitter();
  return {
    stdout,
    stderr,
    killed: false,
    on: (ev, cb) => {
      bus.on(ev, cb as (...args: unknown[]) => void);
      return this as unknown as SpawnedChild;
    },
    emit: (ev, ...a) => bus.emit(ev, ...a),
    kill() {
      this.killed = true;
      bus.emit('close', null);
    },
  };
}

const cfg = {
  enabled: true,
  binPath: '/repo/agent/.venv/bin/agent',
  tasksDir: '/repo/agent/data/coder/tasks',
  workdir: '/repo',
  runTimeoutMs: 30000,
  binArgs: [],
} satisfies DevAgentConfig;

/** Runner that substitutes a fake child process instead of spawning one. */
class TestableRunner extends ChildProcessRunner {
  constructor(
    c: DevAgentConfig,
    private readonly fake: SpawnFn,
  ) {
    super(c);
  }

  protected override spawnChild(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): SpawnedChild {
    return this.fake(command, args, options);
  }
}

describe('ChildProcessRunner', () => {
  it('invokes the whitelisted subcommand with --json, fixed cwd and no shell', async () => {
    const child = makeFakeChild();
    const captured: { cmd?: string; args?: string[]; opts?: unknown } = {};
    const spawnFn: SpawnFn = (cmd, args, opts) => {
      captured.cmd = cmd;
      captured.args = args;
      captured.opts = opts;
      return child;
    };
    const runner = new TestableRunner(cfg, spawnFn);
    const p = runner.exec(['new', '--title', 't', '--problem', 'p', '--acceptance', 'a:unit:d']);
    child.stdout?.emit('data', Buffer.from('{"ok":true,"id":"dev_x"}'));
    child.emit('close', 0);
    const res = await p;

    expect(captured.cmd).toBe(cfg.binPath);
    expect(captured.args).toEqual([
      'dev', 'new', '--title', 't', '--problem', 'p',
      '--acceptance', 'a:unit:d', '--json',
    ]);
    const opts = captured.opts as { cwd: string; shell: boolean };
    expect(opts.cwd).toBe('/repo');
    expect(opts.shell).toBe(false);
    expect(res.returnCode).toBe(0);
    expect(res.stdout).toContain('"id":"dev_x"');
  });

  it('prepends configured bin args (interpreter + script) before the command', async () => {
    const child = makeFakeChild();
    const captured: { args?: string[] } = {};
    const runner = new TestableRunner(
      { ...cfg, binArgs: ['fake-agent.cjs'] },
      (_cmd, args) => {
        captured.args = args;
        return child;
      },
    );
    const p = runner.exec(['new', '--title', 't']);
    child.emit('close', 0);
    await p;
    expect(captured.args).toEqual([
      'fake-agent.cjs', 'dev', 'new', '--title', 't', '--json',
    ]);
  });

  it('rejects a subcommand that is not on the whitelist', async () => {
    const runner = new TestableRunner(cfg, () => makeFakeChild());
    await expect(runner.exec(['rm', '-rf', '/'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['undo', 'restore', 'runtime-stop'])('permits the offline %s command with a bounded timeout', async (command: string) => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const runner = new TestableRunner({ ...cfg, runTimeoutMs: 0 }, () => child);
      const pending = runner.exec([command, 'dev_x']);
      const result = expect(pending).rejects.toThrow(/timed out after 30000ms/);
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(child.killed).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('forwards stderr and the exit code on a non-zero exit', async () => {
    const child = makeFakeChild();
    const runner = new TestableRunner(cfg, () => child);
    const p = runner.exec(['run', 'dev_x']);
    child.stderr?.emit('data', Buffer.from('boom'));
    child.emit('close', 2);
    const res = await p;
    expect(res.returnCode).toBe(2);
    expect(res.stderr).toBe('boom');
  });

  it('kills the process and rejects when the timeout elapses', async () => {
    const child = makeFakeChild();
    const runner = new TestableRunner(cfg, () => child);
    const p = runner.exec(['run', 'dev_x'], { timeoutMs: 20 });
    await expect(p).rejects.toThrow(/timed out/i);
    expect(child.killed).toBe(true);
  });

  it.each([0, null])('disables total runtime timeout with %s', async (timeoutMs) => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const runner = new TestableRunner({ ...cfg, runTimeoutMs: timeoutMs }, () => child);
      const pending = runner.exec(['run', 'dev_x']);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(child.killed).toBe(false);
      child.emit('close', 0);
      await expect(pending).resolves.toMatchObject({ returnCode: 0 });
    } finally { vi.useRealTimers(); }
  });

  it('aborts an owned process and rejects with AbortError', async () => {
    const child = makeFakeChild();
    const runner = new TestableRunner({ ...cfg, runTimeoutMs: 0 }, () => child);
    const controller = new AbortController();
    const pending = runner.exec(['run', 'dev_x'], { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(child.killed).toBe(true);
  });

  it('does not spawn for an already aborted signal', async () => {
    const spawn = vi.fn(() => makeFakeChild());
    const runner = new TestableRunner(cfg, spawn);
    const controller = new AbortController();
    controller.abort();
    await expect(runner.exec(['run', 'dev_x'], { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps the run pending until its process has actually closed after stopping', async () => {
    const child = makeFakeChild();
    child.kill = () => { child.killed = true; };
    const runner = new TestableRunner({ ...cfg, runTimeoutMs: 0 }, () => child);
    const controller = new AbortController();
    const pending = runner.exec(['run', 'dev_x'], { signal: controller.signal });
    const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    let settled = false;
    void pending.catch(() => { settled = true; });
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    child.emit('close', null);
    await stopped;
  });

  it('retains the live process after a failed kill and allows another stop attempt', async () => {
    const child = makeFakeChild();
    class RetryRunner extends TestableRunner {
      attempts = 0;
      protected override async terminateChild(target: SpawnedChild): Promise<void> {
        if (this.attempts++ === 0) throw new Error('kill denied');
        await super.terminateChild(target);
      }
    }
    const runner = new RetryRunner({ ...cfg, runTimeoutMs: 0 }, () => child);
    const control: { stop?: () => Promise<void> } = {};
    const pending = runner.exec(['run', 'dev_x'], { onStopReady: (stop) => { control.stop = stop; } });
    const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    let settled = false;
    void pending.catch(() => { settled = true; });
    if (!control.stop) throw new Error('stop handle missing');
    await expect(control.stop()).rejects.toThrow('kill denied');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    await control.stop();
    await stopped;
    expect(child.killed).toBe(true);
  });

  it('settles normally when a failed kill races with a confirmed natural close', async () => {
    const child = makeFakeChild();
    class ExitRaceRunner extends TestableRunner {
      protected override async terminateChild(): Promise<void> {
        child.emit('close', 0);
        throw new Error('process no longer exists');
      }
    }
    const runner = new ExitRaceRunner({ ...cfg, runTimeoutMs: 0 }, () => child);
    const control: { stop?: () => Promise<void> } = {};
    const pending = runner.exec(['run', 'dev_x'], { onStopReady: (stop) => { control.stop = stop; } });
    if (!control.stop) throw new Error('stop handle missing');
    await control.stop();
    await expect(pending).resolves.toMatchObject({ returnCode: 0 });
  });

  it('keeps short commands bounded even when long-running limits are disabled', async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const runner = new TestableRunner({ ...cfg, runTimeoutMs: 0 }, () => child);
      const pending = runner.exec(['new', '--title', 't']);
      const result = expect(pending).rejects.toThrow(/timed out after 30000ms/);
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
      expect(child.killed).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('terminates a real owned child and its descendant before abort settles', async () => {
    let descendantPid = 0;
    let ready: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { ready = resolve; });
    const code = "const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(c.pid); setInterval(()=>{},1000)";
    const runner = new TestableRunner({
      ...cfg, binPath: process.execPath, binArgs: ['-e', code, '--'], workdir: process.cwd(), runTimeoutMs: 0,
    }, (command, args, options) => {
      const child = spawn(command, args, options);
      child.stdout?.once('data', (data: Buffer) => { descendantPid = Number(data.toString().trim()); ready(); });
      return child;
    });
    const controller = new AbortController();
    const pending = runner.exec(['run', 'dev_x'], { signal: controller.signal });
    const stopped = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    try {
      await started;
      expect(descendantPid).toBeGreaterThan(0);
      controller.abort();
      await stopped;
      expect(() => process.kill(descendantPid, 0)).toThrow();
    } finally {
      controller.abort();
      await stopped;
    }
  }, 10_000);
});

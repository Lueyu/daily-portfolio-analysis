import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { BadRequestException } from '@nestjs/common';
import { ChildProcessRunner, type SpawnedChild, type SpawnFn } from './agent-process.runner';

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
    },
  };
}

const cfg = {
  binPath: '/repo/agent/.venv/bin/agent',
  workdir: '/repo',
  runTimeoutMs: 30000,
};

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
    const runner = new ChildProcessRunner(cfg, spawnFn);
    const p = runner.exec(['new', '--title', 't', '--problem', 'p', '--acceptance', 'a:unit:d']);
    child.stdout?.emit('data', Buffer.from('{"ok":true,"id":"dev_x"}'));
    child.emit('close', 0);
    const res = await p;

    expect(captured.cmd).toBe(cfg.binPath);
    expect(captured.args).toEqual([
      'new', '--title', 't', '--problem', 'p',
      '--acceptance', 'a:unit:d', '--json',
    ]);
    const opts = captured.opts as { cwd: string; shell: boolean };
    expect(opts.cwd).toBe('/repo');
    expect(opts.shell).toBe(false);
    expect(res.returnCode).toBe(0);
    expect(res.stdout).toContain('"id":"dev_x"');
  });

  it('rejects a subcommand that is not on the whitelist', async () => {
    const runner = new ChildProcessRunner(cfg, () => makeFakeChild());
    await expect(runner.exec(['rm', '-rf', '/'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards stderr and the exit code on a non-zero exit', async () => {
    const child = makeFakeChild();
    const runner = new ChildProcessRunner(cfg, () => child);
    const p = runner.exec(['run', 'dev_x']);
    child.stderr?.emit('data', Buffer.from('boom'));
    child.emit('close', 2);
    const res = await p;
    expect(res.returnCode).toBe(2);
    expect(res.stderr).toBe('boom');
  });

  it('kills the process and rejects when the timeout elapses', async () => {
    const child = makeFakeChild();
    const runner = new ChildProcessRunner(cfg, () => child);
    const p = runner.exec(['run', 'dev_x'], { timeoutMs: 20 });
    await expect(p).rejects.toThrow(/timed out/i);
    expect(child.killed).toBe(true);
  });
});

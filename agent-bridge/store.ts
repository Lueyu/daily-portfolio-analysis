import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Task, TaskState } from '@a2a-js/sdk';
import { InMemoryTaskStore, ServerCallContext } from '@a2a-js/sdk/server';

export class DiskTaskStore extends InMemoryTaskStore {
  private writing: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string) { super(() => 'bridge-owner'); }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const context = new ServerCallContext();
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/u.test(name)) continue;
      const task = Task.fromJSON(JSON.parse(await readFile(join(this.directory, name), 'utf8')));
      if (!task.id || !task.contextId || !task.status) throw new Error('Invalid local task store');
      const terminal = [TaskState.TASK_STATE_COMPLETED, TaskState.TASK_STATE_CANCELED,
        TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_REJECTED].includes(task.status.state);
      if (!terminal) {
        task.status = { state: TaskState.TASK_STATE_FAILED, timestamp: new Date().toISOString(), message: undefined };
        task.metadata = { ...task.metadata, interrupted: true, error: 'Agent bridge restarted; task was not re-executed.' };
        await this.save(task, context);
      } else await super.save(task, context);
    }
  }

  override async save(task: Task, context: ServerCallContext): Promise<void> {
    const body = JSON.stringify(Task.toJSON(task));
    const name = createHash('sha256').update(task.id).digest('hex');
    const operation = this.writing.then(async () => {
      const temporary = join(this.directory, `${name}.${randomUUID()}.tmp`);
      await writeFile(temporary, body, { mode: 0o600 });
      await rename(temporary, join(this.directory, `${name}.json`));
      await super.save(Task.fromJSON(JSON.parse(body)), context);
    });
    this.writing = operation.catch(() => {});
    await operation;
  }
}

import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function createUpdateBackup(
  backupRoot: string,
  secretsRoot: string,
  dump: (destination: string) => Promise<void>,
): Promise<string> {
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const name = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}`;
  const pending = join(backupRoot, `.pending-${name}`);
  const complete = join(backupRoot, name);
  await mkdir(pending, { mode: 0o700 });
  try {
    const databaseFile = join(pending, 'database.dump');
    await dump(databaseFile);
    if ((await stat(databaseFile)).size === 0) throw new Error('Database backup is empty');
    await chmod(databaseFile, 0o600);
    for (const filename of ['jwt.key', 'settings.key']) {
      try {
        const target = join(pending, filename);
        await copyFile(join(secretsRoot, filename), target);
        await chmod(target, 0o600);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    await rename(pending, complete);
    return complete;
  } catch (error) {
    await rm(pending, { recursive: true, force: true });
    throw error;
  }
}

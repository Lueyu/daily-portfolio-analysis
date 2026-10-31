import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { desktopPaths, loadOrCreateSecrets, startDesktopDatabase } from './runtime.mts';

const dataRoot = process.argv[2];
if (!dataRoot) throw new Error('Missing crash-test data root');
void (async () => {
  const paths = desktopPaths(resolve('.'), dataRoot);
  const secrets = await loadOrCreateSecrets(paths.secretsFile);
  await startDesktopDatabase(paths, secrets);
  await writeFile(join(dataRoot, 'ready'), String(process.pid));
  setInterval(() => undefined, 60_000);
})();

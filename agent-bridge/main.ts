import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createBridge } from './server';

async function main(): Promise<void> {
  const port = Number(process.env.SQUABBLE_A2A_PORT || 4310);
  const host = process.env.SQUABBLE_A2A_HOST || '127.0.0.1';
  const timeoutMs = Number(process.env.SQUABBLE_A2A_TIMEOUT_MS || 600_000);
  const maxConcurrent = Number(process.env.SQUABBLE_A2A_CONCURRENCY || 1);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs)
    || timeoutMs < 1000 || timeoutMs > 3_600_000 || !Number.isInteger(maxConcurrent)
    || maxConcurrent < 1 || maxConcurrent > 4) throw new Error('Invalid bridge port, timeout or concurrency');
  const publicUrl = process.env.SQUABBLE_A2A_PUBLIC_URL || `http://127.0.0.1:${port}`;
  const url = new URL(publicUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || url.pathname !== '/') throw new Error('SQUABBLE_A2A_PUBLIC_URL must be an HTTP origin');
  const bridge = await createBridge({ token: process.env.SQUABBLE_A2A_TOKEN || '',
    binary: process.env.SQUABBLE_CODEX_BINARY || (process.platform === 'win32' ? 'codex.exe' : 'codex'),
    root: resolve(process.env.SQUABBLE_A2A_DATA_DIR || join(homedir(), '.squabble-agent-bridge')),
    publicUrl, timeoutMs, maxConcurrent });
  const server = bridge.app.listen(port, host, () => {
    process.stdout.write(`Squabble local agent listening on ${host}:${port}\nAgent Card: ${publicUrl}/.well-known/agent-card.json\n`);
  });
  server.on('error', () => { process.stderr.write('Could not listen on the configured bridge address\n'); process.exitCode = 1; });
  const stop = () => {
    server.close();
    void bridge.shutdown().then(() => setTimeout(() => process.exit(0), 2000));
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Local agent bridge failed to start'}\n`);
  process.exitCode = 1;
});

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

export interface RunResult { text: string; totalTokens?: number }
export interface RunOptions {
  binary: string;
  root: string;
  timeoutMs: number;
  signal: AbortSignal;
  progress: (message: string) => void;
  secrets?: string[];
}

export function redact(text: string, secrets: string[] = []): string {
  let result = text;
  for (const secret of secrets.filter(value => value.length >= 8)) result = result.split(secret).join('[redacted]');
  return result.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/gu, '[redacted]');
}

export function codexArgs(workspace: string, output: string): string[] {
  return ['--search', '--ask-for-approval', 'never', 'exec', '--json', '--sandbox', 'read-only',
    '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--color', 'never', '--cd', workspace, '--output-last-message', output, '-'];
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Never expose the bridge Bearer token, webapp secrets, or financial API keys to the child.
  for (const key of ['PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC',
    'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TMP', 'TEMP', 'TMPDIR', 'CODEX_HOME',
    'LANG', 'LC_ALL', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

async function stopTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.once('error', () => { child.kill(); resolve(); });
      killer.once('close', () => resolve());
    });
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }
}

export async function runCodex(prompt: string, options: RunOptions): Promise<RunResult> {
  if (options.signal.aborted) throw new Error('Agent task canceled');
  await mkdir(join(options.root, 'workspaces'), { recursive: true, mode: 0o700 });
  const workspace = await mkdtemp(join(options.root, 'workspaces', 'task-'));
  const output = join(workspace, 'final-response.txt');
  const child = spawn(options.binary, codexArgs(workspace, output), { shell: false, windowsHide: true,
    detached: process.platform !== 'win32', cwd: workspace, env: childEnvironment(), stdio: ['pipe', 'pipe', 'pipe'] });
  let totalTokens: number | undefined;
  let partial = '';
  let timedOut = false;
  let stopped = false;
  let lastProgress = '';
  const cancel = () => { stopped = true; void stopTree(child); };
  const timer = setTimeout(() => { timedOut = true; cancel(); }, options.timeoutMs);
  options.signal.addEventListener('abort', cancel, { once: true });
  if (options.signal.aborted) cancel();
  child.stderr.resume(); // Diagnostics can contain paths/credentials. Never return or log them.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    partial += chunk;
    if (partial.length > 1024 * 1024) partial = '';
    const lines = partial.split('\n'); partial = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as { type?: string; usage?: { input_tokens?: number; output_tokens?: number };
          item?: { type?: string } };
        if (event.type === 'turn.completed' && event.usage) {
          const input = event.usage.input_tokens; const outputTokens = event.usage.output_tokens;
          if (Number.isSafeInteger(input) && Number.isSafeInteger(outputTokens)
            && input! >= 0 && outputTokens! >= 0) totalTokens = input! + outputTokens!;
        }
        const type = event.item?.type;
        const progress = type === 'web_search' ? 'Searching public sources'
          : type === 'command_execution' ? 'Checking research evidence' : '';
        if (progress && progress !== lastProgress) { lastProgress = progress; options.progress(progress); }
      } catch { /* Ignore diagnostics and unknown events; never relay raw reasoning or tool payloads. */ }
    }
  });
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', () => reject(new Error('Could not start Codex. Check the configured executable and local login.')));
      child.once('close', resolve);
    });
    if (timedOut) throw new Error('Local agent exceeded the task time limit');
    if (stopped || options.signal.aborted) throw new Error('Agent task canceled');
    if (code !== 0) throw new Error('Local agent failed. Check Codex authentication and version on the agent machine.');
    const size = await stat(output).then(file => file.size).catch(() => 0);
    if (size > 1024 * 1024) throw new Error('Local agent returned an oversized final report');
    const raw = await readFile(output, 'utf8').catch(() => '');
    if (!raw.trim() || Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Local agent returned no usable final report');
    return { text: redact(raw, options.secrets), totalTokens };
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', cancel);
    const local = relative(options.root, workspace);
    if (local && !local.startsWith('..') && !isAbsolute(local)) await rm(workspace, { recursive: true, force: true });
  }
}

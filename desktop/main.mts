import { appendFileSync, createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { app, BrowserWindow, dialog, session, shell, utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import {
  desktopPaths,
  loadOrCreateSecrets,
  loadOrCreateServerPort,
  nestEnvironment,
  startDesktopDatabase,
  waitForHealth,
} from './runtime.mjs';
import type { DesktopDatabase } from './runtime.mjs';

let window: BrowserWindow | null = null;
let backend: UtilityProcess | null = null;
let database: DesktopDatabase | null = null;
let backendLog: ReturnType<typeof createWriteStream> | null = null;
let quitting = false;
let quitAllowed = false;

function markSmokeStage(stage: string): void {
  const root = process.env.SQUABBLE_DESKTOP_DATA_DIR;
  if (process.env.SQUABBLE_DESKTOP_SMOKE !== '1' || !root || !isAbsolute(root)) return;
  try {
    appendFileSync(join(root, 'packaged-smoke-stage.log'), `${stage}\n`, { mode: 0o600 });
  } catch {
    // Diagnostics must never change application startup.
  }
}

async function stopBackend(): Promise<void> {
  if (!backend) return;
  const child = backend;
  backend = null;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
  backendLog?.end();
  backendLog = null;
}

async function stopServices(): Promise<void> {
  if (quitting) return;
  quitting = true;
  await stopBackend();
  if (database) {
    const current = database;
    database = null;
    await current.stop();
  }
}

function externalLink(value: string, ownOrigin: string): void {
  try {
    const target = new URL(value);
    if (target.origin !== ownOrigin && (target.protocol === 'https:' || target.protocol === 'http:')) {
      void shell.openExternal(target.toString());
    }
  } catch {
    // Invalid URLs stay inside neither the app nor the operating system.
  }
}

async function startDesktop(): Promise<void> {
  markSmokeStage('start-desktop');
  const override = process.env.SQUABBLE_DESKTOP_DATA_DIR;
  if (override && !isAbsolute(override)) throw new Error('Desktop data directory must be absolute');
  const dataRoot = override ?? app.getPath('userData');
  const paths = desktopPaths(app.getAppPath(), dataRoot);
  const secrets = await loadOrCreateSecrets(paths.secretsFile);
  markSmokeStage('before-database');
  database = await startDesktopDatabase(paths, secrets);
  markSmokeStage('after-database');
  const port = await loadOrCreateServerPort(paths.serverPortFile);
  const origin = `http://127.0.0.1:${port}`;
  const environment = nestEnvironment(paths, secrets, database.connectionUrl, port);

  backendLog = createWriteStream(join(paths.logsDir, 'backend.log'), { flags: 'a', mode: 0o600 });
  backendLog.on('error', () => undefined);
  backend = utilityProcess.fork(paths.serverEntry, [], {
    cwd: paths.resourceRoot,
    env: environment,
    stdio: 'pipe',
  });
  backend.stdout?.pipe(backendLog, { end: false });
  backend.stderr?.pipe(backendLog, { end: false });
  backend.on('exit', () => {
    if (!quitting) {
      dialog.showErrorBox('Squabble stopped', 'The local server exited. See the log in your Squabble data folder.');
      app.quit();
    }
  });
  await Promise.race([
    waitForHealth(origin, 45_000),
    new Promise<never>((_resolve, reject) => backend?.once('exit', () => reject(new Error('Local server exited during startup')))),
  ]);
  markSmokeStage('server-healthy');

  if (process.env.SQUABBLE_DESKTOP_SMOKE === '1') {
    const response = await fetch(`${origin}/api/auth/registration-status`);
    if (!response.ok || (await response.json() as { registrationOpen?: boolean }).registrationOpen !== true) {
      throw new Error('Packaged desktop first-run registration is unavailable');
    }
    await writeFile(join(dataRoot, 'packaged-smoke.json'), JSON.stringify({
      healthy: true, registrationOpen: true, defaultDataRoot: app.getPath('userData'),
    }));
    markSmokeStage('smoke-marker-written');
    app.quit();
    return;
  }

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    externalLink(url, origin);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    try { allowed = new URL(url).origin === origin; } catch { /* block malformed navigation */ }
    if (!allowed) {
      event.preventDefault();
      externalLink(url, origin);
    }
  });
  window.once('ready-to-show', () => window?.show());
  await window.loadURL(origin);
}

markSmokeStage('module-loaded');
app.setName('Squabble');

markSmokeStage('before-single-instance-lock');
const singleInstance = app.requestSingleInstanceLock();
markSmokeStage(`single-instance-lock-${singleInstance ? 'acquired' : 'denied'}`);
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitAllowed) return;
    event.preventDefault();
    void stopServices().finally(() => {
      quitAllowed = true;
      app.quit();
    });
  });
  markSmokeStage('before-when-ready');
  void app.whenReady().then(() => {
    markSmokeStage('after-when-ready');
    return startDesktop();
  }).catch(async (error: unknown) => {
    markSmokeStage('startup-error');
    dialog.showErrorBox('Squabble could not start', error instanceof Error ? error.message : String(error));
    await stopServices();
    app.quit();
  });
}

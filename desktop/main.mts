import { appendFileSync, createWriteStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { autoUpdater } from 'electron-updater';
import { app, BrowserWindow, dialog, Menu, session, shell, utilityProcess } from 'electron';
import type { MenuItemConstructorOptions, UtilityProcess } from 'electron';
import {
  desktopPaths,
  loadOrCreateSecrets,
  loadOrCreateServerPort,
  nestEnvironment,
  startDesktopDatabase,
  waitForHealth,
} from './runtime.mjs';
import type { DesktopDatabase } from './runtime.mjs';
import { checkForUpdate, isNewerVersion } from './update-check.mjs';
import { isAutomaticUpdateSupported } from './auto-update.mjs';

let window: BrowserWindow | null = null;
let backend: UtilityProcess | null = null;
let database: DesktopDatabase | null = null;
let backendLog: ReturnType<typeof createWriteStream> | null = null;
let quitting = false;
let quitAllowed = false;
let checkingForUpdate = false;

async function showWindowsUpdateCheck(chinese: boolean, silent: boolean): Promise<void> {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  const result = await autoUpdater.checkForUpdates();
  const version = result?.updateInfo.version;
  if (!version || !isNewerVersion(version, app.getVersion())) {
    if (!silent) await dialog.showMessageBox({ type: 'info', title: 'Squabble',
      message: chinese ? '已是最新版本' : 'Squabble is up to date',
      detail: chinese ? `当前版本：${app.getVersion()}` : `Current version: ${app.getVersion()}` });
    return;
  }
  const choice = await dialog.showMessageBox({ type: 'info', title: 'Squabble',
    message: chinese ? `发现新版本 ${version}` : `Version ${version} is available`,
    detail: chinese ? '下载后可以立即重启安装，数据会保留。' : 'Download and restart to install. Your data will be kept.',
    buttons: chinese ? ['下载更新', '稍后'] : ['Download update', 'Later'],
    defaultId: 0, cancelId: 1 });
  if (choice.response !== 0) return;
  const progress = (_event: { percent: number }) => window?.setProgressBar(_event.percent / 100);
  autoUpdater.on('download-progress', progress);
  try {
    await autoUpdater.downloadUpdate();
  } finally {
    autoUpdater.off('download-progress', progress);
    window?.setProgressBar(-1);
  }
  const install = await dialog.showMessageBox({ type: 'info', title: 'Squabble',
    message: chinese ? '更新已下载' : 'Update downloaded',
    detail: chinese ? '现在重启 Squabble 以完成安装？' : 'Restart Squabble now to finish installing?',
    buttons: chinese ? ['重启并安装', '稍后'] : ['Restart and install', 'Later'],
    defaultId: 0, cancelId: 1 });
  if (install.response === 0) {
    await stopServices();
    quitAllowed = true;
    autoUpdater.quitAndInstall(false, true);
  }
}

async function showUpdateCheck(silent = false): Promise<void> {
  if (checkingForUpdate) return;
  checkingForUpdate = true;
  const chinese = app.getLocale().toLowerCase().startsWith('zh');
  try {
    if (isAutomaticUpdateSupported(process.platform, process.arch, app.isPackaged)) {
      await showWindowsUpdateCheck(chinese, silent);
      return;
    }
    const update = await checkForUpdate(app.getVersion(), process.platform, process.arch);
    if (!update) {
      await dialog.showMessageBox({ type: 'info', title: 'Squabble',
        message: chinese ? '已是最新版本' : 'Squabble is up to date',
        detail: chinese ? `当前版本：${app.getVersion()}` : `Current version: ${app.getVersion()}` });
      return;
    }
    const choice = await dialog.showMessageBox({ type: 'info', title: 'Squabble',
      message: chinese ? `发现新版本 ${update.version}` : `Version ${update.version} is available`,
      detail: update.notes || (chinese ? '查看发布页面了解更新内容。' : 'See the release page for details.'),
      buttons: chinese ? ['打开下载页面', '稍后'] : ['Open download page', 'Later'],
      defaultId: 0, cancelId: 1,
    });
    if (choice.response === 0) await shell.openExternal(update.downloadUrl);
  } catch {
    if (!silent) await dialog.showMessageBox({ type: 'warning', title: 'Squabble',
      message: chinese ? '检查更新失败' : 'Could not check for updates',
      detail: chinese ? '请检查网络连接，或前往 GitHub Releases 页面查看。'
        : 'Check your connection or visit Squabble Releases on GitHub.' });
  } finally {
    checkingForUpdate = false;
  }
}

function installApplicationMenu(): void {
  const chinese = app.getLocale().toLowerCase().startsWith('zh');
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : [
      { label: chinese ? '文件' : 'File', submenu: [{ role: 'quit' as const }] },
    ]),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { label: chinese ? '帮助' : 'Help', submenu: [
      { label: chinese ? '检查更新…' : 'Check for Updates…', click: () => { void showUpdateCheck(); } },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

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
  if (isAutomaticUpdateSupported(process.platform, process.arch, app.isPackaged)) {
    setTimeout(() => { if (!quitting) void showUpdateCheck(true); }, 20_000).unref();
    setInterval(() => { if (!quitting) void showUpdateCheck(true); }, 6 * 60 * 60_000).unref();
  }
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
    installApplicationMenu();
    return startDesktop();
  }).catch(async (error: unknown) => {
    markSmokeStage('startup-error');
    dialog.showErrorBox('Squabble could not start', error instanceof Error ? error.message : String(error));
    await stopServices();
    app.quit();
  });
}

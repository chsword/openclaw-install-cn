'use strict';

/**
 * Electron main process for OpenClaw GUI installer.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Shared logic (re-use from CLI lib) ────────────────────────────────────────
// These modules have no Electron dependency, so they can be shared directly.
const configLib = require('./lib/config');
const registryLib = require('./lib/registry');
const downloaderLib = require('./lib/downloader');
const installerLib = require('./lib/installer');
const platformLib = require('./lib/platform');

let mainWindow = null;

// ── Error logging ─────────────────────────────────────────────────────────────

/**
 * Returns the path to the application log file.
 * Falls back to os.tmpdir() if the app user-data path is not yet available.
 * @returns {string}
 */
function getLogFilePath() {
  try {
    return path.join(app.getPath('logs'), 'error.log');
  } catch {
    return path.join(os.tmpdir(), 'openclaw-error.log');
  }
}

/**
 * Append a log entry to the local log file.
 * @param {'info'|'warn'|'error'} level
 * @param {string} source - e.g. 'main' | 'renderer'
 * @param {string} message
 * @param {string} [stack]
 */
function appendLog(level, source, message, stack) {
  try {
    const logFile = getLogFilePath();
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] [${level.toUpperCase()}] [${source}] ${message}${stack ? '\n' + stack : ''}\n`;
    fs.appendFileSync(logFile, entry, 'utf8');
  } catch {
    // Logging must never crash the app.
  }
}

/**
 * Append an error entry to the local log file.
 * @param {string} source - 'main' | 'renderer'
 * @param {string} message
 * @param {string} [stack]
 */
function appendErrorLog(source, message, stack) {
  appendLog('error', source, message, stack);
}

/**
 * Parse raw log file content into structured entries.
 * Each entry matches the format:
 *   [ISO_TIMESTAMP] [LEVEL] [SOURCE] message\noptional stack\n
 * @param {string} content
 * @returns {Array<{timestamp:string, level:string, source:string, message:string, stack:string}>}
 */
function parseLogEntries(content) {
  const lines = content.split('\n');
  const entries = [];
  let current = null;
  const headerRe = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\] \[(ERROR|WARN|INFO)\] \[([^\]]+)\] (.*)$/;

  for (const line of lines) {
    const match = line.match(headerRe);
    if (match) {
      if (current) entries.push(current);
      current = {
        timestamp: match[1],
        level: match[2].toLowerCase(),
        source: match[3],
        message: match[4],
        stack: '',
      };
    } else if (current && line.trim()) {
      current.stack += (current.stack ? '\n' : '') + line;
    }
  }
  if (current) entries.push(current);
  return entries;
}

/**
 * Show a user-friendly error dialog and then quit the application.
 * @param {string} message
 */
function showFatalErrorDialog(message) {
  dialog.showMessageBoxSync({
    type: 'error',
    title: '应用程序错误',
    message: '发生意外错误，应用程序需要关闭。',
    detail: `${message}\n\n错误日志已保存至:\n${getLogFilePath()}`,
    buttons: ['确定'],
  });
  app.exit(1);
}

// ── Global exception handlers ─────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  appendErrorLog('main', err.message, err.stack);
  showFatalErrorDialog(err.message);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack   = reason instanceof Error ? reason.stack  : undefined;
  appendErrorLog('main', message, stack);
  // Unhandled rejections are logged but do not force-quit the application,
  // as they are often recoverable (e.g. failed network requests).
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 520,
    resizable: false,
    title: 'OpenClaw Installer',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ──────────────────────────────────────────────────────────────

/** Get current status (installed version, CDN, platform info). */
ipcMain.handle('get-status', async () => {
  const config = configLib.loadConfig();
  const installDir = config.installDir;
  const installed = installerLib.isInstalled(installDir);
  const installedVersion = installed
    ? installerLib.readVersionMarker(installDir)
    : config.installedVersion;

  return {
    installed,
    installedVersion,
    installDir,
    cdnBase: config.cdnBase,
    platform: platformLib.getPlatformLabel(),
    arch: platformLib.getArch(),
  };
});

/** Check for latest version on CDN. */
ipcMain.handle('check-latest', async () => {
  const config = configLib.loadConfig();
  try {
    const latest = await registryLib.getLatestVersion(config.cdnBase);
    return { success: true, latest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Get full manifest info. */
ipcMain.handle('get-manifest', async () => {
  const config = configLib.loadConfig();
  try {
    const manifest = await registryLib.fetchManifest(config.cdnBase);
    return { success: true, manifest };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Install or upgrade OpenClaw. Sends progress events back to renderer. */
ipcMain.handle('install', async (_event, opts = {}) => {
  const config = configLib.loadConfig();
  const cdnBase = config.cdnBase;
  const installDir = opts.dir || config.installDir;
  const platform = platformLib.getPlatform();
  const arch = platformLib.getArch();

  function send(type, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('install-progress', { type, ...payload });
    }
  }

  try {
    appendLog('info', 'main', `Install started (platform=${platform}-${arch}, dir=${installDir})`);
    send('status', { message: 'Fetching version information…' });
    const versionInfo = await registryLib.getVersionInfo(cdnBase, opts.version);
    const version = versionInfo.version;
    const platformKey = `${platform}-${arch}`;

    // Determine filename
    let filename;
    if (versionInfo.files && versionInfo.files[platformKey]) {
      filename = versionInfo.files[platformKey];
    } else {
      filename = platformLib.getPackageFilename(version, platform, arch);
    }

    const downloadUrl = registryLib.buildDownloadUrl(cdnBase, version, filename);
    const tmpDir = path.join(os.tmpdir(), 'oclaw-install');
    const tmpFile = path.join(tmpDir, filename);

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    send('status', { message: `Downloading OpenClaw ${version}…` });

    await downloaderLib.downloadFile(downloadUrl, tmpFile, {
      showProgress: false,
      onProgress: (received, total) => {
        send('download-progress', { received, total });
      },
    });

    // ── Integrity check ───────────────────────────────────────────────────────
    const checksum = versionInfo.checksums && versionInfo.checksums[platformKey];
    if (checksum) {
      send('status', { message: 'Verifying file integrity…' });
      await downloaderLib.verifyChecksum(tmpFile, checksum);
    }

    send('status', { message: 'Download complete. Installing…' });

    let backupDir = null;
    if (fs.existsSync(installDir)) {
      backupDir = installerLib.backupInstallation(installDir);
    }

    try {
      installerLib.extract(tmpFile, installDir);
      installerLib.writeVersionMarker(installDir, version);
    } catch (err) {
      if (backupDir) installerLib.restoreBackup(backupDir, installDir);
      throw err;
    }

    if (backupDir) {
      try { installerLib.removeBackup(backupDir); } catch {}
    }
    try { fs.unlinkSync(tmpFile); } catch {}

    configLib.updateConfig({ installedVersion: version, installDir });
    appendLog('info', 'main', `OpenClaw ${version} installed successfully (dir=${installDir})`);
    send('status', { message: `OpenClaw ${version} installed successfully!` });
    return { success: true, version };
  } catch (err) {
    send('status', { message: `Error: ${err.message}` });
    return { success: false, error: err.message };
  }
});

/** Update configuration (CDN base URL is fixed and cannot be overridden). */
ipcMain.handle('set-config', async (_event, updates) => {
  // Strip cdnBase – the CDN URL is fixed and not user-configurable.
  const { cdnBase: _cdnBase, ...safeUpdates } = updates || {};
  configLib.updateConfig(safeUpdates);
  appendLog('info', 'main', `Configuration updated: ${Object.keys(safeUpdates).join(', ')}`);
  return { success: true };
});

/** Open installation directory in file explorer. */
ipcMain.handle('open-install-dir', async () => {
  const config = configLib.loadConfig();
  if (fs.existsSync(config.installDir)) {
    shell.openPath(config.installDir);
  } else {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Not Installed',
      message: 'OpenClaw is not installed yet.',
    });
  }
});

/** Receive renderer-side errors and persist them to the log file. */
ipcMain.on('log-error', (_event, { message, stack } = {}) => {
  appendErrorLog('renderer', message || 'Unknown renderer error', stack);
});

/** Read the log file and return parsed entries. */
ipcMain.handle('get-logs', async () => {
  try {
    const logFile = getLogFilePath();
    if (!fs.existsSync(logFile)) {
      return { success: true, entries: [] };
    }
    const content = fs.readFileSync(logFile, 'utf8');
    return { success: true, entries: parseLogEntries(content) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Clear the log file. */
ipcMain.handle('clear-logs', async () => {
  try {
    const logFile = getLogFilePath();
    if (fs.existsSync(logFile)) {
      fs.writeFileSync(logFile, '', 'utf8');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Export the log file via a save dialog. */
ipcMain.handle('export-logs', async () => {
  try {
    const logFile = getLogFilePath();
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出日志',
      defaultPath: 'openclaw.log',
      filters: [
        { name: '日志文件', extensions: ['log'] },
        { name: '文本文件', extensions: ['txt'] },
      ],
    });
    if (result.canceled || !result.filePath) {
      return { success: true, canceled: true };
    }
    if (fs.existsSync(logFile)) {
      fs.copyFileSync(logFile, result.filePath);
    } else {
      fs.writeFileSync(result.filePath, '', 'utf8');
    }
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

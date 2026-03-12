'use strict';

/**
 * Electron main process for the OpenClaw GUI assistant.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── Shared logic (re-use from CLI lib) ────────────────────────────────────────
// These modules have no Electron dependency, so they can be shared directly.
const configLib = require('./lib/config');
const registryLib = require('./lib/registry');
const platformLib = require('./lib/platform');
const runtimeLib = require('./lib/runtime');

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
    title: 'OpenClaw 安装助手',
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
  const environment = await runtimeLib.inspectEnvironment();

  return {
    installed: environment.openclaw.installed,
    installedVersion: environment.openclaw.version || config.installedVersion,
    cdnBase: config.cdnBase,
    npmRegistry: config.npmRegistry,
    platform: platformLib.getPlatformLabel(),
    arch: platformLib.getArch(),
    node: environment.node,
    pnpm: environment.pnpm,
    installCommand: runtimeLib.getInstallCommandString(),
  };
});

/** Check for latest version on CDN. */
ipcMain.handle('check-latest', async () => {
  const config = configLib.loadConfig();
  try {
    const latest = await registryLib.getLatestVersion(config.cdnBase);
    const environment = await runtimeLib.inspectEnvironment();
    return {
      success: true,
      latest,
      installedVersion: environment.openclaw.version || config.installedVersion,
      updateAvailable: !!environment.openclaw.version && runtimeLib.compareVersions(latest, environment.openclaw.version) > 0,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

/** Install or upgrade OpenClaw. Sends progress events back to renderer. */
ipcMain.handle('install', async (_event, opts = {}) => {
  const config = configLib.loadConfig();
  const platform = platformLib.getPlatform();
  const arch = platformLib.getArch();

  function send(type, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('install-progress', { type, ...payload });
    }
  }

  try {
    appendLog('info', 'main', `Install started (platform=${platform}-${arch})`);
    send('status', { message: '检查 Node.js、pnpm 与 OpenClaw 环境…' });
    const environment = await runtimeLib.inspectEnvironment();

    if (!environment.node.installed) {
      throw new Error('未检测到 Node.js。请先安装 Node.js 18 或更高版本。');
    }
    if (!environment.node.supported) {
      throw new Error(`当前 Node.js 版本为 ${environment.node.version}，需要 18 或更高版本。`);
    }
    if (!environment.pnpm.installed) {
      throw new Error('未检测到 pnpm。请先执行 npm install -g pnpm。');
    }

    send('status', { message: '读取 manifest.json 中的最新版本…' });
    const latestVersion = await registryLib.getLatestVersion(config.cdnBase);

    if (!opts.force && environment.openclaw.installed) {
      const comparison = runtimeLib.compareVersions(environment.openclaw.version, latestVersion);
      if (comparison >= 0) {
        configLib.updateConfig({ installedVersion: environment.openclaw.version });
        send('status', { message: `OpenClaw ${environment.openclaw.version} 已是最新版本。` });
        return {
          success: true,
          version: environment.openclaw.version,
          skipped: true,
        };
      }
    }

    send('status', { message: '正在通过 pnpm 安装 OpenClaw…' });
    await runtimeLib.installOpenclaw({
      onStdout: (text) => {
        const message = text.trim();
        if (message) {
          send('status', { message });
        }
      },
      onStderr: (text) => {
        const message = text.trim();
        if (message) {
          send('status', { message });
        }
      },
    });

    const refreshed = await runtimeLib.inspectEnvironment();
    if (!refreshed.openclaw.installed || !refreshed.openclaw.version) {
      throw new Error('pnpm 已执行完成，但当前终端环境仍无法识别 openclaw 命令。请确认 pnpm 全局目录已加入 PATH。');
    }

    configLib.updateConfig({ installedVersion: refreshed.openclaw.version });
    appendLog('info', 'main', `OpenClaw ${refreshed.openclaw.version} installed successfully`);
    send('status', { message: `OpenClaw ${refreshed.openclaw.version} 安装完成。` });
    return { success: true, version: refreshed.openclaw.version };
  } catch (err) {
    send('status', { message: `Error: ${err.message}` });
    return { success: false, error: err.message };
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

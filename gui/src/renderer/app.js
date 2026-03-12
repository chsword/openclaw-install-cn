'use strict';

/* ── DOM references ────────────────────────────────────────────────────────── */
const elInstalledVersion = document.getElementById('val-installed-version');
const elLatestVersion    = document.getElementById('val-latest-version');
const elNodeVersion      = document.getElementById('val-node-version');
const elPnpmVersion      = document.getElementById('val-pnpm-version');
const elPlatform         = document.getElementById('val-platform');
const envHint            = document.getElementById('env-hint');

const btnInstallNode     = document.getElementById('btn-install-node');
const btnInstall         = document.getElementById('btn-install');
const btnCheck           = document.getElementById('btn-check');
const btnSettings        = document.getElementById('btn-settings');

const cardProgress       = document.getElementById('card-progress');
const progressStatus     = document.getElementById('progress-status');
const progressBar        = document.getElementById('progress-bar');
const progressPct        = document.getElementById('progress-pct');

const cardSettings       = document.getElementById('card-settings');
const btnCancelLogs      = document.getElementById('btn-cancel-logs');
const logViewer          = document.getElementById('log-viewer');
const logEmpty           = document.getElementById('log-empty');
const filterInfo         = document.getElementById('filter-info');
const filterWarn         = document.getElementById('filter-warn');
const filterError        = document.getElementById('filter-error');
const btnRefreshLogs     = document.getElementById('btn-refresh-logs');
const btnExportLogs      = document.getElementById('btn-export-logs');
const btnClearLogs       = document.getElementById('btn-clear-logs');

const messageArea        = document.getElementById('message-area');

/* ── State ─────────────────────────────────────────────────────────────────── */
let currentStatus = null;
let latestVersion = null;
let busy = false;
let logEntries = [];
let logRefreshTimer = null;

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function showMessage(msg, type = 'info') {
  messageArea.textContent = msg;
  messageArea.className = `message-area ${type}`;
  messageArea.style.display = 'block';
}

function hideMessage() {
  messageArea.style.display = 'none';
}

function setButtonsBusy(isBusy) {
  busy = isBusy;
  btnInstallNode.disabled = isBusy;
  btnInstall.disabled = isBusy;
  btnCheck.disabled   = isBusy;
}

function setValue(el, text, className = '') {
  el.textContent = text;
  el.className = `status-value ${className}`.trim();
}

function fmtBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

/* ── Load status ───────────────────────────────────────────────────────────── */
async function loadStatus() {
  try {
    currentStatus = await window.oclaw.getStatus();

    elPlatform.textContent = `${currentStatus.platform} (${currentStatus.arch})`;

    if (currentStatus.node.installed) {
      setValue(elNodeVersion, currentStatus.node.version, currentStatus.node.supported ? 'ready' : 'update-available');
    } else {
      setValue(elNodeVersion, '未安装', 'missing');
    }

    if (currentStatus.pnpm.installed) {
      setValue(elPnpmVersion, currentStatus.pnpm.version, 'ready');
    } else {
      setValue(elPnpmVersion, '未安装', 'missing');
    }

    if (currentStatus.installed && currentStatus.installedVersion) {
      setValue(elInstalledVersion, currentStatus.installedVersion, 'installed');
      btnInstall.textContent = '升级';
    } else {
      setValue(elInstalledVersion, '未安装', 'not-installed');
      btnInstall.textContent = '安装';
    }

    const missingNode = !currentStatus.node.installed || !currentStatus.node.supported;
    const missingPnpm = !currentStatus.pnpm.installed;
    btnInstallNode.style.display = missingNode ? '' : 'none';
    btnInstall.disabled = missingNode || missingPnpm || busy;

    if (missingNode) {
      envHint.textContent = currentStatus.node.installed
        ? `当前 Node.js 版本 ${currentStatus.node.version} 过低，至少需要 18。可点击“安装 Node.js”自动安装 LTS 版本。`
        : '未检测到 Node.js。可点击“安装 Node.js”自动安装 LTS 版本。';
    } else if (missingPnpm) {
      envHint.textContent = '未检测到 pnpm。安装/升级时会自动通过 npm（npmmirror）安装 pnpm。';
    } else if (currentStatus.installed && currentStatus.installedVersion) {
      envHint.textContent = '环境检查已通过，可以直接检查更新或执行升级。';
    } else {
      envHint.textContent = '环境检查已通过，可以直接执行安装。';
    }
  } catch (err) {
    showMessage(`读取状态失败: ${err.message}`, 'error');
  }
}

async function doInstallNodejs() {
  if (busy) return;
  setButtonsBusy(true);
  hideMessage();

  cardProgress.style.display = 'block';
  progressBar.style.width = '60%';
  progressPct.textContent = '执行中';
  progressStatus.textContent = '正在安装 Node.js LTS…';

  const result = await window.oclaw.installNodejs();
  if (result.success) {
    progressBar.style.width = '100%';
    progressBar.style.background = 'linear-gradient(90deg, #0066cc, #0088ff)';
    progressPct.textContent = '完成';
    showMessage(`Node.js ${result.version || ''} 安装成功。`, 'success');
    await loadStatus();
  } else {
    progressBar.style.width = '100%';
    progressBar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
    progressPct.textContent = '失败';
    const manualTip = result.manualUrl ? ` 可改为手动安装: ${result.manualUrl}` : '';
    showMessage(`Node.js 安装失败: ${result.error}.${manualTip}`, 'error');
  }

  setButtonsBusy(false);
}

/* ── Check for updates ─────────────────────────────────────────────────────── */
async function checkLatest() {
  setValue(elLatestVersion, '检查中…');
  const result = await window.oclaw.checkLatest();
  if (result.success) {
    latestVersion = result.latest;

    const installed = currentStatus && currentStatus.installedVersion;
    if (installed && result.updateAvailable) {
      setValue(elLatestVersion, `${result.latest} (有更新)`, 'update-available');
      btnInstall.textContent = '升级';
      envHint.textContent = `检测到新版本 ${result.latest}，可以直接点击“升级”。`;
    } else if (installed === result.latest) {
      setValue(elLatestVersion, result.latest, 'installed');
      envHint.textContent = '当前 OpenClaw 已是最新版本。';
    } else {
      setValue(elLatestVersion, result.latest);
    }
  } else {
    setValue(elLatestVersion, '检查失败', 'missing');
    showMessage(`无法读取 manifest.json: ${result.error}`, 'error');
  }
}

/* ── Install / Upgrade ─────────────────────────────────────────────────────── */
async function doInstall() {
  if (busy) return;
  setButtonsBusy(true);
  hideMessage();

  cardProgress.style.display = 'block';
  progressBar.style.width = '0%';
  progressPct.textContent = '执行中';
  progressStatus.textContent = '准备检查环境…';

  // Set up progress listener
  window.oclaw.offInstallProgress();
  window.oclaw.onInstallProgress((data) => {
    if (data.type === 'status') {
      progressStatus.textContent = data.message;
      progressBar.style.width = '70%';
    }
  });

  const result = await window.oclaw.install({});

  window.oclaw.offInstallProgress();

  if (result.success) {
    progressBar.style.width = '100%';
    progressPct.textContent = result.skipped ? '已最新' : '完成';
    showMessage(result.skipped
      ? `OpenClaw ${result.version} 已是最新版本。`
      : `OpenClaw ${result.version} 安装成功。`, 'success');
    await loadStatus();
  } else {
    progressBar.style.width = '100%';
    progressBar.style.background = 'linear-gradient(90deg, #ef4444, #f97316)';
    progressPct.textContent = '失败';
    showMessage(`✖ 安装失败: ${result.error}`, 'error');
  }

  setButtonsBusy(false);
}

/* ── Log panel ─────────────────────────────────────────────────────────────── */
function openSettings() {
  cardSettings.style.display = 'block';
  cardProgress.style.display = 'none';
  loadLogs();
  startLogAutoRefresh();
  hideMessage();
}

function closeSettings() {
  cardSettings.style.display = 'none';
  stopLogAutoRefresh();
}

/* ── Log viewer ────────────────────────────────────────────────────────────── */
function startLogAutoRefresh() {
  stopLogAutoRefresh();
  logRefreshTimer = setInterval(loadLogs, 5000);
}

function stopLogAutoRefresh() {
  if (logRefreshTimer) {
    clearInterval(logRefreshTimer);
    logRefreshTimer = null;
  }
}

async function loadLogs() {
  const result = await window.oclaw.getLogs();
  if (result.success) {
    logEntries = result.entries;
    renderLogs();
  }
}

function renderLogs() {
  const showInfo  = filterInfo.checked;
  const showWarn  = filterWarn.checked;
  const showError = filterError.checked;

  const filtered = logEntries.filter((e) => {
    if (e.level === 'info'  && !showInfo)  return false;
    if (e.level === 'warn'  && !showWarn)  return false;
    if (e.level === 'error' && !showError) return false;
    return true;
  });

  // Remove existing entry elements (keep the log-empty placeholder)
  Array.from(logViewer.querySelectorAll('.log-entry')).forEach((el) => el.remove());

  if (filtered.length === 0) {
    logEmpty.style.display = '';
    return;
  }

  logEmpty.style.display = 'none';

  // Render newest entries first
  for (const entry of [...filtered].reverse()) {
    const el = document.createElement('div');
    el.className = `log-entry log-${entry.level}`;

    const header = document.createElement('div');
    header.className = 'log-entry-header';

    const levelSpan = document.createElement('span');
    levelSpan.className = 'log-level';
    levelSpan.textContent = entry.level.toUpperCase();

    const sourceSpan = document.createElement('span');
    sourceSpan.className = 'log-source';
    sourceSpan.textContent = `[${entry.source}]`;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = new Date(entry.timestamp).toLocaleString();

    header.appendChild(levelSpan);
    header.appendChild(sourceSpan);
    header.appendChild(timeSpan);

    const msg = document.createElement('div');
    msg.className = 'log-message';
    msg.textContent = entry.message;

    el.appendChild(header);
    el.appendChild(msg);

    if (entry.stack) {
      const stack = document.createElement('pre');
      stack.className = 'log-stack';
      stack.textContent = entry.stack;
      el.appendChild(stack);
    }

    logViewer.insertBefore(el, logEmpty);
  }
}

async function doExportLogs() {
  const result = await window.oclaw.exportLogs();
  if (result.success && !result.canceled) {
    showMessage(`日志已导出至: ${result.filePath}`, 'success');
  } else if (!result.success) {
    showMessage(`导出失败: ${result.error}`, 'error');
  }
}

async function doClearLogs() {
  const result = await window.oclaw.clearLogs();
  if (result.success) {
    logEntries = [];
    renderLogs();
    showMessage('日志已清空。', 'success');
  } else {
    showMessage(`清空失败: ${result.error}`, 'error');
  }
}

/* ── Event listeners ───────────────────────────────────────────────────────── */
btnInstall.addEventListener('click', doInstall);
btnInstallNode.addEventListener('click', doInstallNodejs);
btnCheck.addEventListener('click', async () => {
  setButtonsBusy(true);
  hideMessage();
  await checkLatest();
  setButtonsBusy(false);
});
btnSettings.addEventListener('click', openSettings);
btnCancelLogs.addEventListener('click', closeSettings);
filterInfo.addEventListener('change', renderLogs);
filterWarn.addEventListener('change', renderLogs);
filterError.addEventListener('change', renderLogs);
btnRefreshLogs.addEventListener('click', loadLogs);
btnExportLogs.addEventListener('click', doExportLogs);
btnClearLogs.addEventListener('click', doClearLogs);

/* ── Global renderer error boundary ───────────────────────────────────────── */
window.onerror = function (message, source, lineno, colno, error) {
  const stack = error && error.stack ? error.stack : `${source}:${lineno}:${colno}`;
  window.oclaw.logError(String(message), stack);
  showMessage('发生意外错误，请重启应用。如问题持续，请查看错误日志。', 'error');
  return true; // prevent default browser error handling
};

window.onunhandledrejection = function (event) {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack   = reason instanceof Error ? reason.stack   : undefined;
  window.oclaw.logError(message, stack);
  showMessage('发生未处理的异步错误，请重试。如问题持续，请查看错误日志。', 'error');
};

/* ── Boot ──────────────────────────────────────────────────────────────────── */
(async () => {
  await loadStatus();
  // Auto-check for updates in background (non-blocking)
  checkLatest().catch(() => {});
})();

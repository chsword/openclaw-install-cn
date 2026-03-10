'use strict';

/* ── DOM references ────────────────────────────────────────────────────────── */
const elInstalledVersion = document.getElementById('val-installed-version');
const elLatestVersion    = document.getElementById('val-latest-version');
const elInstallDir       = document.getElementById('val-install-dir');
const elPlatform         = document.getElementById('val-platform');
const elCdn              = document.getElementById('val-cdn');

const btnInstall         = document.getElementById('btn-install');
const btnCheck           = document.getElementById('btn-check');
const btnSettings        = document.getElementById('btn-settings');

const cardProgress       = document.getElementById('card-progress');
const progressStatus     = document.getElementById('progress-status');
const progressBar        = document.getElementById('progress-bar');
const progressPct        = document.getElementById('progress-pct');

const cardSettings       = document.getElementById('card-settings');
const tabBtnConfig       = document.getElementById('tab-btn-config');
const tabBtnLogs         = document.getElementById('tab-btn-logs');
const tabConfig          = document.getElementById('tab-config');
const tabLogs            = document.getElementById('tab-logs');
const inpCdn             = document.getElementById('inp-cdn');
const inpDir             = document.getElementById('inp-dir');
const btnSaveSettings    = document.getElementById('btn-save-settings');
const btnCancelSettings  = document.getElementById('btn-cancel-settings');
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
  btnInstall.disabled = isBusy;
  btnCheck.disabled   = isBusy;
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
    elCdn.textContent = currentStatus.cdnBase;
    elInstallDir.textContent = currentStatus.installDir;

    if (currentStatus.installed && currentStatus.installedVersion) {
      elInstalledVersion.textContent = currentStatus.installedVersion;
      elInstalledVersion.className = 'status-value installed';
      btnInstall.textContent = '升级';
    } else {
      elInstalledVersion.textContent = '未安装';
      elInstalledVersion.className = 'status-value not-installed';
      btnInstall.textContent = '安装';
    }
  } catch (err) {
    showMessage(`读取状态失败: ${err.message}`, 'error');
  }
}

/* ── Check for updates ─────────────────────────────────────────────────────── */
async function checkLatest() {
  elLatestVersion.textContent = '检查中…';
  const result = await window.oclaw.checkLatest();
  if (result.success) {
    latestVersion = result.latest;
    elLatestVersion.textContent = result.latest;

    const installed = currentStatus && currentStatus.installedVersion;
    if (installed && installed !== result.latest) {
      elLatestVersion.className = 'status-value update-available';
      elLatestVersion.textContent += ' (有更新)';
      btnInstall.textContent = '升级';
    } else if (installed === result.latest) {
      elLatestVersion.className = 'status-value installed';
    } else {
      elLatestVersion.className = 'status-value';
    }
  } else {
    elLatestVersion.textContent = `检查失败`;
    showMessage(`无法连接 CDN: ${result.error}`, 'error');
  }
}

/* ── Install / Upgrade ─────────────────────────────────────────────────────── */
async function doInstall() {
  if (busy) return;
  setButtonsBusy(true);
  hideMessage();

  cardProgress.style.display = 'block';
  progressBar.style.width = '0%';
  progressPct.textContent = '0%';
  progressStatus.textContent = '准备安装…';

  // Set up progress listener
  window.oclaw.offInstallProgress();
  window.oclaw.onInstallProgress((data) => {
    if (data.type === 'status') {
      progressStatus.textContent = data.message;
    } else if (data.type === 'download-progress') {
      const { received, total } = data;
      if (total > 0) {
        const pct = Math.round((received / total) * 100);
        progressBar.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%  ${fmtBytes(received)} / ${fmtBytes(total)}`;
      } else {
        progressPct.textContent = fmtBytes(received);
      }
    }
  });

  const result = await window.oclaw.install({});

  window.oclaw.offInstallProgress();

  if (result.success) {
    progressBar.style.width = '100%';
    progressPct.textContent = '100%';
    showMessage(`✔ OpenClaw ${result.version} 安装成功！`, 'success');
    await loadStatus();
  } else {
    showMessage(`✖ 安装失败: ${result.error}`, 'error');
  }

  setButtonsBusy(false);
}

/* ── Settings panel ────────────────────────────────────────────────────────── */
function switchSettingsTab(tab) {
  if (tab === 'config') {
    tabBtnConfig.classList.add('active');
    tabBtnLogs.classList.remove('active');
    tabConfig.style.display = '';
    tabLogs.style.display = 'none';
    stopLogAutoRefresh();
  } else {
    tabBtnConfig.classList.remove('active');
    tabBtnLogs.classList.add('active');
    tabConfig.style.display = 'none';
    tabLogs.style.display = '';
    loadLogs();
    startLogAutoRefresh();
  }
}

function openSettings() {
  if (!currentStatus) return;
  inpCdn.value = currentStatus.cdnBase || '';
  inpDir.value = currentStatus.installDir || '';
  switchSettingsTab('config');
  cardSettings.style.display = 'block';
  cardProgress.style.display = 'none';
  hideMessage();
}

function closeSettings() {
  cardSettings.style.display = 'none';
  stopLogAutoRefresh();
}

async function saveSettings() {
  const updates = {};
  if (inpCdn.value.trim()) updates.cdnBase = inpCdn.value.trim();
  if (inpDir.value.trim()) updates.installDir = inpDir.value.trim();
  await window.oclaw.setConfig(updates);
  closeSettings();
  await loadStatus();
  showMessage('设置已保存。', 'success');
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
btnCheck.addEventListener('click', async () => {
  setButtonsBusy(true);
  hideMessage();
  await checkLatest();
  setButtonsBusy(false);
});
btnSettings.addEventListener('click', openSettings);
btnSaveSettings.addEventListener('click', saveSettings);
btnCancelSettings.addEventListener('click', closeSettings);
btnCancelLogs.addEventListener('click', closeSettings);
tabBtnConfig.addEventListener('click', () => switchSettingsTab('config'));
tabBtnLogs.addEventListener('click', () => switchSettingsTab('logs'));
filterInfo.addEventListener('change', renderLogs);
filterWarn.addEventListener('change', renderLogs);
filterError.addEventListener('change', renderLogs);
btnRefreshLogs.addEventListener('click', loadLogs);
btnExportLogs.addEventListener('click', doExportLogs);
btnClearLogs.addEventListener('click', doClearLogs);
elInstallDir.addEventListener('click', () => {
  if (currentStatus && currentStatus.installed) {
    window.oclaw.openInstallDir();
  }
});

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

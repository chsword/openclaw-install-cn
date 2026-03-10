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
const inpCdn             = document.getElementById('inp-cdn');
const inpDir             = document.getElementById('inp-dir');
const btnSaveSettings    = document.getElementById('btn-save-settings');
const btnCancelSettings  = document.getElementById('btn-cancel-settings');

const messageArea        = document.getElementById('message-area');

/* ── State ─────────────────────────────────────────────────────────────────── */
let currentStatus = null;
let latestVersion = null;
let busy = false;

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
function openSettings() {
  if (!currentStatus) return;
  inpCdn.value = currentStatus.cdnBase || '';
  inpDir.value = currentStatus.installDir || '';
  cardSettings.style.display = 'block';
  cardProgress.style.display = 'none';
  hideMessage();
}

function closeSettings() {
  cardSettings.style.display = 'none';
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

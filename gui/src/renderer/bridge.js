'use strict';

(function initBridge() {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
    throw new Error('Tauri API unavailable. 请通过 tauri dev/tauri build 启动 GUI。');
  }

  const listeners = new Set();

  function invoke(command, payload) {
    return tauri.core.invoke(command, payload);
  }

  window.oclaw = {
    getStatus: () => invoke('get_status'),
    checkLatest: () => invoke('check_latest'),
    resizeWindow: (payload) => invoke('resize_window', { height: payload && payload.height }),
    installNodejs: () => invoke('install_nodejs_cmd'),
    installPnpm: () => invoke('install_pnpm_cmd'),
    install: (opts) => invoke('install', { opts: opts || {} }),
    getLogs: () => invoke('get_logs'),
    clearLogs: () => invoke('clear_logs'),
    exportLogs: () => invoke('export_logs'),
    logError: (message, stack) => invoke('log_error', { message: String(message || ''), stack: stack || null }),
    onInstallProgress: (callback) => {
      const promise = tauri.event.listen('install-progress', (event) => {
        callback(event.payload || {});
      });
      listeners.add(promise);
    },
    offInstallProgress: () => {
      for (const entry of listeners) {
        Promise.resolve(entry).then((unlisten) => {
          if (typeof unlisten === 'function') {
            unlisten();
          }
        }).catch(() => {});
      }
      listeners.clear();
    },
  };
})();

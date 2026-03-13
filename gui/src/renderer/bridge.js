'use strict';

(function initBridge() {
  const tauri = window.__TAURI__;

  if (!tauri || !tauri.core || typeof tauri.core.invoke !== 'function') {
    // Tauri global API unavailable: expose stubs that surface a clear error.
    // This can happen when opening the HTML directly in a browser instead of
    // through a tauri build, or if withGlobalTauri is not enabled.
    const unavailable = () => Promise.reject(new Error('Tauri API 不可用，请通过正规构建版本运行 GUI。'));
    window.oclaw = {
      getStatus:          unavailable,
      checkLatest:        () => Promise.resolve({ success: false, error: 'Tauri API 不可用' }),
      resizeWindow:       () => Promise.resolve({}),
      installNodejs:      unavailable,
      installPnpm:        unavailable,
      install:            unavailable,
      getLogs:            () => Promise.resolve({ success: true, entries: [] }),
      clearLogs:          () => Promise.resolve({ success: true }),
      exportLogs:         () => Promise.resolve({ success: false, error: 'Tauri API 不可用' }),
      logError:           () => Promise.resolve({}),
      onInstallProgress:  () => {},
      offInstallProgress: () => {},
    };
    return;
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

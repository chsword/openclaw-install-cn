'use strict';

/**
 * Electron preload script - bridges IPC between main process and renderer.
 * Uses contextBridge to expose a safe API to the renderer (contextIsolation=true).
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oclaw', {
  /** @returns {Promise<{installed, installedVersion, installDir, cdnBase, platform, arch}>} */
  getStatus: () => ipcRenderer.invoke('get-status'),

  /** @returns {Promise<{success, latest?, error?}>} */
  checkLatest: () => ipcRenderer.invoke('check-latest'),

  /** @returns {Promise<{success, manifest?, error?}>} */
  getManifest: () => ipcRenderer.invoke('get-manifest'),

  /**
   * Install or upgrade OpenClaw.
   * @param {Object} [opts] - { version?, dir? }
   * @returns {Promise<{success, version?, error?}>}
   */
  install: (opts) => ipcRenderer.invoke('install', opts),

  /**
   * Update configuration.
   * @param {Object} updates - { cdnBase?, installDir? }
   */
  setConfig: (updates) => ipcRenderer.invoke('set-config', updates),

  /** Open the installation directory in the OS file manager. */
  openInstallDir: () => ipcRenderer.invoke('open-install-dir'),

  /**
   * Listen for install progress events.
   * @param {Function} callback - called with { type, message?, received?, total? }
   */
  onInstallProgress: (callback) => {
    ipcRenderer.on('install-progress', (_event, data) => callback(data));
  },

  /** Remove all install-progress listeners. */
  offInstallProgress: () => {
    ipcRenderer.removeAllListeners('install-progress');
  },

  /**
   * Send a renderer-side error to the main process for logging.
   * @param {string} message
   * @param {string} [stack]
   */
  logError: (message, stack) => {
    ipcRenderer.send('log-error', { message, stack });
  },

  /**
   * Read the application log file, returning parsed entries.
   * @returns {Promise<{success, entries?, error?}>}
   */
  getLogs: () => ipcRenderer.invoke('get-logs'),

  /**
   * Clear the application log file.
   * @returns {Promise<{success, error?}>}
   */
  clearLogs: () => ipcRenderer.invoke('clear-logs'),

  /**
   * Export the application log file via a save dialog.
   * @returns {Promise<{success, canceled?, filePath?, error?}>}
   */
  exportLogs: () => ipcRenderer.invoke('export-logs'),
});

'use strict';

/**
 * Configuration management for oclaw CLI.
 * Config is stored as JSON in the user's home directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDefaultInstallDir } = require('./platform');

const CONFIG_DIR = path.join(os.homedir(), '.oclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CDN_BASE = 'https://openclaw-cdn.example.com';

/**
 * @typedef {Object} OclawConfig
 * @property {string} cdnBase   - CDN base URL (no trailing slash)
 * @property {string} installDir - OpenClaw installation directory
 * @property {string|null} installedVersion - Currently installed version
 */

/** @returns {OclawConfig} */
function getDefaults() {
  return {
    cdnBase: DEFAULT_CDN_BASE,
    installDir: getDefaultInstallDir(),
    installedVersion: null,
  };
}

/**
 * Load config from disk, merging with defaults.
 * @returns {OclawConfig}
 */
function loadConfig() {
  const defaults = getDefaults();
  if (!fs.existsSync(CONFIG_FILE)) {
    return defaults;
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const stored = JSON.parse(raw);
    return Object.assign({}, defaults, stored);
  } catch {
    return defaults;
  }
}

/**
 * Save config to disk.
 * @param {OclawConfig} config
 */
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Update one or more config keys.
 * @param {Partial<OclawConfig>} updates
 * @returns {OclawConfig} updated config
 */
function updateConfig(updates) {
  const config = loadConfig();
  const updated = Object.assign({}, config, updates);
  saveConfig(updated);
  return updated;
}

/**
 * Return the path to the config file.
 * @returns {string}
 */
function getConfigFilePath() {
  return CONFIG_FILE;
}

module.exports = {
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigFilePath,
  DEFAULT_CDN_BASE,
};

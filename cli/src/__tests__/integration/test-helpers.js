'use strict';

/**
 * Shared helpers for integration tests.
 *
 * Provides subprocess-runner and environment-isolation utilities used by both
 * the online (mock-CDN) and offline (local-package) integration test suites.
 */

const fs      = require('fs');
const path    = require('path');
const { execFile }  = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/** Absolute path to the oclaw CLI entry-point. */
const OCLAW_BIN = path.resolve(__dirname, '../../../bin/oclaw.js');

/**
 * Build a minimal isolated environment for a test run.
 * Overrides HOME / USERPROFILE / LOCALAPPDATA / APPDATA so every config and
 * default install-dir read ends up inside `homeDir`, not the runner's real $HOME.
 *
 * @param {string} homeDir  - temporary directory that acts as $HOME
 * @param {Object} [extra]  - additional env overrides (e.g. OCLAW_CDN)
 * @returns {Object} env record suitable for execFile
 */
function buildEnv(homeDir, extra = {}) {
  return {
    ...process.env,
    HOME:         homeDir,
    USERPROFILE:  homeDir,                                     // Windows: os.homedir()
    LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),      // Windows: default install dir
    APPDATA:      path.join(homeDir, 'AppData', 'Roaming'),
    // Prevent accidental use of real CDN unless the caller overrides OCLAW_CDN explicitly
    OCLAW_CDN:         undefined,
    OCLAW_CLI_VERSION: undefined,
    OCLAW_INSTALL_DIR: undefined,
    OCLAW_BIN_DIR:     undefined,
    ...extra,
  };
}

/**
 * Run `node bin/oclaw.js <args>` in a subprocess with an isolated $HOME.
 *
 * @param {string[]}  args    - CLI arguments
 * @param {string}    homeDir - temporary $HOME for isolation
 * @param {Object}   [opts]
 * @param {Object}   [opts.env]     - additional env overrides
 * @param {number}   [opts.timeout] - ms, default 30 000
 * @returns {Promise<{exitCode:number, stdout:string, stderr:string, output:string}>}
 */
async function runCli(args, homeDir, opts = {}) {
  const env = buildEnv(homeDir, opts.env || {});
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,               // current `node` executable
      [OCLAW_BIN, ...args],
      { encoding: 'utf-8', env, timeout: opts.timeout || 30000 },
    );
    return { exitCode: 0, stdout: stdout || '', stderr: stderr || '', output: (stdout || '') + (stderr || '') };
  } catch (err) {
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout:   err.stdout  || '',
      stderr:   err.stderr  || '',
      output:   (err.stdout || '') + (err.stderr || ''),
    };
  }
}

/**
 * Write a config.json into `homeDir/.oclaw/config.json` directly, bypassing
 * the CLI (useful for pre-seeding a CDN URL or install dir before running
 * `install` or `upgrade`).
 *
 * @param {string} homeDir
 * @param {Object} config - partial config object to write
 */
function seedConfig(homeDir, config) {
  const configDir = path.join(homeDir, '.oclaw');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

module.exports = { OCLAW_BIN, buildEnv, runCli, seedConfig };

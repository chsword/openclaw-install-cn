'use strict';

/**
 * Integration tests — real-machine CLI end-to-end tests.
 *
 * Each test spawns `node bin/oclaw.js` as a real subprocess with an isolated
 * HOME directory (config isolation) and exercises the full CLI flow:
 *   status, config, install, upgrade
 *
 * A MockCdnServer (in-process HTTP server) stands in for the real CDN so no
 * real internet access is required.  The mock server generates valid package
 * archives (tar.gz on Linux/macOS, zip on Windows) using only built-in
 * Node.js modules.
 *
 * Test runner: node --test (built-in, Node.js >= 18)
 *
 * Run individually:
 *   npm run test:integration
 * or as part of CI via .github/workflows/integration-test.yml
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { MockCdnServer } = require('./mock-server');

const execFileAsync = promisify(execFile);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Absolute path to the oclaw entry-point. */
const OCLAW_BIN = path.resolve(__dirname, '../../../bin/oclaw.js');

/**
 * Build a minimal isolated environment for a test run.
 * Overrides HOME / USERPROFILE / LOCALAPPDATA so every config and default
 * install-dir read ends up inside `homeDir`, not the runner's real $HOME.
 *
 * @param {string} homeDir - temporary directory that acts as $HOME
 * @param {Object} [extra] - additional env overrides
 * @returns {Object} env record suitable for execFile
 */
function buildEnv(homeDir, extra = {}) {
  return {
    ...process.env,
    HOME:         homeDir,
    USERPROFILE:  homeDir,                                     // Windows: os.homedir()
    LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),      // Windows: default install dir
    APPDATA:      path.join(homeDir, 'AppData', 'Roaming'),
    // Prevent accidental use of real CDN
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
      { encoding: 'utf-8', env, timeout: opts.timeout || 30000 }
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
 * the CLI (useful for pre-seeding a CDN URL before running `install`).
 */
function seedConfig(homeDir, config) {
  const configDir = path.join(homeDir, '.oclaw');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

// ── Test suites ───────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: status and config commands (no CDN required)
// ─────────────────────────────────────────────────────────────────────────────
describe('integration: status and config', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oclaw-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  test('oclaw status shows platform info and Not installed', { timeout: 15000 }, async () => {
    const r = await runCli(['status'], tmpHome);
    assert.strictEqual(r.exitCode, 0, `Expected exit 0, got ${r.exitCode}\n${r.output}`);
    assert.match(r.output, /OpenClaw Installation Status/i);
    assert.match(r.output, /Platform/i);
    assert.match(r.output, /Not installed/i);
  });

  test('oclaw config shows default CDN URL', { timeout: 15000 }, async () => {
    const r = await runCli(['config', '--list'], tmpHome);
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /CDN/i);
    assert.match(r.output, /oclaw\.chatu\.plus/);
  });

  test('oclaw config --dir updates install directory', { timeout: 15000 }, async () => {
    const customDir = path.join(tmpHome, 'custom-install');
    const r = await runCli(['config', '--dir', customDir], tmpHome);
    assert.strictEqual(r.exitCode, 0, `config set dir failed\n${r.output}`);

    const r2 = await runCli(['config', '--list'], tmpHome);
    assert.match(r2.output, new RegExp(customDir.replace(/\\/g, '\\\\')));
  });

  test('oclaw config --reset restores defaults', { timeout: 15000 }, async () => {
    // Set a custom install dir first
    await runCli(['config', '--dir', path.join(tmpHome, 'custom')], tmpHome);

    // Then reset
    const r = await runCli(['config', '--reset'], tmpHome);
    assert.strictEqual(r.exitCode, 0, `config reset failed\n${r.output}`);

    // Confirm CDN URL is still the hardcoded default after reset
    const r2 = await runCli(['config', '--list'], tmpHome);
    assert.match(r2.output, /oclaw\.chatu\.plus/);
  });

  test('oclaw --version outputs semver', { timeout: 15000 }, async () => {
    const r = await runCli(['--version'], tmpHome);
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.output.trim(), /^\d+\.\d+\.\d+$/);
  });

  test('oclaw -v outputs semver', { timeout: 15000 }, async () => {
    const r = await runCli(['-v'], tmpHome);
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.output.trim(), /^\d+\.\d+\.\d+$/);
  });

  test('oclaw version subcommand outputs semver', { timeout: 15000 }, async () => {
    const r = await runCli(['version'], tmpHome);
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.output.trim(), /^\d+\.\d+\.\d+$/);
  });

  test('oclaw --help shows available commands', { timeout: 15000 }, async () => {
    const r = await runCli(['--help'], tmpHome);
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.output, /install/);
    assert.match(r.output, /upgrade/);
    assert.match(r.output, /status/);
    assert.match(r.output, /config/);
    assert.match(r.output, /version/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: install and upgrade (with mock CDN server)
// ─────────────────────────────────────────────────────────────────────────────
describe('integration: install and upgrade', () => {
  /** @type {MockCdnServer} */
  let server;
  let serverUrl;
  let tmpHome;
  let installDir;

  before(async () => {
    server = new MockCdnServer({ version: '1.0.0' });
    serverUrl = await server.start();
  });

  after(async () => {
    await server.stop();
  });

  beforeEach(() => {
    // Fresh HOME per test — full config + install isolation
    tmpHome    = fs.mkdtempSync(path.join(os.tmpdir(), 'oclaw-e2e-install-'));
    installDir = path.join(tmpHome, 'openclaw-app');
    // Reset the mock server to its base state
    server.reset();
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // ── Helpers local to this suite ──────────────────────────────────────────

  /** Pre-seed the installDir and installedVersion for the mock CDN tests. */
  function seedCdnConfig(extraConfig = {}) {
    seedConfig(tmpHome, {
      installDir:       installDir,
      installedVersion: null,
      ...extraConfig,
    });
  }

  /**
   * Run the CLI with the mock CDN server injected via OCLAW_CDN env var.
   * All install/upgrade tests in this suite must use this instead of runCli.
   *
   * Callers may override OCLAW_CDN via `opts.env` (e.g. to simulate an
   * unreachable CDN by passing `{ OCLAW_CDN: 'http://127.0.0.1:1' }`).
   */
  function runCliMock(args, opts = {}) {
    return runCli(args, tmpHome, {
      ...opts,
      env: { OCLAW_CDN: serverUrl, ...(opts.env || {}) },
    });
  }

  test('oclaw install downloads and installs from mock CDN', { timeout: 30000 }, async () => {
    seedCdnConfig();

    const r = await runCliMock(['install', '--dir', installDir]);
    assert.strictEqual(r.exitCode, 0, `install failed\n${r.output}`);
    assert.match(r.output, /installed successfully/i);

    // Verify the version marker was written
    const markerPath = path.join(installDir, '.oclaw-version');
    assert.ok(fs.existsSync(markerPath), '.oclaw-version marker should exist after install');
    assert.equal(fs.readFileSync(markerPath, 'utf-8').trim(), '1.0.0');
  });

  test('oclaw status shows installed version after install', { timeout: 30000 }, async () => {
    seedCdnConfig();
    await runCliMock(['install', '--dir', installDir]);

    const r = await runCliMock(['status']);
    assert.strictEqual(r.exitCode, 0);
    assert.match(r.output, /1\.0\.0/);
  });

  test('oclaw install skips when already at same version', { timeout: 30000 }, async () => {
    seedCdnConfig();
    // First install
    await runCliMock(['install', '--dir', installDir]);
    // Second install (same version, no --force)
    const r = await runCliMock(['install', '--dir', installDir]);
    assert.strictEqual(r.exitCode, 0, `second install failed\n${r.output}`);
    assert.match(r.output, /already installed/i);
  });

  test('oclaw install --force reinstalls even when up to date', { timeout: 30000 }, async () => {
    seedCdnConfig();
    await runCliMock(['install', '--dir', installDir]);
    const r = await runCliMock(['install', '--dir', installDir, '--force']);
    assert.strictEqual(r.exitCode, 0, `force reinstall failed\n${r.output}`);
    assert.match(r.output, /installed successfully/i);
    // Marker still present
    assert.equal(
      fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim(),
      '1.0.0'
    );
  });

  test('oclaw install fails gracefully when CDN is unreachable', { timeout: 15000 }, async () => {
    seedConfig(tmpHome, { installDir, installedVersion: null });
    // Override OCLAW_CDN to an intentionally unreachable address
    const r = await runCliMock(['install', '--dir', installDir], {
      env: { OCLAW_CDN: 'http://127.0.0.1:1' },
    });
    assert.notEqual(r.exitCode, 0, 'Should exit with non-zero when CDN is unreachable');
    assert.match(r.output, /error|fail|unable|ECONNREFUSED/i);
  });

  test('oclaw upgrade --check reports up to date when on latest', { timeout: 30000 }, async () => {
    seedCdnConfig({ installedVersion: '1.0.0' });
    // Write version marker so upgrade sees it as installed
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, '.oclaw-version'), '1.0.0');

    const r = await runCliMock(['upgrade', '--check']);
    assert.strictEqual(r.exitCode, 0, `upgrade --check failed\n${r.output}`);
    assert.match(r.output, /up to date/i);
  });

  test('oclaw upgrade --check detects newer version without installing', { timeout: 30000 }, async () => {
    // Install 1.0.0 first
    seedCdnConfig();
    await runCliMock(['install', '--dir', installDir]);

    // CDN now advertises 1.1.0
    server.setLatestVersion('1.1.0');

    const r = await runCliMock(['upgrade', '--check']);
    assert.strictEqual(r.exitCode, 0, `upgrade --check failed\n${r.output}`);
    assert.match(r.output, /1\.1\.0/);

    // Must NOT have installed the new version
    const marker = fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim();
    assert.equal(marker, '1.0.0', 'upgrade --check must not change installed version');
  });

  test('oclaw upgrade installs newer version when available', { timeout: 30000 }, async () => {
    // Install 1.0.0 first
    seedCdnConfig();
    await runCliMock(['install', '--dir', installDir]);

    // CDN now advertises 1.1.0
    server.setLatestVersion('1.1.0');

    const r = await runCliMock(['upgrade']);
    assert.strictEqual(r.exitCode, 0, `upgrade failed\n${r.output}`);
    assert.match(r.output, /installed successfully|1\.1\.0/i);

    // Marker updated
    const marker = fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim();
    assert.equal(marker, '1.1.0');
  });

  test('oclaw upgrade --check exits non-zero when not installed', { timeout: 15000 }, async () => {
    seedCdnConfig({ installedVersion: null });
    // installDir does not exist
    const r = await runCliMock(['upgrade', '--check']);
    assert.notEqual(r.exitCode, 0, 'upgrade without any install should exit non-zero');
    assert.match(r.output, /not.*installed|install.*first/i);
  });

  test('oclaw config + install flow without pre-seeded config', { timeout: 30000 }, async () => {
    // Use the CLI to set the install directory. The CDN URL is fixed (OCLAW_CDN env var
    // is used by runCliMock to point at the mock server for all CLI invocations).
    const r1 = await runCliMock(['config', '--dir', installDir]);
    assert.strictEqual(r1.exitCode, 0);

    const r2 = await runCliMock(['install']);
    assert.strictEqual(r2.exitCode, 0, `install via config-set dir failed\n${r2.output}`);
    assert.match(r2.output, /installed successfully/i);

    const marker = fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim();
    assert.equal(marker, '1.0.0');
  });
});

'use strict';

/**
 * Offline install integration tests — exercises `oclaw install --local-package`
 * end-to-end with NO network access.
 *
 * Each test builds a real local bundle directory (manifest.json + a real archive
 * file) and runs `node bin/oclaw.js install --local-package <dir|file>`.
 *
 * No MockCdnServer is started.  OCLAW_CDN is pointed at an unreachable address
 * (127.0.0.1 port 1) so any accidental CDN request would fail immediately,
 * proving the tests are fully offline.
 *
 * Test runner: node --test  (Node.js >= 18 built-in)
 *
 * Run individually:
 *   node --test src/__tests__/integration/offline.test.js
 * or via:
 *   npm run test:offline
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { execFile }  = require('child_process');
const { promisify } = require('util');

const { buildZip, buildTarGz } = require('./mock-server');

const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────────────────────

/** Absolute path to the CLI entry-point. */
const OCLAW_BIN = path.resolve(__dirname, '../../../bin/oclaw.js');

/** Platform / arch for the current runner (matches what install.js uses). */
const PLATFORM = process.platform;   // 'linux' | 'darwin' | 'win32'
const ARCH     = process.arch;       // 'x64' | 'arm64' | ...
const EXT      = PLATFORM === 'win32' ? 'zip' : 'tar.gz';

// ── Small helpers ─────────────────────────────────────────────────────────────

/** Compute the expected archive filename for a given version. */
function pkgFilename(version) {
  return `openclaw-${version}-${PLATFORM}-${ARCH}.${EXT}`;
}

/** Build a real (extractable) archive buffer for a given version. */
function buildArchive(version) {
  const readmeContent = `OpenClaw offline-test package\nversion: ${version}\nplatform: ${PLATFORM}-${ARCH}\n`;
  return EXT === 'zip' ? buildZip('README.txt', readmeContent) : buildTarGz('README.txt', readmeContent);
}

/**
 * Build an isolated subprocess environment.
 * HOME / USERPROFILE / LOCALAPPDATA all point inside `tmpHome`.
 * OCLAW_CDN is set to an unreachable address — any accidental network call
 * would produce an ECONNREFUSED error immediately.
 */
function buildEnv(tmpHome, extraEnv = {}) {
  return {
    ...process.env,
    HOME:         tmpHome,
    USERPROFILE:  tmpHome,
    LOCALAPPDATA: path.join(tmpHome, 'AppData', 'Local'),
    APPDATA:      path.join(tmpHome, 'AppData', 'Roaming'),
    // Unreachable CDN — ensures offline tests stay offline
    OCLAW_CDN:         'http://127.0.0.1:1',
    OCLAW_CLI_VERSION: undefined,
    OCLAW_INSTALL_DIR: undefined,
    OCLAW_BIN_DIR:     undefined,
    ...extraEnv,
  };
}

/** Run `node bin/oclaw.js <args>` in an isolated subprocess. */
async function runCli(args, tmpHome, opts = {}) {
  const env = buildEnv(tmpHome, opts.env || {});
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
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
 * Create a local bundle directory that mirrors the CDN offline layout.
 *
 * @param {string}  bundleDir - absolute path to create
 * @param {string}  version
 * @param {'versioned'|'flat'} [layout='versioned']
 *   versioned: archive goes in {bundleDir}/{version}/{filename}
 *   flat:      archive goes in {bundleDir}/{filename}
 * @returns {{ bundleDir: string, archivePath: string }}
 */
function makeLocalBundle(bundleDir, version, layout = 'versioned') {
  const filename    = pkgFilename(version);
  const platformKey = `${PLATFORM}-${ARCH}`;

  const manifest = {
    latest: version,
    versions: [{
      version,
      releaseDate: '2025-01-01',
      description: `Offline test release ${version}`,
      files: { [platformKey]: filename },
    }],
  };

  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const archiveBuf = buildArchive(version);
  let archivePath;

  if (layout === 'versioned') {
    const versionDir = path.join(bundleDir, version);
    fs.mkdirSync(versionDir, { recursive: true });
    archivePath = path.join(versionDir, filename);
  } else {
    archivePath = path.join(bundleDir, filename);
  }

  fs.writeFileSync(archivePath, archiveBuf);
  return { bundleDir, archivePath };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('integration (offline): install from local package', () => {
  let tmpHome;
  let installDir;
  let tmpBundles;

  beforeEach(() => {
    tmpHome    = fs.mkdtempSync(path.join(os.tmpdir(), 'oclaw-offline-'));
    installDir = path.join(tmpHome, 'openclaw-app');
    tmpBundles = path.join(tmpHome, 'bundles');
    fs.mkdirSync(tmpBundles, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  // ── 1. Install from versioned layout ──────────────────────────────────────

  test('installs from local bundle directory (versioned layout)', { timeout: 30000 }, async () => {
    const { bundleDir } = makeLocalBundle(path.join(tmpBundles, 'v1-versioned'), '1.0.0', 'versioned');

    const r = await runCli(['install', '--local-package', bundleDir, '--dir', installDir], tmpHome);
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /installed successfully/i);

    const markerPath = path.join(installDir, '.oclaw-version');
    assert.ok(fs.existsSync(markerPath), '.oclaw-version marker should exist after install');
    assert.equal(fs.readFileSync(markerPath, 'utf-8').trim(), '1.0.0');
  });

  // ── 2. Install from flat layout ───────────────────────────────────────────

  test('installs from local bundle directory (flat layout)', { timeout: 30000 }, async () => {
    const { bundleDir } = makeLocalBundle(path.join(tmpBundles, 'v1-flat'), '1.0.0', 'flat');

    const r = await runCli(['install', '--local-package', bundleDir, '--dir', installDir], tmpHome);
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /installed successfully/i);

    const marker = fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim();
    assert.equal(marker, '1.0.0');
  });

  // ── 3. Install from a direct archive file ─────────────────────────────────

  test('installs from a direct local archive file', { timeout: 30000 }, async () => {
    const version     = '2.0.0';
    const filename    = pkgFilename(version);
    const archiveDir  = path.join(tmpBundles, 'direct-file');
    const archivePath = path.join(archiveDir, filename);

    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(archivePath, buildArchive(version));

    const r = await runCli(['install', '--local-package', archivePath, '--dir', installDir], tmpHome);
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /installed successfully/i);

    // Version is derived from the archive filename
    const marker = fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim();
    assert.equal(marker, version);
  });

  // ── 4. Skip reinstall when already at same version ────────────────────────

  test('skips reinstall when already at same version (no --force)', { timeout: 30000 }, async () => {
    const { bundleDir } = makeLocalBundle(path.join(tmpBundles, 'skip-test'), '1.0.0', 'versioned');

    // First install
    await runCli(['install', '--local-package', bundleDir, '--dir', installDir], tmpHome);

    // Second install — same version, no --force
    const r = await runCli(['install', '--local-package', bundleDir, '--dir', installDir], tmpHome);
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /already installed/i);
  });

  // ── 5. Force reinstall ────────────────────────────────────────────────────

  test('reinstalls when --force is given even if version matches', { timeout: 30000 }, async () => {
    const { bundleDir } = makeLocalBundle(path.join(tmpBundles, 'force-test'), '1.0.0', 'versioned');

    await runCli(['install', '--local-package', bundleDir, '--dir', installDir], tmpHome);

    const r = await runCli(
      ['install', '--local-package', bundleDir, '--dir', installDir, '--force'],
      tmpHome,
    );
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /installed successfully/i);
    assert.equal(
      fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim(),
      '1.0.0',
    );
  });

  // ── 6. Upgrade to a newer version via local bundle ────────────────────────

  test('upgrades to a newer version from a local bundle', { timeout: 30000 }, async () => {
    // Install v1.0.0 from local bundle
    const { bundleDir: bundle1 } = makeLocalBundle(
      path.join(tmpBundles, 'v100'), '1.0.0', 'versioned',
    );
    await runCli(['install', '--local-package', bundle1, '--dir', installDir], tmpHome);
    assert.equal(
      fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim(),
      '1.0.0',
    );

    // Upgrade to v1.1.0 from a separate local bundle (new version → auto-installs)
    const { bundleDir: bundle2 } = makeLocalBundle(
      path.join(tmpBundles, 'v110'), '1.1.0', 'versioned',
    );
    const r = await runCli(
      ['install', '--local-package', bundle2, '--dir', installDir],
      tmpHome,
    );
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /installed successfully/i);

    // Version marker must reflect the new version
    assert.equal(
      fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim(),
      '1.1.0',
    );
  });

  // ── 7. Latest version is selected from a multi-version bundle ────────────

  test('installs the latest version from a multi-version bundle', { timeout: 30000 }, async () => {
    const v1         = '1.0.0';
    const v2         = '2.0.0';
    const platformKey = `${PLATFORM}-${ARCH}`;
    const bundleDir  = path.join(tmpBundles, 'multi-version');

    const v1Dir = path.join(bundleDir, v1);
    const v2Dir = path.join(bundleDir, v2);
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.mkdirSync(v2Dir, { recursive: true });

    // Bundle has both v1 and v2; latest is v2
    const manifest = {
      latest: v2,
      versions: [
        { version: v1, releaseDate: '2025-01-01', description: `Release ${v1}`, files: { [platformKey]: pkgFilename(v1) } },
        { version: v2, releaseDate: '2025-06-01', description: `Release ${v2}`, files: { [platformKey]: pkgFilename(v2) } },
      ],
    };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(v1Dir, pkgFilename(v1)), buildArchive(v1));
    fs.writeFileSync(path.join(v2Dir, pkgFilename(v2)), buildArchive(v2));

    // Without --version: should install the latest (v2)
    const r = await runCli(
      ['install', '--local-package', bundleDir, '--dir', installDir],
      tmpHome,
    );
    assert.strictEqual(r.exitCode, 0, `Expected exit 0\n${r.output}`);
    assert.match(r.output, /installed successfully/i);

    assert.equal(
      fs.readFileSync(path.join(installDir, '.oclaw-version'), 'utf-8').trim(),
      v2,
    );
  });

  // ── 8. Error: local path does not exist ───────────────────────────────────

  test('exits non-zero when local package path does not exist', { timeout: 15000 }, async () => {
    const r = await runCli(
      ['install', '--local-package', '/nonexistent/path/bundle', '--dir', installDir],
      tmpHome,
    );
    assert.notEqual(r.exitCode, 0, 'Should exit non-zero for missing path');
    assert.match(r.output, /not found|no such|error/i);
  });

  // ── 9. Error: directory without manifest.json ─────────────────────────────

  test('exits non-zero when bundle directory has no manifest.json', { timeout: 15000 }, async () => {
    const emptyDir = path.join(tmpBundles, 'no-manifest');
    fs.mkdirSync(emptyDir, { recursive: true });

    const r = await runCli(
      ['install', '--local-package', emptyDir, '--dir', installDir],
      tmpHome,
    );
    assert.notEqual(r.exitCode, 0, 'Should exit non-zero for missing manifest.json');
    assert.match(r.output, /manifest\.json|not found/i);
  });
});

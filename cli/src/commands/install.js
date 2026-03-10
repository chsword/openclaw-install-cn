'use strict';

/**
 * `oclaw install` command.
 * Downloads and installs OpenClaw from CDN into the configured directory,
 * or installs from a local package directory / archive (offline mode).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, updateConfig } = require('../lib/config');
const { getVersionInfo, buildDownloadUrl } = require('../lib/registry');
const { downloadFile } = require('../lib/downloader');
const {
  extract,
  backupInstallation,
  removeBackup,
  restoreBackup,
  writeVersionMarker,
  readVersionMarker,
  isInstalled,
  verifyChecksum,
} = require('../lib/installer');
const { getPlatform, getArch, getPackageFilename } = require('../lib/platform');
const log = require('../lib/logger');

/**
 * Resolve local package info from a directory that mirrors the CDN structure.
 * The directory must contain a manifest.json file.
 *
 * @param {string} localDir   - absolute path to the local package directory
 * @param {string} [version]  - specific version requested (default: manifest.latest)
 * @param {string} platform
 * @param {string} arch
 * @returns {{ versionInfo: Object, archivePath: string }}
 */
function resolveLocalPackageDir(localDir, version, platform, arch) {
  const manifestPath = path.join(localDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    log.error(`manifest.json not found in: ${localDir}`);
    log.dim('The local package directory must contain a manifest.json file.');
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err) {
    log.error(`Failed to read manifest.json: ${err.message}`);
    process.exit(1);
  }

  const target = version || manifest.latest;
  if (!target) {
    log.error('Could not determine version from local manifest.json.');
    process.exit(1);
  }

  const versionInfo = (manifest.versions || []).find((v) => v.version === target);
  if (!versionInfo) {
    log.error(`Version ${target} not found in local manifest.json.`);
    process.exit(1);
  }

  const platformKey = `${platform}-${arch}`;
  const filename =
    versionInfo.files && versionInfo.files[platformKey]
      ? versionInfo.files[platformKey]
      : getPackageFilename(versionInfo.version, platform, arch);

  // Look in {dir}/{version}/{filename}, then fall back to {dir}/{filename}
  const archiveInVersionDir = path.join(localDir, versionInfo.version, filename);
  const archiveFlat = path.join(localDir, filename);

  let archivePath;
  if (fs.existsSync(archiveInVersionDir)) {
    archivePath = archiveInVersionDir;
  } else if (fs.existsSync(archiveFlat)) {
    archivePath = archiveFlat;
  } else {
    log.error(`Package file not found: ${filename}`);
    log.dim('Expected locations:');
    log.dim(`  ${archiveInVersionDir}`);
    log.dim(`  ${archiveFlat}`);
    process.exit(1);
  }

  return { versionInfo, archivePath };
}

/**
 * Run the install command.
 * @param {Object} options
 * @param {string} [options.version]       - specific version to install (default: latest)
 * @param {string} [options.dir]           - override install directory
 * @param {boolean} [options.force]        - force reinstall even if already installed
 * @param {string} [options.localPackage]  - path to a local package dir or archive (offline mode)
 */
async function runInstall(options = {}) {
  const config = loadConfig();
  const installDir = options.dir || config.installDir;
  const platform = getPlatform();
  const arch = getArch();
  const platformKey = `${platform}-${arch}`;

  let versionInfo;
  let archivePath;
  let shouldCleanupArchive = false;

  if (options.localPackage) {
    // ── Offline / local-package mode ──────────────────────────────────────────
    const localPath = path.resolve(options.localPackage);

    if (!fs.existsSync(localPath)) {
      log.error(`Local package path not found: ${localPath}`);
      process.exit(1);
    }

    const stat = fs.statSync(localPath);

    if (stat.isDirectory()) {
      log.step('Reading local package manifest...');
      ({ versionInfo, archivePath } = resolveLocalPackageDir(
        localPath,
        options.version,
        platform,
        arch,
      ));
    } else {
      // A specific archive file was provided directly
      archivePath = localPath;
      // Try to derive the version from the filename (e.g. openclaw-1.2.3-linux-x64.tar.gz)
      const basename = path.basename(localPath);
      const versionMatch = basename.match(/^openclaw-(\d+\.\d+[\.\d]*(?:-[^-.]+)?)-/);
      const detectedVersion = versionMatch ? versionMatch[1] : 'local';
      versionInfo = { version: detectedVersion, description: null };
    }

    log.step(
      `Installing OpenClaw ${versionInfo.version} for ${platform}-${arch} from local package...`,
    );
    log.dim(`Package: ${archivePath}`);
  } else {
    // ── CDN / online mode ─────────────────────────────────────────────────────
    const cdnBase = config.cdnBase;

    log.step('Checking version information...');
    try {
      versionInfo = await getVersionInfo(cdnBase, options.version);
    } catch (err) {
      log.error(`Failed to fetch version info: ${err.message}`);
      log.dim(`CDN base: ${cdnBase}`);
      log.dim('Run `oclaw config --cdn-url <url>` to set a different CDN.');
      process.exit(1);
    }

    const version = versionInfo.version;
    const filename =
      versionInfo.files && versionInfo.files[platformKey]
        ? versionInfo.files[platformKey]
        : getPackageFilename(version, platform, arch);

    const downloadUrl = buildDownloadUrl(cdnBase, version, filename);
    const tmpDir = path.join(os.tmpdir(), 'oclaw-install');
    archivePath = path.join(tmpDir, filename);
    shouldCleanupArchive = true;

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    log.step(`Downloading OpenClaw ${version} for ${platform}-${arch}...`);
    log.dim(`From: ${downloadUrl}`);

    try {
      await downloadFile(downloadUrl, archivePath, { showProgress: true });
    } catch (err) {
      log.error(`Download failed: ${err.message}`);
      process.exit(1);
    }

    // Verify checksum if the manifest provides one for this platform
    const expectedChecksum =
      versionInfo.checksums && versionInfo.checksums[platformKey];
    if (expectedChecksum) {
      log.step('Verifying checksum...');
      try {
        verifyChecksum(archivePath, expectedChecksum);
        log.success('Checksum verified.');
      } catch (err) {
        log.error(err.message);
        process.exit(1);
      }
    } else {
      log.warn('No checksum available for this platform in the manifest; skipping verification.');
    }

    log.success('Download complete.');
  }

  const version = versionInfo.version;

  // Check if already installed at same version
  if (!options.force && isInstalled(installDir)) {
    const current = readVersionMarker(installDir);
    if (current === version) {
      log.success(`OpenClaw ${version} is already installed at: ${installDir}`);
      log.dim('Use --force to reinstall.');
      return;
    }
  }

  // Back up existing installation
  let backupDir = null;
  if (fs.existsSync(installDir)) {
    log.step('Backing up existing installation...');
    try {
      backupDir = backupInstallation(installDir);
      if (backupDir) log.dim(`Backup at: ${backupDir}`);
    } catch (err) {
      log.warn(`Could not back up existing installation: ${err.message}`);
    }
  }

  log.step(`Installing to: ${installDir}`);
  try {
    extract(archivePath, installDir);
    writeVersionMarker(installDir, version);
  } catch (err) {
    log.error(`Installation failed: ${err.message}`);
    if (backupDir) {
      log.step('Restoring previous installation...');
      restoreBackup(backupDir, installDir);
      log.success('Previous installation restored.');
    }
    process.exit(1);
  }

  // Clean up backup and (if downloaded) the temp archive
  if (backupDir) {
    try {
      removeBackup(backupDir);
    } catch {
      log.warn(`Could not remove backup: ${backupDir}`);
    }
  }
  if (shouldCleanupArchive) {
    try {
      fs.unlinkSync(archivePath);
    } catch {
      // non-fatal
    }
  }

  // Persist installed version in config
  updateConfig({ installedVersion: version, installDir });

  log.success(`OpenClaw ${version} installed successfully!`);
  log.dim(`Location: ${installDir}`);

  if (versionInfo.description) {
    log.info(`Release notes: ${versionInfo.description}`);
  }
}

module.exports = { runInstall, resolveLocalPackageDir };

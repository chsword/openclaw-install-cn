'use strict';

/**
 * `oclaw install` command.
 * Downloads and installs OpenClaw from CDN into the configured directory.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig, updateConfig } = require('../lib/config');
const { getLatestVersion, getVersionInfo, buildDownloadUrl } = require('../lib/registry');
const { downloadFile } = require('../lib/downloader');
const {
  extract,
  backupInstallation,
  removeBackup,
  restoreBackup,
  writeVersionMarker,
  readVersionMarker,
  isInstalled,
} = require('../lib/installer');
const { getPlatform, getArch, getPackageFilename } = require('../lib/platform');
const log = require('../lib/logger');

/**
 * Run the install command.
 * @param {Object} options
 * @param {string} [options.version]    - specific version to install (default: latest)
 * @param {string} [options.dir]        - override install directory
 * @param {boolean} [options.force]     - force reinstall even if already installed
 */
async function runInstall(options = {}) {
  const config = loadConfig();
  const cdnBase = config.cdnBase;
  const installDir = options.dir || config.installDir;
  const platform = getPlatform();
  const arch = getArch();

  log.step('Checking version information...');
  let versionInfo;
  try {
    versionInfo = await getVersionInfo(cdnBase, options.version);
  } catch (err) {
    log.error(`Failed to fetch version info: ${err.message}`);
    log.dim(`CDN base: ${cdnBase}`);
    log.dim('Run `oclaw config --cdn-url <url>` to set a different CDN.');
    process.exit(1);
  }

  const version = versionInfo.version;
  const platformKey = `${platform}-${arch}`;

  // Check if already installed at same version
  if (!options.force && isInstalled(installDir)) {
    const current = readVersionMarker(installDir);
    if (current === version) {
      log.success(`OpenClaw ${version} is already installed at: ${installDir}`);
      log.dim('Use --force to reinstall.');
      return;
    }
  }

  // Determine download filename
  let filename;
  if (versionInfo.files && versionInfo.files[platformKey]) {
    filename = versionInfo.files[platformKey];
  } else {
    filename = getPackageFilename(version, platform, arch);
  }

  const downloadUrl = buildDownloadUrl(cdnBase, version, filename);
  const tmpDir = path.join(os.tmpdir(), 'oclaw-install');
  const tmpFile = path.join(tmpDir, filename);

  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  log.step(`Downloading OpenClaw ${version} for ${platform}-${arch}...`);
  log.dim(`From: ${downloadUrl}`);

  try {
    await downloadFile(downloadUrl, tmpFile, { showProgress: true });
  } catch (err) {
    log.error(`Download failed: ${err.message}`);
    process.exit(1);
  }

  log.success('Download complete.');

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
    extract(tmpFile, installDir);
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

  // Clean up backup and temp file
  if (backupDir) {
    try {
      removeBackup(backupDir);
    } catch {
      log.warn(`Could not remove backup: ${backupDir}`);
    }
  }
  try {
    fs.unlinkSync(tmpFile);
  } catch {
    // non-fatal
  }

  // Persist installed version in config
  updateConfig({ installedVersion: version, installDir });

  log.success(`OpenClaw ${version} installed successfully!`);
  log.dim(`Location: ${installDir}`);

  if (versionInfo.description) {
    log.info(`Release notes: ${versionInfo.description}`);
  }
}

module.exports = { runInstall };

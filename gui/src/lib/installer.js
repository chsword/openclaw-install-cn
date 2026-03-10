'use strict';

/**
 * Installer - extracts downloaded packages and manages installation.
 * Uses built-in Node.js child_process and fs for extraction.
 * No third-party extraction library required.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { getPlatform } = require('./platform');

/**
 * Extract a zip file to a destination directory.
 * On Windows: uses PowerShell Expand-Archive.
 * On macOS/Linux: uses system `unzip`.
 * @param {string} archivePath
 * @param {string} destDir
 */
function extractZip(archivePath, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const platform = getPlatform();
  if (platform === 'win32') {
    const result = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -Force -Path "${archivePath}" -DestinationPath "${destDir}"`,
      ],
      { stdio: 'pipe', encoding: 'utf-8' }
    );
    if (result.status !== 0) {
      throw new Error(`Extraction failed: ${result.stderr || result.stdout}`);
    }
  } else {
    const result = spawnSync('unzip', ['-q', '-o', archivePath, '-d', destDir], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    if (result.status !== 0) {
      throw new Error(`Extraction failed: ${result.stderr || result.stdout}`);
    }
  }
}

/**
 * Extract a tar.gz file to a destination directory.
 * @param {string} archivePath
 * @param {string} destDir
 */
function extractTarGz(archivePath, destDir) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const result = spawnSync('tar', ['-xzf', archivePath, '-C', destDir], {
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(`Extraction failed: ${result.stderr || result.stdout}`);
  }
}

/**
 * Extract an archive (auto-detect format by extension).
 * @param {string} archivePath
 * @param {string} destDir
 */
function extract(archivePath, destDir) {
  if (archivePath.endsWith('.zip')) {
    extractZip(archivePath, destDir);
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    extractTarGz(archivePath, destDir);
  } else {
    throw new Error(`Unsupported archive format: ${archivePath}`);
  }
}

/**
 * Back up an existing installation directory.
 * Renames it to {dir}.backup.{timestamp}
 * @param {string} installDir
 * @returns {string|null} backup path, or null if nothing to back up
 */
function backupInstallation(installDir) {
  if (!fs.existsSync(installDir)) return null;
  const backupDir = `${installDir}.backup.${Date.now()}`;
  fs.renameSync(installDir, backupDir);
  return backupDir;
}

/**
 * Remove a backup directory.
 * @param {string} backupDir
 */
function removeBackup(backupDir) {
  if (backupDir && fs.existsSync(backupDir)) {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
}

/**
 * Restore from backup (used on installation failure).
 * @param {string} backupDir
 * @param {string} installDir
 */
function restoreBackup(backupDir, installDir) {
  if (!backupDir) return;
  if (fs.existsSync(installDir)) {
    fs.rmSync(installDir, { recursive: true, force: true });
  }
  if (fs.existsSync(backupDir)) {
    fs.renameSync(backupDir, installDir);
  }
}

/**
 * Write a version marker file inside the installation directory.
 * @param {string} installDir
 * @param {string} version
 */
function writeVersionMarker(installDir, version) {
  const markerPath = path.join(installDir, '.oclaw-version');
  fs.writeFileSync(markerPath, version, 'utf-8');
}

/**
 * Read the installed version from the marker file.
 * @param {string} installDir
 * @returns {string|null}
 */
function readVersionMarker(installDir) {
  const markerPath = path.join(installDir, '.oclaw-version');
  if (!fs.existsSync(markerPath)) return null;
  try {
    return fs.readFileSync(markerPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Detect if OpenClaw is already installed in a directory.
 * @param {string} installDir
 * @returns {boolean}
 */
function isInstalled(installDir) {
  return fs.existsSync(installDir) && readVersionMarker(installDir) !== null;
}

/**
 * Verify a downloaded file's SHA-256 checksum.
 * The expected value may be prefixed with "sha256:" (case-insensitive).
 *
 * @param {string} filePath  - path to the file to verify
 * @param {string} expected  - expected checksum, e.g. "sha256:abc123..." or "abc123..."
 * @throws {Error} if the computed checksum does not match the expected value
 */
function verifyChecksum(filePath, expected) {
  const expectedHex = expected.replace(/^sha256:/i, '').toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);
  const actualHex = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  if (actualHex !== expectedHex) {
    throw new Error(
      `Checksum mismatch for ${path.basename(filePath)}:\n` +
        `  Expected: ${expectedHex}\n` +
        `  Got:      ${actualHex}\n` +
        'The file may be corrupted or tampered with. Please re-run the installer.',
    );
  }
}

module.exports = {
  extract,
  extractZip,
  extractTarGz,
  backupInstallation,
  removeBackup,
  restoreBackup,
  writeVersionMarker,
  readVersionMarker,
  isInstalled,
  verifyChecksum,
};
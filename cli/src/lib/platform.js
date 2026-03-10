'use strict';

/**
 * Platform detection utilities.
 * Returns normalized platform identifier and default paths.
 */

const os = require('os');
const path = require('path');

/** @returns {'win32'|'darwin'|'linux'} */
function getPlatform() {
  return process.platform;
}

/** @returns {'x64'|'arm64'|'ia32'} */
function getArch() {
  return process.arch;
}

/**
 * Returns the default installation directory for OpenClaw.
 * @returns {string}
 */
function getDefaultInstallDir() {
  const platform = getPlatform();
  if (platform === 'win32') {
    const appData = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(appData, 'OpenClaw');
  }
  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'OpenClaw');
  }
  // Linux
  return path.join(os.homedir(), '.openclaw');
}

/**
 * Returns the package archive extension for the current platform.
 * @param {string} [platform]
 * @returns {string}
 */
function getArchiveExt(platform) {
  const p = platform || getPlatform();
  return p === 'win32' ? 'zip' : 'tar.gz';
}

/**
 * Returns the CDN package filename for a given version/platform/arch.
 * Convention: openclaw-{version}-{platform}-{arch}.{ext}
 * @param {string} version
 * @param {string} [platform]
 * @param {string} [arch]
 * @returns {string}
 */
function getPackageFilename(version, platform, arch) {
  const p = platform || getPlatform();
  const a = arch || getArch();
  const ext = getArchiveExt(p);
  return `openclaw-${version}-${p}-${a}.${ext}`;
}

/**
 * Returns a human-readable platform name.
 * @returns {string}
 */
function getPlatformLabel() {
  const platform = getPlatform();
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  return 'Linux';
}

module.exports = {
  getPlatform,
  getArch,
  getDefaultInstallDir,
  getArchiveExt,
  getPackageFilename,
  getPlatformLabel,
};

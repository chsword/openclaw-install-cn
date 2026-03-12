'use strict';

/**
 * Platform detection utilities.
 * Returns normalized platform identifiers.
 */

/** @returns {'win32'|'darwin'|'linux'} */
function getPlatform() {
  return process.platform;
}

/** @returns {'x64'|'arm64'|'ia32'} */
function getArch() {
  return process.arch;
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
  getPlatformLabel,
};


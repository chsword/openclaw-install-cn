'use strict';

/**
 * Version registry - fetches version info from CDN manifest.
 *
 * CDN manifest structure (at {cdnBase}/manifest.json):
 * {
 *   "latest": "1.2.3",
 *   "versions": [
 *     {
 *       "version": "1.2.3",
 *       "releaseDate": "2025-01-01",
 *       "description": "Release notes",
 *       "files": {
 *         "win32-x64": "openclaw-1.2.3-win32-x64.zip",
 *         "darwin-x64": "openclaw-1.2.3-darwin-x64.tar.gz",
 *         "darwin-arm64": "openclaw-1.2.3-darwin-arm64.tar.gz",
 *         "linux-x64": "openclaw-1.2.3-linux-x64.tar.gz"
 *       },
 *       "checksums": {
 *         "win32-x64": "sha256:abc123...",
 *         "darwin-x64": "sha256:def456...",
 *         "darwin-arm64": "sha256:ghi789...",
 *         "linux-x64": "sha256:jkl012..."
 *       }
 *     }
 *   ]
 * }
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Fetch JSON from a URL.
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const req = transport.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // Follow one redirect
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
        } catch (e) {
          reject(new Error(`Invalid JSON from ${url}: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out: ${url}`));
    });
  });
}

/**
 * Fetch the full manifest from CDN.
 * @param {string} cdnBase
 * @returns {Promise<Object>}
 */
async function fetchManifest(cdnBase) {
  const url = `${cdnBase.replace(/\/$/, '')}/manifest.json`;
  try {
    return await fetchJson(url);
  } catch (err) {
    throw new Error(`Failed to fetch manifest from ${url}: ${err.message}`);
  }
}

/**
 * Get latest version string.
 * @param {string} cdnBase
 * @returns {Promise<string>}
 */
async function getLatestVersion(cdnBase) {
  const manifest = await fetchManifest(cdnBase);
  if (!manifest.latest) {
    throw new Error('Manifest missing "latest" field');
  }
  return manifest.latest;
}

/**
 * Get full info for a specific version (or latest).
 * @param {string} cdnBase
 * @param {string} [version] - defaults to latest
 * @returns {Promise<Object>}
 */
async function getVersionInfo(cdnBase, version) {
  const manifest = await fetchManifest(cdnBase);
  const target = version || manifest.latest;
  const entry = (manifest.versions || []).find((v) => v.version === target);
  if (!entry) {
    throw new Error(`Version ${target} not found in manifest`);
  }
  return entry;
}

/**
 * Build the download URL for a package.
 * @param {string} cdnBase
 * @param {string} version
 * @param {string} filename
 * @returns {string}
 */
function buildDownloadUrl(cdnBase, version, filename) {
  return `${cdnBase.replace(/\/$/, '')}/${version}/${filename}`;
}

module.exports = {
  fetchManifest,
  getLatestVersion,
  getVersionInfo,
  buildDownloadUrl,
  fetchJson,
};

'use strict';

/**
 * Version registry - fetches version info from CDN manifest.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { debug } = require('./logger');

/**
 * Fetch JSON from a URL.
 * @param {string} url
 * @returns {Promise<any>}
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const startTime = Date.now();
    debug(`GET ${url}`);

    const req = transport.get(url, { timeout: 15000 }, (res) => {
      const elapsed = Date.now() - startTime;
      if (res.statusCode === 301 || res.statusCode === 302) {
        debug(`Redirect ${res.statusCode}: ${url} → ${res.headers.location}`);
        // Follow one redirect
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        debug(`HTTP ${res.statusCode} ${url} (${elapsed}ms)`);
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      debug(`HTTP ${res.statusCode} ${url} (${elapsed}ms)`);
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
  debug(`Resolving version info from: ${url}`);
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

module.exports = {
  fetchManifest,
  getLatestVersion,
  fetchJson,
};

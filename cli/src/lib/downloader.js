'use strict';

/**
 * Downloader - downloads files from CDN with progress reporting.
 * Uses only built-in Node.js https/http modules.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { progress, progressEnd } = require('./logger');

/**
 * Download a file from URL to a local destination path.
 * @param {string} url  - Download URL
 * @param {string} dest - Local file path to write to
 * @param {Object} [opts]
 * @param {boolean} [opts.showProgress=true] - Whether to show progress bar in terminal
 * @param {Function} [opts.onProgress]       - Callback(received, total) for GUI progress
 * @returns {Promise<void>}
 */
function downloadFile(url, dest, opts = {}) {
  const { showProgress = true, onProgress } = opts;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const doRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        return reject(new Error('Too many redirects'));
      }

      const req = transport.get(requestUrl, { timeout: 60000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          const location = res.headers.location;
          if (!location) return reject(new Error('Redirect with no Location header'));
          res.resume(); // discard body
          return doRequest(location, redirectCount + 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} downloading ${requestUrl}`));
        }

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;

        // Ensure destination directory exists
        const dir = path.dirname(dest);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        const file = fs.createWriteStream(dest);

        res.on('data', (chunk) => {
          received += chunk.length;
          if (showProgress) {
            progress(received, total);
          }
          if (onProgress) {
            onProgress(received, total);
          }
        });

        res.pipe(file);

        file.on('finish', () => {
          file.close(() => {
            if (showProgress) progressEnd();
            resolve();
          });
        });

        file.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });

        res.on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Download timed out: ${requestUrl}`));
      });
    };

    doRequest(url);
  });
}

module.exports = { downloadFile };

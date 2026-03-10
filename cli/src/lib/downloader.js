'use strict';

/**
 * Downloader - downloads files from CDN with progress reporting.
 * Supports: retry with exponential back-off, HTTP Range resume,
 * and separate connection / read-inactivity timeouts.
 * Uses only built-in Node.js https/http modules.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { progress, progressEnd, debug } = require('./logger');

/** Default connection timeout in milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 30000;

/** Default read-inactivity timeout in milliseconds (reset on every data chunk). */
const DEFAULT_READ_TIMEOUT_MS = 60000;

/**
 * Sleep for `ms` milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Download a file from URL to a local destination path.
 *
 * Features:
 *  - Automatic retry with exponential back-off on transient failures.
 *  - HTTP Range-based resume when a partial file already exists on disk.
 *  - Separate connection-timeout and read-inactivity timeout.
 *
 * @param {string} url  - Download URL
 * @param {string} dest - Local file path to write to
 * @param {Object} [opts]
 * @param {boolean}  [opts.showProgress=true]   - Show progress bar in terminal
 * @param {Function} [opts.onProgress]           - Callback(received, total) for GUI
 * @param {number}   [opts.maxRetries=3]         - Maximum number of retry attempts
 * @param {number}   [opts.retryDelay=1000]      - Base delay (ms) for exponential back-off
 * @param {number}   [opts.connectTimeout=30000] - Connection timeout in ms
 * @param {number}   [opts.readTimeout=60000]    - Read inactivity timeout in ms
 * @returns {Promise<void>}
 */
function downloadFile(url, dest, opts = {}) {
  const {
    showProgress = true,
    onProgress,
    maxRetries = 3,
    retryDelay = 1000,
    connectTimeout = DEFAULT_CONNECT_TIMEOUT_MS,
    readTimeout = DEFAULT_READ_TIMEOUT_MS,
  } = opts;

  // Ensure destination directory exists up front (not per-attempt).
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /**
   * One download attempt.  Checks for a partial file on disk and resumes using
   * an HTTP Range request when the server supports it.
   * @returns {Promise<void>}
   */
  function attemptDownload() {
    return new Promise((resolve, reject) => {
      // How many bytes have we already downloaded?
      let startByte = 0;
      try { startByte = fs.statSync(dest).size; } catch (err) { if (err.code !== 'ENOENT') throw err; }

      const parsed = new URL(url);
      const transport = parsed.protocol === 'https:' ? https : http;

      /**
       * Perform (or resume) an HTTP GET, following redirects.
       * @param {string} requestUrl
       * @param {number} startOffset  - byte offset to resume from
       * @param {number} [redirects]  - redirect-hop counter
       */
      const doRequest = (requestUrl, startOffset, redirects = 0) => {
        if (redirects > 5) {
          return reject(new Error('Too many redirects'));
        }

        const reqHeaders = {};
        if (startOffset > 0) {
          reqHeaders['Range'] = `bytes=${startOffset}-`;
        }

        debug(`GET ${requestUrl}${startOffset > 0 ? ` (resume from byte ${startOffset})` : ''}`);
        const reqStartTime = Date.now();

        const req = transport.get(requestUrl, { headers: reqHeaders }, (res) => {
          const elapsed = Date.now() - reqStartTime;
          // ── Redirects ──────────────────────────────────────────────────────
          if (res.statusCode === 301 || res.statusCode === 302 ||
              res.statusCode === 307 || res.statusCode === 308) {
            const location = res.headers.location;
            if (!location) return reject(new Error('Redirect with no Location header'));
            debug(`Redirect ${res.statusCode}: ${requestUrl} → ${location}`);
            res.resume();
            return doRequest(location, startOffset, redirects + 1);
          }

          // ── 416 Range Not Satisfiable ──────────────────────────────────────
          // Our partial file is larger than the remote content (e.g. file was
          // replaced on the server).  Delete local partial and start fresh.
          if (res.statusCode === 416) {
            debug(`HTTP 416 Range Not Satisfiable — restarting download from byte 0`);
            res.resume();
            try { fs.unlinkSync(dest); } catch (err) { if (err.code !== 'ENOENT') return reject(err); }
            return doRequest(url, 0, 0);
          }

          // ── Server ignores Range header (returns 200 instead of 206) ──────
          // Some servers don't support partial content.  Delete local partial
          // and start a full download.
          if (startOffset > 0 && res.statusCode === 200) {
            debug(`Server returned 200 instead of 206 — Range not supported, restarting full download`);
            res.resume();
            try { fs.unlinkSync(dest); } catch (err) { if (err.code !== 'ENOENT') return reject(err); }
            return doRequest(url, 0, 0);
          }

          if (res.statusCode !== 200 && res.statusCode !== 206) {
            debug(`HTTP ${res.statusCode} ${requestUrl} (${elapsed}ms)`);
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} downloading ${requestUrl}`));
          }

          debug(`HTTP ${res.statusCode} ${requestUrl} (${elapsed}ms)`);

          const contentLength = parseInt(res.headers['content-length'] || '0', 10);
          // For 206 Partial Content, total size = already-downloaded + remaining.
          const total = res.statusCode === 206 ? startOffset + contentLength : contentLength;
          let received = startOffset; // progress counter starts from resumed offset

          const file = fs.createWriteStream(dest, startOffset > 0 ? { flags: 'a' } : {});

          // Read-inactivity timer: reset on every data chunk.
          let readTimer;
          const resetReadTimer = () => {
            clearTimeout(readTimer);
            if (readTimeout > 0) {
              readTimer = setTimeout(() => {
                req.destroy(new Error(`Read inactivity timeout after ${readTimeout}ms`));
              }, readTimeout);
            }
          };
          resetReadTimer();

          res.on('data', (chunk) => {
            resetReadTimer();
            received += chunk.length;
            if (showProgress) progress(received, total);
            if (onProgress) onProgress(received, total);
          });

          res.pipe(file);

          let settled = false;

          file.on('finish', () => {
            if (settled) return;
            settled = true;
            clearTimeout(readTimer);
            file.close(() => {
              if (showProgress) progressEnd();
              resolve();
            });
          });

          const handleError = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(readTimer);
            file.close(() => reject(err));
          };

          file.on('error', handleError);
          res.on('error', handleError);
        });

        req.setTimeout(connectTimeout, () => {
          req.destroy(new Error(`Connection timed out: ${requestUrl}`));
        });
        req.on('error', reject);
      };

      doRequest(url, startByte);
    });
  }

  return (async () => {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await attemptDownload();
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          // Exponential back-off: 1 s, 2 s, 4 s, …
          const delay = retryDelay * (2 ** attempt);
          debug(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${err.message}`);
          await sleep(delay);
        }
      }
    }
    // All attempts exhausted — remove any partial file.
    try { fs.unlinkSync(dest); } catch (err) { if (err.code !== 'ENOENT') { /* best-effort cleanup */ } }
    throw lastErr;
  })();
}

/**
 * Compute the SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {Promise<string>} hex digest
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      stream.destroy();
      resolve(hash.digest('hex'));
    });
    stream.on('error', (err) => {
      stream.destroy();
      reject(err);
    });
  });
}

/**
 * Verify the SHA-256 checksum of a downloaded file.
 *
 * The expected value may be prefixed with "sha256:" (e.g. "sha256:abc123…").
 * Throws an Error if the computed digest does not match, with a message that
 * encourages the user to retry the download.
 *
 * Silently skips verification when the expected value is not a valid
 * 64-character hex string (e.g. a placeholder like "REPLACE_WITH_ACTUAL_CHECKSUM").
 *
 * @param {string} filePath - path to the file to verify
 * @param {string} expected - expected SHA-256 digest, optionally prefixed with "sha256:"
 * @returns {Promise<void>}
 */
async function verifyChecksum(filePath, expected) {
  const normalised = expected.replace(/^sha256:/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalised)) {
    // Not a valid SHA-256 hex digest — skip verification (placeholder value).
    debug(`Checksum verification: SKIPPED (not a valid SHA-256 hex digest)`);
    return;
  }
  debug(`Computing SHA-256: ${path.basename(filePath)}`);
  const actual = await hashFile(filePath);
  debug(`SHA-256: ${actual}`);
  if (actual !== normalised) {
    debug(`Checksum verification: FAILED`);
    throw new Error(
      `Checksum mismatch for ${path.basename(filePath)}:\n` +
        `  Expected: ${normalised}\n` +
        `  Actual:   ${actual}\n` +
        'The file may be corrupted or tampered with. Please try downloading again.',
    );
  }
  debug(`Checksum verification: PASSED`);
}

module.exports = { downloadFile, verifyChecksum };

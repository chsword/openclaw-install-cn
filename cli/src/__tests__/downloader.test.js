'use strict';

/**
 * Unit tests for the downloader module.
 *
 * Uses a lightweight in-process HTTP server (no external deps) to verify:
 *  - Basic successful download
 *  - Automatic retry with exponential back-off on transient failures
 *  - HTTP Range-based resume of partial downloads
 *  - Fallback to full download when server does not support Range
 *  - 416 Range-Not-Satisfiable handling (stale partial file)
 *  - Connection-timeout and read-inactivity-timeout errors
 *  - Partial file is removed after all retries are exhausted
 */

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('fs');
const http   = require('http');
const path   = require('path');
const os     = require('os');

const { downloadFile } = require('../lib/downloader');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Start a one-shot HTTP server; handler is called for every request. */
function startServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, url: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
}

// ── Test suite ────────────────────────────────────────────────────────────────

const tmpBase = path.join(os.tmpdir(), `oclaw-dl-test-${Date.now()}-${process.pid}`);

describe('downloader', () => {
  before(() => fs.mkdirSync(tmpBase, { recursive: true }));
  after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  // ── Basic download ──────────────────────────────────────────────────────────

  test('downloads file successfully', async () => {
    const content = 'hello downloader';
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(content) });
      res.end(content);
    });

    const dest = path.join(tmpBase, 'basic.txt');
    try {
      await downloadFile(url, dest, { showProgress: false });
      assert.equal(fs.readFileSync(dest, 'utf-8'), content);
    } finally {
      await stopServer(server);
    }
  });

  test('creates destination directory if it does not exist', async () => {
    const content = 'mkdir test';
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(content) });
      res.end(content);
    });

    const dest = path.join(tmpBase, 'nested', 'dir', 'file.txt');
    try {
      await downloadFile(url, dest, { showProgress: false });
      assert.equal(fs.readFileSync(dest, 'utf-8'), content);
    } finally {
      await stopServer(server);
    }
  });

  test('follows HTTP redirects', async () => {
    const content = 'after redirect';
    let port;
    const { server, url } = await startServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/final` });
        return res.end();
      }
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(content) });
      res.end(content);
    });
    port = server.address().port;

    const dest = path.join(tmpBase, 'redirected.txt');
    try {
      await downloadFile(`${url}/redirect`, dest, { showProgress: false });
      assert.equal(fs.readFileSync(dest, 'utf-8'), content);
    } finally {
      await stopServer(server);
    }
  });

  test('rejects on HTTP error status', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(404);
      res.end('Not Found');
    });

    const dest = path.join(tmpBase, 'http-error.txt');
    try {
      await assert.rejects(
        downloadFile(url, dest, { showProgress: false, maxRetries: 0 }),
        /HTTP 404/
      );
    } finally {
      await stopServer(server);
    }
  });

  // ── Retry mechanism ─────────────────────────────────────────────────────────

  test('retries on connection error and succeeds on second attempt', async () => {
    let calls = 0;
    const content = 'retry success';
    const { server, url } = await startServer((req, res) => {
      calls++;
      if (calls === 1) {
        // Simulate a transient error by abruptly closing the connection.
        res.socket.destroy();
        return;
      }
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(content) });
      res.end(content);
    });

    const dest = path.join(tmpBase, 'retry-success.txt');
    try {
      await downloadFile(url, dest, { showProgress: false, maxRetries: 2, retryDelay: 10 });
      assert.equal(calls, 2);
      assert.equal(fs.readFileSync(dest, 'utf-8'), content);
    } finally {
      await stopServer(server);
    }
  });

  test('removes partial file after all retries are exhausted', async () => {
    const { server, url } = await startServer((req, res) => {
      res.socket.destroy();
    });

    const dest = path.join(tmpBase, 'all-failed.txt');
    try {
      await assert.rejects(
        downloadFile(url, dest, { showProgress: false, maxRetries: 1, retryDelay: 10 })
      );
      assert.ok(!fs.existsSync(dest), 'Partial file should be removed after all retries fail');
    } finally {
      await stopServer(server);
    }
  });

  test('invokes onProgress callback', async () => {
    const content = Buffer.alloc(1024, 0x41); // 1 KB of 'A'
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Length': content.length });
      res.end(content);
    });

    const dest = path.join(tmpBase, 'progress.bin');
    const calls = [];
    try {
      await downloadFile(url, dest, {
        showProgress: false,
        onProgress: (received, total) => calls.push({ received, total }),
      });
      assert.ok(calls.length > 0, 'onProgress should be called at least once');
      assert.equal(calls[calls.length - 1].received, content.length);
    } finally {
      await stopServer(server);
    }
  });

  // ── Resume / Range support ──────────────────────────────────────────────────

  test('resumes download using HTTP Range header', async () => {
    const fullContent = 'ABCDEFGHIJ'; // 10 bytes
    const partial     = 'ABCDE';      // first 5 bytes already on disk

    const { server, url } = await startServer((req, res) => {
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        // Parse "bytes=5-"
        const match = rangeHeader.match(/bytes=(\d+)-/);
        const start = match ? parseInt(match[1], 10) : 0;
        const body  = fullContent.slice(start);
        res.writeHead(206, {
          'Content-Range':  `bytes ${start}-${fullContent.length - 1}/${fullContent.length}`,
          'Content-Length': Buffer.byteLength(body),
        });
        return res.end(body);
      }
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(fullContent) });
      res.end(fullContent);
    });

    const dest = path.join(tmpBase, 'resume.txt');
    // Seed the partial file
    fs.writeFileSync(dest, partial);

    try {
      await downloadFile(url, dest, { showProgress: false });
      assert.equal(fs.readFileSync(dest, 'utf-8'), fullContent);
    } finally {
      await stopServer(server);
    }
  });

  test('falls back to full download when server does not support Range', async () => {
    const fullContent = 'full content without range support';
    let requestCount = 0;

    const { server, url } = await startServer((req, res) => {
      requestCount++;
      // Always respond with 200 (ignoring any Range header)
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(fullContent) });
      res.end(fullContent);
    });

    const dest = path.join(tmpBase, 'no-range.txt');
    // Seed a partial file to trigger a range request on the first attempt
    fs.writeFileSync(dest, 'partial');

    try {
      await downloadFile(url, dest, { showProgress: false, maxRetries: 0 });
      // The downloader should have made a second request (full download after detecting no Range support)
      assert.ok(requestCount >= 2, 'Should retry with full download when Range is not supported');
      assert.equal(fs.readFileSync(dest, 'utf-8'), fullContent);
    } finally {
      await stopServer(server);
    }
  });

  test('handles 416 Range Not Satisfiable by restarting download', async () => {
    const fullContent = 'fresh content';
    let requestCount = 0;

    const { server, url } = await startServer((req, res) => {
      requestCount++;
      if (req.headers['range']) {
        // Return 416 to indicate our range is invalid
        res.writeHead(416, { 'Content-Range': `bytes */${Buffer.byteLength(fullContent)}` });
        return res.end();
      }
      res.writeHead(200, { 'Content-Length': Buffer.byteLength(fullContent) });
      res.end(fullContent);
    });

    const dest = path.join(tmpBase, '416-restart.txt');
    // Seed a partial file larger than the server content
    fs.writeFileSync(dest, 'this is a longer partial file content that exceeds server content');

    try {
      await downloadFile(url, dest, { showProgress: false, maxRetries: 0 });
      assert.ok(requestCount >= 2, 'Should make at least 2 requests (416 then full)');
      assert.equal(fs.readFileSync(dest, 'utf-8'), fullContent);
    } finally {
      await stopServer(server);
    }
  });

  // ── Timeout handling ────────────────────────────────────────────────────────

  test('times out on slow connection', async () => {
    const { server, url } = await startServer((req, res) => {
      // Never respond — simulates connection hanging
    });

    const dest = path.join(tmpBase, 'connect-timeout.txt');
    try {
      await assert.rejects(
        downloadFile(url, dest, {
          showProgress: false,
          maxRetries: 0,
          connectTimeout: 50, // 50 ms
          readTimeout: 0,
        }),
        /timed out/i
      );
    } finally {
      await stopServer(server);
    }
  });

  test('times out on stalled read', async () => {
    const { server, url } = await startServer((req, res) => {
      // Send headers then stall — simulates a slow/stalled body transfer.
      // flushHeaders() ensures the headers actually reach the client so the
      // response callback fires and the read-inactivity timer is started.
      res.writeHead(200, { 'Content-Length': '1000' });
      res.flushHeaders();
      // Intentionally never write body chunks
    });

    const dest = path.join(tmpBase, 'read-timeout.txt');
    try {
      await assert.rejects(
        downloadFile(url, dest, {
          showProgress: false,
          maxRetries: 0,
          connectTimeout: 5000,
          readTimeout: 50, // 50 ms inactivity
        }),
        /inactivity timeout/i
      );
    } finally {
      await stopServer(server);
    }
  });

  // ── Options passthrough ─────────────────────────────────────────────────────

  test('accepts configurable maxRetries option', async () => {
    let calls = 0;
    const { server, url } = await startServer((req, res) => {
      calls++;
      res.socket.destroy();
    });

    const dest = path.join(tmpBase, 'max-retries.txt');
    try {
      await assert.rejects(
        downloadFile(url, dest, { showProgress: false, maxRetries: 2, retryDelay: 10 })
      );
      // 1 initial attempt + 2 retries = 3 total
      assert.equal(calls, 3);
    } finally {
      await stopServer(server);
    }
  });
});

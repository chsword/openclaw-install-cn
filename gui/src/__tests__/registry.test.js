'use strict';

/**
 * Unit tests for gui/src/lib/registry.js.
 * Uses a lightweight in-process HTTP server to simulate the CDN manifest.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http   = require('http');

const {
  fetchManifest,
  getLatestVersion,
  fetchJson,
} = require('../lib/registry');

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** A minimal but valid manifest for testing. */
const SAMPLE_MANIFEST = {
  latest: '1.2.3',
  versions: [
    {
      version: '1.2.3',
      releaseDate: '2025-01-01',
      description: 'Latest release',
    },
    {
      version: '1.0.0',
      releaseDate: '2024-01-01',
      description: 'First release',
    },
  ],
};

// ── fetchJson ─────────────────────────────────────────────────────────────────

describe('fetchJson', () => {
  test('fetches and parses JSON from a local server', async () => {
    const payload = { hello: 'world' };
    const { server, url } = await startServer((req, res) => {
      const body = JSON.stringify(payload);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
    try {
      const result = await fetchJson(url);
      assert.deepEqual(result, payload);
    } finally {
      await stopServer(server);
    }
  });

  test('rejects on HTTP error status', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    try {
      await assert.rejects(fetchJson(url), /HTTP 500/);
    } finally {
      await stopServer(server);
    }
  });

  test('rejects on invalid JSON', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('not valid json {{{');
    });
    try {
      await assert.rejects(fetchJson(url), /Invalid JSON/);
    } finally {
      await stopServer(server);
    }
  });

  test('follows HTTP redirect', async () => {
    const payload = { redirected: true };
    let port;
    const { server, url } = await startServer((req, res) => {
      if (req.url === '/old') {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/new` });
        return res.end();
      }
      const body = JSON.stringify(payload);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
    port = server.address().port;
    try {
      const result = await fetchJson(`${url}/old`);
      assert.deepEqual(result, payload);
    } finally {
      await stopServer(server);
    }
  });
});

// ── fetchManifest ─────────────────────────────────────────────────────────────

describe('fetchManifest', () => {
  test('fetches manifest.json from cdnBase', async () => {
    const { server, url } = await startServer((req, res) => {
      assert.equal(req.url, '/manifest.json');
      const body = JSON.stringify(SAMPLE_MANIFEST);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
    try {
      const manifest = await fetchManifest(url);
      assert.equal(manifest.latest, '1.2.3');
      assert.ok(Array.isArray(manifest.versions));
    } finally {
      await stopServer(server);
    }
  });

  test('strips trailing slash from cdnBase when building URL', async () => {
    let requestedUrl;
    const { server, url } = await startServer((req, res) => {
      requestedUrl = req.url;
      const body = JSON.stringify(SAMPLE_MANIFEST);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
    try {
      await fetchManifest(`${url}/`);
      assert.equal(requestedUrl, '/manifest.json');
    } finally {
      await stopServer(server);
    }
  });

  test('wraps errors with manifest URL in message', async () => {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(404);
      res.end();
    });
    try {
      await assert.rejects(
        fetchManifest(url),
        /Failed to fetch manifest/i,
      );
    } finally {
      await stopServer(server);
    }
  });
});

// ── getLatestVersion ──────────────────────────────────────────────────────────

describe('getLatestVersion', () => {
  test('returns latest version string', async () => {
    const { server, url } = await startServer((req, res) => {
      const body = JSON.stringify(SAMPLE_MANIFEST);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
    try {
      const version = await getLatestVersion(url);
      assert.equal(version, '1.2.3');
    } finally {
      await stopServer(server);
    }
  });

  test('throws when manifest is missing "latest" field', async () => {
    const { server, url } = await startServer((req, res) => {
      const body = JSON.stringify({ versions: [] });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
    try {
      await assert.rejects(
        getLatestVersion(url),
        /missing "latest" field/i,
      );
    } finally {
      await stopServer(server);
    }
  });
});


'use strict';

/**
 * MockCdnServer — lightweight in-process HTTP server that simulates an
 * OpenClaw CDN for integration tests.
 *
 * Features:
 *  - Serves manifest.json and cli-manifest.json from memory
 *  - Generates minimal valid package archives (tar.gz for Unix, zip for Windows)
 *    using only built-in Node.js modules — no child_process, no external deps
 *  - Supports upgradeability: call setLatestVersion(v) to advertise a newer
 *    version and pre-generate its package
 *
 * Usage:
 *   const server = new MockCdnServer({ version: '1.0.0' });
 *   const baseUrl = await server.start();
 *   // ... run tests ...
 *   await server.stop();
 */

const http  = require('http');
const zlib  = require('zlib');

// ── Pure-Node.js archive builders ─────────────────────────────────────────────

/**
 * Compute CRC-32 (IEEE polynomial) of a buffer.
 * @param {Buffer} buf
 * @returns {number} unsigned 32-bit integer
 */
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build a minimal POSIX/V7 TAR buffer containing one file.
 * @param {string} entryName - filename inside archive (e.g. 'README.txt')
 * @param {Buffer|string} content
 * @returns {Buffer}
 */
function buildTar(entryName, content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);

  // 512-byte header, zero-filled
  const hdr = Buffer.alloc(512, 0);

  // name (100 bytes, null-padded)
  hdr.write(entryName.slice(0, 99), 0, 'ascii');
  // mode
  hdr.write('0000644\0', 100, 'ascii');
  // uid / gid
  hdr.write('0000000\0', 108, 'ascii');
  hdr.write('0000000\0', 116, 'ascii');
  // size (12 bytes, octal)
  hdr.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  // mtime (12 bytes, octal seconds since epoch)
  hdr.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  // checksum field: fill with spaces while computing
  hdr.fill(0x20, 148, 156);
  // typeflag: '0' = regular file
  hdr[156] = 0x30;

  // Compute and write checksum
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += hdr[i];
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  // Data padded to nearest 512-byte boundary
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
  data.copy(padded);

  // End-of-archive: two 512-byte zero blocks
  return Buffer.concat([hdr, padded, Buffer.alloc(1024, 0)]);
}

/**
 * Build a minimal gzip-compressed tar archive containing one file.
 * Compatible with `tar -xzf` on Linux and macOS.
 */
function buildTarGz(entryName, content) {
  return zlib.gzipSync(buildTar(entryName, content));
}

/**
 * Build a minimal ZIP archive containing one file (STORED, no compression).
 * Compatible with PowerShell `Expand-Archive` on Windows and `unzip` on Unix.
 */
function buildZip(entryName, content) {
  const data    = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const nameBuf = Buffer.from(entryName, 'utf-8');
  const now     = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const fileCrc = crc32(data);

  // ── Local file header (30 + filename bytes) ──────────────────────────────
  const lfh = Buffer.alloc(30 + nameBuf.length, 0);
  lfh.writeUInt32LE(0x04034b50, 0);          // signature
  lfh.writeUInt16LE(20, 4);                  // version needed: 2.0
  lfh.writeUInt16LE(0, 6);                   // general purpose flags
  lfh.writeUInt16LE(0, 8);                   // compression: STORED
  lfh.writeUInt16LE(dosTime, 10);
  lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(fileCrc, 14);
  lfh.writeUInt32LE(data.length, 18);        // compressed size
  lfh.writeUInt32LE(data.length, 22);        // uncompressed size
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);                  // extra field length
  nameBuf.copy(lfh, 30);

  const cdOffset = lfh.length + data.length; // central dir starts here

  // ── Central directory header (46 + filename bytes) ───────────────────────
  const cdh = Buffer.alloc(46 + nameBuf.length, 0);
  cdh.writeUInt32LE(0x02014b50, 0);          // signature
  cdh.writeUInt16LE(20, 4);                  // version made by
  cdh.writeUInt16LE(20, 6);                  // version needed
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);                  // STORED
  cdh.writeUInt16LE(dosTime, 12);
  cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(fileCrc, 16);
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);                  // extra field length
  cdh.writeUInt16LE(0, 32);                  // comment length
  cdh.writeUInt16LE(0, 34);                  // disk start
  cdh.writeUInt16LE(0, 36);                  // internal attrs
  cdh.writeUInt32LE(0, 38);                  // external attrs
  cdh.writeUInt32LE(0, 42);                  // offset of local header (first file → 0)
  nameBuf.copy(cdh, 46);

  // ── End-of-central-directory record (22 bytes) ───────────────────────────
  const eocd = Buffer.alloc(22, 0);
  eocd.writeUInt32LE(0x06054b50, 0);         // signature
  eocd.writeUInt16LE(0, 4);                  // disk number
  eocd.writeUInt16LE(0, 6);                  // disk with central dir
  eocd.writeUInt16LE(1, 8);                  // entries on disk
  eocd.writeUInt16LE(1, 10);                 // total entries
  eocd.writeUInt32LE(cdh.length, 12);        // central dir size
  eocd.writeUInt32LE(cdOffset, 16);          // central dir offset
  eocd.writeUInt16LE(0, 20);                 // comment length

  return Buffer.concat([lfh, data, cdh, eocd]);
}

// ── MockCdnServer ─────────────────────────────────────────────────────────────

class MockCdnServer {
  /**
   * @param {Object} [opts]
   * @param {string} [opts.version='1.0.0'] - initial (and base) version to advertise
   */
  constructor(opts = {}) {
    this._baseVersion   = opts.version || '1.0.0';
    this._latestVersion = opts.version || '1.0.0';
    this._packages      = new Map(); // filename → Buffer
    this._server        = null;
    this._port          = null;
  }

  /** @returns {string} e.g. 'http://127.0.0.1:PORT' */
  get baseUrl() {
    return `http://127.0.0.1:${this._port}`;
  }

  /**
   * Start the server and pre-generate packages for the base version.
   * @returns {Promise<string>} baseUrl
   */
  start() {
    // Pre-generate packages synchronously before the event loop starts serving.
    this._prebuildVersion(this._baseVersion);

    return new Promise((resolve, reject) => {
      this._server = http.createServer((req, res) => {
        try {
          this._handle(req, res);
        } catch (err) {
          res.writeHead(500);
          res.end(String(err));
        }
      });
      this._server.listen(0, '127.0.0.1', () => {
        this._port = this._server.address().port;
        resolve(this.baseUrl);
      });
      this._server.on('error', reject);
    });
  }

  /** Stop the server. @returns {Promise<void>} */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this._server) return resolve();
      this._server.close(err => (err ? reject(err) : resolve()));
    });
  }

  /**
   * Advertise a newer version on the CDN (for upgrade tests).
   * Pre-generates the package for that version.
   * @param {string} version
   */
  setLatestVersion(version) {
    this._latestVersion = version;
    this._prebuildVersion(version);
  }

  /** Reset the latest version back to the base version. */
  reset() {
    this._latestVersion = this._baseVersion;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Build and cache the package archive for a given version on the current
   * platform/arch combination.
   */
  _prebuildVersion(version) {
    const filename = this._pkgFilename(version);
    if (this._packages.has(filename)) return;

    const content = `OpenClaw mock package — version ${version}, platform ${process.platform}-${process.arch}\n`;
    const pkg = filename.endsWith('.zip')
      ? buildZip('README.txt', content)
      : buildTarGz('README.txt', content);

    this._packages.set(filename, pkg);
  }

  /** Compute the package filename for the current platform/arch. */
  _pkgFilename(version) {
    const p   = process.platform;                         // 'linux' | 'darwin' | 'win32'
    const a   = process.arch;                             // 'x64' | 'arm64' | ...
    const ext = p === 'win32' ? 'zip' : 'tar.gz';
    return `openclaw-${version}-${p}-${a}.${ext}`;
  }

  /** Build the manifest.json payload served by the mock CDN. */
  _manifest() {
    // Include both base and latest version in the versions array
    const allVersions = [...new Set([this._latestVersion, this._baseVersion])];
    return {
      latest: this._latestVersion,
      versions: allVersions.map(v => ({
        version:     v,
        releaseDate: '2025-01-01',
        description: `Mock release ${v}`,
        files: {
          'win32-x64':    `openclaw-${v}-win32-x64.zip`,
          'win32-arm64':  `openclaw-${v}-win32-arm64.zip`,
          'darwin-x64':   `openclaw-${v}-darwin-x64.tar.gz`,
          'darwin-arm64': `openclaw-${v}-darwin-arm64.tar.gz`,
          'linux-x64':    `openclaw-${v}-linux-x64.tar.gz`,
          'linux-arm64':  `openclaw-${v}-linux-arm64.tar.gz`,
        },
      })),
    };
  }

  /** HTTP request dispatcher. */
  _handle(req, res) {
    const url = req.url.split('?')[0];

    if (url === '/manifest.json') {
      return this._serveJson(res, this._manifest());
    }

    if (url === '/cli-manifest.json') {
      return this._serveJson(res, {
        latest:   this._latestVersion,
        versions: [{ version: this._latestVersion }],
      });
    }

    // Package download: /{version}/{filename.tar.gz|.zip}
    const m = url.match(/^\/([^/]+)\/(.*(?:\.tar\.gz|\.zip))$/);
    if (m) {
      const filename = m[2];
      const buf = this._packages.get(filename);
      if (buf) {
        res.writeHead(200, {
          'Content-Type':   'application/octet-stream',
          'Content-Length': buf.length,
        });
        return res.end(buf);
      }
      res.writeHead(404);
      return res.end(`Package not found: ${filename}`);
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  /** Send a JSON response. */
  _serveJson(res, data) {
    const body = JSON.stringify(data);
    res.writeHead(200, {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}

module.exports = { MockCdnServer };

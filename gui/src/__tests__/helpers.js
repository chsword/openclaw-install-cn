'use strict';

/**
 * Shared test helpers for GUI unit tests.
 * Provides pure-Node.js archive builders without external dependencies.
 */

const zlib = require('zlib');

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
 * @param {string} entryName - filename inside archive
 * @param {Buffer|string} content
 * @returns {Buffer}
 */
function buildTar(entryName, content) {
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hdr = Buffer.alloc(512, 0);
  hdr.write(entryName.slice(0, 99), 0, 'ascii');
  hdr.write('0000644\0', 100, 'ascii');
  hdr.write('0000000\0', 108, 'ascii');
  hdr.write('0000000\0', 116, 'ascii');
  hdr.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  hdr.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  hdr.fill(0x20, 148, 156);
  hdr[156] = 0x30;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += hdr[i];
  hdr.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512, 0);
  data.copy(padded);
  return Buffer.concat([hdr, padded, Buffer.alloc(1024, 0)]);
}

/**
 * Build a minimal gzip-compressed tar archive containing one file.
 * Compatible with `tar -xzf` on Linux and macOS.
 * @param {string} entryName
 * @param {Buffer|string} content
 * @returns {Buffer}
 */
function buildTarGz(entryName, content) {
  return zlib.gzipSync(buildTar(entryName, content));
}

/**
 * Build a minimal ZIP archive containing one file (STORED, no compression).
 * Compatible with PowerShell `Expand-Archive` on Windows and `unzip` on Unix.
 * @param {string} entryName
 * @param {Buffer|string} content
 * @returns {Buffer}
 */
function buildZip(entryName, content) {
  const data    = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const nameBuf = Buffer.from(entryName, 'utf-8');
  const now     = new Date();
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const fileCrc = crc32(data);

  const lfh = Buffer.alloc(30 + nameBuf.length, 0);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0, 6);
  lfh.writeUInt16LE(0, 8);
  lfh.writeUInt16LE(dosTime, 10);
  lfh.writeUInt16LE(dosDate, 12);
  lfh.writeUInt32LE(fileCrc, 14);
  lfh.writeUInt32LE(data.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(nameBuf.length, 26);
  lfh.writeUInt16LE(0, 28);
  nameBuf.copy(lfh, 30);

  const cdOffset = lfh.length + data.length;

  const cdh = Buffer.alloc(46 + nameBuf.length, 0);
  cdh.writeUInt32LE(0x02014b50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);
  cdh.writeUInt16LE(dosTime, 12);
  cdh.writeUInt16LE(dosDate, 14);
  cdh.writeUInt32LE(fileCrc, 16);
  cdh.writeUInt32LE(data.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(nameBuf.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);                  // external attrs
  cdh.writeUInt32LE(0, 42);                  // offset of local header (first file → 0)
  nameBuf.copy(cdh, 46);

  const eocd = Buffer.alloc(22, 0);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, data, cdh, eocd]);
}

module.exports = { buildZip, buildTarGz };

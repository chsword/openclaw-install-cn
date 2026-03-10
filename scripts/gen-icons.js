#!/usr/bin/env node
'use strict';

/**
 * gen-icons.js — Generate placeholder icons for GUI builds in CI.
 *
 * Produces:
 *   gui/assets/icon.png  (512×512 RGBA PNG, solid #0066CC)
 *   gui/assets/icon.ico  (256×256 ICO wrapping a 256×256 PNG)
 *   gui/assets/icon.icns (macOS ICNS with 256×256 and 512×512 PNG entries)
 *
 * No external dependencies — uses only built-in Node.js modules.
 *
 * Usage:
 *   node scripts/gen-icons.js
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ── Output directory ──────────────────────────────────────────────────────────
const ASSETS_DIR = path.join(__dirname, '..', 'gui', 'assets');
if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// ── CRC-32 ────────────────────────────────────────────────────────────────────
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (c >>> 1) ^ 0xEDB88320 : c >>> 1;
    }
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG ───────────────────────────────────────────────────────────────────────
/**
 * Build a minimal NxN RGBA PNG filled with a single color.
 * @param {number} size  - width and height in pixels
 * @param {number} r,g,b - fill color components (0-255)
 * @returns {Buffer}
 */
function buildPng(size, r, g, b) {
  // Build uncompressed image data: one filter byte (0) + RGBA row
  const rowBytes = Buffer.alloc(1 + size * 4);
  rowBytes[0] = 0; // filter: None
  for (let x = 0; x < size; x++) {
    const off = 1 + x * 4;
    rowBytes[off]     = r;
    rowBytes[off + 1] = g;
    rowBytes[off + 2] = b;
    rowBytes[off + 3] = 255;
  }
  const allRows = [];
  for (let y = 0; y < size; y++) allRows.push(rowBytes);
  const raw = Buffer.concat(allRows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  function chunk(type, data) {
    const typeB = Buffer.from(type, 'ascii');
    const payload = Buffer.concat([typeB, data]);
    const lenB = Buffer.alloc(4);
    lenB.writeUInt32BE(data.length);
    const crcB = Buffer.alloc(4);
    crcB.writeUInt32BE(crc32(payload));
    return Buffer.concat([lenB, typeB, data, crcB]);
  }

  const sig  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);   // width
  ihdrData.writeUInt32BE(size, 4);   // height
  ihdrData[8]  = 8;  // bit depth
  ihdrData[9]  = 6;  // color type: RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── ICO (embeds PNG directly — Windows Vista+ format) ─────────────────────────
/**
 * Wrap a PNG buffer inside an ICO file.
 * @param {Buffer} pngData
 * @returns {Buffer}
 */
function buildIco(pngData) {
  const HEADER_SIZE = 6;
  const ENTRY_SIZE  = 16;
  const dataOffset  = HEADER_SIZE + ENTRY_SIZE; // 22

  const buf = Buffer.alloc(dataOffset + pngData.length);

  // ICONDIR
  buf.writeUInt16LE(0, 0); // Reserved
  buf.writeUInt16LE(1, 2); // Type: 1 = ICO
  buf.writeUInt16LE(1, 4); // Count: 1 image

  // ICONDIRENTRY (at offset 6)
  buf.writeUInt8(0, 6);           // bWidth:  0 → 256
  buf.writeUInt8(0, 7);           // bHeight: 0 → 256
  buf.writeUInt8(0, 8);           // bColorCount
  buf.writeUInt8(0, 9);           // bReserved
  buf.writeUInt16LE(1,  10);      // wPlanes
  buf.writeUInt16LE(32, 12);      // wBitCount
  buf.writeUInt32LE(pngData.length, 14); // dwBytesInRes
  buf.writeUInt32LE(dataOffset,    18);  // dwImageOffset

  pngData.copy(buf, dataOffset);
  return buf;
}

// ── ICNS (macOS icon format, wraps PNG data in icns container) ───────────────
/**
 * Wrap one or more PNG buffers inside a macOS ICNS file.
 * Each entry uses a PNG-capable icon type:
 *   ic08 → 256×256 PNG
 *   ic09 → 512×512 PNG
 *
 * @param {{ type: string, png: Buffer }[]} entries
 * @returns {Buffer}
 */
function buildIcns(entries) {
  const entryBuffers = entries.map(({ type, png }) => {
    const typeB = Buffer.from(type, 'ascii'); // 4 bytes

    // Pad PNG payload to a 4-byte boundary (ICNS elements are commonly 4-byte aligned)
    const padding = (4 - (png.length % 4)) % 4;
    const paddedPng = padding === 0 ? png : Buffer.concat([png, Buffer.alloc(padding)]);

    const sizeB = Buffer.alloc(4);
    // size field: 4-byte type + 4-byte size + PNG data (including any padding)
    sizeB.writeUInt32BE(8 + paddedPng.length);

    return Buffer.concat([typeB, sizeB, paddedPng]);
  });
  const body      = Buffer.concat(entryBuffers);
  const totalSize = 8 + body.length;          // ICNS header (8) + entries
  const header    = Buffer.alloc(8);
  Buffer.from('icns', 'ascii').copy(header, 0);
  header.writeUInt32BE(totalSize, 4);
  return Buffer.concat([header, body]);
}

// ── Generate ──────────────────────────────────────────────────────────────────
const png256 = buildPng(256, 0, 102, 204); // #0066CC — OpenClaw blue
const png512 = buildPng(512, 0, 102, 204);
const ico    = buildIco(png256);
const icns   = buildIcns([
  { type: 'ic08', png: png256 }, // 256×256
  { type: 'ic09', png: png512 }, // 512×512
]);

const pngPath  = path.join(ASSETS_DIR, 'icon.png');
const icoPath  = path.join(ASSETS_DIR, 'icon.ico');
const icnsPath = path.join(ASSETS_DIR, 'icon.icns');

fs.writeFileSync(pngPath,  png512); // Use 512×512 as the base PNG for best quality
fs.writeFileSync(icoPath,  ico);
fs.writeFileSync(icnsPath, icns);

console.log(`✔  Generated ${pngPath}`);
console.log(`✔  Generated ${icoPath}`);
console.log(`✔  Generated ${icnsPath}`);
console.log('   Size: PNG=%d B, ICO=%d B, ICNS=%d B', png512.length, ico.length, icns.length);

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  writeVersionMarker,
  readVersionMarker,
  isInstalled,
  backupInstallation,
  removeBackup,
  restoreBackup,
  extractZip,
  extractTarGz,
  extract,
  verifyChecksum,
} = require('../lib/installer');

const { buildZip, buildTarGz } = require('./helpers');

const tmpBase = path.join(os.tmpdir(), `oclaw-gui-installer-test-${Date.now()}`);

describe('installer', () => {
  before(() => fs.mkdirSync(tmpBase, { recursive: true }));
  after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  test('writeVersionMarker writes file', () => {
    const dir = path.join(tmpBase, 'install1');
    fs.mkdirSync(dir, { recursive: true });
    writeVersionMarker(dir, '1.2.3');
    const marker = path.join(dir, '.oclaw-version');
    assert.ok(fs.existsSync(marker));
    assert.equal(fs.readFileSync(marker, 'utf-8'), '1.2.3');
  });

  test('readVersionMarker reads written version', () => {
    const dir = path.join(tmpBase, 'install2');
    fs.mkdirSync(dir, { recursive: true });
    writeVersionMarker(dir, '2.0.0');
    assert.equal(readVersionMarker(dir), '2.0.0');
  });

  test('readVersionMarker returns null when no marker', () => {
    const dir = path.join(tmpBase, 'install3');
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(readVersionMarker(dir), null);
  });

  test('isInstalled returns false for empty dir', () => {
    const dir = path.join(tmpBase, 'install4');
    fs.mkdirSync(dir, { recursive: true });
    assert.equal(isInstalled(dir), false);
  });

  test('isInstalled returns true after writing marker', () => {
    const dir = path.join(tmpBase, 'install5');
    fs.mkdirSync(dir, { recursive: true });
    writeVersionMarker(dir, '1.0.0');
    assert.equal(isInstalled(dir), true);
  });

  test('backupInstallation renames directory', () => {
    const dir = path.join(tmpBase, 'install6');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'test.txt'), 'hello');
    const backupDir = backupInstallation(dir);
    assert.ok(!fs.existsSync(dir), 'original should not exist after backup');
    assert.ok(fs.existsSync(backupDir), 'backup dir should exist');
    // cleanup
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  test('backupInstallation returns null when dir does not exist', () => {
    const dir = path.join(tmpBase, 'nonexistent-install');
    assert.equal(backupInstallation(dir), null);
  });

  test('restoreBackup restores directory', () => {
    const dir = path.join(tmpBase, 'install7');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'data.txt'), 'data');
    const backupDir = backupInstallation(dir);
    restoreBackup(backupDir, dir);
    assert.ok(fs.existsSync(dir), 'dir should be restored');
    assert.ok(!fs.existsSync(backupDir), 'backup should be removed after restore');
  });

  test('removeBackup deletes backup directory', () => {
    const dir = path.join(tmpBase, 'install8');
    fs.mkdirSync(dir, { recursive: true });
    const backupDir = backupInstallation(dir);
    removeBackup(backupDir);
    assert.ok(!fs.existsSync(backupDir));
  });
});

// ── extractZip ────────────────────────────────────────────────────────────────

describe('extractZip', () => {
  const zipTmpBase = path.join(os.tmpdir(), `oclaw-gui-extractzip-test-${Date.now()}`);

  before(() => fs.mkdirSync(zipTmpBase, { recursive: true }));
  after(() => fs.rmSync(zipTmpBase, { recursive: true, force: true }));

  test('extracts zip to a plain directory', () => {
    const archivePath = path.join(zipTmpBase, 'plain.zip');
    const destDir     = path.join(zipTmpBase, 'plain-out');
    fs.writeFileSync(archivePath, buildZip('hello.txt', 'hello world'));

    extractZip(archivePath, destDir);

    assert.ok(fs.existsSync(path.join(destDir, 'hello.txt')), 'hello.txt should exist');
    assert.equal(fs.readFileSync(path.join(destDir, 'hello.txt'), 'utf-8'), 'hello world');
  });

  test('extracts zip to directory path that contains spaces', () => {
    const archivePath = path.join(zipTmpBase, 'archive with spaces.zip');
    const destDir     = path.join(zipTmpBase, 'dest dir with spaces');
    fs.writeFileSync(archivePath, buildZip('data.txt', 'content'));

    extractZip(archivePath, destDir);

    assert.ok(fs.existsSync(path.join(destDir, 'data.txt')), 'data.txt should exist');
    assert.equal(fs.readFileSync(path.join(destDir, 'data.txt'), 'utf-8'), 'content');
  });

  test('creates destination directory if it does not exist', () => {
    const archivePath = path.join(zipTmpBase, 'mkdir-test.zip');
    const destDir     = path.join(zipTmpBase, 'new-subdir', 'nested');
    fs.writeFileSync(archivePath, buildZip('f.txt', 'x'));

    extractZip(archivePath, destDir);

    assert.ok(fs.existsSync(destDir), 'destDir should have been created');
    assert.ok(fs.existsSync(path.join(destDir, 'f.txt')));
  });
});

// ── extractTarGz ──────────────────────────────────────────────────────────────

describe('extractTarGz', () => {
  // tar is not available on Windows, skip on that platform
  const skip = process.platform === 'win32';
  const tarTmpBase = path.join(os.tmpdir(), `oclaw-gui-extracttar-test-${Date.now()}`);

  before(() => fs.mkdirSync(tarTmpBase, { recursive: true }));
  after(() => fs.rmSync(tarTmpBase, { recursive: true, force: true }));

  test('extracts tar.gz to a directory', { skip }, () => {
    const archivePath = path.join(tarTmpBase, 'archive.tar.gz');
    const destDir     = path.join(tarTmpBase, 'tar-out');
    fs.writeFileSync(archivePath, buildTarGz('hello.txt', 'tar content'));

    extractTarGz(archivePath, destDir);

    assert.ok(fs.existsSync(path.join(destDir, 'hello.txt')), 'hello.txt should exist');
    assert.equal(fs.readFileSync(path.join(destDir, 'hello.txt'), 'utf-8'), 'tar content');
  });

  test('creates destination directory if it does not exist', { skip }, () => {
    const archivePath = path.join(tarTmpBase, 'mkdir.tar.gz');
    const destDir     = path.join(tarTmpBase, 'new-tar-dir', 'nested');
    fs.writeFileSync(archivePath, buildTarGz('g.txt', 'y'));

    extractTarGz(archivePath, destDir);

    assert.ok(fs.existsSync(destDir), 'destDir should have been created');
    assert.ok(fs.existsSync(path.join(destDir, 'g.txt')));
  });
});

// ── extract (auto-detect) ─────────────────────────────────────────────────────

describe('extract', () => {
  const extTmpBase = path.join(os.tmpdir(), `oclaw-gui-extract-test-${Date.now()}`);

  before(() => fs.mkdirSync(extTmpBase, { recursive: true }));
  after(() => fs.rmSync(extTmpBase, { recursive: true, force: true }));

  test('extract auto-detects zip by extension', () => {
    const archivePath = path.join(extTmpBase, 'auto.zip');
    const destDir     = path.join(extTmpBase, 'auto-zip-out');
    fs.writeFileSync(archivePath, buildZip('auto.txt', 'auto content'));

    extract(archivePath, destDir);

    assert.ok(fs.existsSync(path.join(destDir, 'auto.txt')));
    assert.equal(fs.readFileSync(path.join(destDir, 'auto.txt'), 'utf-8'), 'auto content');
  });

  test('extract throws for unsupported format', () => {
    const archivePath = path.join(extTmpBase, 'archive.rar');
    const destDir     = path.join(extTmpBase, 'rar-out');
    fs.writeFileSync(archivePath, Buffer.from('fake rar'));

    assert.throws(() => extract(archivePath, destDir), /unsupported archive format/i);
  });
});

// ── verifyChecksum ────────────────────────────────────────────────────────────

describe('verifyChecksum', () => {
  const csTmpBase = path.join(os.tmpdir(), `oclaw-gui-checksum-test-${Date.now()}`);

  before(() => fs.mkdirSync(csTmpBase, { recursive: true }));
  after(() => fs.rmSync(csTmpBase, { recursive: true, force: true }));

  function makeTmpFile(name, content) {
    const filePath = path.join(csTmpBase, name);
    const buf = Buffer.from(content, 'utf-8');
    fs.writeFileSync(filePath, buf);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    return { filePath, hash };
  }

  test('passes when checksum matches (plain hex)', () => {
    const { filePath, hash } = makeTmpFile('ok-plain.txt', 'hello world');
    assert.doesNotThrow(() => verifyChecksum(filePath, hash));
  });

  test('passes when checksum matches (sha256: prefix)', () => {
    const { filePath, hash } = makeTmpFile('ok-prefix.txt', 'hello world');
    assert.doesNotThrow(() => verifyChecksum(filePath, `sha256:${hash}`));
  });

  test('passes when checksum matches (SHA256: uppercase prefix)', () => {
    const { filePath, hash } = makeTmpFile('ok-upper.txt', 'case insensitive prefix');
    assert.doesNotThrow(() => verifyChecksum(filePath, `SHA256:${hash}`));
  });

  test('throws on checksum mismatch', () => {
    const { filePath } = makeTmpFile('bad.txt', 'real content');
    const wrongHash = 'a'.repeat(64);
    assert.throws(
      () => verifyChecksum(filePath, wrongHash),
      /checksum mismatch/i,
    );
  });

  test('error message includes expected and actual hex', () => {
    const { filePath, hash } = makeTmpFile('msg-test.txt', 'some data');
    const wrongHash = 'b'.repeat(64);
    let caught;
    try {
      verifyChecksum(filePath, wrongHash);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, 'should have thrown');
    assert.ok(caught.message.includes(wrongHash), 'message should contain expected hash');
    assert.ok(caught.message.includes(hash), 'message should contain actual hash');
  });
});

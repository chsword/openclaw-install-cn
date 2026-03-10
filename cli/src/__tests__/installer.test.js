'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  writeVersionMarker,
  readVersionMarker,
  isInstalled,
  backupInstallation,
  removeBackup,
  restoreBackup,
  extractZip,
} = require('../lib/installer');

const { buildZip } = require('./integration/mock-server');

const tmpBase = path.join(os.tmpdir(), `oclaw-installer-test-${Date.now()}`);

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
// These tests build a real in-memory ZIP (using the same helper as the mock
// CDN server) and then call extractZip() to verify extraction works.
//
// On Windows the extraction path uses PowerShell Expand-Archive with paths
// embedded in single-quoted PS strings.  The space-in-path test specifically
// validates that the -LiteralPath / single-quote fix handles spaces correctly.
//
// On Linux/macOS the `unzip` system tool is used; spaces are handled natively.

describe('extractZip', () => {
  const zipTmpBase = path.join(os.tmpdir(), `oclaw-extractzip-test-${Date.now()}`);

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

  // Regression test for the Windows path-quoting fix:
  //   Previously Expand-Archive was invoked via a double-quoted PS string which
  //   caused errors whenever the archive or destination path contained spaces
  //   (extremely common on Windows: C:\Users\John Doe\...).
  //   The fix uses a single-quoted PS string + -LiteralPath so spaces are safe.
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

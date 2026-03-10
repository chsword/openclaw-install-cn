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
} = require('../lib/installer');

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

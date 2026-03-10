'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { resolveLocalPackageDir } = require('../commands/install');
const { getPlatform, getArch, getPackageFilename } = require('../lib/platform');

const tmpBase = path.join(os.tmpdir(), `oclaw-install-test-${Date.now()}-${process.pid}`);

describe('resolveLocalPackageDir', () => {
  before(() => fs.mkdirSync(tmpBase, { recursive: true }));
  after(() => fs.rmSync(tmpBase, { recursive: true, force: true }));

  test('resolves archive from version subdirectory', () => {
    const platform = getPlatform();
    const arch = getArch();
    const platformKey = `${platform}-${arch}`;
    const version = '2.0.0';
    const filename = getPackageFilename(version, platform, arch);

    const bundleDir = path.join(tmpBase, 'bundle1');
    const versionDir = path.join(bundleDir, version);
    fs.mkdirSync(versionDir, { recursive: true });

    const manifest = {
      latest: version,
      versions: [
        {
          version,
          releaseDate: '2025-01-01',
          description: 'Test release',
          files: { [platformKey]: filename },
        },
      ],
    };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest));

    // Create a dummy archive file in the versioned subdir
    const archivePath = path.join(versionDir, filename);
    fs.writeFileSync(archivePath, 'dummy');

    const result = resolveLocalPackageDir(bundleDir, undefined, platform, arch);
    assert.equal(result.versionInfo.version, version);
    assert.equal(result.archivePath, archivePath);
  });

  test('resolves archive from flat directory (no version subdir)', () => {
    const platform = getPlatform();
    const arch = getArch();
    const platformKey = `${platform}-${arch}`;
    const version = '3.0.0';
    const filename = getPackageFilename(version, platform, arch);

    const bundleDir = path.join(tmpBase, 'bundle2');
    fs.mkdirSync(bundleDir, { recursive: true });

    const manifest = {
      latest: version,
      versions: [{ version, files: { [platformKey]: filename } }],
    };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest));

    // Create archive directly in bundle root (flat layout)
    const archivePath = path.join(bundleDir, filename);
    fs.writeFileSync(archivePath, 'dummy');

    const result = resolveLocalPackageDir(bundleDir, undefined, platform, arch);
    assert.equal(result.versionInfo.version, version);
    assert.equal(result.archivePath, archivePath);
  });

  test('honours explicit version when manifest has multiple versions', () => {
    const platform = getPlatform();
    const arch = getArch();
    const platformKey = `${platform}-${arch}`;
    const v1 = '1.0.0';
    const v2 = '2.0.0';
    const filename1 = getPackageFilename(v1, platform, arch);

    const bundleDir = path.join(tmpBase, 'bundle3');
    const v1Dir = path.join(bundleDir, v1);
    fs.mkdirSync(v1Dir, { recursive: true });

    const manifest = {
      latest: v2,
      versions: [
        { version: v1, files: { [platformKey]: filename1 } },
        { version: v2, files: { [platformKey]: getPackageFilename(v2, platform, arch) } },
      ],
    };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(v1Dir, filename1), 'dummy');

    const result = resolveLocalPackageDir(bundleDir, v1, platform, arch);
    assert.equal(result.versionInfo.version, v1);
  });

  test('falls back to derived filename when files map is absent', () => {
    const platform = getPlatform();
    const arch = getArch();
    const version = '4.0.0';
    const filename = getPackageFilename(version, platform, arch);

    const bundleDir = path.join(tmpBase, 'bundle4');
    const versionDir = path.join(bundleDir, version);
    fs.mkdirSync(versionDir, { recursive: true });

    // No files map in versionInfo
    const manifest = { latest: version, versions: [{ version }] };
    fs.writeFileSync(path.join(bundleDir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(versionDir, filename), 'dummy');

    const result = resolveLocalPackageDir(bundleDir, undefined, platform, arch);
    assert.equal(result.versionInfo.version, version);
    assert.equal(path.basename(result.archivePath), filename);
  });
});

#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target || !['win', 'mac', 'linux'].includes(target)) {
  console.error('Usage: node scripts/collect-artifacts.js <win|mac|linux>');
  process.exit(1);
}

const guiRoot = path.join(__dirname, '..');
const distDir = path.join(guiRoot, 'dist');
const tauriRoot = path.join(guiRoot, 'src-tauri', 'target', 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(guiRoot, 'package.json'), 'utf8'));
const version = pkg.version;

ensureDir(distDir);
cleanDir(distDir);

if (target === 'win') {
  const setup = findFirst(path.join(tauriRoot, 'bundle', 'nsis'), (name) => /setup.*\.exe$/i.test(name) || /\.exe$/i.test(name));
  const portable = path.join(tauriRoot, 'openclaw-gui.exe');

  if (!setup || !fs.existsSync(portable)) {
    throw new Error('Windows artifacts not found. Please run `tauri build --bundles nsis` first.');
  }

  copy(setup, path.join(distDir, `openclaw-gui-setup-${version}-x64.exe`));
  copy(portable, path.join(distDir, `openclaw-gui-${version}-win32-x64.exe`));
}

if (target === 'mac') {
  const dmgDir = path.join(tauriRoot, 'bundle', 'dmg');
  const files = listFiles(dmgDir).filter((file) => file.toLowerCase().endsWith('.dmg'));
  if (files.length === 0) {
    throw new Error('macOS dmg artifacts not found. Please run `tauri build --bundles dmg` first.');
  }

  let copied = 0;
  for (const file of files) {
    const name = path.basename(file).toLowerCase();
    if (name.includes('x64')) {
      copy(file, path.join(distDir, `openclaw-gui-${version}-darwin-x64.dmg`));
      copied += 1;
    } else if (name.includes('aarch64') || name.includes('arm64')) {
      copy(file, path.join(distDir, `openclaw-gui-${version}-darwin-arm64.dmg`));
      copied += 1;
    }
  }

  if (copied === 0) {
    const fallback = files[0];
    copy(fallback, path.join(distDir, `openclaw-gui-${version}-darwin-arm64.dmg`));
  }
}

if (target === 'linux') {
  const appImage = findFirst(path.join(tauriRoot, 'bundle', 'appimage'), (name) => name.endsWith('.AppImage'));
  if (!appImage) {
    throw new Error('Linux AppImage not found. Please run `tauri build --bundles appimage` first.');
  }
  copy(appImage, path.join(distDir, `openclaw-gui-${version}-linux-x86_64.AppImage`));
}

console.log(`Collected ${target} artifacts into: ${distDir}`);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cleanDir(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      fs.rmSync(full, { recursive: true, force: true });
    } else {
      fs.unlinkSync(full);
    }
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function findFirst(dir, predicate) {
  for (const file of listFiles(dir)) {
    if (predicate(path.basename(file))) {
      return file;
    }
  }
  return null;
}

function copy(source, destination) {
  fs.copyFileSync(source, destination);
  console.log(`  - ${path.basename(destination)}`);
}

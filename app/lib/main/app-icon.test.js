'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { appIconPath } = require('./app-icon');

test('Athena app icon PNG exists and is a 256 RGBA image', () => {
  const icon = appIconPath();
  assert.ok(icon);
  const bytes = fs.readFileSync(icon);
  assert.equal(bytes[0], 0x89);
  assert.equal(bytes[1], 0x50);
  assert.equal(bytes[2], 0x4e);
  assert.equal(bytes[3], 0x47);
  assert.ok(bytes.length > 1024);
});

test('Windows ICO companion exists next to the PNG', () => {
  const ico = path.join(path.dirname(appIconPath()), 'athena-icon.ico');
  assert.equal(fs.existsSync(ico), true);
  const bytes = fs.readFileSync(ico);
  assert.equal(bytes[0], 0x00);
  assert.equal(bytes[1], 0x00);
  assert.equal(bytes[2], 0x01);
  assert.equal(bytes[3], 0x00);
});

test('main and installer wire the Athena icon into the desktop app', () => {
  const root = path.join(__dirname, '..', '..', '..');
  const main = fs.readFileSync(path.join(root, 'app', 'main.js'), 'utf8');
  const installer = fs.readFileSync(path.join(root, 'scripts', 'windows-installer.config.cjs'), 'utf8');
  const orb = fs.readFileSync(path.join(root, 'app', 'lib', 'main', 'orb-window.js'), 'utf8');
  assert.match(main, /appIconPath/);
  assert.match(main, /icon: APP_ICON/);
  assert.match(main, /nativeImage\.createFromPath\(APP_ICON\)/);
  assert.match(orb, /appIconPath/);
  assert.match(installer, /icon: 'data\/athena-icon\.ico'/);
});

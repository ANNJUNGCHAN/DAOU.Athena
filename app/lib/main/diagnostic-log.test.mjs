import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import logger from './diagnostic-log.js';

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-log-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'logs', 'main-debug.log'),
    log: logger.createDiagnosticLog({ userDataPath: () => root, ...options }) };
}

test('creates user data log directory and records safe lifecycle and failure stages only', (t) => {
  const { log, file } = fixture(t);
  log('module loaded, ATHENA_NO_AUTOSTART: private-value');
  log('세션 스토어 열기 실패 — dummy-secret /private/profile user@example.invalid');
  log('부팅 작업 account-token → failed — dummy-secret account 123456');
  log('부팅 작업 backend → succeeded — dummy-secret');
  log('부팅 작업 private-value → failed — dummy-secret');
  log('부팅 작업 backend → private-value');
  log('unrecognized dummy-secret');
  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /module loaded\n/);
  assert.match(content, /session store open failed\n/);
  assert.match(content, /boot account-token failed\n/);
  assert.match(content, /boot backend succeeded\n/);
  assert.doesNotMatch(content, /dummy-secret|private|123456|@/);
  assert.equal(content.trim().split('\n').length, 4);
});

test('rotates to exactly one bounded backup and caps oversized development messages', (t) => {
  const { log, file, root } = fixture(t, { detailed: true, maxBytes: 256 });
  log('first '.repeat(80));
  assert.equal(fs.statSync(file).size, 256);
  log('second '.repeat(80));
  log('third '.repeat(80));
  assert.equal(fs.statSync(file).size, 256);
  assert.equal(fs.statSync(`${file}.1`).size, 256);
  assert.match(fs.readFileSync(file, 'utf8'), /third/);
  assert.match(fs.readFileSync(`${file}.1`, 'utf8'), /second/);
  assert.deepEqual(fs.readdirSync(path.join(root, 'logs')).sort(), ['main-debug.log', 'main-debug.log.1']);
  log('한글\n'.repeat(200));
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(fs.statSync(file).size <= 256);
  assert.equal(content.split('\n').length, 2);
  assert.ok(content.endsWith('\n'));
  assert.doesNotMatch(content, /\uFFFD/);
});

test('path lookup and unwritable-directory failures never escape and a later write recovers', (t) => {
  assert.doesNotThrow(() => logger.createDiagnosticLog({ userDataPath() { throw new Error('not ready'); } })('createWindows start'));
  const { root, file, log } = fixture(t);
  fs.writeFileSync(path.join(root, 'logs'), 'blocking file');
  assert.doesNotThrow(() => log('createWindows start'));
  fs.unlinkSync(path.join(root, 'logs'));
  log('createWindows start');
  assert.match(fs.readFileSync(file, 'utf8'), /window creation started/);
  fs.mkdirSync(`${file}.1`);
  const bounded = logger.createDiagnosticLog({ userDataPath: () => root, maxBytes: 32 });
  assert.doesNotThrow(() => bounded('createWindows start'));
});

test('main chooses userData storage and disables detailed logging in packaged builds', () => {
  const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  assert.match(main, /userDataPath: \(\) => app\.getPath\('userData'\)/);
  assert.match(main, /detailed: !app\.isPackaged/);
  assert.doesNotMatch(main, /const MDEBUGLOG/);
});

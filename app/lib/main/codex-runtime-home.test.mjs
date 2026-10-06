import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCodexRuntime } = require('./codex-runtime-home');

test('Windows interactive launcher executes a native fixture in a usable terminal', async (t) => {
  if (process.platform !== 'win32') return;
  const runtimeHome = temporaryHome(t);
  const root = path.dirname(runtimeHome);
  fs.mkdirSync(root, { recursive: true });
  const report = path.join(root, 'terminal.json');
  const fixture = path.join(root, 'terminal.cjs');
  fs.writeFileSync(fixture, `require('node:fs').writeFileSync(${JSON.stringify(report)}, JSON.stringify({ stdin: !!process.stdin.isTTY, stdout: !!process.stdout.isTTY, stderr: !!process.stderr.isTTY, home: process.env.CODEX_HOME }));`);
  const runtime = createCodexRuntime({ runtimeHome, codexExecutable: process.execPath, spawnImpl: spawn });
  const child = runtime.spawnPrivateHomeInteractiveCommand([fixture], { title: 'Athena terminal verification' });
  const exit = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
  assert.equal(exit, 0);
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(report) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(report), true, 'interactive terminal must execute its command');
  assert.deepEqual(JSON.parse(fs.readFileSync(report, 'utf8')), { stdin: true, stdout: true, stderr: true, home: runtimeHome });
});

function temporaryHome(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-codex-home-test-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('athena-codex-home-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return path.join(root, 'new-profile', 'codex-runtime');
}

for (const kind of ['status', 'interactive']) {
  test(`${kind} creates missing private home before spawning Codex`, (t) => {
    const runtimeHome = temporaryHome(t);
    assert.equal(fs.existsSync(runtimeHome), false);
    let spawned = 0;
    const runtime = createCodexRuntime({
      runtimeHome, codexExecutable: 'test-codex', platform: 'win32',
      spawnImpl(command, args, options) {
        spawned++;
        assert.equal(fs.statSync(runtimeHome).isDirectory(), true);
        assert.equal(options.env.CODEX_HOME, runtimeHome);
        assert.equal(fs.existsSync(path.join(runtimeHome, 'auth.json')), false);
        if (kind === 'interactive') {
          assert.equal(command, 'powershell.exe');
          assert.deepEqual(JSON.parse(options.env.ATHENA_CODEX_ARGV_JSON), ['login']);
        } else {
          assert.equal(command, 'test-codex');
          assert.deepEqual(args, ['login', 'status']);
        }
        return { marker: 'child' };
      },
    });
    const result = kind === 'interactive'
      ? runtime.spawnPrivateHomeInteractiveCommand(['login'])
      : runtime.spawnPrivateHomeCommand(['login', 'status']);
    assert.equal(result.marker, 'child');
    assert.equal(spawned, 1);
  });
}

test('existing private auth and config files are untouched by repeated setup', (t) => {
  const runtimeHome = temporaryHome(t);
  fs.mkdirSync(runtimeHome, { recursive: true });
  const auth = path.join(runtimeHome, 'auth.json');
  const config = path.join(runtimeHome, 'config.toml');
  fs.writeFileSync(auth, 'test-only-auth-marker');
  fs.writeFileSync(config, '# test-only-config-marker');
  const runtime = createCodexRuntime({ runtimeHome, codexExecutable: 'test-codex', spawnImpl: () => ({}) });
  runtime.spawnPrivateHomeCommand(['login', 'status']);
  runtime.spawnPrivateHomeInteractiveCommand(['login']);
  assert.equal(fs.readFileSync(auth, 'utf8'), 'test-only-auth-marker');
  assert.equal(fs.readFileSync(config, 'utf8'), '# test-only-config-marker');
});

test('directory creation failure prevents spawn and gives an actionable error', () => {
  let spawned = false;
  const cause = Object.assign(new Error('test permission failure'), { code: 'EACCES' });
  const runtime = createCodexRuntime({
    runtimeHome: path.join(os.tmpdir(), 'unused-test-home'), codexExecutable: 'test-codex',
    fsImpl: { mkdirSync() { throw cause; } },
    spawnImpl() { spawned = true; },
  });
  for (const invoke of [
    () => runtime.spawnPrivateHomeCommand(['login', 'status']),
    () => runtime.spawnPrivateHomeInteractiveCommand(['login']),
  ]) {
    assert.throws(invoke, (error) => error.code === 'CODEX_RUNTIME_HOME_UNAVAILABLE'
      && error.cause === cause && error.message.includes('폴더 접근 권한'));
  }
  assert.equal(spawned, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveCodexExecutable } = require('./codex-bin');
const base = path.resolve('codex-resolver-test');
const npm = path.join(base, 'npm');
const wrapper = path.join(npm, 'codex.cmd');
const npmNative = path.join(npm, 'node_modules', '@openai', 'codex', 'node_modules',
  '@openai/codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const desktopNative = path.join(base, 'desktop', 'codex.exe');

function resolve(discovered, files, env = {}) {
  return resolveCodexExecutable({
    platform: 'win32', env,
    existsSync: (candidate) => files.includes(candidate),
    spawnSyncImpl: () => ({ status: 0, stdout: discovered.join('\r\n') }),
  });
}

test('npm shim ahead of desktop executable wins at its original PATH position', () => {
  assert.equal(resolve([wrapper, desktopNative], [npmNative, desktopNative]), npmNative);
});

test('earlier native executable keeps precedence over a later npm shim', () => {
  assert.equal(resolve([desktopNative, wrapper], [npmNative, desktopNative]), desktopNative);
});

test('unusable PATH candidates are skipped without blocking later installations', () => {
  assert.equal(resolve([wrapper, desktopNative], [desktopNative]), desktopNative);
  assert.equal(resolve([desktopNative, wrapper], [npmNative]), npmNative);
});

test('APPDATA npm fallback works with no usable PATH result', () => {
  assert.equal(resolve([], [npmNative], { APPDATA: base }), npmNative);
});

test('explicit override remains authoritative and does not probe PATH', () => {
  const override = path.join(base, 'explicit', 'codex.exe');
  assert.equal(resolveCodexExecutable({
    env: { ATHENA_CODEX_BIN: override }, platform: 'win32',
    spawnSyncImpl() { throw new Error('must not probe'); },
    existsSync() { throw new Error('must not inspect another install'); },
  }), override);
});

test('missing native binary still fails explicitly instead of spawning a shim', () => {
  assert.throws(() => resolve([wrapper], []), { code: 'CODEX_EXECUTABLE_NOT_FOUND' });
});

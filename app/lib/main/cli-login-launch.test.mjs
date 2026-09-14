import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const { createCliAccounts } = require('./cli-accounts');

function childProcessDouble() {
  const child = new EventEmitter();
  child.unrefCalls = 0;
  child.unref = () => { child.unrefCalls += 1; };
  child.kill = () => true;
  return child;
}

function loginHarness(t, outcome) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `athena-cli-launch-${outcome}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let launchChild;
  const accounts = createCliAccounts({
    appImpl: { getPath: () => path.join(root, 'user-data') },
    runtime: {
      spawnPrivateHomeInteractiveCommand() {
        if (outcome === 'throw') throw new Error('fixture synchronous launch failure');
        launchChild = childProcessDouble();
        queueMicrotask(() => {
          if (outcome === 'spawn') launchChild.emit('spawn');
          else if (outcome === 'error') {
            launchChild.emit('error', new Error('fixture asynchronous launch failure'));
            launchChild.emit('exit', 1, null);
          } else {
            launchChild.emit('exit', 1, null);
          }
        });
        return launchChild;
      },
    },
    fsImpl: fs,
    osImpl: { homedir: () => root },
    spawnImpl(command) {
      assert.equal(command, 'where');
      const child = childProcessDouble();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });
  return { accounts, launchChild: () => launchChild };
}

function assertLaunchListenersClean(child) {
  assert.equal(child.listenerCount('spawn'), 0);
  assert.equal(child.listenerCount('error'), 0);
  assert.equal(child.listenerCount('exit'), 0);
}

test('Codex login reports success only after the detached launcher spawns', async (t) => {
  const run = loginHarness(t, 'spawn');

  const result = await run.accounts.login('codex');

  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(run.launchChild().unrefCalls, 1);
  assertLaunchListenersClean(run.launchChild());
});

test('Codex login converts an asynchronous launcher error into an IPC failure', async (t) => {
  const run = loginHarness(t, 'error');

  const result = await run.accounts.login('codex');

  assert.deepEqual(result, { ok: false, launched: false, message: '로그인 창을 열지 못했다' });
  assert.equal(run.launchChild().unrefCalls, 0);
  assertLaunchListenersClean(run.launchChild());
});

test('Codex login rejects a synchronous throw or exit before spawn', async (t) => {
  for (const outcome of ['throw', 'exit']) {
    const run = loginHarness(t, outcome);

    const result = await run.accounts.login('codex');

    assert.deepEqual(result, { ok: false, launched: false, message: '로그인 창을 열지 못했다' });
    if (run.launchChild()) {
      assert.equal(run.launchChild().unrefCalls, 0);
      assertLaunchListenersClean(run.launchChild());
    }
  }
});

test('Codex login survives a real asynchronous ENOENT from ChildProcess', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-cli-launch-enoent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingExecutable = path.join(root, 'definitely-missing-launcher.exe');
  const accounts = createCliAccounts({
    appImpl: { getPath: () => path.join(root, 'user-data') },
    runtime: {
      spawnPrivateHomeInteractiveCommand() {
        return spawn(missingExecutable, [], { shell: false, stdio: 'ignore' });
      },
    },
    fsImpl: fs,
    osImpl: { homedir: () => root },
    spawnImpl(command) {
      assert.equal(command, 'where');
      const child = childProcessDouble();
      queueMicrotask(() => child.emit('exit', 0, null));
      return child;
    },
  });

  const result = await accounts.login('codex');

  assert.deepEqual(result, { ok: false, launched: false, message: '로그인 창을 열지 못했다' });
});

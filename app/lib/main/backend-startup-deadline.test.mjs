import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const flush = () => new Promise((resolve) => setImmediate(resolve));

function harness({ healthy = true } = {}) {
  let now = 0;
  let killed = 0;
  let spawned = 0;
  const timers = new Set();
  const setTimer = (fn, delay) => {
    const timer = { fn, at: now + delay };
    timers.add(timer);
    return timer;
  };
  const clearTimer = (timer) => timers.delete(timer);
  const fakeDate = class extends Date { static now() { return now; } };
  const endpointModule = { exports: {} };
  const globals = { URL, process: { env: {} }, Date: fakeDate, setTimeout: setTimer, clearTimeout: clearTimer };
  vm.runInNewContext(fs.readFileSync(new URL('./backend-endpoint.js', import.meta.url), 'utf8'), {
    ...globals, module: endpointModule,
  });
  const child = new EventEmitter();
  child.pid = 101;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const healthChecks = [];
  const launcherModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('./backend-launcher.js', import.meta.url), 'utf8'), {
    ...globals,
    module: launcherModule,
    require: (id) => {
      if (id === './backend-endpoint') return endpointModule.exports;
      if (id === './mcp-config') return { BACKEND_DIR: 'fixture', PYTHON_EXE: 'fixture-python' };
      if (id === './proc-utils') return { killTree: () => { killed += 1; } };
      if (id === './claude-bin') return { getClaudeBin: () => 'fixture-claude' };
      if (id === 'fs') return {
        existsSync: () => true,
        mkdirSync: () => {},
        createWriteStream: () => Object.assign(new EventEmitter(), { write() {}, end() {} }),
      };
      return require(id);
    },
    AbortController,
    fetch: async (_url, { signal }) => {
      healthChecks.push(now);
      if (healthy === 'hang') {
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      }
      return { ok: healthy };
    },
  });
  const launcher = launcherModule.exports;
  const start = (options = {}) => launcher.ensureBackend({ ...options, _dependencies: {
    spawnFn: () => { spawned += 1; return child; },
    waitForBackendUrlFn: (spawned, timeout) => launcher.waitForAnnouncedBackendUrl(spawned, timeout),
  } });
  return {
    child, launcher, healthChecks, endpoint: endpointModule.exports, start,
    startReady: () => launcher.ensureBackendReady({ _dependencies: { ensureBackendFn: start } }),
    killed: () => killed,
    spawned: () => spawned,
    setHealthy: (value) => { healthy = value; },
    announce: (text = 'http://127.0.0.1:32100') => child.stdout.emit('data', `ATHENA_BACKEND_URL=${text}\n`),
    async advance(milliseconds) {
      const target = now + milliseconds;
      await flush();
      while (true) {
        const next = [...timers].filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        timers.delete(next);
        next.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

test('cold backend may announce after six seconds and still become ready', async () => {
  const h = harness();
  const started = h.start();
  await h.advance(10_000);
  assert.equal(h.killed(), 0);
  assert.equal(h.launcher.hasSpawnedChild(), true);
  h.announce();
  const result = await started;
  assert.equal(result.ready, true);
  assert.equal(h.endpoint.getBackendUrl(), 'http://127.0.0.1:32100');
});

test('backend that never announces is retired at the shared sixty-second deadline', async () => {
  const h = harness();
  const started = h.start();
  await h.advance(59_999);
  assert.equal(h.killed(), 0);
  await h.advance(1);
  assert.equal((await started).reason, 'endpoint-unavailable');
  assert.equal(h.killed(), 1);
  assert.equal(h.launcher.hasSpawnedChild(), false);
});

for (const healthy of [false, 'hang']) {
  test(`late announcement leaves only the remaining budget for health (${healthy})`, async () => {
    const h = harness({ healthy });
    const started = h.start();
    await h.advance(59_000);
    h.announce();
    await h.advance(999);
    assert.equal(h.killed(), 0);
    await h.advance(1);
    await started;
    assert.equal(h.killed(), 1);
    assert.equal(h.launcher.hasSpawnedChild(), false);
    assert.equal(h.endpoint.getBackendUrl(), null);
    assert.ok(h.healthChecks.every((time) => time < 60_000));
  });
}

test('background health polling also retires an unready child at the shared deadline', async () => {
  const h = harness({ healthy: false });
  const started = h.start();
  await h.advance(45_000);
  h.announce();
  await h.advance(12_000);
  assert.equal((await started).ready, false);
  assert.equal(h.killed(), 0);
  await h.advance(3_000);
  assert.equal(h.killed(), 1);
  assert.equal(h.launcher.hasSpawnedChild(), false);
});

test('readiness loop cannot respawn after its foreground health check crosses the shared deadline', async () => {
  const h = harness({ healthy: 'hang' });
  let result = null;
  const started = h.startReady().then((value) => { result = value; });
  h.announce();
  await h.advance(59_999);
  assert.equal(result, null);
  assert.equal(h.killed(), 0);
  await h.advance(1);
  assert.ok(result, 'readiness settles at sixty seconds instead of granting another startup budget');
  await started;
  assert.equal(result.reason, 'readiness-hard-timeout');
  assert.equal(h.killed(), 1);
  assert.equal(h.spawned(), 1);
  assert.equal(h.launcher.hasSpawnedChild(), false);
  await h.advance(60_000);
  assert.equal(h.spawned(), 1);
});

test('readiness loop preserves a backend that becomes healthy before the shared deadline', async () => {
  const h = harness({ healthy: false });
  const started = h.startReady();
  h.announce();
  await h.advance(55_000);
  h.setHealthy(true);
  await h.advance(500);
  assert.equal((await started).ready, true);
  await h.advance(10_000);
  assert.equal(h.killed(), 0);
  assert.equal(h.spawned(), 1);
  assert.equal(h.launcher.hasSpawnedChild(), true);
});

for (const failure of ['exit', 'error', 'invalid']) {
  test(`announcement ${failure} fails promptly and removes announcement listeners`, async () => {
    const h = harness();
    const started = h.start();
    if (failure === 'exit') h.child.emit('exit', 3, null);
    if (failure === 'error') h.child.emit('error', new Error('synthetic spawn error'));
    if (failure === 'invalid') h.announce('file:///invalid');
    const result = await started;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'endpoint-unavailable');
    assert.equal(h.killed(), 1);
    assert.equal(h.child.stdout.listenerCount('data'), 1, 'only the existing output capture remains');
    await h.advance(60_000);
    assert.equal(h.killed(), 1);
  });
}

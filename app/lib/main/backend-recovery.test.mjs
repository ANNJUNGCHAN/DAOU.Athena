import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { StartupReadiness, StartupFailureNotifier } = require('./startup-readiness');
const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');

async function harness({ finalReplacementFails = false } = {}) {
  const endpointModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('./backend-endpoint.js', import.meta.url), 'utf8'), {
    module: endpointModule, URL, process: { env: {} }, setTimeout, clearTimeout,
  });
  const endpoint = endpointModule.exports;
  const launcherModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(new URL('./backend-launcher.js', import.meta.url), 'utf8'), {
    module: launcherModule,
    require: (id) => {
      if (id === './backend-endpoint') return endpoint;
      if (id === './mcp-config') return { BACKEND_DIR: 'fixture', PYTHON_EXE: 'fixture-python' };
      if (id === './proc-utils') return { killTree: () => {} };
      if (id === './claude-bin') return { getClaudeBin: () => 'fixture-claude' };
      return require(id);
    },
    process: { env: {} }, URL, AbortController, fetch, setTimeout, clearTimeout,
  });
  const launcher = launcherModule.exports;
  const children = [];
  const states = [];
  const applied = [];
  const notifications = [];
  const payloads = [];
  let configured = 0;
  let now = 1_000;
  let releaseCooldown;
  let cooldownStarted;
  const cooldown = new Promise((resolve) => { cooldownStarted = resolve; });
  const dependencies = {
    nowFn: () => now,
    venvExistsFn: () => true,
    checkHealthFn: async () => false,
    spawnFn: () => {
      const child = new EventEmitter();
      child.pid = children.length + 1;
      children.push(child);
      return child;
    },
    waitUntilHealthyFn: async () => true,
    waitForBackendUrlFn: async (child) => {
      if (child.pid === 2 || (child.pid === 3 && finalReplacementFails)) {
        child.emit('exit', 3, null);
        throw new Error('backend exited before endpoint announcement (code=3)');
      }
      return 'http://127.0.0.1:56897';
    },
    killTreeFn: () => {},
  };
  const readiness = new StartupReadiness({
    tasks: [{ id: 'backend', kind: 'gate', label: 'ATHENA service' }],
    runId: 'initial-run',
    onChange: (snapshot) => states.push(snapshot.tasks[0].state),
  });
  const notifier = new StartupFailureNotifier();
  const notify = (snapshot, payloadOverride) => notifier.notify(snapshot, {
    shell: (payload) => {
      notifications.push(snapshot);
      payloads.push(payloadOverride || payload);
      return true;
    },
  });
  // An earlier boot failure notification must not suppress runtime recovery failure.
  await notify({ runId: 'initial-run', phase: 'degraded', tasks: [
    { id: 'backend', kind: 'gate', state: 'failed', label: 'ATHENA service' },
  ] });
  const context = vm.createContext({
    Promise, isQuitting: false, startupReadiness: readiness, backendEndpoint: endpoint,
    backendLauncher: {
      ...launcher,
      ensureBackendReady: (options) => launcher.ensureBackendReady({
        ...options, _dependencies: {
          nowFn: () => now,
          ensureBackendFn: () => launcher.ensureBackend({ _dependencies: dependencies }),
        },
      }),
    },
    mdlog: () => {},
    applyBackendEndpoint: (url) => applied.push(url),
    configureConversationGraphPipeline: () => { configured += 1; },
    notifyStartupFailuresAfterExpansion: notify,
    waitMs: (ms) => {
      assert.equal(ms, 60_000);
      cooldownStarted();
      return new Promise((resolve) => {
        releaseCooldown = () => { now += ms; resolve(); };
      });
    },
  });
  const start = source.indexOf('async function ensureBackendStrict(');
  const end = source.indexOf('function waitMs(ms)', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  readiness.setRunner('backend', context.ensureBackendStrict);
  assert.match(source, /setOwnedChildExitListener\(recoverOwnedBackend\)/);
  launcher.setOwnedChildExitListener(context.recoverOwnedBackend);
  await readiness.start('backend');
  assert.equal(readiness.snapshot().tasks[0].state, 'succeeded');
  children[0].emit('exit', 1, null);
  const recovery = context.recoverOwnedBackend();
  await cooldown;
  return {
    context, children, states, applied, notifications, payloads, readiness, recovery, endpoint,
    configured: () => configured,
    release: () => releaseCooldown(),
    shutdown: () => { context.isQuitting = true; launcher.shutdownBackend({ killTreeFn: () => {} }); },
  };
}

test('replacement startup exit is tracked, cooldown retry is deduplicated and restores endpoint/pipeline', async () => {
  const h = await harness();
  assert.equal(h.children.length, 2);
  assert.equal(h.endpoint.getBackendUrl(), null);
  assert.equal(h.readiness.snapshot().tasks[0].state, 'retrying');
  assert.equal(h.context.recoverOwnedBackend(), h.recovery);
  h.release();
  await h.recovery;
  assert.equal(h.children.length, 3);
  assert.equal(h.readiness.snapshot().tasks[0].state, 'succeeded');
  assert.equal(h.endpoint.getBackendUrl(), 'http://127.0.0.1:56897');
  assert.deepEqual(h.applied, ['http://127.0.0.1:56897', 'http://127.0.0.1:56897']);
  assert.equal(h.configured(), 2);
  assert.ok(h.states.includes('failed'));
  assert.equal(h.notifications.length, 1);
});

test('second failed replacement stops with visible failure despite prior notification', async () => {
  const h = await harness({ finalReplacementFails: true });
  h.release();
  await h.recovery;
  assert.equal(h.children.length, 3);
  assert.equal(h.endpoint.getBackendUrl(), null);
  const snapshot = h.readiness.snapshot();
  assert.equal(snapshot.phase, 'degraded');
  assert.equal(snapshot.tasks[0].state, 'failed');
  assert.match(snapshot.tasks[0].detail, /앱을 종료한 뒤 다시 실행/);
  assert.equal(h.notifications.length, 2);
  assert.match(h.notifications[1].runId, /backend-recovery:1$/);
  assert.match(h.payloads[1].title, /서비스를 복구하지 못/);
  assert.match(h.payloads[1].body, /앱을 종료한 뒤 다시 실행/);
  assert.equal(h.configured(), 1);
});

test('shutdown during cooldown prevents delayed spawn and later exit callbacks do nothing', async () => {
  const h = await harness();
  h.shutdown();
  h.release();
  await h.recovery;
  await h.context.recoverOwnedBackend();
  assert.equal(h.children.length, 2);
  assert.equal(h.configured(), 1);
  assert.equal(h.notifications.length, 1);
});

test('recovery notification override reaches shell, orb and OS with restart guidance', async () => {
  const received = [];
  const context = vm.createContext({
    shellExpansionAcknowledged: true,
    startupFailureNotifier: new StartupFailureNotifier(),
    shellWin: 'shell', orbWin: 'orb', Notification: {}, APP_ICON: null,
    startupFailureNotificationResult: null,
    sendRendererStartupNotification: async (target, payload) => {
      received.push({ target, ...payload });
      return true;
    },
    showStartupOsNotification: async (_ctor, payload) => {
      received.push({ target: 'os', ...payload });
      return true;
    },
  });
  const start = source.indexOf('async function notifyStartupFailuresAfterExpansion(');
  const end = source.indexOf('function broadcastBootReadiness(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  const payload = { title: 'Recovery failed', body: 'Restart the app.' };
  await context.notifyStartupFailuresAfterExpansion({
    runId: 'recovery-1', phase: 'degraded', tasks: [
      { id: 'backend', kind: 'gate', state: 'failed', label: 'ATHENA service' },
    ],
  }, payload);
  assert.deepEqual(received.map(({ target }) => target), ['shell', 'orb', 'os']);
  assert.ok(received.every(({ title, body }) => title === payload.title && body === payload.body));
});

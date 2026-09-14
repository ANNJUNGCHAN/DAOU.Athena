import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`missing function: ${signature}`);
  const paramsStart = source.indexOf('(', start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === '(') paramsDepth += 1;
    if (source[index] === ')') paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const brace = source.indexOf('{', paramsEnd);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${signature}`);
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeTimers() {
  let nextId = 1;
  const tasks = new Map();
  return {
    setTimer(callback, delay) {
      const id = nextId;
      nextId += 1;
      tasks.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) { tasks.delete(id); },
    runNext() {
      const entry = tasks.entries().next().value;
      if (!entry) return false;
      const [id, task] = entry;
      tasks.delete(id);
      task.callback();
      return true;
    },
    delays: () => [...tasks.values()].map((task) => task.delay),
    size: () => tasks.size,
  };
}

function loadCanvasLifecycle(overrides = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');
  const context = vm.createContext({
    Promise,
    setTimeout,
    clearTimeout,
    quoteRealtimeResetters: new Set(),
    ...overrides,
  });
  vm.runInContext([
    functionSource(source, 'function resolveEnvelopeSymbol('),
    functionSource(source, 'function releaseRendererRealtimeLease('),
    functionSource(source, 'function createQuoteRealtimeLeaseLifecycle('),
    functionSource(source, 'function wireQuoteRealtime('),
    functionSource(source, 'function resetQuoteRealtimeForAccountChange('),
  ].join('\n'), context);
  return context;
}

test('failed quote REG retries while connected, then ticks update and one lease is released', async () => {
  const timers = fakeTimers();
  const calls = [];
  const destroyers = new Map();
  let panelTick = null;
  let applied = 0;
  let attempts = 0;
  const context = loadCanvasLifecycle({
    setTimeout: timers.setTimer,
    clearTimeout: timers.clearTimer,
    cardDestroyers: destroyers,
    quoteRealtimePanels: {
      openPanel(_card, _symbol, onTick) { panelTick = onTick; },
      closePanel() { calls.push(['close-panel']); },
    },
    window: {
      athena: {
        invoke: async (channel, payload) => {
          calls.push([channel, payload]);
          if (channel === 'athena:realtime-release') return true;
          attempts += 1;
          return attempts === 1
            ? { ok: false, error: 'temporary REG failure' }
            : { ok: true, leaseToken: 'lease-1' };
        },
      },
    },
  });

  const card = {};
  context.wireQuoteRealtime(card, {}, { operation_args: { stk_cd: '005930' } }, () => { applied += 1; });
  await flush();
  assert.equal(attempts, 1);
  assert.deepEqual(timers.delays(), [250]);

  timers.runNext();
  await flush();
  assert.equal(attempts, 2);
  panelTick({ symbol: '005930', price: 70000 });
  assert.equal(applied, 1);

  destroyers.get(card)();
  destroyers.get(card)();
  await flush();
  assert.equal(calls.filter(([channel]) => channel === 'athena:realtime-release').length, 1);
});

test('destroy before retry cancels the timer and never acquires again', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const context = loadCanvasLifecycle();
  const lifecycle = context.createQuoteRealtimeLeaseLifecycle({
    acquire: async () => { attempts += 1; return { ok: false }; },
    release: () => { throw new Error('no lease should be released'); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  lifecycle.start();
  await flush();
  assert.equal(timers.size(), 1);
  assert.equal(lifecycle.close(), true);
  assert.equal(lifecycle.close(), false);
  assert.equal(timers.size(), 0);
  assert.equal(timers.runNext(), false);
  assert.equal(attempts, 1);
});

test('fixture-disabled is a terminal snapshot state and does not retry', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const context = loadCanvasLifecycle();
  const lifecycle = context.createQuoteRealtimeLeaseLifecycle({
    acquire: async () => {
      attempts += 1;
      return { ok: true, status: 'fixture-disabled', leaseToken: null };
    },
    release: () => { throw new Error('fixture mode has no lease'); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  lifecycle.start();
  await flush();
  assert.equal(attempts, 1);
  assert.equal(timers.size(), 0);
});

test('repeated REG failures use exponential backoff capped at five seconds', async () => {
  const timers = fakeTimers();
  const scheduled = [];
  const context = loadCanvasLifecycle();
  const lifecycle = context.createQuoteRealtimeLeaseLifecycle({
    acquire: async () => ({ ok: false }),
    release: () => {},
    setTimer(callback, delay) {
      scheduled.push(delay);
      return timers.setTimer(callback, delay);
    },
    clearTimer: timers.clearTimer,
  });

  lifecycle.start();
  await flush();
  for (let count = 0; count < 6; count += 1) {
    timers.runNext();
    await flush();
  }
  assert.deepEqual(scheduled, [250, 500, 1000, 2000, 4000, 5000, 5000]);
  lifecycle.close();
});

test('account reset closes quote panels and cancels pending retry before the new account', async () => {
  const timers = fakeTimers();
  const destroyers = new Map();
  let attempts = 0;
  let closed = 0;
  const context = loadCanvasLifecycle({
    setTimeout: timers.setTimer,
    clearTimeout: timers.clearTimer,
    cardDestroyers: destroyers,
    quoteRealtimePanels: {
      openPanel() {},
      closePanel() { closed += 1; },
    },
    window: {
      athena: {
        invoke: async () => { attempts += 1; return { ok: false }; },
      },
    },
  });

  context.wireQuoteRealtime({}, {}, { operation_args: { stk_cd: '005930' } }, () => {});
  await flush();
  assert.equal(timers.size(), 1);
  context.resetQuoteRealtimeForAccountChange();
  assert.equal(closed, 1);
  assert.equal(timers.size(), 0);
  assert.equal(timers.runNext(), false);
  assert.equal(attempts, 1);
});

test('late successful retry after close releases its lease exactly once', async () => {
  const timers = fakeTimers();
  let finishRetry;
  let attempts = 0;
  const released = [];
  const context = loadCanvasLifecycle();
  const lifecycle = context.createQuoteRealtimeLeaseLifecycle({
    acquire: async () => {
      attempts += 1;
      if (attempts === 1) return { ok: false };
      return new Promise((resolve) => { finishRetry = resolve; });
    },
    release: (leaseToken) => { released.push(leaseToken); },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  lifecycle.start();
  lifecycle.start();
  await flush();
  assert.equal(attempts, 1, 'concurrent starts must not duplicate REG');
  timers.runNext();
  await flush();
  assert.equal(attempts, 2);
  lifecycle.close();
  finishRetry({ ok: true, leaseToken: 'late-lease' });
  await flush();
  assert.deepEqual(released, ['late-lease']);
  assert.equal(timers.size(), 0);
});

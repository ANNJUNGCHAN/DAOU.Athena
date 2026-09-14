import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRealtimeFallbackCoordinator } = require('./realtime-fallback.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createHarness(refresh) {
  const calls = [];
  const data = [];
  const states = [];
  const timers = [];
  let accountGeneration = 7;
  const coordinator = createRealtimeFallbackCoordinator({
    refresh: async (descriptor, context) => {
      calls.push({ descriptor, context });
      return refresh(descriptor, context, calls.length);
    },
    onData: (event) => data.push(event),
    onState: (event) => states.push(event),
    getAccountGeneration: () => accountGeneration,
    now: () => '2026-09-14T05:00:00.000Z',
    jitter: (delay) => delay,
    setTimer: (fn, delay) => {
      const timer = { fn, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
  });
  const register = (ownerId, overrides = {}) => coordinator.register({
    ownerId,
    kind: 'quote',
    physicalKey: 'account-A|ka10001|023590',
    accountGeneration: 7,
    refreshIntervalMs: 15_000,
    intent: 'query',
    verifiedQueryOnly: true,
    ...overrides,
  });
  return {
    coordinator, register, calls, data, states, timers,
    setAccountGeneration(value) { accountGeneration = value; },
  };
}

test('deduplicates main and Orb owners onto one physical REST refresh', async () => {
  const h = createHarness(async () => ({ ok: true, envelope: { price: 40950 } }));
  assert.equal(h.register('main:quote').ok, true);
  assert.equal(h.register('orb:quote', { kind: 'orb-quote' }).ok, true);

  await h.coordinator.handleFeedStatus({ state: 'disconnected' });

  assert.equal(h.calls.length, 1);
  assert.equal(h.coordinator.size(), 2);
  assert.equal(h.coordinator.physicalSize(), 1);
  assert.deepEqual(h.data.map((event) => event.ownerId).sort(), ['main:quote', 'orb:quote']);
});

test('rejects trading and unverified authorities before REST fallback registration', () => {
  const h = createHarness(async () => ({ ok: true }));

  assert.equal(h.register('order', { intent: 'order' }).ok, false);
  assert.equal(h.register('write', { kind: 'write' }).ok, false);
  assert.equal(h.register('unverified', { verifiedQueryOnly: false }).ok, false);
  assert.equal(h.register('missing-proof', { verifiedQueryOnly: undefined }).ok, false);
  assert.equal(h.register('query').ok, true);
  assert.equal(h.coordinator.size(), 1);
});

test('applies a per-binding REG failure only to the failed owner', async () => {
  const h = createHarness(async () => ({ ok: true, envelope: { price: 40950 } }));
  h.register('main:quote');
  h.register('orb:quote', { kind: 'orb-quote' });
  await h.coordinator.handleOwnerStatus('main:quote', 'active');

  await h.coordinator.handleOwnerStatus('orb:quote', 'error');

  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.data.map((event) => event.ownerId), ['orb:quote']);
});

test('does not duplicate or abort a shared refresh while another failed owner still needs it', async () => {
  const pending = deferred();
  const h = createHarness((_descriptor, { signal }) => pending.promise.then((result) => ({ ...result, signal })));
  h.register('main:quote');
  h.register('orb:quote', { kind: 'orb-quote' });

  const upstream = h.coordinator.handleFeedStatus({ state: 'disconnected' });
  const downstream = h.coordinator.handleOwnerStatus('orb:quote', 'reconnecting');
  assert.equal(h.calls.length, 1);
  await h.coordinator.handleOwnerStatus('main:quote', 'active');
  assert.equal(h.calls[0].context.signal.aborted, false);
  pending.resolve({ ok: true, envelope: { price: 40950 } });
  await Promise.all([upstream, downstream]);

  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.data.map((event) => event.ownerId), ['orb:quote']);
});

test('upstream ready aborts one shared refresh without starting duplicate recovery work', async () => {
  const pending = deferred();
  const h = createHarness(() => pending.promise);
  h.register('main:quote');
  h.register('orb:quote', { kind: 'orb-quote' });
  await h.coordinator.handleOwnerStatus('main:quote', 'active');
  await h.coordinator.handleOwnerStatus('orb:quote', 'active');

  const running = h.coordinator.handleFeedStatus({ state: 'disconnected' });
  assert.equal(h.calls.length, 1);
  await h.coordinator.handleFeedStatus({ state: 'ready' });
  assert.equal(h.calls[0].context.signal.aborted, true);
  await h.coordinator.handleOwnerStatus('main:quote', 'active');
  await h.coordinator.handleOwnerStatus('orb:quote', 'active');
  pending.resolve({ ok: true, envelope: { stale: true } });
  await running;

  assert.equal(h.calls.length, 1);
  assert.equal(h.data.length, 0);
  assert.equal(h.coordinator.status('main:quote').needsFallback, false);
  assert.equal(h.coordinator.status('orb:quote').needsFallback, false);
});

test('discards late REST data after account generation and epoch change', async () => {
  const pending = deferred();
  const h = createHarness(() => pending.promise);
  h.register('main:quote');

  const running = h.coordinator.handleOwnerStatus('main:quote', 'error');
  const oldEpoch = h.coordinator.status('main:quote').sourceEpoch;
  h.setAccountGeneration(8);
  h.coordinator.resetAccount();
  pending.resolve({ ok: true, envelope: { price: 1 } });
  await running;

  assert.equal(h.data.length, 0);
  assert.equal(h.coordinator.size(), 0);
  assert.equal(h.calls[0].context.sourceEpoch, oldEpoch);
});

test('releasing one owner preserves a shared refresh for the remaining owner', async () => {
  const pending = deferred();
  const h = createHarness(() => pending.promise);
  h.register('main:quote');
  h.register('orb:quote', { kind: 'orb-quote' });

  const running = h.coordinator.handleFeedStatus({ state: 'disconnected' });
  assert.equal(h.coordinator.unregister('main:quote'), true);
  pending.resolve({ ok: true, envelope: { price: 40950 } });
  await running;

  assert.deepEqual(h.data.map((event) => event.ownerId), ['orb:quote']);
  assert.equal(h.coordinator.size(), 1);
  assert.equal(h.coordinator.physicalSize(), 1);
});

test('keeps the last successful REST data while errors back off with a bounded delay', async () => {
  const h = createHarness(async (_descriptor, _context, callNumber) => (
    callNumber === 1
      ? { ok: true, envelope: { price: 40950 }, providerAsOf: '2026-09-14T04:59:59.000Z' }
      : { ok: false, error: 'REST unavailable' }
  ));
  h.register('main:quote');
  await h.coordinator.handleOwnerStatus('main:quote', 'error');
  assert.equal(h.data.length, 1);

  await h.timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(h.data.length, 1);
  assert.equal(h.data[0].envelope.price, 40950);
  assert.equal(h.states.at(-1).status, 'delayed');
  assert.equal(h.states.at(-1).error, 'REST unavailable');
  assert.equal(h.timers[1].delay, 15_000);
});

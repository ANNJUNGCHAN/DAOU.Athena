import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import fallbackModule from './realtime-fallback.js';

const { createRealtimeFallbackCoordinator } = fallbackModule;

function registration(ownerId, kind = 'quote', physicalKey = 'account:4|quote:005930') {
  return {
    ownerId,
    kind,
    physicalKey,
    accountGeneration: 4,
    refreshIntervalMs: 15_000,
    intent: 'query',
    verifiedQueryOnly: true,
  };
}

function harness(refresh = async () => ({ ok: true, envelope: { value: 1 } })) {
  const timers = [];
  const states = [];
  const data = [];
  let generation = 4;
  const coordinator = createRealtimeFallbackCoordinator({
    refresh,
    onState: (value) => states.push(value),
    onData: (value) => data.push(value),
    getAccountGeneration: () => generation,
    setTimer: (fn, delay) => {
      const timer = { fn, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    now: () => '2026-09-14T03:04:05.000Z',
    jitter: (delay) => delay,
    baseIntervalMs: 15_000,
    maxIntervalMs: 60_000,
  });
  return { coordinator, timers, states, data, setGeneration: (value) => { generation = value; } };
}

test('downstream open or no-trade does not start REST fallback; confirmed disconnect does', async () => {
  let calls = 0;
  const h = harness(async () => { calls += 1; return { ok: true, envelope: { price: 40900 } }; });
  const registered = h.coordinator.register(registration('quote:1'));
  assert.equal(registered.ok, true);
  await h.coordinator.handleFeedStatus({ state: 'open' });
  await h.coordinator.handleOwnerStatus('quote:1', 'waiting');
  assert.equal(calls, 0, 'raw downstream open and quiet market are not failure evidence');

  await h.coordinator.handleFeedStatus({ state: 'disconnected' });
  assert.equal(calls, 1);
  assert.equal(h.data[0].transport, 'rest-fallback');
  assert.equal(h.data[0].source, 'kiwoom-rest');
  assert.equal(h.data[0].asOf, '2026-09-14T03:04:05.000Z');
  assert.equal(h.timers[0].delay, 15_000);
});

test('REST failure backs off 15s, 30s, 60s and keeps retry bounded', async () => {
  const h = harness(async () => ({ ok: false, error: 'upstream unavailable' }));
  h.coordinator.register(registration('book:1', 'orderbook'));
  await h.coordinator.handleOwnerStatus('book:1', 'error');
  assert.equal(h.states.at(-1).status, 'delayed');
  assert.equal(h.states.at(-1).error, 'upstream unavailable');
  assert.equal(h.timers[0].delay, 15_000);
  await h.timers[0].fn();
  assert.equal(h.timers[1].delay, 30_000);
  await h.timers[1].fn();
  assert.equal(h.timers[2].delay, 60_000);
  await h.timers[2].fn();
  assert.equal(h.timers[3].delay, 60_000);
});

test('WS registration recovery stops polling and unregister cancels an in-flight refresh', async () => {
  let finish;
  const h = harness((_descriptor, { signal }) => new Promise((resolve) => {
    finish = { resolve, signal };
  }));
  const registered = h.coordinator.register(registration('chart:1', 'chart'));
  const started = h.coordinator.handleOwnerStatus('chart:1', 'reconnecting');
  assert.equal(finish.signal.aborted, false);
  await h.coordinator.handleOwnerStatus('chart:1', 'active');
  assert.equal(finish.signal.aborted, true);
  finish.resolve({ ok: true, candles: [{ close: 40900 }] });
  await started;
  assert.equal(h.data.length, 0, 'late REST completion after WS recovery is discarded');
  assert.equal(h.states.at(-1).status, 'ws-active');

  const second = h.coordinator.register(registration('chart:1', 'chart'));
  assert.ok(second.registrationRevision > registered.registrationRevision);
  assert.equal(h.coordinator.unregister('chart:1'), true);
  assert.equal(h.coordinator.size(), 0);
});

test('upstream ready does not clear an explicit owner REG failure', async () => {
  const h = harness();
  h.coordinator.register(registration('chart:explicit', 'chart'));
  await h.coordinator.handleOwnerStatus('chart:explicit', 'active');
  await h.coordinator.handleFeedStatus({ state: 'unavailable' });
  await h.coordinator.handleOwnerStatus('chart:explicit', 'registration-failed');

  await h.coordinator.handleFeedStatus({ state: 'ready' });
  assert.equal(h.coordinator.status('chart:explicit').needsFallback, true);

  await h.coordinator.handleOwnerStatus('chart:explicit', 'active');
  assert.equal(h.coordinator.status('chart:explicit').needsFallback, false);
  assert.equal(h.states.at(-1).status, 'ws-active');
});

test('account generation mismatch refuses registration and reset drops stale callbacks', async () => {
  let finish;
  const h = harness(() => new Promise((resolve) => { finish = resolve; }));
  assert.equal(h.coordinator.register({ ...registration('bad'), accountGeneration: 3 }).ok, false);
  const registered = h.coordinator.register(registration('semantic:1', 'semantic'));
  assert.equal(registered.ok, true);
  const started = h.coordinator.handleOwnerStatus('semantic:1', 'unsupported');
  h.setGeneration(5);
  h.coordinator.resetAccount();
  finish({ ok: true, envelope: { stale: true } });
  await started;
  assert.equal(h.data.length, 0);
  assert.equal(h.coordinator.size(), 0);
});

test('unsupported kinds including write/order/oauth never enter fallback', () => {
  const h = harness();
  for (const kind of ['order', 'oauth', 'write', 'rest-only']) {
    const result = h.coordinator.register(registration(`owner:${kind}`, kind));
    assert.equal(result.ok, false, kind);
  }
  assert.equal(h.coordinator.size(), 0);
});

test('write intent and unverified query authority are refused', () => {
  const h = harness();
  assert.equal(h.coordinator.register({ ...registration('write'), intent: 'order' }).ok, false);
  assert.equal(h.coordinator.register({ ...registration('unverified'), verifiedQueryOnly: false }).ok, false);
  assert.equal(h.coordinator.size(), 0);
});

test('one physical response is projected separately for each failed owner', async () => {
  const data = [];
  const coordinator = createRealtimeFallbackCoordinator({
    refresh: async () => ({ ok: true, envelope: { price: 40900 } }),
    project: (result, owner) => ({ ok: true, projection: owner.kind, price: result.envelope.price }),
    onData: (event) => data.push(event),
    getAccountGeneration: () => 4,
    jitter: (delay) => delay,
  });
  coordinator.register(registration('canvas:quote'));
  coordinator.register(registration('orb:quote', 'orb-quote'));
  await coordinator.handleFeedStatus({ state: 'unavailable' });
  assert.deepEqual(data.map((event) => event.projection).sort(), ['orb-quote', 'quote']);
});

test('shared query uses the fastest registered owner cadence without a second physical call', async () => {
  const timers = [];
  let calls = 0;
  const coordinator = createRealtimeFallbackCoordinator({
    refresh: async () => { calls += 1; return { ok: true, envelope: {} }; },
    getAccountGeneration: () => 4,
    jitter: (delay) => delay,
    setTimer: (fn, delay) => { const timer = { fn, delay, unref() {} }; timers.push(timer); return timer; },
    clearTimer: () => {},
  });
  coordinator.register({ ...registration('slow', 'semantic'), refreshIntervalMs: 30_000 });
  coordinator.register(registration('fast'));
  await coordinator.handleFeedStatus({ state: 'unavailable' });
  assert.equal(calls, 1);
  assert.equal(timers.at(-1).delay, 15_000);
});

test('main exposes its initial account generation and preload allows the fallback bridge', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const main = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(here, '..', '..', 'preload.js'), 'utf8');
  assert.match(main, /ipcMain\.handle\('athena:realtime-generation'/);
  assert.match(main, /accountGeneration:\s*realtimeAccountGeneration/);
  for (const channel of [
    'athena:realtime-generation',
    'athena:realtime-fallback-register',
    'athena:realtime-fallback-unregister',
    'athena:realtime-fallback-status',
    'athena:realtime-fallback-visibility',
    'athena:realtime-fallback-state',
    'athena:realtime-fallback-data',
  ]) assert.match(preload, new RegExp(channel.replaceAll(':', '\\:')));
});

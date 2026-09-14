import assert from 'node:assert/strict';
import test from 'node:test';

import chartRealtime from './chart-realtime.js';
import integratedRealtime from './integrated-card-realtime.js';

const { createRealtimeRegistrar } = chartRealtime;
const { CardLeaseManager, createRegistrarTransport } = integratedRealtime;

function manualClock() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimer(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    clearTimer(id) { callbacks.delete(id); },
    fireNext() {
      const entry = callbacks.entries().next().value;
      assert.ok(entry, 'expected a pending control-plane deadline');
      callbacks.delete(entry[0]);
      entry[1]();
    },
    size() { return callbacks.size; },
  };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('chart REG hang is aborted and settles as a failed registration', async () => {
  const clock = manualClock();
  let requestSignal = null;
  const registrar = createRealtimeRegistrar({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => {});
    },
  });

  const acquiring = registrar.acquire('005930');
  await turn();
  clock.fireNext();

  assert.equal(await acquiring, false);
  assert.equal(requestSignal.aborted, true);
  assert.equal(registrar.isRegistered('005930'), false);
  assert.equal(clock.size(), 0);
});

test('successful REG clears its deadline and no-trade silence stays registered', async () => {
  const clock = manualClock();
  let requestSignal = null;
  const registrar = createRealtimeRegistrar({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(await registrar.acquire('005930'), true);
  assert.equal(clock.size(), 0);
  assert.equal(requestSignal.aborted, false);
  assert.equal(registrar.isRegistered('005930'), true);
});

test('late failure after a REG timeout cannot retain the pending registration slot', async () => {
  const clock = manualClock();
  let attempts = 0;
  let rejectLate;
  const registrar = createRealtimeRegistrar({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Promise((_, reject) => { rejectLate = reject; });
      return { ok: true, status: 200 };
    },
  });

  const first = registrar.acquire('005930');
  await turn();
  clock.fireNext();
  assert.equal(await first, false);
  assert.equal(await registrar.acquire('005930'), true);
  rejectLate(new Error('late socket failure'));
  await turn();
  assert.equal(attempts, 2);
  assert.equal(registrar.refCount('005930'), 1);
  assert.equal(clock.size(), 0);
});

test('late successful REG with no owner is removed through the existing orphan cleanup path', async () => {
  const clock = manualClock();
  const calls = [];
  let resolveLate;
  const registrar = createRealtimeRegistrar({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.trnm);
      if (body.trnm === 'REG') return new Promise((resolve) => { resolveLate = resolve; });
      return { ok: true, status: 200 };
    },
  });

  const acquiring = registrar.acquire('005930');
  await turn();
  clock.fireNext();
  assert.equal(await acquiring, false);
  resolveLate({ ok: true, status: 200 });
  await turn();
  await turn();

  assert.deepEqual(calls, ['REG', 'REMOVE']);
  assert.equal(registrar.refCount('005930'), 0);
  assert.equal(clock.size(), 0);
});

test('timed-out chart REMOVE keeps ownership so a later release retries cleanup', async () => {
  const clock = manualClock();
  let removeAttempts = 0;
  const registrar = createRealtimeRegistrar({
    backendBase: 'http://backend',
    backendAccountAlias: 'server-a',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.trnm === 'REG') return { ok: true, status: 200 };
      removeAttempts += 1;
      if (removeAttempts === 1) return new Promise(() => {});
      return { ok: true, status: 200 };
    },
  });

  assert.equal(await registrar.acquire('005930'), true);
  const firstRelease = registrar.release('005930');
  await turn();
  clock.fireNext();
  assert.equal(await firstRelease, false);
  assert.equal(registrar.refCount('005930'), 1);

  assert.equal(await registrar.release('005930'), true);
  assert.equal(removeAttempts, 2);
  assert.equal(registrar.refCount('005930'), 0);
  assert.equal(clock.size(), 0);
});

test('integrated card REG hang reaches manager error state instead of blocking forever', async () => {
  const clock = manualClock();
  const states = [];
  let requestSignal = null;
  const transport = createRegistrarTransport({
    backendBase: 'http://backend',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => {});
    },
  });
  const manager = new CardLeaseManager({ transport, onState: (state) => states.push(state) });

  const mounting = manager.mount({
    leaseId: 'quote-card',
    cardId: 'CC-03',
    mode: 'quote',
    symbol: '005930',
    backendAccountAlias: 'server-a',
  });
  await turn();
  clock.fireNext();

  const result = await mounting;
  assert.equal(result.ok, false);
  assert.equal(result.status, 'error');
  assert.equal(requestSignal.aborted, true);
  assert.equal(states.at(-1).status, 'error');
});

test('integrated condition command uses the same bounded control transport', async () => {
  const clock = manualClock();
  const transport = createRegistrarTransport({
    backendBase: 'http://backend',
    controlRequestTimeoutMs: 25,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => new Promise(() => {}),
    }),
  });

  const command = transport.command('ka10171', {}, 'server-a');
  await turn();
  clock.fireNext();
  const result = await command;
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
});

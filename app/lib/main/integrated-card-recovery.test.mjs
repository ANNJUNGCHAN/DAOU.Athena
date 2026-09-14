import test from 'node:test';
import assert from 'node:assert/strict';
import realtime from './integrated-card-realtime.js';

const { CardLeaseManager, createRegistrarTransport } = realtime;
const bindingId = 'rtb_eeeeeeeeeeeeeeeeeeee';

function account(leaseId, backendAccountAlias = 'server-a', accountId = 'ACC-1') {
  return {
    leaseId,
    backendAccountAlias,
    cardId: 'CC-01',
    mode: 'overview',
    accountId,
    semanticBindingIds: [bindingId],
  };
}

function transport(overrides = {}) {
  const calls = [];
  return {
    calls,
    acquire: async (binding) => {
      calls.push(['REG', binding.backendAccountAlias, binding.operationId]);
      return true;
    },
    release: async (binding) => {
      calls.push(['REMOVE', binding.backendAccountAlias, binding.operationId]);
      return true;
    },
    reconnect: async (bindings) => {
      calls.push(['RECONNECT', ...bindings.map((binding) => (
        `${binding.backendAccountAlias}:${binding.operationId}`
      ))]);
      return bindings.map((binding) => ({ binding, ok: true, error: null }));
    },
    ...overrides,
  };
}

function manualTimers() {
  const scheduled = [];
  return {
    scheduled,
    setTimer(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cancelled = true; },
  };
}

test('initial REG failure retries while feed stays open, routes ticks, and joins refcount cleanup', async () => {
  const wire = transport();
  const timers = manualTimers();
  let failAcquire = false;
  wire.acquire = async (binding) => {
    wire.calls.push(['REG', binding.backendAccountAlias, binding.operationId]);
    return !failAcquire;
  };
  const manager = new CardLeaseManager({
    transport: wire,
    semanticBindingSourceProvider: async (operationId) => operationId === '04'
      ? new Map([['10', bindingId]]) : new Map(),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    retryBaseMs: 10,
    retryMaxMs: 20,
  });

  await manager.handleFeedStatus({ state: 'open' }, 1);
  assert.equal((await manager.mount(account('healthy', 'server-b', 'ACC-2'))).ok, true);
  failAcquire = true;
  assert.equal((await manager.mount(account('failed'))).status, 'error');
  assert.equal(timers.scheduled[0].delay, 10);
  failAcquire = false;
  await timers.scheduled[0].callback();
  assert.equal(manager.status('failed').status, 'active');
  assert.equal(manager.status('healthy').generation, 1);
  assert.deepEqual(wire.calls.filter(([, alias]) => alias === 'server-a'), [
    ['REG', 'server-a', '00'],
    ['REG', 'server-a', '00'], ['REG', 'server-a', '04'],
  ]);
  assert.deepEqual(manager.routeFrame({
    trnm: 'REAL', data: [{ type: '04', values: { 9201: 'ACC-1', 10: '73500' } }],
  }), [{
    leaseId: 'failed', cardId: 'CC-01', mode: 'overview', generation: 1,
    connectionGeneration: 1,
    semantic_updates: [{ binding_id: bindingId, value: '73500' }],
  }]);

  assert.equal((await manager.mount(account('shared'))).ok, true);
  await manager.unmount('failed');
  assert.equal(wire.calls.some(([kind]) => kind === 'REMOVE'), false);
  await manager.unmount('shared');
  assert.deepEqual(wire.calls.filter(([kind]) => kind === 'REMOVE'), [
    ['REMOVE', 'server-a', '00'], ['REMOVE', 'server-a', '04'],
  ]);
});

test('production transport recovery increments registrar ownership and sends final REMOVE', async () => {
  const requests = [];
  let firstRegistration = true;
  const timers = manualTimers();
  const registrarTransport = createRegistrarTransport({
    backendBase: 'http://backend',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      requests.push(body);
      const returnCode = body.trnm === 'REG' && firstRegistration ? '17' : '0';
      firstRegistration = false;
      return { ok: true, status: 200, json: async () => ({ return_code: returnCode }) };
    },
  });
  const manager = new CardLeaseManager({
    transport: registrarTransport,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    retryBaseMs: 10,
  });

  assert.equal((await manager.mount(account('actual'))).status, 'error');
  await timers.scheduled[0].callback();
  assert.equal(manager.status('actual').status, 'active');
  assert.equal((await manager.unmount('actual')).ok, true);
  assert.deepEqual(requests.map((body) => `${body.trnm}:${body.data[0].type}`), [
    'REG:00', 'REG:00', 'REG:04', 'REMOVE:00', 'REMOVE:04',
  ]);
});

test('releaseAll removes late acquire successes from an in-flight automatic retry', async () => {
  let retrying = false;
  let finishAcquires;
  let markStarted;
  let starts = 0;
  const acquireGate = new Promise((resolve) => { finishAcquires = resolve; });
  const started = new Promise((resolve) => { markStarted = resolve; });
  const wire = transport();
  wire.acquire = async () => {
    if (!retrying) return false;
    starts += 1;
    if (starts === 2) markStarted();
    return acquireGate;
  };
  const timers = manualTimers();
  const manager = new CardLeaseManager({
    transport: wire, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await manager.mount(account('late'));
  retrying = true;
  const retry = timers.scheduled[0].callback();
  await started;
  assert.equal((await manager.releaseAll()).ok, true);
  finishAcquires(true);
  assert.deepEqual(await retry, { ok: false, status: 'draining' });
  assert.deepEqual(wire.calls.filter(([kind]) => kind === 'REMOVE'), [
    ['REMOVE', 'server-a', '00'], ['REMOVE', 'server-a', '04'],
  ]);
});

test('pending recovery remains isolated by backend account alias', async () => {
  const wire = transport();
  let allowAcquire = false;
  const recovered = [];
  wire.acquire = async (binding) => {
    if (allowAcquire) recovered.push(`${binding.backendAccountAlias}:${binding.operationId}`);
    return allowAcquire;
  };
  const manager = new CardLeaseManager({ transport: wire });
  await manager.mount(account('a', 'server-a'));
  await manager.mount(account('b', 'server-b'));
  allowAcquire = true;
  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.handleFeedStatus({ state: 'open' }, 2);

  assert.equal(manager.status('a').status, 'active');
  assert.equal(manager.status('b').status, 'active');
  assert.deepEqual(recovered.sort(), [
    'server-a:00', 'server-a:04', 'server-b:00', 'server-b:04',
  ]);
  await manager.unmount('a');
  assert.deepEqual(wire.calls.filter(([kind]) => kind === 'REMOVE'), [
    ['REMOVE', 'server-a', '00'], ['REMOVE', 'server-a', '04'],
  ]);
  assert.equal(manager.status('b').status, 'active');
});

test('failed re-registration recovers on the next connection generation', async () => {
  let pass = 0;
  const timers = manualTimers();
  const wire = transport({
    reconnect: async (bindings) => {
      pass += 1;
      return bindings.map((binding) => ({
        binding,
        ok: binding.operationId === '00' || pass > 4,
        error: binding.operationId === '00' || pass > 4 ? null : 'transient failure',
      }));
    },
  });
  const manager = new CardLeaseManager({
    transport: wire,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    retryBaseMs: 10,
    retryMaxMs: 20,
  });
  await manager.mount(account('lease'));
  await manager.handleFeedStatus({ state: 'disconnected' });
  assert.equal((await manager.handleFeedStatus({ state: 'open' }, 2)).ok, false);
  assert.equal(manager.status('lease').status, 'error');

  assert.equal(timers.scheduled[0].delay, 10);
  await timers.scheduled[0].callback();
  assert.equal(timers.scheduled[1].delay, 20);
  await timers.scheduled[1].callback();
  assert.equal(manager.status('lease').status, 'active');
  assert.equal(manager.status('lease').connectionGeneration, 2);
});

test('unmount and releaseAll cancel pending automatic recovery', async () => {
  const wire = transport({ acquire: async () => false });
  const timers = manualTimers();
  const manager = new CardLeaseManager({
    transport: wire, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  await manager.mount(account('closed'));
  assert.equal((await manager.unmount('closed')).status, 'unmounted');
  assert.equal(manager.status('closed'), null);
  assert.equal(timers.scheduled[0].cancelled, true);
  await timers.scheduled[0].callback();
  assert.equal(wire.calls.some(([kind]) => kind === 'RECONNECT'), false);

  const shutdownWire = transport({ acquire: async () => false });
  const shutdownTimers = manualTimers();
  const shutdownManager = new CardLeaseManager({
    transport: shutdownWire,
    setTimer: shutdownTimers.setTimer,
    clearTimer: shutdownTimers.clearTimer,
  });
  await shutdownManager.mount(account('shutdown'));
  assert.equal((await shutdownManager.releaseAll()).ok, true);
  assert.equal(shutdownTimers.scheduled[0].cancelled, true);
  await shutdownTimers.scheduled[0].callback();
  assert.equal(shutdownWire.calls.some(([kind]) => kind === 'RECONNECT'), false);
});

test('partial initial recovery is owned and removed when its card unmounts', async () => {
  const wire = transport();
  let mounting = true;
  wire.acquire = async (binding) => !mounting && binding.operationId === '00';
  const manager = new CardLeaseManager({ transport: wire });
  await manager.mount(account('partial'));
  mounting = false;
  await manager.handleFeedStatus({ state: 'disconnected' });
  assert.equal((await manager.handleFeedStatus({ state: 'open' }, 2)).ok, false);
  assert.deepEqual(manager.status('partial').bindings.map(({ operationId }) => operationId), ['00']);

  await manager.handleFeedStatus({ state: 'disconnected' });
  await manager.unmount('partial');
  await manager.handleFeedStatus({ state: 'open' }, 3);
  assert.deepEqual(wire.calls.filter(([kind]) => kind === 'REMOVE'), [
    ['REMOVE', 'server-a', '00'],
  ]);
});

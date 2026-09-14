import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  normalizeQuoteSymbol, createOrbQuoteRealtimeSession, createOrbQuoteFallbackSession,
} = require('./orb-quote-realtime.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeTimers() {
  const pending = [];
  return {
    setTimer(fn) { const timer = { fn, cleared: false }; pending.push(timer); return timer; },
    clearTimer(timer) { timer.cleared = true; },
    run() { const timer = pending.shift(); if (timer && !timer.cleared) timer.fn(); },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('실패한 orb quote acquire는 재시도 성공 뒤 같은 종목 틱만 적용한다', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const ticks = [];
  const releases = [];
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590',
    acquire: async () => (++attempts === 1 ? { ok: false } : { ok: true, leaseToken: 'lease-1' }),
    release: (token) => releases.push(token), onTick: (tick) => ticks.push(tick),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  session.start();
  await flush();
  assert.equal(session.applyTick({ symbol: '023590', price: 40900 }), false);
  timers.run();
  await flush();
  assert.equal(session.applyTick({ symbol: '005930', price: 70000 }), false);
  assert.equal(session.applyTick({ symbol: '023590', price: 41100 }), true);
  assert.equal(ticks.length, 1);
  session.close();
  session.close();
  assert.deepEqual(releases, ['lease-1']);
});

test('retry 전 destroy와 acquire 중 reset은 새 lease를 남기지 않는다', async () => {
  const timers = fakeTimers();
  const late = deferred();
  const releases = [];
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: () => late.promise, release: (token) => releases.push(token),
    onTick() {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  session.start();
  session.close();
  late.resolve({ ok: true, leaseToken: 'late-lease' });
  await flush();
  assert.deepEqual(releases, ['late-lease']);

  let attempts = 0;
  const retrying = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => { attempts += 1; return { ok: false }; },
    release() {}, onTick() {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  retrying.start();
  await flush();
  retrying.close();
  timers.run();
  await flush();
  assert.equal(attempts, 1);
});

test('DOM에서 제거된 카드 세션은 다음 틱을 거부하고 lease를 한 번만 닫는다', async () => {
  let connected = true;
  const releases = [];
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => ({ ok: true, leaseToken: 'lease-dom' }),
    release: (token) => releases.push(token), onTick() {}, isConnected: () => connected,
  });
  session.start();
  await flush();
  connected = false;
  assert.equal(session.applyTick({ symbol: '023590', price: 41100 }), false);
  assert.deepEqual(releases, ['lease-dom']);
  session.close();
  assert.deepEqual(releases, ['lease-dom']);
});

test('fixture-disabled 응답은 재시도하지 않는다', async () => {
  const timers = fakeTimers();
  let attempts = 0;
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590',
    acquire: async () => { attempts += 1; return { ok: true, status: 'fixture-disabled', leaseToken: null }; },
    release() {}, onTick() {}, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  session.start();
  await flush();
  timers.run();
  await flush();
  assert.equal(attempts, 1);
  session.close();
});

test('비동기 lease 해제 실패는 teardown의 unhandled rejection이 되지 않는다', async () => {
  const timers = fakeTimers();
  let releases = 0;
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => ({ ok: true, leaseToken: 'lease-reject' }),
    release: async () => { releases += 1; throw new Error('renderer gone'); }, onTick() {},
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  session.start();
  await flush();
  session.close();
  await flush();
  timers.run();
  await flush();
  assert.equal(releases, 2, 'rejected REMOVE를 같은 token으로 재시도한다');
});

test('REMOVE false는 같은 lease token으로 재시도하고 성공 뒤 멈춘다', async () => {
  const timers = fakeTimers();
  const releases = [];
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => ({ ok: true, leaseToken: 'lease-false' }),
    release: async (token) => { releases.push(token); return releases.length > 1; }, onTick() {},
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  session.start();
  await flush();
  session.close();
  await flush();
  timers.run();
  await flush();
  timers.run();
  await flush();
  assert.deepEqual(releases, ['lease-false', 'lease-false']);
});

test('키움 시장 접두 종목은 REST 카드와 같은 6자리 신원으로 구독하고 비교한다', async () => {
  assert.equal(normalizeQuoteSymbol('A023590'), '023590');
  assert.equal(normalizeQuoteSymbol('J023590'), '023590');
  assert.equal(normalizeQuoteSymbol('Q023590'), '023590');
  assert.equal(normalizeQuoteSymbol('ABC123'), 'ABC123');
  const acquired = [];
  const ticks = [];
  const session = createOrbQuoteRealtimeSession({
    symbol: 'A023590', acquire: async (symbol) => { acquired.push(symbol); return { ok: true, leaseToken: 'lease-a' }; },
    release() {}, onTick: (tick) => ticks.push(tick),
  });
  session.start();
  await flush();
  assert.deepEqual(acquired, ['023590']);
  assert.equal(session.applyTick({ symbol: '023590', price: 41100 }), true);
  assert.equal(ticks.length, 1);
  session.close();
});

test('quote 상태는 fallback 전환과 복구에 필요한 실패·active·receiving을 알린다', async () => {
  const timers = fakeTimers();
  const states = [];
  let attempts = 0;
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => (++attempts === 1
      ? { ok: false } : { ok: true, leaseToken: 'lease-state' }),
    release() {}, onTick() {}, onState: (state) => states.push(state),
    setTimer: timers.setTimer, clearTimer: timers.clearTimer,
  });
  session.start();
  await flush();
  timers.run();
  await flush();
  session.applyTick({ symbol: '023590', price: 41100 });
  session.close();
  assert.deepEqual(states, ['registration-failed', 'active', 'receiving', 'stopped']);
});

test('renderer reREG 상태는 exact lease·kind·symbol에서만 기존 quote 세션을 전환한다', async () => {
  const states = [];
  const ticks = [];
  const session = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => ({ ok: true, leaseToken: 'lease-rereg' }),
    release() {}, onTick: (tick) => ticks.push(tick), onState: (state) => states.push(state),
  });
  session.start();
  await flush();
  assert.equal(session.applyState({ leaseToken: 'other', kind: 'quote', symbol: '023590', status: 'error', connectionGeneration: 2 }), false);
  assert.equal(session.applyState({ leaseToken: 'lease-rereg', kind: 'orderbook', symbol: '023590', status: 'error', connectionGeneration: 2 }), false);
  assert.equal(session.applyState({ leaseToken: 'lease-rereg', kind: 'quote', symbol: '005930', status: 'error', connectionGeneration: 2 }), false);
  assert.equal(session.applyState({ leaseToken: 'lease-rereg', kind: 'quote', symbol: 'A023590', status: 'reconnecting', connectionGeneration: 2 }), true);
  assert.equal(session.applyTick({ symbol: '023590', price: 41000 }), false);
  assert.equal(session.applyState({ leaseToken: 'lease-rereg', kind: 'quote', symbol: '023590', status: 'error', connectionGeneration: 3 }), true);
  assert.equal(session.applyState({ leaseToken: 'lease-rereg', kind: 'quote', symbol: '023590', status: 'active', connectionGeneration: 2 }), false,
    '이전 연결 세대의 늦은 active를 거부한다');
  assert.equal(session.applyState({ leaseToken: 'lease-rereg', kind: 'quote', symbol: '023590', status: 'active', connectionGeneration: 4 }), true);
  assert.equal(session.applyTick({ symbol: '023590', price: 41100 }), true);
  assert.deepEqual(ticks.map((tick) => tick.price), [41100]);
  assert.deepEqual(states, ['active', 'reconnecting', 'error', 'active', 'receiving']);
  session.close();
});

test('reconnect 뒤 quote reREG 실패는 fallback을 재개하고 later active는 다시 멈춘다', async () => {
  const calls = [];
  const data = [];
  const fallback = createOrbQuoteFallbackSession({
    ownerId: 'orb:rereg', accountGeneration: 8, correlation: {}, target: '023590',
    invoke: async (channel, payload) => {
      calls.push([channel, payload]);
      if (channel.endsWith('-register')) {
        return { ok: true, registrationRevision: 14, sourceEpoch: 0, ownerEpoch: 0 };
      }
      return true;
    },
    onData: (event) => data.push(event.envelope.price),
  });
  await fallback.start();
  const quote = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: async () => ({ ok: true, leaseToken: 'lease-cycle' }),
    release() {}, onTick() {}, onState: (state) => { void fallback.handleQuoteState(state); },
  });
  quote.start();
  await flush();
  quote.applyState({ leaseToken: 'lease-cycle', kind: 'quote', symbol: '023590', status: 'reconnecting', connectionGeneration: 2 });
  quote.applyState({ leaseToken: 'lease-cycle', kind: 'quote', symbol: '023590', status: 'error', connectionGeneration: 3 });
  await flush();
  const identity = {
    ownerId: 'orb:rereg', accountGeneration: 8, registrationRevision: 14,
    sourceEpoch: 3, ownerEpoch: 2,
  };
  assert.equal(fallback.applyState({ ...identity, status: 'refreshing' }), true);
  assert.equal(fallback.applyData({ ...identity, envelope: { price: 41200 } }), true);
  quote.applyState({ leaseToken: 'lease-cycle', kind: 'quote', symbol: '023590', status: 'active', connectionGeneration: 4 });
  await flush();
  assert.equal(fallback.applyData({ ...identity, envelope: { price: 41300 } }), false);
  assert.deepEqual(data, [41200]);
  assert.ok(calls.some(([channel, payload]) => channel.endsWith('-status') && payload.state === 'error'));
  assert.ok(calls.some(([channel, payload]) => channel.endsWith('-status') && payload.state === 'active'));
  quote.close();
  fallback.close();
});

test('fallback owner는 WS active에서 standby로 남아 이후 장애와 복구를 반복한다', async () => {
  const calls = [];
  const fallback = createOrbQuoteFallbackSession({
    ownerId: 'orb:1', accountGeneration: 3, correlation: { dataset_id: 'd', item_id: 'i', ordinal: 0 },
    target: '023590', invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      if (channel === 'athena:realtime-fallback-register') return { ok: true, ownerId: 'orb:1', accountGeneration: 3, registrationRevision: 7, sourceEpoch: 0, ownerEpoch: 0 };
      return true;
    }, onData() {},
  });
  assert.equal(await fallback.handleQuoteState('active'), true);
  assert.deepEqual(calls.map(({ channel }) => channel), [
    'athena:realtime-fallback-register', 'athena:realtime-fallback-status',
  ]);
  const base = { ownerId: 'orb:1', accountGeneration: 3, registrationRevision: 7 };
  assert.equal(fallback.applyState({ ...base, status: 'refreshing', sourceEpoch: 1, ownerEpoch: 1 }), true);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 1, ownerEpoch: 1, envelope: { value: 1 } }), true);
  assert.equal(fallback.applyState({ ...base, status: 'ws-active', sourceEpoch: 2, ownerEpoch: 2 }), true);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 1, ownerEpoch: 1, envelope: { stale: true } }), false);
  assert.equal(fallback.applyState({ ...base, status: 'refreshing', sourceEpoch: 3, ownerEpoch: 3 }), true);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 1, ownerEpoch: 1, envelope: { stale: true } }), false);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 3, ownerEpoch: 3, envelope: { value: 2 } }), true);
  assert.equal(await fallback.handleQuoteState('receiving'), true);
  assert.equal(calls.filter(({ channel }) => channel === 'athena:realtime-fallback-register').length, 1);
  fallback.close();
  await flush();
  assert.equal(calls.at(-1).channel, 'athena:realtime-fallback-unregister');
});

test('quote acquire가 응답하지 않아도 fallback owner는 먼저 standby 등록된다', async () => {
  const calls = [];
  const data = [];
  const fallback = createOrbQuoteFallbackSession({
    ownerId: 'orb:standby', accountGeneration: 5,
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 0 }, target: '023590',
    invoke: async (channel) => {
      calls.push(channel);
      if (channel === 'athena:realtime-fallback-register') {
        return { ok: true, ownerId: 'orb:standby', accountGeneration: 5,
          registrationRevision: 9, sourceEpoch: 0, ownerEpoch: 0 };
      }
      return true;
    },
    onData: (event) => data.push(event),
  });
  assert.equal((await fallback.start()).registrationRevision, 9);
  const neverAcquire = deferred();
  const quote = createOrbQuoteRealtimeSession({
    symbol: '023590', acquire: () => neverAcquire.promise, release() {}, onTick() {},
  });
  quote.start();
  assert.deepEqual(calls, ['athena:realtime-fallback-register']);
  const base = { ownerId: 'orb:standby', accountGeneration: 5, registrationRevision: 9 };
  assert.equal(fallback.applyState({ ...base, status: 'refreshing', sourceEpoch: 1, ownerEpoch: 1 }), true);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 1, ownerEpoch: 1, envelope: { price: 41100 } }), true);
  assert.equal(data.length, 1, '끝나지 않은 quote acquire와 독립적으로 API fallback data를 받는다');
  quote.close();
  fallback.close();
});

test('fallback register 응답 전 이벤트는 확정된 revision·epoch로 다시 검증해 적용한다', async () => {
  const registration = deferred();
  const states = [];
  const data = [];
  const fallback = createOrbQuoteFallbackSession({
    ownerId: 'orb:early', accountGeneration: 6, correlation: {}, target: '023590',
    invoke: (channel) => channel === 'athena:realtime-fallback-register'
      ? registration.promise : Promise.resolve(true),
    onState: (event) => states.push(event.status), onData: (event) => data.push(event.envelope.price),
  });
  const registering = fallback.start();
  const identity = {
    ownerId: 'orb:early', accountGeneration: 6, registrationRevision: 12,
    sourceEpoch: 2, ownerEpoch: 3,
  };
  assert.equal(fallback.applyState({ ...identity, status: 'refreshing' }), true);
  assert.equal(fallback.applyData({ ...identity, envelope: { price: 41100 } }), true);
  assert.equal(fallback.applyData({ ...identity, registrationRevision: 11, envelope: { price: 99999 } }), true,
    '등록 전에는 bounded queue에 두고 응답 뒤 exact revision으로 거른다');
  registration.resolve({
    ok: true, status: 'api-fallback', registrationRevision: 12, sourceEpoch: 2, ownerEpoch: 3,
  });
  await registering;
  assert.deepEqual(states, ['api-fallback', 'refreshing']);
  assert.deepEqual(data, [41100]);
  fallback.close();
});

test('fallback data는 owner·계좌·revision·source epoch가 현재일 때만 적용한다', async () => {
  const data = [];
  let current = true;
  const fallback = createOrbQuoteFallbackSession({
    ownerId: 'orb:2', accountGeneration: 4, correlation: {}, target: '023590',
    invoke: async (channel) => channel === 'athena:realtime-fallback-register'
      ? { ok: true, ownerId: 'orb:2', accountGeneration: 4, registrationRevision: 8, sourceEpoch: 2, ownerEpoch: 0 }
      : true,
    onData: (event) => data.push(event), isCurrent: () => current,
  });
  await fallback.handleQuoteState('registration-failed');
  const base = { ownerId: 'orb:2', accountGeneration: 4, registrationRevision: 8 };
  assert.equal(fallback.applyState({ ...base, status: 'refreshing', sourceEpoch: 2, ownerEpoch: 1 }), true);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 2, ownerEpoch: 1, envelope: { value: 1 } }), true);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 1, ownerEpoch: 1, envelope: { value: 2 } }), false);
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 2, ownerEpoch: 1, registrationRevision: 7, envelope: { value: 3 } }), false);
  current = false;
  assert.equal(fallback.applyData({ ...base, sourceEpoch: 3, ownerEpoch: 2, envelope: { value: 4 } }), false);
  assert.equal(data.length, 1);
  fallback.close();
});

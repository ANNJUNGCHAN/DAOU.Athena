import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const accountBoundDataset = require('./account-bound-dataset');
const chartRealtime = require('./chart-realtime');
const integratedCardRealtime = require('./integrated-card-realtime');
const dirname = path.dirname(fileURLToPath(import.meta.url));

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf(') {', start) + 2;
  assert.ok(open > start + 1, `missing body for ${signature}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}

function createRuntime({ fetchImpl, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const source = fs.readFileSync(path.join(dirname, '..', '..', 'main.js'), 'utf8');
  const calls = {
    feeds: [], fetches: [], rendererEvents: [], chartFallbackStatuses: [], feedFallbackStatuses: [],
  };

  class FakeRoutineFeed {
    constructor(options) { this.options = options; calls.feeds.push(this); }
    start() { this.started = true; }
    stop() { this.stopped = true; }
  }

  const context = vm.createContext({
    accountBoundDataset,
    calls,
    accounts: {
      resolveBackendAlias: async ({ id }) => ({ ok: true, accountId: id, backendAlias: 'server-a' }),
    },
    activeRestAccountId: () => 'local-a',
    backendAccountAuthorization: () => 'Bearer fixture',
    BACKEND_HTTP_BASE: 'http://backend',
    BACKEND_WS_BASE: 'ws://backend',
    LOCAL_BEARER_TOKEN: 'fixture',
    RoutineFeed: FakeRoutineFeed,
    chartRealtime,
    orderbookRealtime: { REAL_TR_ID: '0D', parseQuoteBookFrame: () => [] },
    integratedCardRealtime,
    fetch: async (url, init) => {
      const call = { url, init, body: JSON.parse(init.body) };
      calls.fetches.push(call);
      if (fetchImpl) return fetchImpl(call, calls);
      return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
    },
    mdlog: () => {},
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    process: { env: { ATHENA_CANVAS_SOURCE: 'live' } },
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    shellWin: {
      isDestroyed: () => false,
      webContents: { send: (...args) => calls.rendererEvents.push(args) },
    },
  });

  vm.runInContext([
    'let chartRealtimeFeed = null;',
    'let chartRealtimeRegistrar = null;',
    'let orderbookRealtimeRegistrar = null;',
    'let integratedCardRealtimeManager = null;',
    'let integratedCardRealtimeTransport = null;',
    'let realtimeBackendAccountAlias = null;',
    'let realtimeAccountGeneration = 1;',
    'let realtimeFeedInstanceGeneration = 0;',
    'let realtimeFeedEpoch = 1;',
    'let realtimeFallbackCoordinator = null;',
    'const realtimeFallbackOwners = new Map();',
    'const realtimeFallbackAuthorities = new Map();',
    'const integratedRealtimeLeaseSenders = new Map();',
    'function ensureRealtimeFallbackCoordinator() { return { handleFeedStatus: async (status) => { calls.feedFallbackStatuses.push(status); return []; }, resetAccount() {} }; }',
    'function relayChartRealtimeFallbackStatus(panelId, status) { calls.chartFallbackStatuses.push({ panelId, status }); }',
    'function rendererForRealtimeLease() { return shellWin.webContents; }',
    'const realtimeCleanupBarriers = new Map();',
    'const chartRealtimePanelSymbols = new Map();',
    'const rendererRealtimeLeases = new Map();',
    functionSource(source, 'function createActiveBackendAccountInvoker('),
    functionSource(source, 'function ensureRealtimeFeed('),
    functionSource(source, 'async function withActiveRealtimeAccount('),
    functionSource(source, 'async function waitForRealtimeCleanup('),
    functionSource(source, 'async function ensureRealtimeForSymbol('),
    functionSource(source, 'function releaseRealtimeForSymbol('),
    functionSource(source, 'function ensureChartRealtime('),
    functionSource(source, 'async function acquireRendererRealtimeLease('),
    functionSource(source, 'async function resetAccountBoundRealtime()'),
  ].join('\n'), context);

  return { calls, context };
}

test('shared feed reconnect re-registers an active legacy quote lease', async () => {
  const runtime = createRuntime();
  const acquired = await runtime.context.acquireRendererRealtimeLease('quote', '005930');
  assert.equal(acquired.ok, true);

  runtime.calls.feeds[0].options.onStatus({ state: 'disconnected', connectionEpoch: 2 });
  runtime.calls.feeds[0].options.onStatus({ state: 'open', connectionEpoch: 3 });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runtime.calls.fetches.filter((call) => call.body.trnm === 'REG').length, 2);
});

test('new downstream connection accepts the same upstream ready snapshot again', async () => {
  const runtime = createRuntime();
  assert.equal(await runtime.context.ensureRealtimeForSymbol('005930', 'local-a'), true);
  const feed = runtime.calls.feeds[0];

  feed.options.onEvent({
    type: 'feed-status', feed: 'kiwoom-real', state: 'ready', upstreamGeneration: 1, revision: 1,
  }, { connectionEpoch: 1 });
  feed.options.onStatus({ state: 'disconnected', connectionEpoch: 1 });
  feed.options.onStatus({ state: 'open', connectionEpoch: 2 });
  feed.options.onEvent({
    type: 'feed-status', feed: 'kiwoom-real', state: 'ready', upstreamGeneration: 1, revision: 1,
  }, { connectionEpoch: 2 });

  assert.deepEqual(runtime.calls.feedFallbackStatuses.map((status) => status.state), [
    'ready', 'unavailable', 'ready',
  ]);
});

test('AITS chart retries a failed initial REG on the next paint ack', async () => {
  const runtime = createRuntime({
    fetchImpl: async (_call, calls) => {
      const attempt = calls.fetches.filter((call) => call.body.trnm === 'REG').length;
      return {
        ok: attempt > 1,
        status: attempt > 1 ? 200 : 503,
        json: async () => ({ return_code: attempt > 1 ? '0' : '1' }),
      };
    },
  });
  const authority = { accountId: 'local-a', chartBody: { stock: '005930' } };

  assert.equal(await runtime.context.ensureChartRealtime(authority, 'panel-a'), false);
  assert.equal(await runtime.context.ensureChartRealtime(authority, 'panel-a'), true);
  assert.equal(runtime.calls.fetches.filter((call) => call.body.trnm === 'REG').length, 2);
});

test('AITS chart automatically retries a failed REG while the feed stays open', async () => {
  const timers = [];
  const attempts = new Map();
  const runtime = createRuntime({
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    fetchImpl: async (call) => {
      const symbol = call.body.data[0].item;
      attempts.set(symbol, (attempts.get(symbol) || 0) + 1);
      const ok = symbol === '000660' || attempts.get(symbol) > 1;
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => ({ return_code: ok ? '0' : '1' }),
      };
    },
  });
  assert.equal(await runtime.context.ensureRealtimeForSymbol('000660', 'local-a'), true);
  runtime.calls.feeds[0].options.onStatus({ state: 'open', connectionEpoch: 2 });

  const authority = { accountId: 'local-a', chartBody: { stock: '005930' } };
  assert.equal(await runtime.context.ensureChartRealtime(authority, 'panel-a'), false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 250);

  timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts.get('005930'), 2);
});

test('AITS chart REG failure starts its panel fallback and recovery stops it', async () => {
  const timers = [];
  let attempts = 0;
  const runtime = createRuntime({
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    fetchImpl: async () => {
      attempts += 1;
      const ok = attempts > 1;
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => ({ return_code: ok ? '0' : '1' }),
      };
    },
  });
  const authority = { accountId: 'local-a', chartBody: { stock: '005930' } };

  assert.equal(await runtime.context.ensureChartRealtime(authority, 'panel-a'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.chartFallbackStatuses)), [
    { panelId: 'panel-a', status: 'registration-failed' },
  ]);

  const retry = timers.find((timer) => !timer.cleared);
  retry.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.chartFallbackStatuses)), [
    { panelId: 'panel-a', status: 'registration-failed' },
    { panelId: 'panel-a', status: 'active' },
  ]);
});

test('failed direct quote re-registration retries without another feed transition', async () => {
  const timers = [];
  const runtime = createRuntime({
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    fetchImpl: async (_call, calls) => {
      const attempt = calls.fetches.filter((call) => call.body.trnm === 'REG').length;
      const ok = attempt !== 2;
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => ({ return_code: ok ? '0' : '1' }),
      };
    },
  });
  const acquired = await runtime.context.acquireRendererRealtimeLease('quote', '005930');
  assert.equal(acquired.ok, true);
  runtime.calls.rendererEvents.length = 0;

  runtime.calls.feeds[0].options.onStatus({ state: 'disconnected', connectionEpoch: 2 });
  runtime.calls.feeds[0].options.onStatus({ state: 'open', connectionEpoch: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  const pendingTimers = timers.filter((timer) => !timer.cleared);
  assert.equal(pendingTimers.length, 1);
  assert.equal(pendingTimers[0].delay, 250);

  pendingTimers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runtime.calls.fetches.filter((call) => call.body.trnm === 'REG').length, 3);
  assert.deepEqual(
    runtime.calls.rendererEvents.map((event) => event[1].status),
    ['reconnecting', 'error', 'active'],
  );
});

test('failed reconnect REG restarts AITS panel fallback until retry succeeds', async () => {
  const timers = [];
  const runtime = createRuntime({
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    fetchImpl: async (_call, calls) => {
      const attempt = calls.fetches.filter((call) => call.body.trnm === 'REG').length;
      const ok = attempt !== 2;
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => ({ return_code: ok ? '0' : '1' }),
      };
    },
  });
  assert.equal(await runtime.context.ensureChartRealtime({
    accountId: 'local-a', chartBody: { stock: '005930' },
  }, 'panel-a'), true);
  runtime.calls.chartFallbackStatuses.length = 0;

  runtime.calls.feeds[0].options.onStatus({ state: 'disconnected', connectionEpoch: 2 });
  runtime.calls.feeds[0].options.onStatus({ state: 'open', connectionEpoch: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.chartFallbackStatuses)), [
    { panelId: 'panel-a', status: 'registration-failed' },
  ]);

  const retry = timers.find((timer) => !timer.cleared);
  assert.equal(retry.delay, 250);
  retry.callback();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.chartFallbackStatuses)), [
    { panelId: 'panel-a', status: 'registration-failed' },
    { panelId: 'panel-a', status: 'active' },
  ]);
});

test('account reset cancels pending AITS and direct registrar retry timers', async () => {
  const timers = [];
  const attempts = new Map();
  const runtime = createRuntime({
    setTimer: (callback, delay) => {
      const timer = { callback, delay, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => { timer.cleared = true; },
    fetchImpl: async (call) => {
      if (call.body.trnm === 'REMOVE') {
        return { ok: true, status: 200, json: async () => ({ return_code: '0' }) };
      }
      const symbol = call.body.data[0].item;
      attempts.set(symbol, (attempts.get(symbol) || 0) + 1);
      const ok = symbol === '005930' ? attempts.get(symbol) === 1 : attempts.get(symbol) > 1;
      return {
        ok,
        status: ok ? 200 : 503,
        json: async () => ({ return_code: ok ? '0' : '1' }),
      };
    },
  });
  assert.equal((await runtime.context.acquireRendererRealtimeLease('quote', '005930')).ok, true);
  runtime.calls.feeds[0].options.onStatus({ state: 'disconnected', connectionEpoch: 2 });
  runtime.calls.feeds[0].options.onStatus({ state: 'open', connectionEpoch: 3 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await runtime.context.ensureChartRealtime({
    accountId: 'local-a', chartBody: { stock: '000660' },
  }, 'panel-a'), false);
  assert.equal(timers.filter((timer) => !timer.cleared).length, 2);

  await runtime.context.resetAccountBoundRealtime();
  assert.equal(timers.every((timer) => timer.cleared), true);
});

test('account reset broadcasts only the incremented realtime generation', async () => {
  const runtime = createRuntime();
  await runtime.context.resetAccountBoundRealtime();
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.calls.rendererEvents)), [
    ['athena:realtime-account-reset', { generation: 2 }],
  ]);
});

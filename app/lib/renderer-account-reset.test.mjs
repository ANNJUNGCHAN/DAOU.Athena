import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createAitsChartPanelAdapter } = require('./aits-chart-panel');
const canvasSource = fs.readFileSync(path.join(__dirname, '..', 'canvas.js'), 'utf8');

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

function load(functions, values = {}, declarations = '') {
  const context = vm.createContext({ Promise, setTimeout, clearTimeout, ...values });
  vm.runInContext([
    declarations,
    ...functions.map((signature) => functionSource(canvasSource, signature)),
  ].join('\n'), context);
  return context;
}

test('account reset closes an active direct orderbook panel and rejects later ticks', async () => {
  let onTick;
  let applied = 0;
  let closed = 0;
  const calls = [];
  const context = load([
    'function resolveEnvelopeSymbol(',
    'function wireOrderbookRealtime(',
    'function resetQuoteRealtimeForAccountChange(',
    'function resetRendererRealtimeForAccountChange(',
  ], {
    stampOrderbookRealtimeStatus() {},
    releaseRendererRealtimeLease() {},
    cardDestroyers: new Map(),
    quoteRealtimeResetters: new Set(),
    directOrderbookRealtimeResetters: new Set(),
    directOrderbookRealtimeSessions: new Map(),
    orderbookRealtimePanels: {
      openPanel(_card, _symbol, callback) { onTick = callback; },
      closePanel() { closed += 1; },
    },
    aitsChartPanels: { snapshot: () => [], destroyPanel: () => false },
    mountedChartSessions: new Map(),
    integratedRealtimeTasks: new Map(),
    grid: { querySelectorAll: () => [] },
    stampBoardRealtimeStatus() {},
    window: {
      athena: {
        invoke: async () => ({ ok: true, leaseToken: 'orderbook-old' }),
        send: (...args) => calls.push(args),
      },
    },
  }, 'let rendererRealtimeAccountGeneration = 0;');

  const release = context.wireOrderbookRealtime(
    {}, {}, { operation_args: { stk_cd: '005930' } }, () => { applied += 1; },
    { registerCardDestroyer: false },
  );
  await flush();
  onTick({ symbol: '005930' });
  assert.equal(applied, 1);

  context.resetRendererRealtimeForAccountChange({ generation: 2 });
  onTick({ symbol: '005930' });
  assert.equal(applied, 1);
  assert.equal(context.directOrderbookRealtimeSessions.size, 0);
  assert.equal(closed, 1);
  assert.equal(release(), false, 'later card destroy must not release a new-account owner');
  assert.deepEqual(calls, []);
});

test('account reset fences an in-flight integrated update and the next sync mounts', async () => {
  const root = {
    dataset: { integratedInstanceKey: 'card-1', cardId: 'CC-03' },
    isConnected: true,
    querySelector: () => null,
    __athenaIntegratedMetadata: { mode: 'quote' },
    __athenaIntegratedRealtime: {
      leaseId: 'card-1', mounted: true, mountAttempted: true,
      generation: 4, connectionGeneration: 9, operationIds: ['00'],
    },
  };
  const calls = [];
  let finishUpdate;
  const context = load([
    'function resetQuoteRealtimeForAccountChange(',
    'function resetRendererRealtimeForAccountChange(',
    'function integratedRealtimePayload(',
    'function integratedRealtimeMeta(',
    'function hasRealtimePolicy(',
    'function syncIntegratedRealtime(',
  ], {
    quoteRealtimeResetters: new Set(),
    directOrderbookRealtimeResetters: new Set(),
    aitsChartPanels: { snapshot: () => [], destroyPanel: () => false },
    mountedChartSessions: new Map(),
    integratedRealtimeTasks: new Map(),
    grid: { querySelectorAll: () => [root] },
    stampBoardRealtimeStatus() {},
    stampIntegratedRealtimeState(target, state) {
      target.__athenaIntegratedRealtime.status = state.status;
      target.__athenaIntegratedRealtime.mounted = true;
    },
    clearIntegratedRealtimeError() {},
    showIntegratedRealtimeError() {},
    syncCardRealtimeFallback() {},
    surfaceContractOf: () => ({}),
    realtimePolicies: async () => [{ rules: [{ cardId: 'CC-03', modes: ['quote'] }] }],
    integratedCardSurface: {
      targetIdentity: () => '005930',
      visibleTargetsFor: () => [],
      verifiedOperationRefsFor: () => [],
      realtimeEligibleFor: () => true,
      normalizeIdentity: (value) => value,
      requireRealtimeSuccess: (state) => {
        if (!state || !state.ok) throw new Error('REG failed');
      },
    },
    window: {
      athena: {
        send() {},
        invoke(channel) {
          calls.push(channel);
          if (channel.endsWith('-update')) {
            return new Promise((resolve) => { finishUpdate = resolve; });
          }
          return Promise.resolve({ ok: true, status: 'active', generation: 1, connectionGeneration: 1 });
        },
      },
    },
  }, 'let rendererRealtimeAccountGeneration = 1;');
  const envelope = { card_id: 'CC-03', mode: 'quote', operation_args: {} };
  root.__athenaIntegratedRealtime.accountGeneration = 1;
  root.__athenaIntegratedRealtime.status = 'active';
  root.__athenaBoardRealtimeReceived = true;

  context.syncIntegratedRealtime(root, envelope);
  await flush();
  assert.equal(calls.at(-1), 'athena:integrated-card-realtime-update');
  context.resetRendererRealtimeForAccountChange({ generation: 2 });
  finishUpdate({ ok: true, status: 'active', generation: 9, connectionGeneration: 9 });
  await flush();
  assert.equal(root.__athenaIntegratedRealtime.mounted, false);
  assert.equal(root.__athenaIntegratedRealtime.generation, null);

  context.syncIntegratedRealtime(root, envelope);
  await flush();
  await flush();
  assert.equal(calls.at(-1), 'athena:integrated-card-realtime-mount');
  assert.equal(root.__athenaIntegratedRealtime.mounted, true);
});

test('account reset fences AITS ticks until a fresh envelope reloads that panel', async () => {
  let applied = 0;
  const adapter = createAitsChartPanelAdapter({
    renderChart: async () => ({
      setData() {},
      applyChartTick() { applied += 1; },
      destroy() {},
    }),
  });
  await adapter.openPanel({}, {
    period: 'day', target: 'stock', trId: 'ka10081',
    candles: [{ time: '2026-09-14', open: 100, high: 100, low: 100, close: 100, volume: 1 }],
  }, { panelId: 'chart-old', stock: '005930', realtimeAccountGeneration: 1 });
  await adapter.applyRealtimeTick(
    { symbol: '005930', at: 1789344000, price: 101, volume: 1 },
    { realtimeAccountGeneration: 1 },
  );
  assert.equal(applied, 1);
  const card = { dataset: { integratedInstanceKey: 'root-1' } };
  const context = load([
    'function resetQuoteRealtimeForAccountChange(',
    'function resetRendererRealtimeForAccountChange(',
  ], {
    quoteRealtimeResetters: new Set(),
    directOrderbookRealtimeResetters: new Set(),
    aitsChartPanels: adapter,
    mountedChartSessions: new Map([['chart-old', {}]]),
    integratedRealtimeTasks: new Map(),
    grid: { querySelectorAll: () => [card] },
    stampBoardRealtimeStatus() {},
    window: { athena: { send() {} } },
  }, 'let rendererRealtimeAccountGeneration = 1;');

  context.resetRendererRealtimeForAccountChange({ generation: 2 });
  assert.equal(adapter.size(), 1, 'snapshot renderer remains mounted');
  assert.equal(await adapter.applyRealtimeTick(
    { symbol: '005930', at: 1789344060, price: 102, volume: 1 },
    { realtimeAccountGeneration: 2 },
  ), 0);
  assert.equal(applied, 1);
  assert.equal(card.dataset.integratedInstanceKey, 'root-1', 'reset keeps the static card root');
  await adapter.reloadPanel('chart-old', {
    period: 'day', target: 'stock', trId: 'ka10081',
    candles: [{ time: '2026-09-14', open: 102, high: 102, low: 102, close: 102, volume: 1 }],
  }, { generation: 2, realtimeAccountGeneration: 2 });
  assert.equal(await adapter.applyRealtimeTick(
    { symbol: '005930', at: 1789344120, price: 103, volume: 1 },
    { realtimeAccountGeneration: 2 },
  ), 1);
  assert.equal(applied, 2);
});

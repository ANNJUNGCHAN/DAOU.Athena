import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { correlationKey } = require('../rest-canvas-paint.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `main source markers must exist: ${startMarker}`);
  return mainSource.slice(start, end);
}

const fallbackSource = sourceSlice(
  'const REALTIME_FALLBACK_INTERVALS',
  'async function hydrateCanvasBoardForActiveAccount',
);
const liveRelaySource = sourceSlice(
  'function sendLiveCanvasResult(',
  'function sendLiveTextDelta(',
);

function sender(id) {
  const callbacks = new Map();
  return {
    id,
    sent: [],
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    once(name, callback) { callbacks.set(name, callback); },
    send(channel, payload) { this.sent.push({ channel, payload }); },
    destroy() {
      this.destroyed = true;
      const callback = callbacks.get('destroyed');
      if (callback) callback();
    },
  };
}

function createHarness() {
  const handlers = new Map();
  const listeners = new Map();
  const registeredDescriptors = [];
  const coordinatorCalls = { unregister: [], status: [], visible: [] };
  const shellSender = sender(11);
  const orbSender = sender(22);
  const foreignSender = sender(33);
  const realtimeFallbackAuthorities = new Map();
  const realtimeFallbackOwners = new Map();
  const realtimeFallbackSenderCleanup = new Set();
  const rendererRealtimeLeases = new Map();
  const integratedRealtimeLeaseSenders = new Map();
  const chartRealtimePanelSymbols = new Map();
  const releaseCalls = [];
  const state = {
    coordinatorOptions: null,
    hydrateBoard: async () => ({ ok: false, error: 'fixture not configured' }),
    integratedUnmount: null,
    releaseRenderer: null,
    runRestDataset: async () => ({ ok: false, error: 'fixture not configured' }),
  };
  const integratedManager = {
    mounted: new Set(),
    updateCalls: 0,
    unmountCalls: 0,
    async mount(payload) {
      this.mounted.add(payload.leaseId);
      return { ok: true, status: 'mounted', leaseId: payload.leaseId };
    },
    async update(payload) {
      this.updateCalls += 1;
      return { ok: true, status: 'updated', leaseId: payload.leaseId };
    },
    async unmount(leaseId) {
      this.unmountCalls += 1;
      if (state.integratedUnmount) return state.integratedUnmount(leaseId, this);
      this.mounted.delete(leaseId);
      return { ok: true, status: 'unmounted', leaseId };
    },
    status(leaseId) { return this.mounted.has(leaseId) ? { status: 'mounted' } : null; },
  };
  const coordinator = {
    register(descriptor) {
      registeredDescriptors.push(descriptor);
      return { ok: true, ownerId: descriptor.ownerId, status: 'registered' };
    },
    unregister(ownerId) { coordinatorCalls.unregister.push(ownerId); return true; },
    handleOwnerStatus(ownerId, value) { coordinatorCalls.status.push({ ownerId, value }); },
    setOwnerVisible(ownerId, value) { coordinatorCalls.visible.push({ ownerId, value }); return true; },
  };

  const context = vm.createContext({
    AbortController,
    Array,
    Boolean,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    activeRestAccountId: () => 'local-account',
    acquireRendererRealtimeLease: async (kind, symbol, ownerId) => {
      const leaseToken = `${kind}:${symbol}`;
      rendererRealtimeLeases.set(leaseToken, { kind, ownerId });
      return { ok: true, leaseToken };
    },
    BACKEND_HTTP_BASE: 'http://backend.test',
    backendAccountAuthorization: () => 'Bearer fixture',
    bindRealtimeFallbackSenderCleanup: undefined,
    briefingRunner: { killInProgressBriefing() {} },
    chartRealtimePanelSymbols,
    chartReloadAuthority: { unregister() {}, registerPaint() {} },
    clearTimeout() {},
    createActiveBackendAccountInvoker: async (run) => ({
      ok: true,
      accountId: 'local-account',
      run: () => run({ backendAccountAlias: 'server-account' }),
    }),
    createRealtimeFallbackCoordinator: (options) => {
      state.coordinatorOptions = options;
      return coordinator;
    },
    crypto,
    decidePaintAck: () => ({ action: 'ignore' }),
    DIRECT_DATASET_SETTLE_TIMEOUT_MS: 3000,
    ensureChartRealtime() {},
    ensureIntegratedCardRealtimeManager: () => integratedManager,
    ensureRealtimeFeed: () => true,
    fetch: async () => { throw new Error('unexpected fetch'); },
    historyConversationId: () => 'conversation-A',
    hydrateCanvasBoardForActiveAccount: (payload) => state.hydrateBoard(payload),
    integratedCardRealtime: { OPERATION_POLICIES: [], publicPolicies: () => [] },
    integratedCardRealtimeManager: integratedManager,
    integratedRealtimeLeaseSenders,
    ipcMain: {
      handle(channel, callback) { handlers.set(channel, callback); },
      on(channel, callback) { listeners.set(channel, callback); },
    },
    isQueryOnlyRetryDataset: (dataset) => {
      const item = dataset && dataset.items && dataset.items[0];
      return Boolean(item && /^(?:base|detail):/.test(String(item.operationRef || '')));
    },
    isQuitting: false,
    mdlog() {},
    orbWin: { isDestroyed: () => false, webContents: orbSender },
    performance: { now: () => 100 },
    persistBackgroundCanvasCard() {},
    process: { env: {} },
    PENDING_MOUNT_ACK_TIMEOUT_MS: 1000,
    realtimeAccountGeneration: 7,
    realtimeFallbackAuthorities,
    realtimeFallbackCoordinator: null,
    realtimeFallbackOwners,
    realtimeFallbackSenderCleanup,
    releaseRealtimeForSymbol() {},
    releaseRendererRealtimeLease: async (kind, leaseToken, ownerId) => {
      releaseCalls.push({ kind, leaseToken, ownerId });
      if (state.releaseRenderer) return state.releaseRenderer({ kind, leaseToken, ownerId });
      if (releaseCalls.length === 1) return false;
      rendererRealtimeLeases.delete(leaseToken);
      return true;
    },
    rendererRealtimeLeases,
    restCorrelationKey: correlationKey,
    restDatasetRunner: {
      runRestDataset: (options) => state.runRestDataset(options),
    },
    restPaintWaiters: new Map(),
    restReceiptWaiters: new Map(),
    revealShell() {},
    shellWin: { isDestroyed: () => false, webContents: shellSender },
    timedOutPaint: (paint) => paint,
    setTimeout(callback) {
      queueMicrotask(callback);
      return { unref() {} };
    },
    withActiveRealtimeAccount: async (run) => ({
      ok: true,
      value: await run({ backendAccountAlias: 'server-account' }),
    }),
  });
  vm.runInContext([
    fallbackSource,
    liveRelaySource,
    'this.testApi = { rememberRealtimeFallbackAuthority, rememberLiveRealtimeFallbackAuthority,',
    '  fallbackAllowedSlotIds, projectRealtimeFallbackResult, refreshRealtimeFallback,',
    '  ensureRealtimeFallbackCoordinator, sendLiveCanvasResult, chartRealtimePanelSymbols };',
  ].join('\n'), context);

  return {
    api: context.testApi,
    chartRealtimePanelSymbols,
    coordinatorCalls,
    foreignSender,
    handlers,
    integratedManager,
    integratedRealtimeLeaseSenders,
    listeners,
    orbSender,
    realtimeFallbackAuthorities,
    registeredDescriptors,
    releaseCalls,
    rendererRealtimeLeases,
    shellSender,
    state,
  };
}

const correlation = Object.freeze({ dataset_id: 'dataset-A', item_id: 'item-A', ordinal: 1 });

function trustedQuotePayload(overrides = {}) {
  return {
    envelope: {
      canvas_type: 'facts',
      correlation,
      operation_ref: 'detail:ka10001:current_trading',
      operation_args: { stk_cd: '023590' },
    },
    operationRef: 'detail:ka10001:current_trading',
    operationArgs: { stk_cd: '023590' },
    canvasType: 'facts',
    accountId: 'local-account',
    ...overrides,
  };
}

test('fallback registration trusts stored correlation authority and ignores renderer operation claims', async () => {
  const h = createHarness();
  h.api.rememberRealtimeFallbackAuthority(trustedQuotePayload());

  const result = await h.handlers.get('athena:realtime-fallback-register')(
    { sender: h.shellSender },
    {
      ownerId: 'card-1', kind: 'quote', correlation, accountGeneration: 7,
      operationRef: 'order:malicious', operationArgs: { stk_cd: '005930', qty: 999 },
      target: '005930',
    },
  );

  assert.equal(result.ok, true);
  assert.equal(h.registeredDescriptors.length, 1);
  assert.equal(h.registeredDescriptors[0].operationRef, 'detail:ka10001:current_trading');
  assert.deepEqual({ ...h.registeredDescriptors[0].operationArgs }, { stk_cd: '023590' });
  assert.equal(h.registeredDescriptors[0].target, '023590');
});

test('provider canvas relay stores trusted query metadata before renderer fallback admission', async () => {
  const h = createHarness();
  const providerCard = {
    status: 'success',
    envelope: trustedQuotePayload().envelope,
  };

  h.api.sendLiveCanvasResult(providerCard, { conversationId: 'conversation-A' });
  const result = await h.handlers.get('athena:realtime-fallback-register')(
    { sender: h.shellSender },
    { ownerId: 'provider-card', kind: 'quote', correlation, accountGeneration: 7 },
  );

  assert.equal(result.ok, true);
  assert.equal(h.registeredDescriptors[0].operationRef, 'detail:ka10001:current_trading');
  assert.deepEqual({ ...h.registeredDescriptors[0].operationArgs }, { stk_cd: '023590' });
});

test('realtime generation is available only to the current shell or orb renderer', async () => {
  const h = createHarness();
  const invoke = h.handlers.get('athena:realtime-generation');

  assert.deepEqual({ ...await invoke({ sender: h.shellSender }) }, { ok: true, accountGeneration: 7 });
  assert.deepEqual({ ...await invoke({ sender: h.orbSender }) }, { ok: true, accountGeneration: 7 });
  assert.deepEqual({ ...await invoke({ sender: h.foreignSender }) }, { ok: false, error: 'invalid renderer' });
});

for (const [shape, slotValues] of [
  ['array', [{ slot_id: 'price', value: 40900 }, { slot_id: 'volume', value: 33291 }]],
  ['map', { price: 40900, volume: 33291 }],
]) {
  test(`integrated fallback admits only slot ids present in actual ${shape} slot_values`, async () => {
    const h = createHarness();
    h.api.rememberRealtimeFallbackAuthority(trustedQuotePayload({
      envelope: {
        canvas_type: 'free', correlation,
        surface_contract: { board_id: 'board-1', slot_values: slotValues },
      },
    }));
    const invoke = h.handlers.get('athena:realtime-fallback-register');

    const accepted = await invoke({ sender: h.shellSender }, {
      ownerId: 'board-card', kind: 'integrated-board', correlation,
      accountGeneration: 7, slotIds: ['price'],
    });
    const rejected = await invoke({ sender: h.shellSender }, {
      ownerId: 'board-card-2', kind: 'integrated-board', correlation,
      accountGeneration: 7, slotIds: ['unknown'],
    });

    assert.equal(accepted.ok, true);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /슬롯 권위/);
  });
}

test('same-correlation chart authority change drops the old completion and refreshes with the new period', async () => {
  const h = createHarness();
  const key = correlationKey(correlation);
  let releaseOld;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const requestedArgs = [];
  h.state.runRestDataset = async (options) => {
    requestedArgs.push({ ...options.dataset.items[0].args });
    await oldGate;
    await options.emitCanvas({ envelope: { data: { chart: { period: 'day', candles: [{ close: 40900 }] } } } });
    return { ok: true };
  };
  h.api.rememberRealtimeFallbackAuthority(trustedQuotePayload({
    operationRef: 'base:ka10081',
    operationArgs: { stk_cd: '023590', bas_dt: '20260914' },
  }));
  const descriptor = {
    kind: 'chart', authorityKey: key, accountGeneration: 7,
    backendAccountAlias: 'server-account', panelId: 'panel-1', target: '023590',
  };
  const oldRefresh = h.api.refreshRealtimeFallback(descriptor);

  h.api.rememberRealtimeFallbackAuthority(trustedQuotePayload({
    operationRef: 'base:ka10080',
    operationArgs: { stk_cd: '023590', tic_scope: '1' },
  }));
  releaseOld();
  const oldResult = await oldRefresh;
  assert.equal(oldResult.ok, false);
  assert.match(oldResult.error, /이전 API 응답을 버렸다/);

  h.state.runRestDataset = async (options) => {
    requestedArgs.push({ ...options.dataset.items[0].args });
    await options.emitCanvas({ envelope: { data: { chart: { period: 'minute', interval: '1', candles: [{ close: 41000 }] } } } });
    return { ok: true };
  };
  const currentResult = await h.api.refreshRealtimeFallback(descriptor);

  assert.equal(currentResult.ok, true);
  assert.deepEqual(requestedArgs, [
    { stk_cd: '023590', bas_dt: '20260914' },
    { stk_cd: '023590', tic_scope: '1' },
  ]);
});

test('chart fallback registration replays only its matching pre-registration REG failure', async () => {
  const h = createHarness();
  h.api.rememberRealtimeFallbackAuthority(trustedQuotePayload({
    operationRef: 'base:ka10081',
    operationArgs: { stk_cd: '023590', bas_dt: '20260914' },
  }));
  h.chartRealtimePanelSymbols.set('panel-A', {
    generation: 7, code: '023590', fallbackStatus: 'registration-failed',
  });
  h.chartRealtimePanelSymbols.set('panel-B', {
    generation: 7, code: '005930', fallbackStatus: 'active',
  });

  const result = await h.handlers.get('athena:realtime-fallback-register')(
    { sender: h.shellSender },
    {
      ownerId: 'chart-owner-A', kind: 'chart', correlation, accountGeneration: 7,
      panelId: 'panel-A', target: '023590', period: 'day',
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(h.coordinatorCalls.status, [{
    ownerId: '11:chart-owner-A',
    value: 'registration-failed',
  }]);
});

test('coordinator projection uses each owner descriptor for the same refreshed payload', () => {
  const h = createHarness();
  h.api.ensureRealtimeFallbackCoordinator();
  const refreshed = {
    ok: true,
    envelope: { data: { chart: { stock: '023590', period: 'minute', interval: '1', candles: [{ close: 41000 }] } } },
  };

  const chart = h.state.coordinatorOptions.project(refreshed, {
    kind: 'chart', panelId: 'panel-A', target: '023590', slotIds: [],
  });
  const semantic = h.state.coordinatorOptions.project(refreshed, {
    kind: 'semantic', ownerId: 'semantic-A', slotIds: [],
  });

  assert.equal(chart.mode, 'replace-latest');
  assert.equal(chart.panelId, 'panel-A');
  assert.equal(chart.latestCandle.close, 41000);
  assert.equal(semantic.envelope, refreshed.envelope);
});

test('integrated board refresh uses stored hydrate authority and returns only the requested owner slots', async () => {
  const h = createHarness();
  const key = correlationKey(correlation);
  h.realtimeFallbackAuthorities.set(key, Object.freeze({
    key,
    operationRef: 'detail:ka10001:current_trading',
    operationArgs: Object.freeze({ stk_cd: '023590' }),
    accountId: 'local-account',
    accountGeneration: 7,
    envelope: Object.freeze({
      correlation,
      surface_contract: { board_id: 'board-1', slot_values: { price: 40900, volume: 33291 } },
    }),
    boardHydrate: Object.freeze({ boardId: 'board-1', target: Object.freeze({ stk_cd: '023590' }) }),
  }));
  const calls = [];
  h.state.hydrateBoard = async (payload) => {
    calls.push(payload);
    return {
      ok: true,
      slot_values: { price: 41000 },
      surface_contract: { board_id: 'board-1', slot_values: { price: 41000 } },
    };
  };

  const refreshed = await h.api.refreshRealtimeFallback({
    kind: 'integrated-board', authorityKey: key, accountGeneration: 7, slotIds: ['price'],
  });
  h.api.ensureRealtimeFallbackCoordinator();
  const projected = h.state.coordinatorOptions.project(refreshed, {
    kind: 'integrated-board', boardId: 'board-1', slotIds: ['price'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].boardId, 'board-1');
  assert.deepEqual({ ...calls[0].target }, { stk_cd: '023590' });
  assert.deepEqual(Array.from(calls[0].slotIds), ['price']);
  assert.equal(projected.ok, true);
  assert.deepEqual({ ...projected.slotValues }, { price: 41000 });
});

test('fully populated board without prior hydrate refreshes requested slots from validated board authority', async () => {
  const h = createHarness();
  const key = correlationKey(correlation);
  h.api.rememberRealtimeFallbackAuthority(trustedQuotePayload({
    envelope: {
      canvas_type: 'free', correlation,
      surface_contract: {
        board_id: 'board-fully-populated',
        slot_values: { price: 40900, volume: 33291 },
      },
    },
    operationRef: 'detail:ka10001:current_trading',
    operationArgs: { stk_cd: '023590' },
  }));
  const hydrateCalls = [];
  h.state.runRestDataset = async () => { throw new Error('integrated board must use validated hydrate authority'); };
  h.state.hydrateBoard = async (payload) => {
    hydrateCalls.push(payload);
    return {
      ok: true,
      slot_values: { price: 41000 },
      surface_contract: {
        board_id: 'board-fully-populated',
        slot_values: { price: 41000 },
      },
    };
  };
  const descriptor = {
    kind: 'integrated-board', authorityKey: key, accountGeneration: 7,
    backendAccountAlias: 'server-account', boardId: 'board-fully-populated', slotIds: ['price'],
  };

  const refreshed = await h.api.refreshRealtimeFallback(descriptor);
  h.api.ensureRealtimeFallbackCoordinator();
  const projected = h.state.coordinatorOptions.project(refreshed, descriptor);

  assert.equal(refreshed.ok, true);
  assert.equal(hydrateCalls.length, 1);
  assert.equal(hydrateCalls[0].boardId, 'board-fully-populated');
  assert.deepEqual({ ...hydrateCalls[0].target }, { stk_cd: '023590' });
  assert.deepEqual(Array.from(hydrateCalls[0].slotIds), ['price']);
  assert.equal(projected.ok, true);
  assert.equal(projected.mode, 'slot-patch');
  assert.deepEqual({ ...projected.slotValues }, { price: 41000 });
});

test('integrated board projection rejects a successful refresh that omitted the requested slot', () => {
  const h = createHarness();
  h.api.ensureRealtimeFallbackCoordinator();

  const projected = h.state.coordinatorOptions.project({
    ok: true,
    slotValues: { volume: 33291 },
    surfaceContract: { board_id: 'board-1', slot_values: { volume: 33291 } },
  }, {
    kind: 'integrated-board', boardId: 'board-1', slotIds: ['price'],
  });

  assert.equal(projected.ok, false);
  assert.match(projected.error, /대체 값이 없다/);
});

test('integrated realtime lease cannot be updated, unmounted, or inspected by another renderer', async () => {
  const h = createHarness();
  const mount = h.handlers.get('athena:integrated-card-realtime-mount');
  const update = h.handlers.get('athena:integrated-card-realtime-update');
  const unmount = h.handlers.get('athena:integrated-card-realtime-unmount');
  const status = h.handlers.get('athena:integrated-card-realtime-status');

  const mounted = await mount({ sender: h.shellSender }, { leaseId: 'lease-A' });
  const remount = await mount({ sender: h.orbSender }, { leaseId: 'lease-A' });
  const foreignUpdate = await update({ sender: h.orbSender }, { leaseId: 'lease-A' });
  const foreignUnmount = await unmount({ sender: h.orbSender }, { leaseId: 'lease-A' });
  const foreignStatus = await status({ sender: h.orbSender }, { leaseId: 'lease-A' });

  assert.equal(mounted.ok, true);
  for (const result of [remount, foreignUpdate, foreignUnmount, foreignStatus]) {
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid realtime owner/);
  }
  assert.equal(h.integratedManager.updateCalls, 0);
  assert.equal(h.integratedManager.unmountCalls, 0);
});

test('destroyed direct quote sender retries a false release result until the lease is released', async () => {
  const h = createHarness();
  const acquire = h.handlers.get('athena:realtime-acquire');
  const acquired = await acquire({ sender: h.shellSender }, { symbol: '023590' });

  h.shellSender.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(acquired.ok, true);
  assert.equal(h.releaseCalls.length, 2);
  assert.deepEqual(h.releaseCalls.map((entry) => entry.ownerId), [11, 11]);
  assert.equal(h.rendererRealtimeLeases.has(acquired.leaseToken), false);
});

test('destroyed direct quote sender retries a rejected release promise until the lease is released', async () => {
  const h = createHarness();
  let attempts = 0;
  h.state.releaseRenderer = async ({ leaseToken }) => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary REMOVE failure');
    h.rendererRealtimeLeases.delete(leaseToken);
    return true;
  };
  const acquired = await h.handlers.get('athena:realtime-acquire')(
    { sender: h.shellSender }, { symbol: '023590' },
  );

  h.shellSender.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(acquired.ok, true);
  assert.equal(attempts, 2);
  assert.equal(h.rendererRealtimeLeases.has(acquired.leaseToken), false);
});

test('destroyed integrated sender retries a false unmount result until REMOVE succeeds', async () => {
  const h = createHarness();
  let attempts = 0;
  h.state.integratedUnmount = async (leaseId, manager) => {
    attempts += 1;
    if (attempts === 1) return { ok: false, status: 'error', leaseId };
    manager.mounted.delete(leaseId);
    return { ok: true, status: 'unmounted', leaseId };
  };
  const mounted = await h.handlers.get('athena:integrated-card-realtime-mount')(
    { sender: h.shellSender }, { leaseId: 'integrated-A' },
  );

  h.shellSender.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(mounted.ok, true);
  assert.equal(attempts, 2);
  assert.equal(h.integratedRealtimeLeaseSenders.has('integrated-A'), false);
  assert.equal(h.integratedManager.status('integrated-A'), null);
});

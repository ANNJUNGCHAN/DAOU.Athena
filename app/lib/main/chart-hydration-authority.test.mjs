import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createChartReloadAuthority } = require('./chart-reload');
const { createChartRemounts } = require('./chart-remount');
const boardHydrate = require('./board-hydrate');
const boardRegistry = require('../board-template-registry');
const { panelIdFor } = require('../aits-chart-panel');
const paint = require('../rest-canvas-paint');
const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const canvas = fs.readFileSync(new URL('../../canvas.js', import.meta.url), 'utf8');
const correlation = { dataset_id: 'company-query', item_id: 'company', ordinal: 1 };
const primary = {
  renderer_id: 'aits-chart-v1', canvas_type: 'chart', operation_ref: 'base:ka10079',
  operation_args: { stk_cd: '023590', tic_scope: '1', upd_stkpc_tp: '1' },
  correlation: { dataset_id: 'backend-hydrate', item_id: 'chart', ordinal: 1 },
  data: {
    symbol: '023590',
    chart: { period: 'tick', target: 'stock', trId: 'ka10079', candles: [{ time: 1, close: 100 }] },
    chart_meta: { series_scope: 'stock', reload_group: 'stock', reload_targets: {
      tick: { operation_ref: 'base:ka10079', request_fields: ['stk_cd', 'tic_scope', 'upd_stkpc_tp'] },
      day: { operation_ref: 'base:ka10081', request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] },
    } },
  },
};

function extract(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return source.slice(a, b);
}

function harness() {
  const handlers = new Map(), events = new Map(), timers = new Map(), sends = [], errors = [], saved = [];
  const sender = { id: 7, send: (...args) => sends.push(args) };
  const authority = createChartReloadAuthority({ today: () => '20261007' });
  let uuid = 0, currentConversation = 'current', currentAccount = 'mock-account';
  const remounts = createChartRemounts({ correlationKey: paint.correlationKey, panelIdFor, randomUUID: () => `remount-${++uuid}` });
  const context = vm.createContext({
    Map, Object, String, Number, Error, Promise, performance, boardHydrate,
    process: { env: {} }, shellWin: { isDestroyed: () => false, webContents: sender }, orbWin: null,
    ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => events.set(name, fn) },
    crypto: { randomUUID: () => `hydrate-${++uuid}` }, chartPanelIdFor: panelIdFor,
    realtimeAccountGeneration: 1, realtimeFallbackAuthorities: new Map(), restPaintWaiters: new Map(),
    restCorrelationKey: paint.correlationKey, decidePaintAck: paint.decidePaintAck,
    timedOutPaint: paint.timedOutPaint, PENDING_MOUNT_ACK_TIMEOUT_MS: paint.PENDING_MOUNT_ACK_TIMEOUT_MS,
    chartReloadAuthority: authority, chartRemounts: remounts, chartRemountContext: () => ({}),
    ensureChartRealtime() {}, rememberRealtimeFallbackAuthority() {}, revealShell() {},
    rememberLiveRealtimeFallbackAuthority() {}, rememberPendingCanvasCard() {}, flushDeferredShellEvents() {},
    persistBackgroundCanvasCard: (_conversationId, result) => saved.push(result.envelope),
    pendingCanvasCards: new Map(), getSessionBridge: () => ({ flush() {}, load: () => ({ canvasCards: [] }) }),
    activeRestAccountId: () => currentAccount, historyConversationId: () => currentConversation,
    hydrateCanvasBoardForActiveAccount: async () => ({ ok: true, primary_envelope: structuredClone(primary) }),
    mdlog: message => errors.push(message),
    setTimeout: fn => { const key = {}; timers.set(key, fn); return key; }, clearTimeout: key => timers.delete(key),
  });
  for (const [start, end] of [
    ["ipcMain.on('athena:rest-canvas-painted',", "ipcMain.on('athena:rest-receipt-painted',"],
    ["ipcMain.handle('athena:canvas-board-hydrate',", 'function emitRestReceiptAndWaitForPaint('],
    ['async function emitRestCanvasAndWaitForPaint(', 'let liveMcpConfig ='],
    ['function sendLiveCanvasResult(', '// 답변 텍스트 조각'],
    ["ipcMain.handle('athena:session-replay-cards',", '// 과거 대화 열기'],
  ]) vm.runInContext(extract(main, start, end), context);
  return {
    context, sender, authority, remounts, timers, sends, errors, saved,
    hydrate: (payload = {}) => handlers.get('athena:canvas-board-hydrate')({ sender }, { boardId: '137X-2', correlation, ...payload }),
    ack: payload => events.get('athena:rest-canvas-painted')({ sender }, payload),
    deliver: envelope => context.sendLiveCanvasResult({ status: 'success', envelope }),
    replay: envelope => {
      context.getSessionBridge = () => ({ flush() {}, load: () => ({ canvasCards: [{ cardId: 'saved-company-card', channel: 'live', envelope }] }) });
      return handlers.get('athena:session-replay-cards')({ sender }, { id: 'current' });
    },
    conversation: value => { currentConversation = value; }, account: value => { currentAccount = value; },
  };
}

for (const route of ['provider', 'saved-legacy']) {
  test(`${route} company card without correlation acquires daily reload through its actual delivery path`, async () => {
    const h = harness();
    const company = { operation_ref: 'detail:ka10001:identity_and_capital', operation_args: { stk_cd: '023590' }, canvas_type: 'facts', data: {} };
    if (route === 'provider') h.deliver(company); else h.replay(company);
    const delivered = h.sends.find(([channel]) => channel === 'athena:add-canvas-live')[1].envelope;
    assert.equal(paint.isValidCorrelation(delivered.correlation), true, 'main must issue the company card identity before delivery');
    assert.equal(company.correlation, undefined, 'normalization must not mutate the provider/stored input');
    if (route === 'provider') assert.equal(h.saved[0], delivered, 'persist and delivery must share the main-issued identity');
    const backendPrimary = structuredClone(primary);
    delete backendPrimary.correlation;
    h.context.hydrateCanvasBoardForActiveAccount = async () => ({ ok: true, primary_envelope: backendPrimary });
    const reply = await h.hydrate({ correlation: delivered.correlation });
    assert.equal(reply.primary_paint_required, true);
    const ack = ackFor(reply.primary_envelope);
    h.ack(ack);
    const request = h.authority.buildDataset({ panelId: ack.panel_id, generation: 1, period: 'D' });
    assert.equal(request.items[0].operationRef, 'base:ka10081');
    assert.equal(request.items[0].args.stk_cd, '023590');
    h.remounts.retire(ack.panel_id);
    assert.doesNotThrow(() => h.remounts.begin({ panelId: ack.panel_id, generation: 1,
      correlation: delivered.correlation, cardId: 'company-card' }, {
      senderId: 7, conversationId: 'current', accountGeneration: 1, accountId: 'mock-account',
      cardId: 'company-card', cardKey: paint.correlationKey(delivered.correlation),
    }));
  });
}

test('repeated legacy replay keeps the latest pending content and one issued identity', () => {
  const h = harness();
  const company = { canvas_type: 'facts', operation_ref: 'detail:ka10001:identity_and_capital', revision: 'stored' };
  h.context.pendingCanvasCards.set('saved-company-card', { conversationId: 'current', card: {
    cardId: 'saved-company-card', channel: 'live', envelope: { ...company, revision: 'newer-pending' },
  } });
  h.replay(company);
  const delivered = h.sends.find(([channel]) => channel === 'athena:add-canvas-live')[1].envelope;
  assert.equal(delivered.revision, 'newer-pending', 'stale storage must not replace the pending authoritative card');
  assert.equal(paint.isValidCorrelation(delivered.correlation), true);
  assert.deepEqual(h.context.pendingCanvasCards.get('saved-company-card').card.envelope, delivered);
  h.sends.length = 0;
  h.replay(company);
  const repeated = h.sends.find(([channel]) => channel === 'athena:add-canvas-live')[1].envelope;
  assert.deepEqual(repeated, delivered, 'replaying before a viewport report reuses the same pending identity');
  assert.equal(company.correlation, undefined);
});

function ackFor(envelope) {
  return { ...envelope.correlation, operation_ref: envelope.operation_ref, canvas_type: 'chart',
    render_state: 'data', renderer_id: 'aits-chart-v1', panel_id: panelIdFor({ source: 'live', correlation: envelope.correlation }),
    generation: 1, verified_visible: true, pending: false };
}

test('company-to-chart hydration establishes daily reload only after its visible paint', async () => {
  const h = harness();
  const reply = await h.hydrate();
  assert.equal(reply.primary_paint_required, true);
  const ack = ackFor(reply.primary_envelope);
  assert.equal(h.authority.has(ack.panel_id), false);
  assert.equal(h.context.restPaintWaiters.size, 1);
  assert.equal(h.sends.length, 0, 'hydration must not emit a duplicate card');
  h.ack(ack);
  const request = h.authority.buildDataset({ panelId: ack.panel_id, generation: 1, period: 'D' });
  assert.equal(request.items[0].operationRef, 'base:ka10081');
  assert.equal(request.items[0].args.stk_cd, '023590');
  assert.equal(request.accountId, 'mock-account');
  assert.equal(h.context.restPaintWaiters.size, 0);
  h.remounts.retire(ack.panel_id);
  assert.doesNotThrow(() => h.remounts.begin({ panelId: ack.panel_id, generation: 1, correlation, cardId: 'company-card' }, {
    senderId: 7, conversationId: 'current', accountGeneration: 1, accountId: 'mock-account',
    cardId: 'company-card', cardKey: paint.correlationKey(correlation),
  }));
});

test('initial pending card retains its original paint acknowledgment path', async () => {
  const h = harness();
  const waiter = { reloadAuthority: { accountId: 'mock-account' } };
  h.context.restPaintWaiters.set(paint.correlationKey(correlation), waiter);
  const reply = await h.hydrate();
  assert.notEqual(reply.primary_paint_required, true);
  assert.equal(h.context.restPaintWaiters.size, 1);
  assert.equal(waiter.reloadAuthority.operationRef, 'base:ka10079');
});

for (const change of ['conversation', 'account', 'accountGeneration']) {
  test(`hydration arriving after ${change} changes cannot install a waiter`, async () => {
    const h = harness(); let finish;
    h.context.hydrateCanvasBoardForActiveAccount = () => new Promise(resolve => { finish = resolve; });
    const pending = h.hydrate();
    if (change === 'conversation') h.conversation('other');
    if (change === 'account') h.account('other');
    if (change === 'accountGeneration') h.context.realtimeAccountGeneration += 1;
    finish({ ok: true, primary_envelope: structuredClone(primary) });
    const reply = await pending;
    assert.notEqual(reply.primary_paint_required, true);
    assert.equal(h.context.restPaintWaiters.size, 0);
  });
}

test('empty or non-chart primary data cannot request chart paint authority', async () => {
  for (const invalid of [null, { ...primary, renderer_id: 'other' }, { ...primary, data: { ...primary.data, chart: { ...primary.data.chart, candles: [] } } }]) {
    const h = harness();
    h.context.hydrateCanvasBoardForActiveAccount = async () => ({ ok: true, primary_envelope: invalid });
    const reply = await h.hydrate();
    assert.notEqual(reply.primary_paint_required, true);
    assert.equal(h.context.restPaintWaiters.size, 0);
  }
});

for (const change of ['conversation', 'account', 'accountGeneration', 'panel', 'generation', 'invisible', 'timeout']) {
  test(`late or invalid hydrated paint (${change}) cannot acquire reload authority`, async () => {
    const h = harness();
    const reply = await h.hydrate();
    assert.equal(reply.primary_paint_required, true);
    const ack = ackFor(reply.primary_envelope);
    if (change === 'conversation') h.conversation('other');
    if (change === 'account') h.account('other');
    if (change === 'accountGeneration') h.context.realtimeAccountGeneration += 1;
    if (change === 'panel') ack.panel_id = 'unrelated-panel';
    if (change === 'generation') ack.generation = 2;
    if (change === 'invisible') ack.verified_visible = false;
    if (change === 'timeout') for (const fn of [...h.timers.values()]) fn();
    h.ack(ack);
    await Promise.resolve();
    assert.equal(h.authority.has(ack.panel_id), false);
    assert.equal(h.context.restPaintWaiters.size, 0);
  });
}

test('successive tab hydrations have distinct paint identities and ignore an expired acknowledgment', async () => {
  const h = harness(); const first = await h.hydrate();
  assert.equal(first.primary_paint_required, true);
  for (const fn of [...h.timers.values()]) fn();
  const second = await h.hydrate();
  assert.notDeepEqual(first.primary_envelope.correlation, second.primary_envelope.correlation);
  h.ack(ackFor(first.primary_envelope));
  assert.equal(h.context.restPaintWaiters.size, 1);
  h.ack(ackFor(second.primary_envelope));
  assert.equal(h.authority.has(ackFor(second.primary_envelope).panel_id), true);
});

for (const detached of [false, true]) test(`hydrated chart paint ${detached ? 'discards a detached mount' : 'acknowledges the visible mount'}`, async () => {
  const sent = [], state = { primaryPaintEnvelope: primary, primaryRemount: null };
  let destroyed = 0;
  const card = { dataset: {} };
  const point = { isConnected: true, dataset: {}, appendChild() {} };
  const surface = {}; state.surface = surface;
  const host = { isConnected: true, closest: () => card };
  const descriptor = { rendererId: 'aits-chart-v1', panelId: 'mounted-panel', generation: 1,
    context: { operationRef: primary.operation_ref } };
  const context = vm.createContext({
    BOARD_CHART_RENDERER: 'athena-chart', BOARD_ORDERBOOK_RENDERER: 'orderbook-ladder',
    boardStateOf: () => state, boardPrimaryAcceptsEnvelope: () => true, boardChartDescriptor: () => descriptor,
    document: { createElement: () => ({ style: {}, remove() {} }) },
    boardMount: { collapsePrimaryMockup() {} }, releaseBoardChartPanel() {},
    beginBoardChartMount: () => { state.primaryDescriptor = descriptor; },
    mountAitsChartPanel: async () => ({ body: primary.data.chart, generation: 1, destroy() { destroyed += 1; } }),
    waitForVisiblePaint: async () => { if (detached) host.isConnected = false; return { verifiedVisible: true }; },
    settleBoardChartMount() {}, startBoardChartRefresh() {}, clearBoardChartIdentity() {},
    window: { athena: { send: (...args) => sent.push(args) } },
  });
  vm.runInContext(extract(canvas, 'async function mountBoardPrimary(', 'const RETRYABLE_BOARD_HYDRATE_REASONS'), context);
  await context.mountBoardPrimary(host, primary, { surface, primary: { renderer: 'athena-chart', mountPoint: point } });
  if (detached) {
    assert.equal(sent.length, 0);
    assert.equal(destroyed, 1);
    return;
  }
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'athena:rest-canvas-painted');
  assert.equal(sent[0][1].panel_id, 'mounted-panel');
  assert.equal(sent[0][1].verified_visible, true);
  assert.equal(sent[0][1].dataset_id, primary.correlation.dataset_id);
});

for (const wrongBoard of [false, true]) test(`cached company-to-chart revisit ${wrongBoard ? 'rejects a foreign chart source' : 'remounts the verified daily chart'}`, async () => {
  const calls = [], sent = [], rendered = [];
  const notices = []; let mockCollapsed = false;
  const company = { canvas_type: 'facts', operation_ref: 'detail:ka10001:identity_and_capital', correlation };
  const daily = { ...primary, operation_ref: 'base:ka10081', correlation: { ...correlation, dataset_id: 'remounted-daily' },
    data: { ...primary.data, chart: { ...primary.data.chart, period: 'day', trId: 'ka10081' } } };
  const card = { dataset: { sessionCardId: 'company-card' }, __athenaSessionCard: { envelope: daily } };
  const point = { isConnected: true, dataset: {}, appendChild() {}, prepend: note => notices.push(note) };
  const surface = {};
  const boardId = wrongBoard ? '32S7-0' : '137X-2';
  const state = { boardId, surface, primaryPanelId: 'daily-panel', hydrationWarnings: [],
    hydrationByBoard: new Map([[boardId, []]]), loadCard: card };
  const host = { isConnected: true, hidden: false, style: {}, closest: () => card, removeAttribute() {} };
  const descriptor = { rendererId: 'aits-chart-v1', panelId: 'remounted-panel', generation: 1,
    context: { operationRef: 'base:ka10081' } };
  const context = vm.createContext({
    Map, BOARD_CHART_RENDERER: 'athena-chart', BOARD_ORDERBOOK_RENDERER: 'orderbook-ladder',
    boardStateOf: () => state, closeParentRankingFilter() {}, clearTimeout() {},
    aitsChartPanels: { snapshot: () => [{ panelId: 'daily-panel', generation: 2 }], destroyPanel: () => true },
    boardChartDescriptor: envelope => { rendered.push(envelope); return descriptor; },
    document: { createElement: () => ({ style: {}, remove() {} }) },
    boardMount: { collapsePrimaryMockup() { mockCollapsed = true; } }, releaseBoardChartPanel() {}, errorNote: message => message,
    beginBoardChartMount: () => { state.primaryDescriptor = descriptor; },
    mountAitsChartPanel: async () => ({ body: daily.data.chart, generation: 1, destroy() {} }),
    waitForVisiblePaint: async () => ({ verifiedVisible: true }),
    settleBoardChartMount() {}, startBoardChartRefresh() {}, clearBoardChartIdentity() {},
    removeBoardLoadNode() {}, stampBoardRealtimeStatus() {}, integratedRealtimeMeta: () => ({}), mountAuthoredOrderbook() {},
    window: { AthenaLib: {}, athena: {
      send: (...args) => sent.push(args),
      invoke: async (channel, request) => { calls.push({ channel, request }); return { ok: true, token: 'verified-remount', envelope: daily }; },
    } },
  });
  for (const [start, end] of [
    ['function destroyBoardPrimary(', 'function boardChartDescriptor('],
    ['function boardPrimaryAcceptsEnvelope(', 'function mountAuthoredOrderbook('],
    ['async function mountBoardPrimary(', 'const RETRYABLE_BOARD_HYDRATE_REASONS'],
    ['async function hydrateBoardSlots(', 'function rememberMountedBoard('],
    ['async function showBoardReady(', 'function showBoardLoadError('],
  ]) vm.runInContext(extract(canvas, start, end), context);
  context.destroyBoardPrimary(state);
  assert.equal(state.primaryEnvelope, null);
  assert.equal(state.primaryRemount.generation, 2);
  const mounted = { surface, primary: { renderer: 'athena-chart', mountPoint: point,
    propsFrom: boardRegistry.contractFor(boardId).primary.props_from } };
  assert.equal(context.boardPrimaryAcceptsEnvelope(mounted.primary, company), false);
  const cached = await context.hydrateBoardSlots(host, company, mounted);
  assert.equal(cached, mounted);
  assert.equal(calls.length, 0, 'complete cached slots do not rehydrate');
  await context.showBoardReady(state, host, company, cached, () => {});
  assert.equal(calls[0]?.channel, 'athena:remount-chart-panel');
  assert.equal(calls[0].request.generation, 2);
  if (wrongBoard) {
    assert.equal(rendered.length, 0, 'a stock chart cannot mount into a sector primary');
    assert.equal(calls[1]?.channel, 'athena:cancel-chart-remount');
    assert.equal(sent.some(([channel]) => channel === 'athena:rest-canvas-painted'), false);
    assert.equal(mockCollapsed, true);
    assert.equal(notices.length, 1, 'rejected remount shows an error instead of mock candles');
  } else {
    assert.equal(rendered[0], daily);
    assert.equal(sent.at(-1)[0], 'athena:rest-canvas-painted');
    assert.equal(sent.at(-1)[1].dataset_id, 'remounted-daily');
    assert.equal(state.primaryRemount, null);
    assert.equal(point.dataset.bsPrimaryMounted, 'athena-chart');
  }
});

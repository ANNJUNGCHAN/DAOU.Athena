import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const book = require('./board-orderbook');
const { parseQuoteBookTick } = require('./main/orderbook-realtime');
const { createQuoteRealtimePanelAdapter } = require('./quote-realtime-panel');
const canvas = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const hogaSource = fs.readFileSync(new URL('./card-kind-호가.js', import.meta.url), 'utf8');

function source(name, next) {
  const start = canvas.indexOf(`function ${name}(`);
  const end = canvas.indexOf(next, start + 1);
  assert.ok(start >= 0 && end > start, name);
  return canvas.slice(start, end);
}

function envelope(symbol = '123456', fields = { sel_1bid: -101, sel_1bid_req: 7, buy_1bid: 99, buy_1bid_req: 0 }) {
  return { operation_ref: 'detail:ka10007:bid_prices', operation_args: { stk_cd: symbol },
    data: { fields: Object.entries(fields).map(([key, value]) => ({ key, value })) } };
}

function harness({ boardId = '13BC-2', deferAcquire = false } = {}) {
  const frames = [], acquisitions = [], releases = [], paints = [], callbacks = [];
  const hogaContext = { module: { exports: {} }, requestAnimationFrame: fn => frames.push(fn) };
  vm.runInNewContext(hogaSource, hogaContext);
  const hoga = hogaContext.module.exports;
  const panels = createQuoteRealtimePanelAdapter();
  const openPanel = panels.openPanel;
  panels.openPanel = (card, symbol, callback) => { callbacks.push(callback); openPanel(card, symbol, callback); };
  const mountPoint = { children: [], dataset: {}, appendChild(child) { child.parentElement = this; this.children.push(child); } };
  const surface = { isConnected: true, contains: child => mountPoint.children.includes(child) };
  const state = { boardId, surface, values: { s013: 11, s014: 12, s016: 13, s017: 14, s099: 'untouched' },
    valuesByBoard: new Map(), mountContract: {}, primaryRelease: null, primaryOrderbookEnvelope: null };
  const card = {}, host = { closest: () => card };
  const context = {
    BOARD_ORDERBOOK_RENDERER: 'orderbook-ladder', boardStateOf: () => state,
    orderbookRealtimePanels: panels, directOrderbookRealtimeSessions: new Map(),
    directOrderbookRealtimeResetters: new Set(), cardDestroyers: new Map(),
    stampOrderbookRealtimeStatus() {}, clearTimeout() {}, settleBoardChartMount() {},
    aitsChartPanels: { destroyPanel: () => false },
    releaseRendererRealtimeLease: (channel, token) => releases.push({ channel, token }),
    boardMount: {
      collapsePrimaryMockup() {},
      applyRealtimeSlots(target, contract, values, slots) { paints.push({ target, contract, values: { ...values }, slots: [...slots] }); },
    },
    window: {
      athena: { invoke: (channel, args) => {
        assert.equal(channel, 'athena:orderbook-realtime-acquire');
        const token = `synthetic-${acquisitions.length + 1}`;
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        acquisitions.push({ args, resolve: () => resolve({ ok: true, leaseToken: token }) });
        if (!deferAcquire) acquisitions.at(-1).resolve();
        return promise;
      } },
      AthenaLib: { BoardOrderbook: book, CardKindHoga: hoga, CardKinds: { resolve: () => incoming => ({
        hidden: false, style: {}, parentElement: null,
        classList: { contains: name => name === 'card-kit-hoga-live' }, querySelector: () => null,
        __athenaOrderbookState: hoga.buildOrderbookState(incoming.data.fields, incoming.operation_ref),
        remove() { mountPoint.children = mountPoint.children.filter(child => child !== this); this.parentElement = null; },
      }) } },
    },
  };
  vm.createContext(context);
  for (const [name, next] of [
    ['resolveEnvelopeSymbol', 'function releaseRendererRealtimeLease'],
    ['wireOrderbookRealtime', 'function renderMcpTable'],
    ['mountAuthoredOrderbook', 'function mountBoardOrderbook'],
    ['mountBoardOrderbook', 'async function mountBoardPrimary'],
    ['destroyBoardPrimary', 'function boardChartDescriptor'],
  ]) vm.runInContext(source(name, next), context);
  const mount = incoming => context.mountBoardOrderbook(card, state, { mountPoint }, incoming);
  return { context, state, surface, card, host, mountPoint, mount, panels, acquisitions, releases, paints, callbacks,
    authored: incoming => context.mountAuthoredOrderbook(host, incoming, { surface }),
    tick: values => panels.applyRealtimeTick(parseQuoteBookTick({ type: '0D', item: '123456', values })),
    flushFrames: () => { for (const frame of frames.splice(0)) frame(); } };
}

const flush = () => new Promise(resolve => setImmediate(resolve));
const summary = h => ['s013', 's014', 's016', 's017'].map(slot => h.state.values[slot]);

test('13BC snapshot and typed 0D partial ticks share one ladder lease, preserve zero and update the board cache', async () => {
  const h = harness(), incoming = envelope(), built = h.mount(incoming);
  h.authored(incoming);
  assert.equal(h.mount(incoming), built);
  await flush();
  assert.equal(h.acquisitions.length, 1);
  assert.equal(h.panels.size(), 1);
  assert.deepEqual(summary(h), [101, 7, 99, 0]);
  assert.equal(h.state.valuesByBoard.get('13BC-2'), h.state.values);
  assert.equal(h.state.values.s099, 'untouched');
  h.tick({ 41: '-103', 61: '0' });
  h.tick({ 71: '8' });
  assert.deepEqual(summary(h), [103, 0, 99, 8]);
  assert.equal(built.__athenaOrderbookState.asks[0].price, 101, 'ladder frame is still queued');
  // A same-envelope readiness paint must include queued partial updates, not restore the old snapshot.
  h.state.values = { s099: 'untouched' };
  h.mount(incoming);
  assert.deepEqual(summary(h), [103, 0, 99, 8]);
  assert.equal(h.state.valuesByBoard.get('13BC-2'), h.state.values);
  h.flushFrames();
  const snapshot = built.__athenaOrderbookState;
  assert.deepEqual([snapshot.asks[0].price, snapshot.asks[0].quantity, snapshot.bids[0].price, snapshot.bids[0].quantity], summary(h));
  const count = h.paints.length;
  h.tick({ 41: 'not-a-price', 62: '123' });
  assert.equal(h.paints.length, count, 'malformed/missing best-level fields do not erase summary data');
  assert.equal(h.acquisitions.length, 1);
  assert.ok(h.paints.every(paint => paint.target === h.surface && paint.contract === h.state.mountContract));
});

test('13BC missing snapshot members preserve prior values; a mismatched snapshot identity is ignored', () => {
  const h = harness();
  h.mount(envelope('123456', { sel_1bid_req: 0 }));
  assert.deepEqual(summary(h), [11, 0, 13, 14]);
  const other = harness();
  other.mount(envelope('123456', { stk_cd: '654321', sel_1bid: 555 }));
  assert.deepEqual(summary(other), [11, 12, 13, 14]);
  assert.equal(other.paints.length, 0);
});

test('13BC rejects ticks after board, surface, symbol, envelope, or DOM identity changes', async () => {
  const h = harness(), incoming = envelope(), built = h.mount(incoming);
  await flush();
  const assertIgnored = () => { const count = h.paints.length; h.tick({ 41: '888' }); assert.equal(h.paints.length, count); assert.equal(built.__athenaPendingOrderbookTick, undefined); };
  h.state.boardId = '1JPU-0'; assertIgnored(); h.state.boardId = '13BC-2';
  h.state.surface = {}; assertIgnored(); h.state.surface = h.surface;
  h.state.primaryOrderbookEnvelope = {}; assertIgnored(); h.state.primaryOrderbookEnvelope = incoming;
  incoming.operation_args.stk_cd = '654321'; assertIgnored(); incoming.operation_args.stk_cd = '123456';
  h.surface.isConnected = false; assertIgnored(); h.surface.isConnected = true;
  built.parentElement = null; assertIgnored(); built.parentElement = h.mountPoint;
  h.panels.applyRealtimeTick(parseQuoteBookTick({ type: '0D', item: '654321', values: { 41: '888' } }));
  assert.deepEqual(summary(h), [101, 7, 99, 0]);
  h.tick({ 41: '102' });
  assert.deepEqual(summary(h), [102, 7, 99, 0]);
});

test('13BC hydrate and symbol replacement release prior leases; destroy releases once and fences callbacks', async () => {
  const h = harness();
  const first = h.mount(envelope()); await flush();
  h.mount(envelope('123456', { sel_1bid: 201, sel_1bid_req: 0 })); await flush();
  assert.equal(first.parentElement, null);
  assert.equal(h.releases.length, 1);
  const third = h.mount(envelope('654321', { sel_1bid: 301, buy_1bid: 299 })); await flush();
  assert.equal(h.releases.length, 2);
  assert.equal(h.panels.size(), 1);
  const count = h.paints.length;
  for (const callback of h.callbacks.slice(0, 2)) callback(parseQuoteBookTick({ type: '0D', item: '123456', values: { 41: '999' } }));
  assert.equal(h.paints.length, count);
  h.panels.applyRealtimeTick(parseQuoteBookTick({ type: '0D', item: '654321', values: { 61: '0' } }));
  assert.equal(h.state.values.s014, 0);
  assert.equal(h.context.destroyBoardPrimary(h.state), true);
  assert.equal(h.context.destroyBoardPrimary(h.state), false);
  assert.equal(h.releases.length, 3);
  assert.equal(h.context.directOrderbookRealtimeSessions.size, 0);
  assert.equal(h.panels.size(), 0);
  h.callbacks.at(-1)(parseQuoteBookTick({ type: '0D', item: '654321', values: { 41: '999' } }));
  assert.equal(h.state.values.s013, 301);
  h.flushFrames();
  assert.equal(third.__athenaOrderbookState.asks[0].price, 301);
});

test('13BC closing before acquire completes releases the late lease without reopening or repainting', async () => {
  const h = harness({ deferAcquire: true });
  h.mount(envelope());
  h.tick({ 41: '999' });
  assert.equal(h.state.values.s013, 101, 'ticks are not accepted before acquisition');
  h.context.destroyBoardPrimary(h.state);
  h.acquisitions[0].resolve(); await flush();
  assert.equal(h.releases.length, 1);
  assert.equal(h.panels.size(), 0);
  assert.equal(h.context.directOrderbookRealtimeSessions.size, 0);
  assert.equal(h.state.values.s013, 101);
});

test('other primary ladders retain their existing feed without receiving 13BC summary mappings', async () => {
  const h = harness({ boardId: '1JPU-0' }), built = h.mount(envelope());
  h.authored(envelope()); await flush();
  h.tick({ 41: '103', 61: '0' }); h.flushFrames();
  assert.equal(built.__athenaOrderbookState.asks[0].price, 103);
  assert.equal(built.__athenaOrderbookState.asks[0].quantity, 0);
  assert.equal(h.paints.length, 0);
  assert.equal(h.acquisitions.length, 1);
  assert.deepEqual(summary(h), [11, 12, 13, 14]);
});

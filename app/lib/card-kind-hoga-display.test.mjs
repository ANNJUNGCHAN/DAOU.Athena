import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hoga = require('./card-kind-호가.js');
const source = fs.readFileSync(new URL('./card-kind-호가.js', import.meta.url), 'utf8');
const displayStart = source.indexOf('function formatNumber(');
const displayEnd = source.indexOf('// 좁은 창 반응형', displayStart);
assert.ok(displayStart > 0 && displayEnd > displayStart);
const display = vm.createContext({ LEVEL_COUNT: 10 });
vm.runInContext(source.slice(displayStart, displayEnd), display);

function fixture() {
  const cell = () => ({ textContent: '', style: {}, setAttribute() {} });
  const nodes = Object.fromEntries(['current-price', 'expected-execution', 'sell-total',
    'buy-total', 'time', 'focus', 'aux-header', 'ask-share', 'bid-share'].map(role => [role, cell()]));
  const rows = Object.fromEntries(['ask', 'bid'].map(side => [side, Array.from({ length: 10 }, () => {
    const cells = Object.fromEntries(['count', 'quantity', 'change', 'price', 'bar'].map(role => [role, cell()]));
    return { cells, querySelector: selector => cells[selector.match(/"([^"]+)"/)[1]] };
  })]));
  return { nodes, rows, wrap: {
    __athenaOrderbookRows: rows,
    querySelector: selector => nodes[selector.match(/"([^"]+)"/)[1]],
  } };
}

test('a missing zero quote renders as a dash without discarding zero quantities or raw values', () => {
  const state = hoga.buildOrderbookState([
    { key: 'sel_1bid', value: 0 }, { key: 'sel_1bid_req', value: 0 },
    { key: 'buy_1bid', value: 12345 }, { key: 'buy_1bid_req', value: 0 },
    { key: 'cur_prc', value: 0 }, { key: 'flu_rt', value: 0 },
    { key: 'exp_cntr_pric', value: 0 }, { key: 'exp_cntr_qty', value: 0 },
    { key: 'tot_sel_req', value: 0 }, { key: 'tot_buy_req', value: 0 },
    { key: 'bid_req_base_tm', value: '000000' },
  ], 'base:ka10007');
  const h = fixture();
  const before = structuredClone(state);
  display.updateOrderbookDom(h.wrap, state, false);
  assert.equal(h.rows.ask[0].cells.price.textContent, '—');
  assert.equal(h.rows.bid[0].cells.price.textContent, '12,345');
  assert.equal(h.rows.ask[0].cells.quantity.textContent, '0');
  assert.equal(h.nodes['sell-total'].textContent, '0');
  assert.equal(h.nodes['current-price'].textContent, '—');
  assert.equal(h.nodes['expected-execution'].textContent, '예상체결 — · 0주');
  assert.equal(h.nodes.time.textContent, '시각 미제공');
  assert.deepEqual(state, before);
});

test('real ticks restore quotes and format market time while preserving a later zero quantity', () => {
  const state = hoga.buildOrderbookState([], 'base:ka10007');
  const h = fixture();
  display.updateOrderbookDom(h.wrap, state, false);
  assert.equal(h.nodes.time.textContent, '수신 대기');
  hoga.mergeTickIntoState(state, { sellPrices: [12345], sellQuantities: [42], currentPrice: 12340, time: '091205' });
  display.updateOrderbookDom(h.wrap, state, false);
  assert.equal(h.rows.ask[0].cells.price.textContent, '12,345');
  assert.equal(h.nodes['current-price'].textContent, '12,340');
  assert.equal(h.nodes.time.textContent, '09:12:05');
  hoga.mergeTickIntoState(state, { sellPrices: [0], sellQuantities: [0], time: '000000' });
  display.updateOrderbookDom(h.wrap, state, false);
  assert.equal(h.rows.ask[0].cells.price.textContent, '—');
  assert.equal(h.rows.ask[0].cells.quantity.textContent, '0');
  assert.equal(state.asks[0].price, 0);
  assert.equal(state.asks[0].quantity, 0);
  assert.equal(state.time, '000000');
});

test('already formatted times and after-hours snapshot context remain intact', () => {
  const state = hoga.buildOrderbookState([], 'base:ka10087');
  state.time = '15:30:00';
  const h = fixture();
  display.updateOrderbookDom(h.wrap, state, false);
  assert.equal(h.nodes.time.textContent, '15:30:00');
  assert.equal(h.nodes['expected-execution'].textContent, 'REST 스냅샷');
});

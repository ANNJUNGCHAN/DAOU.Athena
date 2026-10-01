import test from 'node:test';
import assert from 'node:assert/strict';
import chart from './backtest-natural-chart.js';
import fakeDom from './graph-mode/fake-dom.js';

const input = { candles: [
  { dt: '2026-01-02', open: 100, high: 102, low: 99, close: 101 },
  { dt: '2026-01-05', open: 110, high: 112, low: 109, close: 111 },
  { dt: '2026-01-06', open: 999999, high: 1000000, low: 999990, close: 999995 },
] };
const snapshot = { cursor: 2, input,
  decisions: [
    { as_of: '2026-01-02', action: 'enter', request: { state: { qty: 0, pending_entry: false } } },
    { as_of: '2026-01-05', action: 'hold', request: { state: { qty: 8, pending_entry: false } } },
    { as_of: '2026-01-06', action: 'exit', request: { state: { qty: 8 } } },
  ],
  trades: [{ dt: '2026-01-05', side: 'buy', price: 110.5, qty: 8, fee: 2, tax: 0 },
    { dt: '2026-01-06', side: 'sell', price: 999995, qty: 8, fee: 999, tax: 999 }],
  equity: [{ dt: '2026-01-02', cash: 1000, equity: 1000, position_value: 0 },
    { dt: '2026-01-05', cash: 114, equity: 1002, position_value: 888 },
    { dt: '2026-01-06', cash: 9999999, equity: 9999999, position_value: 0 }],
};
const document = { createElement: fakeDom.fakeNode, createElementNS: (_ns, tag) => fakeDom.fakeNode(tag) };

test('chart geometry excludes all future candles, decisions, fills and accounting from visible prefix', () => {
  const geometry = chart.buildGeometry(snapshot);
  assert.equal(geometry.rows.length, 2);
  assert.equal(geometry.bars.length, 2);
  assert.equal(geometry.decisions.length, 2);
  assert.equal(geometry.fills.length, 1);
  assert.ok(geometry.price.max < 120);
  assert.ok(geometry.equity.max < 1010);
  assert.equal(JSON.stringify(geometry).includes('2026-01-06'), false);
  assert.equal(JSON.stringify(geometry).includes('99999'), false);
});

test('entry decision and next-bar actual fill have different x positions and recorded prices', () => {
  const geometry = chart.buildGeometry(snapshot);
  assert.equal(geometry.decisions[0].dt, '2026-01-02');
  assert.equal(geometry.fills[0].dt, '2026-01-05');
  assert.equal(geometry.fills[0].price, 110.5);
  assert.ok(geometry.decisions[0].x < geometry.fills[0].x);
  assert.equal(geometry.fills[0].y, geometry.price.y(110.5));
  assert.equal(geometry.rows[0].pending, '진입 대기');
  assert.equal(geometry.rows[1].state.qty, 8);
});

test('new session has no manufactured series and malformed missing prices never become zero', () => {
  const fresh = chart.buildGeometry({ ...snapshot, cursor: 0 });
  assert.equal(fresh.rows.length, 0);
  assert.equal(fresh.quantityPath, '');
  assert.equal(fresh.equityPath, '');
  const missing = chart.buildGeometry({ cursor: 1, input: { candles: [{ dt: 'today', open: null }] } });
  assert.equal(missing.bars.length, 0);
  assert.equal(missing.price, null);
  assert.equal(missing.equityPath, '');
  const single = chart.buildGeometry({ ...snapshot, cursor: 1 });
  assert.equal(single.bars.length, 1);
  assert.equal(/NaN|Infinity/.test(single.equityPath), false);
});

test('keyboard-accessible bar selector renders each actual ledger and never exposes future values', () => {
  const root = chart.renderChart(document, snapshot);
  assert.match(root.textContent, /보유 8주 · 현금 114원 · 평가자산 1,002원/);
  assert.match(root.textContent, /매수 체결 8주 × 110.5원 · 수수료 2원 · 세금 0원/);
  assert.equal(root.textContent.includes('2026-01-06'), false);
  const select = root.querySelector('.backtest-natural-bar-select');
  const slider = select.children[1];
  slider.value = 0;
  slider.dispatchEvent({ type: 'input' });
  const ledger = root.querySelector('.backtest-natural-bar-ledger');
  assert.match(ledger.textContent, /판단 진입 · 진입 대기/);
  assert.match(ledger.textContent, /이 봉의 모의 체결 없음/);
  assert.match(ledger.textContent, /현금 1,000원/);
});

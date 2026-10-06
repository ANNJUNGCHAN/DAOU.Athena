import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const hoga = require('./card-kind-호가.js');

function element() {
  return {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function fixture(state, embedded = true) {
  const selectors = Object.fromEntries([
    'depth', 'title', 'subtitle', 'table',
  ].map((name) => [`.card-kit-hoga-live-${name}`, element()]));
  const badge = element();
  const rows = {
    ask: Array.from({ length: state.depth }, () => ({ hidden: false })),
    bid: Array.from({ length: state.depth }, () => ({ hidden: false })),
  };
  const wrap = {
    ...element(),
    clientWidth: 0,
    __athenaOrderbookState: state,
    __athenaOrderbookRows: rows,
    querySelector: (selector) => selectors[selector] || null,
    closest(selector) {
      assert.equal(selector, '[data-node="1JPV-0"]');
      return embedded ? {
        querySelector(selector) {
          assert.equal(selector, '[data-node="1JQC-0"]');
          return badge;
        },
      } : null;
    },
  };
  return { wrap, rows, badge, selectors };
}

function regularState() {
  const fields = [{ key: 'stk_nm', value: '검증 종목' }, { key: 'stk_cd', value: '123456' }];
  for (let level = 1; level <= 10; level += 1) {
    fields.push({ key: `sel_${level}bid`, value: 10000 + level * 100 });
    fields.push({ key: `buy_${level}bid`, value: 10000 - level * 100 });
    fields.push({ key: `sel_${level}bid_req`, value: level * 1000 });
    fields.push({ key: `buy_${level}bid_req`, value: level * 2000 });
  }
  return hoga.buildOrderbookState(fields, 'base:ka10007');
}

test('좁아졌다 넓어져도 표시 단수만 바꾸고 숨은 10단 데이터와 틱을 보존한다', () => {
  const state = regularState();
  const h = fixture(state);
  for (const [width, shown] of [[0, 10], [419, 3], [420, 5], [559, 5], [560, 10]]) {
    h.wrap.clientWidth = width;
    hoga.applyResponsiveShape(h.wrap);
    for (const side of ['ask', 'bid']) {
      assert.equal(h.rows[side].filter((row) => !row.hidden).length, shown);
    }
    assert.equal(h.selectors['.card-kit-hoga-live-title'].textContent, `실시간 ${shown}단 호가`);
    assert.equal(h.selectors['.card-kit-hoga-live-depth'].textContent, `${shown}호가`);
    assert.equal(h.badge.textContent, `${shown}단 표시`);
    assert.equal(h.wrap.attributes['aria-label'], `실시간 ${shown}단 호가`);
    assert.equal(h.selectors['.card-kit-hoga-live-table'].attributes['aria-label'], `${shown}단 매도·매수 호가`);
    assert.equal(h.selectors['.card-kit-hoga-live-table'].attributes['aria-colcount'], width > 0 && width < 420 ? '2' : '5');
    assert.equal(state.depth, 10);
    assert.equal(state.asks[9].price, 11000);
    assert.equal(state.bids[9].quantity, 20000);
  }
  h.wrap.clientWidth = 375;
  hoga.applyResponsiveShape(h.wrap);
  assert.match(h.selectors['.card-kit-hoga-live-subtitle'].textContent, /전체 10단$/);
  assert.equal(h.rows.ask[9].hidden, true);
  hoga.mergeTickIntoState(state, { sellQuantities: [null, null, null, null, null, null, null, null, null, 76543] });
  h.wrap.clientWidth = 900;
  hoga.applyResponsiveShape(h.wrap);
  assert.equal(h.rows.ask[9].hidden, false);
  assert.equal(state.asks[9].quantity, 76543);
  assert.equal(h.selectors['.card-kit-hoga-live-subtitle'].textContent, '검증 종목 · 123456');
});

test('시간외는 넓혀도 실제 5단을 넘지 않고 독립 카드는 바깥 배지가 필요 없다', () => {
  const state = hoga.buildOrderbookState([], 'base:ka10087');
  const h = fixture(state, false);
  for (const [width, shown] of [[375, 3], [437, 5], [900, 5]]) {
    h.wrap.clientWidth = width;
    hoga.applyResponsiveShape(h.wrap);
    assert.equal(h.rows.ask.filter((row) => !row.hidden).length, shown);
    assert.equal(h.selectors['.card-kit-hoga-live-title'].textContent, `시간외 단일가 ${shown}단 호가`);
    assert.equal(state.depth, 5);
    assert.equal(state.liveSource, null);
  }
});

test('시간외 잔량 요약은 호가 단계나 바깥 배지를 지어내지 않는다', () => {
  const state = hoga.buildOrderbookState([], 'detail:ka10004:after_hours_totals');
  const h = fixture(state);
  h.selectors['.card-kit-hoga-live-title'].textContent = '시간외 호가 잔량';
  h.selectors['.card-kit-hoga-live-depth'].textContent = '요약';
  h.badge.textContent = '기존 표시';
  h.wrap.clientWidth = 375;
  hoga.applyResponsiveShape(h.wrap);
  assert.equal(state.depth, 0);
  assert.equal(h.selectors['.card-kit-hoga-live-title'].textContent, '시간외 호가 잔량');
  assert.equal(h.selectors['.card-kit-hoga-live-depth'].textContent, '요약');
  assert.equal(h.badge.textContent, '기존 표시');
});

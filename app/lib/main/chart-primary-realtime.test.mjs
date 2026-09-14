import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAitsChartPanelAdapter } = require('../aits-chart-panel');
const { createQuoteRealtimePanelAdapter } = require('../quote-realtime-panel');
const { normalizeSecurityTarget, parseRealFrame } = require('./chart-realtime');
const { normalizeFrameRows } = require('./integrated-card-realtime');
const { parseQuoteBookFrame } = require('./orderbook-realtime');

const AT = Date.UTC(2026, 8, 14, 3, 21, 28) / 1000;

test('A-prefixed 0B frame updates the normalized board header and AITS primary candle together', async () => {
  const frame = {
    trnm: 'REAL',
    data: [{
      type: '0B',
      item: 'A023590',
      values: { 20: '122128', 10: '-40900', 15: '+3' },
    }],
  };
  const headerRow = normalizeFrameRows(frame)[0];
  const [chartTick] = parseRealFrame(frame, '20260914');
  let renderedClose = null;
  const adapter = createAitsChartPanelAdapter({
    renderChart: async () => ({
      setData() {},
      applyChartTick(_kind, candle) { renderedClose = candle.close; },
      destroy() {},
    }),
  });
  await adapter.openPanel({}, {
    period: 'day', target: 'stock', trId: 'ka10081',
    candles: [{
      time: '2026-09-14', open: 40950, high: 40950, low: 40950, close: 40950, volume: 1,
    }],
  }, { panelId: 'aits:live:stock:023590', stock: '023590' });

  assert.equal(headerRow.target, '023590');
  assert.equal(chartTick.at, AT);
  assert.equal(await adapter.applyRealtimeTick(chartTick), 1);
  assert.equal(renderedClose, 40900);
  assert.equal(adapter.snapshot()[0].lastCandle.close, 40900);
});

test('security target normalization preserves six-character derivative identities', () => {
  assert.equal(normalizeSecurityTarget('J023590'), '023590');
  assert.equal(normalizeSecurityTarget('Q023590'), '023590');
  assert.equal(normalizeSecurityTarget('52M504'), '52M504');
  assert.equal(normalizeSecurityTarget('A52M504'), 'A52M504');
});

test('A-prefixed 0D frame reaches only the matching normalized orderbook panel', () => {
  const [tick] = parseQuoteBookFrame({
    trnm: 'REAL',
    data: [{ type: '0D', item: 'A023590', values: { 21: '122128', 41: '-40950' } }],
  });
  let received = 0;
  const adapter = createQuoteRealtimePanelAdapter();
  adapter.openPanel({}, '023590', () => { received += 1; });
  adapter.openPanel({}, '000660', () => { received += 100; });

  assert.equal(tick.symbol, '023590');
  assert.equal(adapter.applyRealtimeTick(tick), 1);
  assert.equal(received, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import rest from './rest-dataset-runner.js';
import simple from './simple-chart-fast-path.js';
import selector from './selector-fast-path.js';

const query = '키다리스튜디오 최근 3개월 일봉 차트를 보여줘.';

test('the exact natural chart question resolves its stock and paints a three-month viewport', async () => {
  const index = new rest.StockEntityIndex();
  index.replace([{ code: '020120', name: '키다리스튜디오', market: '0' }]);
  const paints = [];
  const route = await simple.runSimpleChartFastPath({
    query, index, ensureReady: async () => true,
    buildDataset: (question, stocks) => rest.buildChartDataset(question, stocks, {
      idFactory: () => 'chart-test', today: () => '20260922',
    }),
    runDataset: (dataset) => rest.runRestDataset({
      dataset, backendBase: 'http://test.invalid', backendAccountAlias: 'test',
      calendarNow: () => new Date('2026-09-22T00:00:00Z'),
      fetchImpl: async (url, options) => {
        const request = JSON.parse(options.body);
        if (url.endsWith('/resolve')) return { ok: true, json: async () => ({ plan_token: 'synthetic-plan' }) };
        const correlation = { dataset_id: request.dataset_id, item_id: request.item_id, ordinal: request.ordinal };
        return { ok: true, json: async () => ({
          delivery: 'inline', queued: false, status: 'rendered', operation_ref: 'base:ka10081',
          canvas_type: 'chart', screen_id: 'test-chart', correlation,
          envelope: { canvas_type: 'chart', screen_id: 'test-chart', correlation,
            data: { chart: { candles: [{ time: '2026-09-21', close: 100 }] } } },
        }) };
      },
      emitCanvas: async (payload) => { paints.push(payload); return { verifiedVisible: true }; },
    }),
  });
  assert.equal(route.handled, true);
  assert.equal(route.dataset.question, query);
  assert.equal(route.dataset.items[0].args.stk_cd, '020120');
  assert.equal(paints.length, 1);
  assert.equal(paints[0].envelope.data.chart.initialVisibleFrom, '2026-06-22');
  assert.equal(route.result.canvases[0].envelope.data.chart.initialVisibleFrom, '2026-06-22');
});

test('three-month viewport respects calendar boundaries and does not alter other periods', () => {
  assert.equal(selector.recentThreeMonthStart(query, new Date('2026-05-31T00:00:00Z')), '2026-02-28');
  assert.equal(selector.recentThreeMonthStart(query.replace('3개월', '6개월'), new Date()), null);
  const index = new rest.StockEntityIndex();
  index.replace([{ code: '020120', name: '키다리스튜디오', market: '0' }]);
  assert.equal(rest.buildChartDataset(query.replace('3개월', '6개월'), index), null);
  assert.equal(rest.buildChartDataset(query.replace('일봉', '주봉'), index), null);
  for (const unsupported of [
    '키다리스튜디오 최근 3개월 일봉 좀 보여줘',
    '키다리스튜디오 최근 3개월 주가 차트 보여줘',
    '키다리스튜디오 최근 3개월 차트 그려줘',
  ]) {
    assert.equal(rest.buildChartDataset(unsupported, index), null, unsupported);
  }
});

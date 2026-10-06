import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const integratedCardSurface = require('../integrated-card-surface');
const { createAitsChartPanelAdapter } = require('../aits-chart-panel');
const { createChartReloadAuthority } = require('./chart-reload');
const source = fs.readFileSync(new URL('../../canvas.js', import.meta.url), 'utf8');

function declaration(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}

test('restored daily chart remount keeps week/day/month/day reloads on the current panel and generation', async () => {
  const root = { dataset: { chartPanelId: 'restored-daily', chartGeneration: '1' }, scrollIntoView() {} };
  const reloaded = [], replacements = [];
  const adapter = createAitsChartPanelAdapter({ renderChart: () => ({
    setData() {}, destroy() {}, replaceData: (_candles, options) => replacements.push(options.period),
  }) });
  const authority = createChartReloadAuthority();
  const correlation = { dataset_id: 'remount-main-issued', item_id: 'card', ordinal: 1 };
  const targets = { day: 'base:ka10081', week: 'base:ka10082', month: 'base:ka10083' };
  const metadata = { series_scope: 'stock', reload_group: 'stock', reload_targets: Object.fromEntries(
    Object.entries(targets).map(([period, operation_ref]) => [period, { operation_ref, request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] }]),
  ) };
  const envelopeFor = period => ({ renderer_id: 'aits-chart-v1', canvas_type: 'chart', correlation,
    operation_ref: targets[period], operation_args: { stk_cd: '023590', base_dt: '20261007', upd_stkpc_tp: '1' },
    data: { symbol: '023590', chart: { period, target: 'stock', trId: targets[period].slice(5),
      candles: [{ time: '2026-10-06', open: 100, high: 110, low: 90, close: 105, volume: 50 }] }, chart_meta: metadata },
  });
  const descriptorFor = envelope => ({ panelId: 'current-remount', generation: 1, rendererId: 'aits-chart-v1',
    body: envelope.data.chart, context: { operationRef: envelope.operation_ref, operationArgs: envelope.operation_args },
  });
  const context = vm.createContext({
    integratedCardSurface, rendererRealtimeAccountGeneration: 1,
    grid: { querySelectorAll: () => [root] }, cardDestroyers: new Map(), mountedChartSessions: new Map(),
    window: { athena: { invoke() {}, send() {} } },
    retitleChartCard() {}, refreshChartSubtitle() {}, stampPaperScreen() {},
    liveChartCard: () => root,
    aitsChartPanels: adapter,
  });
  vm.runInContext(declaration('async function reloadExistingAitsChartPanel(', '// 통합 카드는 임시 카드의 body'), context);
  vm.runInContext(declaration('async function mountAitsChartPanel(', '// TR이 Paper 보드'), context);
  const daily = envelopeFor('day'), mounted = descriptorFor(daily);
  const original = descriptorFor(daily);
  original.panelId = 'restored-daily'; original.context.panelId = original.panelId; original.context.generation = 1;
  await context.mountAitsChartPanel(root, {}, original, { registerCardDestroyer: false });
  // Actual integrated metadata survives leaving the original daily panel.
  integratedCardSurface.rememberPanelSession(root, daily, root);
  assert.equal(adapter.destroyPanel('restored-daily'), true);
  mounted.context.panelId = mounted.panelId; mounted.context.generation = 1;
  await context.mountAitsChartPanel(root, {}, mounted, { registerCardDestroyer: false });
  assert.equal(root.dataset.chartPanelId, 'current-remount');
  const register = envelope => authority.registerPaint({ renderState: 'data', rendererId: 'aits-chart-v1',
    panelId: root.dataset.chartPanelId, generation: Number(root.dataset.chartGeneration) }, {
    correlation, operationRef: envelope.operation_ref, operationArgs: envelope.operation_args,
    accountId: 'mock-account', chartBody: envelope.data.chart, chartMeta: metadata,
  });
  assert.equal(register(daily), true);
  for (const [period, ui] of [['week', 'W'], ['day', 'D'], ['month', 'M'], ['day', 'D']]) {
    const request = authority.buildDataset({ panelId: root.dataset.chartPanelId, generation: Number(root.dataset.chartGeneration), period: ui });
    const envelope = envelopeFor(period);
    const rendered = await context.reloadExistingAitsChartPanel(descriptorFor(envelope), envelope, root);
    assert.equal(rendered, root, `${period} must reload the remounted card without falling back to its old panel`);
    const result = { ok: true, canvases: [{ envelope, renderState: 'data', isDataCanvas: true,
      rendererId: root.dataset.rendererId, panelId: root.dataset.chartPanelId,
      generation: Number(root.dataset.chartGeneration), operationRef: envelope.operation_ref }] };
    assert.doesNotThrow(() => authority.acceptResult(request, result));
    assert.equal(register(envelope), true);
    const active = adapter.snapshot()[0];
    assert.equal(active.panelId, 'current-remount');
    assert.equal(active.period, period);
    assert.equal(active.generation, Number(root.dataset.chartGeneration));
    reloaded.push([active.period, active.generation]);
  }
  for (const period of Object.keys(targets)) {
    assert.equal(integratedCardSurface.panelSessionFor(root, envelopeFor(period)).panelId, 'current-remount');
  }
  assert.deepEqual(reloaded, [['week', 2], ['day', 3], ['month', 4], ['day', 5]]);
  assert.deepEqual(replacements, ['W', 'D', 'M', 'D']);
  assert.equal(adapter.snapshot().length, 1);
});

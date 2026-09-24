import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import SpecModel from './backtest-spec.js';

const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
const declared = {
  fast: { default: 20, min: 5, max: 30, step: 5, type: 'int' },
  slow: { default: 60, min: 40, max: 120, step: 20, type: 'int' },
};

function harness() {
  let request;
  const states = [];
  const context = vm.createContext({ spec: SpecModel.createSpec(null, {
    params: declared, symbols: ['005930'], fromDt: '20260101', toDt: '20260108',
  }), SpecModel, runPath: 'code',
    workspaceGeneration: 1, userStrategyId: 'registered', userStrategies: [], codeSource: 'stale buffer',
    state: {}, setState: patch => states.push(patch), currentYaml: () => 'yaml body',
    projectIde: { isDirty: () => false, currentProject: () => ({ id: 'owner-project' }) },
    activeProjectFile: () => ({ path: 'nested/strategy.py' }), runsPickedStrategy: () => true,
    projectFileText: async () => 'saved file signals code',
    deps: { optimize: async body => { request = body; return { trials: [] }; } },
  });
  const start = source.indexOf('  async function runOptimize()');
  const end = source.indexOf('  async function applyBestParams()', start);
  vm.runInContext(source.slice(source.indexOf('  function codeRuns()'),
    source.indexOf('  async function handleRun(')), context);
  vm.runInContext(source.slice(start, end), context);
  return { context, states, request: () => request };
}

test('registered strategy selection preserves full declared metadata and its exact thirty-point search grid', async () => {
  const h = harness();
  // Run the actual registration-to-spec mapping, not a separately reimplemented mapping.
  h.context.entry = { name: 'SMA-CROSS-GRID-30', params: { fast: 20, slow: 60 }, param_specs: declared };
  h.context.SpecModel = SpecModel;
  h.context.keptTarget = () => ({ symbols: ['005930'], fromDt: '20260101', toDt: '20260108' });
  const start = source.indexOf('    const params = {};', source.indexOf('async function selectUserStrategy'));
  const end = source.indexOf('    userStrategyId = entry.id;', start);
  vm.runInContext(source.slice(start, end), h.context);
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.spec.params)), declared);
  await h.context.runOptimize();
  const body = JSON.parse(JSON.stringify(h.request()));
  assert.deepEqual(body.ranges, [
    { name: 'fast', start: 5, stop: 30, step: 5, is_int: true },
    { name: 'slow', start: 40, stop: 120, step: 20, is_int: true },
  ]);
  assert.equal(body.source, 'saved file signals code');
  assert.equal(body.project_id, 'owner-project');
  assert.equal(body.ascending, undefined);
});

test('dirty or mismatched Python files cannot execute against stale parameters', async () => {
  for (const reason of ['dirty', 'mismatch']) {
    const h = harness();
    if (reason === 'dirty') h.context.projectIde.isDirty = () => true;
    else h.context.runsPickedStrategy = () => false;
    await h.context.runOptimize();
    assert.equal(h.request(), undefined);
    assert.ok(h.states.at(-1).optimizeError);
    assert.equal(h.states.at(-1).optimizeBusy, false);
  }
});

test('restored guessed ranges yield to current registered PARAMS declarations', () => {
  const h = harness();
  h.context.spec = { params: { fast: { min: 0, max: 80, step: 1, type: 'int' } } };
  h.context.userStrategies = [{ id: 'registered', param_specs: declared }];
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.optimizeRanges())), [
    { name: 'fast', start: 5, stop: 30, step: 5, is_int: true },
    { name: 'slow', start: 40, stop: 120, step: 20, is_int: true },
  ]);
});

test('YAML optimizer keeps its existing payload and coarsening', async () => {
  const h = harness();
  h.context.runPath = 'form';
  h.context.spec.params = { fast: { min: 0, max: 80, step: 1, type: 'int' }, slow: declared.slow };
  h.context.spec.entry.conditions = [{ indicator: 'close', operator: 'greater_than', compare_to: 0 }];
  h.context.spec.exit.conditions = [{ indicator: 'close', operator: 'less_than', compare_to: 0 }];
  await h.context.runOptimize();
  assert.equal(h.request().source, undefined);
  assert.equal(h.request().ranges[0].step, 8);
  assert.deepEqual(Array.from(h.request().ascending), ['fast', 'slow']);
});

test('missing or invalid execution data opens the form with Korean guidance before any optimize request', async () => {
  for (const data of [
    { symbols: [], fromDt: '', toDt: '' },
    { symbols: ['005930', '000660'], fromDt: '20260101', toDt: '20260108' },
    { symbols: ['005930'], fromDt: '20260108', toDt: '20260101' },
  ]) {
    const h = harness();
    Object.assign(h.context.spec, data);
    await h.context.runOptimize();
    assert.equal(h.request(), undefined);
    const state = h.states.at(-1);
    assert.equal(state.view, 'design');
    assert.equal(state.tab, 'design');
    assert.equal(state.designTab, 'form');
    assert.equal(state.optimizeBusy, false);
    assert.equal(state.optimizeError, '');
    assert.ok(state.formErrors[0].includes('종목·기간'));
    assert.ok(state.formErrors.length >= 2);
    assert.ok(!state.formErrors.some(line => /ValidationError|진입 조건|청산 조건/.test(line)));
    Object.assign(h.context.spec, { symbols: ['005930'], fromDt: '20260101', toDt: '20260108' });
    await h.context.runOptimize();
    assert.ok(h.request());
  }
});

test('the result apply button updates visible sliders and next Python run overrides', async () => {
  const h = harness();
  const nodes = [];
  const el = (_tag, className, text) => {
    const node = { className, textContent: text, children: [], listeners: {},
      appendChild(child) { this.children.push(child); }, setAttribute() {},
      addEventListener(event, fn) { this.listeners[event] = fn; } };
    nodes.push(node);
    return node;
  };
  Object.assign(h.context, { el, MODE_TABS: [['design', '기법']], formatRatioValue: String });
  for (const [start, end] of [
    ['function button(className, text, onClick)', '// ---------- 순수 계산'],
    ['  async function applyBestParams()', '  async function loadDeployments()'],
    ['  function renderOptimizeResult(res)', '  function renderHeatmap(map)'],
    ['  function renderParamSlider(name, p)', '  function renderRiskCard()'],
    ['  async function startRun(allowPartial)', '  async function confirmBackfill()'],
  ]) {
    const from = source.indexOf(start);
    vm.runInContext(source.slice(from, source.indexOf(end, from)), h.context);
  }
  h.context.state.optimizeResult = { best: { params: { fast: 15, slow: 40 }, sharpe: 1.37 } };
  h.context.renderOptimizeResult(h.context.state.optimizeResult);
  nodes.find(node => node.className === 'backtest-optimize-apply').listeners.click();
  assert.equal(h.context.spec.params.fast.default, 15);
  assert.equal(h.context.spec.params.slow.default, 40);
  assert.equal(h.states.at(-1).designTab, 'form');
  h.context.renderParamSlider('fast', h.context.spec.params.fast);
  h.context.renderParamSlider('slow', h.context.spec.params.slow);
  assert.deepEqual(nodes.filter(node => node.className === 'backtest-param-slider').map(node => node.value), ['15', '40']);
  let sent;
  h.context.deps.run = async body => { sent = body; return { blocked: true }; };
  await h.context.startRun(false);
  assert.deepEqual(JSON.parse(JSON.stringify(sent.params)), { fast: 15, slow: 40 });
  assert.equal(sent.source, 'saved file signals code');
});

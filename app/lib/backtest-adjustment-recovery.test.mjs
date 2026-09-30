import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import canvas from './backtest-canvas.js';
import bridge from './main/backtest-bridge.js';

const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
function declaration(name, async = false) {
  const start = source.indexOf(`  ${async ? 'async ' : ''}function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function element(tag, className, text = '') {
  return { tag, className, textContent: text, children: [], listeners: {},
    appendChild(child) { this.children.push(child); }, setAttribute() {},
    addEventListener(event, handler) { this.listeners[event] = handler; } };
}
function flatten(node) { return [node, ...node.children.flatMap(flatten)]; }
const settle = () => new Promise(resolve => setImmediate(resolve));
const recovery = () => ({ stk_cd: '005930', period: 'day', adjusted: true,
  from_dt: '20240101', to_dt: '20260930', mismatch_dates: ['20260929'], estimated_pages: 4, est_seconds: 2.4 });
const mismatch = () => ({ status: 'failed', error: 'adjustment detected: raw diagnostic',
  error_code: 'ADJUSTMENT_DETECTED', recovery: recovery() });
function harness(first = mismatch()) {
  const calls = [], runs = [], timers = [];
  const container = element('div', 'container');
  const context = vm.createContext({
    state: { view: 'running', jobId: 'old-job' }, spec: { symbols: ['005930'], period: 'day',
      adjusted: true, fromDt: '20260101', toDt: '20260930' }, workspaceGeneration: 1,
    pollTimer: null, stopPolling() {}, isVisible: () => true, schedulePoll: tick => timers.push(tick),
    mounted: true, syncChatTechniqueAttr() {}, coverageKey: () => null, coverageAsked: null,
    clear: node => { node.children = []; }, container, el: element,
    errorStateBadge: canvas.errorStateBadge, ERROR_BADGE_DISABLED: '비활성',
    CRUMB_HOME_LABEL: '⌂ 팔라스 홈', MODE_TABS: canvas.MODE_TABS,
    formatNumeric: String, draftValueText: (_key, value) => value === 'day' ? '일봉' : String(value),
    goHome() {}, loadPresets() {}, coverageRatio: () => 0.5, cancelApproval() {},
    setState(patch) { context.state = { ...context.state, ...patch }; if (context.state.view === 'error') context.render(); },
    startRun: async allowPartial => { runs.push({ allowPartial, spec: structuredClone(context.spec) }); },
    deps: {
      backfill: async body => { calls.push(JSON.parse(JSON.stringify(body))); return { job_id: 'refresh-job' }; },
      status: async ({ job_id }) => job_id === 'old-job' ? first : { status: 'running' },
    },
  });
  const constant = source.match(/^const ADJUSTMENT_DETECTED_TEXT = .+;$/m)[0];
  const buttonStart = source.indexOf('function button(');
  const buttonEnd = source.indexOf('\n}', buttonStart) + 2;
  vm.runInContext([constant, source.slice(buttonStart, buttonEnd),
    ...['backfillTarget', 'currentAdjustmentRecovery', 'pollJob', 'renderAdjustmentRecovery', 'renderMessagePanel', 'render', 'renderApproval', 'fail'].map(name => declaration(name)),
    ...['confirmFullRefresh', 'confirmBackfill', 'startBackfill'].map(name => declaration(name, true)),
  ].join('\n'), context);
  return { context, calls, runs, timers, nodes: () => flatten(container),
    async failCollection() { context.pollJob(); await settle(); },
    refreshButton() { return flatten(container).find(node => node.className === 'backtest-adjustment-refresh'); } };
}

test('price mismatch stops and explains preserved data, expanded range and quota cost before any approval', async () => {
  const h = harness();
  await h.failCollection();
  assert.equal(h.context.state.view, 'error');
  const text = h.nodes().map(node => node.textContent).join('\n');
  assert.match(text, /저장된 종가와 새로 조회한 종가가 달라/);
  assert.match(text, /원인은 아직 확인되지 않았습니다/);
  assert.match(text, /원본도 별도로 보관/);
  assert.match(text, /005930.*일봉.*수정주가 켬.*20240101 ~ 20260930/);
  assert.match(text, /불일치 날짜 · 20260929/);
  assert.match(text, /예상 API 호출 · 4회.*2.4초/);
  assert.match(text, /호출 한도를 추가로 사용/);
  assert.doesNotMatch(text, /adjustment detected|권리락/);
  assert.equal(h.refreshButton().textContent, '전체 구간 다시 수집하고 실행');
  assert.equal(h.calls.length, 0);
  assert.equal(h.runs.length, 0);
});

test('explicit refresh sends the displayed union once, polls it, then runs the original requested period', async () => {
  const h = harness();
  await h.failCollection();
  h.context.deps.status = async () => ({ status: 'done' });
  const button = h.refreshButton();
  button.listeners.click();
  button.listeners.click();
  await settle();
  assert.deepEqual(h.calls, [{ stk_cd: '005930', period: 'day', adjusted: true,
    from_dt: '20240101', to_dt: '20260930', full_refresh: true }]);
  assert.equal(h.runs.length, 1);
  assert.equal(h.runs[0].allowPartial, false);
  assert.equal(h.runs[0].spec.fromDt, '20260101');
  assert.equal(h.context.state.adjustmentRecovery, null);
  assert.equal(h.context.state.neededPages, 4);
});

test('ordinary collection never enables full refresh implicitly', async () => {
  const h = harness();
  await h.context.confirmBackfill();
  await settle();
  assert.deepEqual(h.calls, [{ stk_cd: '005930', period: 'day', adjusted: true,
    from_dt: '20260101', to_dt: '20260930' }]);
  assert.equal(h.runs.length, 0);
});

test('generic failures and cancellation retain their message without offering destructive recovery', async () => {
  for (const status of ['failed', 'cancelled']) {
    const h = harness({ status, error: '연결 시간이 초과됐습니다',
      ...(status === 'cancelled' ? { error_code: 'ADJUSTMENT_DETECTED', recovery: recovery() } : {}) });
    await h.failCollection();
    assert.equal(h.context.state.message, '연결 시간이 초과됐습니다');
    assert.equal(h.refreshButton(), undefined);
    assert.equal(h.calls.length, 0);
  }
});

test('incomplete, mismatched or stale recovery metadata cannot authorize another series or range', async () => {
  for (const invalid of [null, { ...recovery(), stk_cd: '000660' }, { ...recovery(), adjusted: false },
    { ...recovery(), from_dt: '20260601' }, { ...recovery(), to_dt: '20260830' },
    { ...recovery(), estimated_pages: null }, { ...recovery(), est_seconds: NaN }]) {
    const h = harness({ ...mismatch(), recovery: invalid });
    await h.failCollection();
    assert.equal(h.refreshButton(), undefined);
    assert.match(h.context.state.message, /기존 데이터는 보존/);
    assert.equal(h.calls.length, 0);
  }
  for (const invalidate of [
    c => { c.spec.fromDt = '20260201'; },
    c => { c.workspaceGeneration++; },
    c => { c.state.jobId = 'other-job'; },
    c => { c.state.view = 'design'; },
    c => { c.state.adjustmentRecovery.recovery = recovery(); },
  ]) {
    const h = harness();
    await h.failCollection();
    const oldButton = h.refreshButton();
    invalidate(h.context);
    oldButton.listeners.click();
    await settle();
    assert.equal(h.calls.length, 0);
  }
});

test('late polling after cancellation cannot restore approval or resume execution', async () => {
  let resolveStatus;
  const h = harness();
  h.context.deps.status = () => new Promise(resolve => { resolveStatus = resolve; });
  h.context.pollJob();
  h.context.state = { view: 'design', jobId: null };
  resolveStatus(mismatch());
  await settle();
  assert.equal(h.context.state.view, 'design');
  assert.equal(h.context.state.adjustmentRecovery, undefined);
  assert.equal(h.calls.length + h.runs.length + h.timers.length, 0);
});

test('failed refresh preserves its error flow and never starts a backtest', async () => {
  const h = harness();
  await h.failCollection();
  h.context.deps.status = async () => ({ status: 'failed', error: '전체 재수집 검증 실패: 기존 데이터는 보존되었습니다' });
  h.refreshButton().listeners.click();
  await settle();
  assert.match(h.context.state.message, /기존 데이터는 보존/);
  assert.equal(h.refreshButton(), undefined);
  assert.equal(h.calls.length, 1);
  assert.equal(h.runs.length, 0);
});

test('full_refresh survives the actual renderer adapter and REST bridge', async () => {
  const adapterSource = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
  const posted = [];
  const adapterContext = vm.createContext({ window: { athena: { invoke: async (channel, body) => {
    assert.equal(channel, 'athena:backtest-backfill');
    return bridge.backfillBacktest({ backendBase: 'http://synthetic-backend', ...body,
      fetchImpl: async (url, options) => { posted.push({ url, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ job_id: 'refresh-job' }) }; },
    });
  } } }, backtestError: () => 'unexpected error' });
  const start = adapterSource.indexOf('  backfill: async (params) => {');
  const end = adapterSource.indexOf('\n  },', start) + 5;
  const h = harness();
  h.context.deps.backfill = vm.runInContext(`({${adapterSource.slice(start, end)}}).backfill`, adapterContext);
  await h.failCollection();
  h.refreshButton().listeners.click();
  await settle();
  assert.equal(posted[0].url, 'http://synthetic-backend/api/v1/backtest/data/backfill');
  assert.deepEqual(posted[0].body, { stk_cd: '005930', period: 'day', adjusted: true,
    from_dt: '20240101', to_dt: '20260930', full_refresh: true });
});

test('initial approval describes stopping on mismatch and asks before full refresh', () => {
  const h = harness();
  const text = flatten(h.context.renderApproval()).map(node => node.textContent).join('\n');
  assert.match(text, /기존 데이터를 보존하고 중단/);
  assert.match(text, /직접 승인/);
  assert.doesNotMatch(text, /권리락|전체를 다시 받고/);
});

test('pending mismatch cannot attach recovery to an edited target or a different technique screen', async () => {
  for (const change of [
    c => { c.state.view = 'design'; c.spec.fromDt = '20260301'; },
    c => { c.spec.fromDt = '20260301'; },
    c => { c.state.view = 'design'; },
  ]) {
    let resolveStatus;
    const h = harness();
    h.context.deps.status = () => new Promise(resolve => { resolveStatus = resolve; });
    await h.context.confirmBackfill();
    const requestedTarget = h.context.state.backfillTarget;
    change(h.context);
    resolveStatus(mismatch());
    await settle();
    assert.equal(requestedTarget.from_dt, '20260101', 'job keeps its original requested period');
    assert.equal(h.context.state.adjustmentRecovery, null);
    assert.notEqual(h.context.state.view, 'error');
    assert.equal(h.runs.length, 0);
    assert.equal(h.timers.length, 0);
  }
});

test('full refresh completion cannot auto-run a changed target or a screen that left running', async () => {
  for (const change of [
    c => { c.state.view = 'design'; c.spec.fromDt = '20260301'; },
    c => { c.spec.fromDt = '20260301'; },
    c => { c.state.view = 'design'; },
  ]) {
    let resolveStatus;
    const h = harness();
    await h.failCollection();
    h.context.deps.status = () => new Promise(resolve => { resolveStatus = resolve; });
    h.refreshButton().listeners.click();
    await settle();
    assert.equal(h.context.state.backfillTarget.from_dt, '20260101');
    change(h.context);
    resolveStatus({ status: 'done' });
    await settle();
    assert.equal(h.runs.length, 0);
    assert.equal(h.timers.length, 0);
    assert.equal(h.calls.length, 1);
  }
});

test('late backfill acknowledgement does not adopt a job after navigation or a target edit', async () => {
  for (const change of [
    c => { c.state.view = 'design'; },
    c => { c.spec.fromDt = '20260301'; },
  ]) {
    let acknowledge;
    let statusCalls = 0;
    const h = harness();
    h.context.deps.backfill = () => new Promise(resolve => { acknowledge = resolve; });
    h.context.deps.status = async () => { statusCalls++; return { status: 'done' }; };
    const request = h.context.confirmBackfill();
    change(h.context);
    acknowledge({ job_id: 'late-job' });
    await request;
    assert.equal(h.context.state.jobId, null);
    assert.equal(statusCalls, 0);
    assert.equal(h.runs.length, 0);
  }
});

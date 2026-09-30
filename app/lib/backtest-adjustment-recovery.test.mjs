import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import canvas from './backtest-canvas.js';
import bridge from './main/backtest-bridge.js';
import accountBoundDataset from './main/account-bound-dataset.js';

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
const mainSource = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8');
function mainDeclaration(signature) {
  const start = mainSource.indexOf(signature);
  assert.notEqual(start, -1);
  return mainSource.slice(start, mainSource.indexOf('\n}', start) + 2);
}
function mainBackfillHarness({ activeId = 'selected-account', waitForBackendUrl,
  resolveBackendAlias, fetchImpl } = {}) {
  const requests = [], resolutions = [], events = [];
  let selected = activeId, activeReads = 0, handler;
  const context = vm.createContext({
    backtestBridge: bridge, accountBoundDataset, realtimeAccountGeneration: 1,
    BACKEND_HTTP_BASE: 'http://stale-backend', backendAccountAuthorization: () => 'synthetic-authorization',
    backendLauncher: { STARTUP_HARD_TIMEOUT_MS: 100 },
    backendEndpoint: { waitForBackendUrl: async options => {
      events.push('endpoint');
      assert.equal(options.timeoutMs, 5100);
      return waitForBackendUrl ? waitForBackendUrl() : 'http://synthetic-backend';
    } },
    accounts: {
      list: () => { activeReads++; return { accounts: selected ? [{ id: selected, active: true }] : [] }; },
      resolveBackendAlias: async options => {
        events.push('sync'); resolutions.push(options);
        return resolveBackendAlias ? resolveBackendAlias(options) : { ok: true, backendAlias: 'bound-account' };
      },
    },
    fetch: async (url, options) => {
      events.push('request');
      requests.push({ url, options, body: options.body === undefined ? undefined : JSON.parse(options.body) });
      return fetchImpl ? fetchImpl(url, options) : { ok: true, json: async () => ({ job_id: 'refresh-job' }) };
    },
    ipcMain: { handle: (channel, fn) => { assert.equal(channel, 'athena:backtest-backfill'); handler = fn; } },
    attachSessionJob() {},
  });
  const ipcStart = mainSource.indexOf("ipcMain.handle('athena:backtest-backfill'");
  const ipcEnd = mainSource.indexOf('\n});', ipcStart) + 4;
  vm.runInContext([
    mainDeclaration('async function callBacktestBridge('),
    mainDeclaration('function activeRestAccountId('),
    mainDeclaration('function createActiveBackendAccountInvoker('),
    mainSource.slice(ipcStart, ipcEnd),
  ].join('\n'), context);
  return { context, requests, resolutions, events, invoke: body => handler(null, body),
    get activeReads() { return activeReads; },
    changeAccount(id) { selected = id; context.realtimeAccountGeneration++; } };
}

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

test('full_refresh survives the actual renderer adapter, main IPC, account binding and REST bridge', async () => {
  const adapterSource = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
  const main = mainBackfillHarness();
  const adapterContext = vm.createContext({ window: { athena: { invoke: async (channel, body) => {
    assert.equal(channel, 'athena:backtest-backfill');
    return main.invoke(body);
  } } }, backtestError: () => 'unexpected error' });
  const start = adapterSource.indexOf('  backfill: async (params) => {');
  const end = adapterSource.indexOf('\n  },', start) + 5;
  const h = harness();
  h.context.deps.backfill = vm.runInContext(`({${adapterSource.slice(start, end)}}).backfill`, adapterContext);
  await h.failCollection();
  h.refreshButton().listeners.click();
  await settle();
  assert.equal(main.requests[0].url, 'http://synthetic-backend/api/v1/backtest/data/backfill');
  assert.deepEqual(main.requests[0].body, { stk_cd: '005930', period: 'day', adjusted: true,
    from_dt: '20240101', to_dt: '20260930', full_refresh: true });
  assert.equal(main.requests[0].options.headers['X-Athena-Account'], 'bound-account');
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


test('first backfill waits for the endpoint and syncs the selected account before posting with its binding', async () => {
  const h = mainBackfillHarness();
  const result = await h.invoke({ stk_cd: '005930', full_refresh: true,
    backendAccountAlias: 'renderer-supplied-account', backendBase: 'http://renderer-supplied', fetchImpl: 'ignored' });
  assert.equal(result.ok, true);
  assert.deepEqual(h.events, ['endpoint', 'sync', 'request']);
  assert.equal(h.resolutions.length, 1);
  assert.equal(h.resolutions[0].id, 'selected-account');
  assert.equal(h.resolutions[0].backendBase, 'http://synthetic-backend', 'sync uses the ready endpoint, not stale global state');
  assert.equal(h.resolutions[0].authorization, 'synthetic-authorization');
  assert.equal(h.resolutions[0].fetchImpl, h.context.fetch);
  assert.equal(h.requests[0].url, 'http://synthetic-backend/api/v1/backtest/data/backfill');
  assert.equal(h.requests[0].options.headers['X-Athena-Account'], 'bound-account');
  assert.deepEqual(h.requests[0].body, { stk_cd: '005930', full_refresh: true });
});

test('backfill fails closed without an active account or when its runtime sync fails', async () => {
  const absent = mainBackfillHarness({ activeId: '' });
  const missing = await absent.invoke({ stk_cd: '005930' });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 503);
  assert.match(missing.error, /계좌.*선택/);
  assert.equal(absent.resolutions.length + absent.requests.length, 0);
  const h = mainBackfillHarness({ resolveBackendAlias: async () => ({ ok: false, error: '선택 계좌 연결 실패' }) });
  const failed = await h.invoke({ stk_cd: '005930' });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 503);
  assert.equal(failed.error, '선택 계좌 연결 실패');
  assert.deepEqual(h.events, ['endpoint', 'sync']);
  assert.equal(h.requests.length, 0);
});

test('account changes during endpoint readiness or runtime sync prevent the backfill POST', async () => {
  for (const stage of ['endpoint', 'sync']) {
    for (const returnToOriginal of [false, true]) {
      let release;
      const pause = () => new Promise(resolve => { release = resolve; });
      const h = mainBackfillHarness(stage === 'endpoint'
        ? { waitForBackendUrl: pause } : { resolveBackendAlias: pause });
      const pending = h.invoke({ stk_cd: '005930' });
      await settle();
      h.changeAccount('other-account');
      if (returnToOriginal) h.changeAccount('selected-account');
      release(stage === 'endpoint' ? 'http://synthetic-backend' : { ok: true, backendAlias: 'old-account' });
      const result = await pending;
      assert.equal(result.ok, false);
      assert.equal(result.status, 503);
      assert.match(result.error, /계좌가 변경/);
      assert.equal(h.requests.length, 0);
      assert.equal(h.resolutions.length, stage === 'endpoint' ? 0 : 1);
    }
  }
});

test('cached backtest routes never read or sync accounts and preserve request failures', async () => {
  const h = mainBackfillHarness({ activeId: '', resolveBackendAlias: () => { throw new Error('unexpected sync'); } });
  for (const [call, body] of [
    [bridge.fetchPresets, {}], [bridge.planBacktest, { stk_cd: '005930' }],
    [bridge.runBacktest, { yaml: 'cached-strategy' }], [bridge.fetchJobStatus, { job_id: 'job' }],
    [bridge.fetchRunResult, { run_id: 'run' }], [bridge.fetchRunTrades, { run_id: 'run' }], [bridge.fetchRuns, {}],
  ]) assert.equal((await h.context.callBacktestBridge(call, body)).ok, true);
  assert.equal(h.requests.length, 7);
  assert.equal(h.activeReads + h.resolutions.length, 0);
  for (const request of h.requests) assert.equal(request.options.headers?.['X-Athena-Account'], undefined);
  const detail = { message: '캐시 부족', needed_pages: 2 };
  const failure = mainBackfillHarness({ fetchImpl: async () => ({ ok: false, status: 409, json: async () => ({ detail }) }) });
  const result = await failure.context.callBacktestBridge(bridge.runBacktest, {});
  assert.equal(result.status, 409);
  assert.equal(result.detail, detail);
  assert.equal(result.error, detail.message);
});

test('backfill requires a valid bound alias and retains existing transport error envelopes', async () => {
  for (const backendAccountAlias of [undefined, '', 'BAD ALIAS', 'a'.repeat(33)]) {
    const result = await bridge.backfillBacktest({ backendBase: 'http://synthetic-backend', backendAccountAlias,
      fetchImpl: async () => { assert.fail('invalid alias must not reach fetch'); } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  }
  const failedEndpoint = mainBackfillHarness({ waitForBackendUrl: async () => { throw new Error('backend timeout'); } });
  const endpointResult = await failedEndpoint.invoke({});
  assert.equal(endpointResult.status, 0);
  assert.equal(endpointResult.error, 'backend timeout');
  assert.equal(failedEndpoint.resolutions.length + failedEndpoint.requests.length, 0);
  const failedRequest = mainBackfillHarness({ fetchImpl: async () => { throw new Error('socket closed'); } });
  const requestResult = await failedRequest.invoke({});
  assert.equal(requestResult.status, 0);
  assert.equal(requestResult.error, 'socket closed');
  assert.deepEqual(failedRequest.events, ['endpoint', 'sync', 'request']);
});

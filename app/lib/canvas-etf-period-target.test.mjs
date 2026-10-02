import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('./board-template-registry');
const controls = require('./ranking-board-controls');
const boardMount = require('./board-mount');
const period = require('./board-etf-period');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const cacheKeys = ['valuesByBoard', 'unboundByBoard', 'hydrationByBoard', 'realtimeByBoard',
  'emptyRowsByBoard', 'emptyColumnsByBoard', 'emptyValueSlotsByBoard', 'deferredValueSlotsByBoard'];
const oldEnvelope = () => ({ stk_cd: '123456', stk_nm: '이전 종목', operation_ref: 'base:ka40004',
  operation_args: { stk_cd: '123456', dt: '1' } });

function fixture(code = '654321_AL', name = '합성 ETF') {
  const state = { boardId: '2VIN-0', values: { s387: code, s386: name }, links: registry.stateLinksFor('2VIN-0'),
    load: boardMount.createLatestBoardLoad(), hydrationWarnings: [] };
  for (const key of cacheKeys) state[key] = new Map([
    ['2WZK-0', { s004: '이전 ETF', s017: 99 }], ['2VIN-0', state.values], ['15N5-2', 'other detail'],
  ]);
  const host = { __athenaBoard: state, scrollTop: 0 }, requests = [], notices = [], remounts = [];
  const context = vm.createContext({
    rankingBoardControls: controls, boardTemplateRegistry: registry, boardStateOf: () => state,
    cardStkCd: envelope => envelope.stk_cd || '', realtimeBindingsOf: () => [],
    boardMount: { ...boardMount, mountBoard: (_host, id, values, options) => {
      const plan = boardMount.mountPlan(registry.contractFor(id), values, options);
      const mounted = { plan, model: period.modelFor(plan, options) };
      remounts.push(mounted); return mounted;
    } },
    destroyBoardPrimary() {}, showBoardLoading() {}, showBoardReady: async () => {}, showBoardLoadError() {},
    rememberMountedBoard() {}, wireMountedBoardControls() {}, boardHydrateAccount: () => '',
    RETRYABLE_BOARD_HYDRATE_REASONS: new Set(['unavailable']),
    mountBoardState: (_host, id, envelope) => {
      const clearedCaches = cacheKeys.filter(key => !state[key].has(id));
      context.activateBoardState(state, id);
      state.links = registry.stateLinksFor(id);
      const options = context.boardMountOptions(host, envelope);
      const plan = boardMount.mountPlan(registry.contractFor(id), state.values, options);
      requests.push({ id, target: options.operationArgs, identity: options.identity,
        model: period.modelFor(plan, options), clearedCaches, options });
      return { plan };
    },
    errorNote: text => ({ text, classList: { add() {} }, setAttribute() {}, remove() {} }),
    boardLoadAnchor: () => ({ insertBefore: note => notices.push(note.text) }),
  });
  for (const [start, end] of [
    ['const RANKING_BOARD_OPERATIONS =', 'function boardHydrateAccount('],
    ['function activateBoardState(', 'function boardMountOptions('],
    ['function boardMountOptions(', '// 봉투가 실어온 계약'],
    ['function closeParentRankingFilter(', 'function wireStateControls('],
    ['function selectEtfReturnPeriod(', 'function selectRankingFilter('],
    ['function runBoardSurfaceLoad(', 'function renderBoardSurfaceCard('],
    ['async function hydrateBoardSlots(', '// 마운트 결과에서'],
  ]) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    vm.runInContext(source.slice(a, b), context);
  }
  return { context, state, host, requests, notices, remounts,
    open: envelope => context.switchStateBoard(host, '2WZK-0', envelope, '기간 수익률') };
}

test('ETF period action uses the received first row for hydration and loading identity, including venue suffixes', async () => {
  assert.ok(registry.directStateLinksFor('2VIN-0').some(link => link.control === '기간 수익률' && link.board_id === '2WZK-0'));
  for (const code of ['654321', '654321_AL', { value: ' 654321_NX ', observation_id: 'synthetic-row' }]) {
    const f = fixture(code, { value: ' 합성 ETF ' }), envelope = oldEnvelope(), before = JSON.stringify(envelope);
    await f.open(envelope);
    const request = f.requests[0];
    assert.equal(request.id, '2WZK-0');
    assert.equal(request.target.stk_cd, '654321');
    assert.equal(request.target.dt, '1');
    assert.equal(request.identity.name, '합성 ETF');
    assert.equal(request.model.target, '합성 ETF · 654321');
    assert.deepEqual(request.clearedCaches, cacheKeys);
    for (const key of cacheKeys) assert.equal(f.state[key].get('15N5-2'), 'other detail');
    assert.equal(f.state.etfDetailIdentity, undefined);
    assert.equal(JSON.stringify(envelope), before);
  }
});

test('period action rejects malformed or absent list codes instead of silently reusing the old stock', () => {
  for (const code of [undefined, '', '000000', '000000_AL', 654321, '654321|123456', '654321_AL_AL',
    '654321 · 1위', ['654321'], { value: '654321', missing: 'unavailable' }, { text: '654321' }]) {
    const f = fixture(code);
    // An earlier successful visit is also not a substitute for the current missing row.
    f.state.etfReturnIdentity = { code: '111111', name: '이전 ETF' };
    f.state.values.s387 = code;
    assert.equal(f.open(oldEnvelope()), null);
    assert.equal(f.requests.length, 0);
    assert.equal(f.state.boardId, '2VIN-0');
    assert.equal(f.state.etfReturnIdentity.code, '111111');
    assert.match(f.notices[0], /ETF 목록 첫 행의 종목코드/);
    assert.equal(f.state.valuesByBoard.get('2WZK-0').s004, '이전 ETF');
  }
});

test('a refreshed first ETF invalidates period caches and missing names never borrow the prior envelope name', async () => {
  const f = fixture(); await f.open(oldEnvelope());
  for (const key of cacheKeys) f.state[key].set('2WZK-0', { s004: '첫 ETF', s017: 99 });
  f.state.boardId = '2VIN-0'; f.state.links = registry.stateLinksFor('2VIN-0');
  f.state.values = { s387: '111111_NX', s386: { value: 'specimen', missing: 'unavailable' } };
  await f.open(oldEnvelope());
  const request = f.requests[1];
  assert.equal(request.target.stk_cd, '111111');
  assert.equal(request.identity.name, '');
  assert.equal(request.model.target, '111111');
  assert.deepEqual(request.clearedCaches, cacheKeys);
  assert.equal(f.state.values.s017, undefined);
});

test('all supported period filters retain the ETF symbol and name after list navigation', async () => {
  const f = fixture(), envelope = oldEnvelope(); await f.open(envelope);
  for (const dt of ['0', '1', '2', '3']) {
    await f.requests.at(-1).options.onEtfPeriodChange(dt);
    const request = f.requests.at(-1);
    assert.equal(request.target.stk_cd, '654321');
    assert.equal(request.target.dt, dt);
    assert.equal(request.model.target, '합성 ETF · 654321');
    assert.equal(request.model.period, dt);
  }
  const count = f.requests.length;
  assert.equal(f.context.selectEtfReturnPeriod(f.host, envelope, '3'), null);
  assert.equal(f.context.selectEtfReturnPeriod(f.host, envelope, '9'), null);
  assert.equal(f.requests.length, count);
});

test('direct ETF period queries keep their supplied identity through a period change', async () => {
  const f = fixture();
  f.context.activateBoardState(f.state, '2WZK-0');
  f.state.values = { s004: '직접 ETF' };
  const envelope = { stk_cd: '222222', stk_nm: '직접 ETF', operation_ref: 'base:ka40001', operation_args: { stk_cd: '222222', dt: '0' } };
  assert.equal(f.context.boardMountOptions(f.host, envelope).identity.name, '직접 ETF');
  await f.context.selectEtfReturnPeriod(f.host, envelope, '2');
  assert.equal(f.requests[0].target.stk_cd, '222222');
  assert.equal(f.requests[0].model.target, '직접 ETF · 222222');
  assert.equal(f.requests[0].model.period, '2');
  assert.equal(f.state.etfReturnIdentity, undefined);
});

test('actual hydrate requests use the ETF target and retain the returned name and zero metrics', async () => {
  const f = fixture(), envelope = oldEnvelope(); await f.open(envelope);
  f.state.hydrationByBoard.set('2WZK-0', ['s004', 's017']);
  f.context.window = { athena: { invoke: async (channel, request) => {
    assert.equal(channel, 'athena:canvas-board-hydrate');
    assert.equal(request.boardId, '2WZK-0');
    assert.equal(request.target.stk_cd, '654321');
    assert.equal(request.target.dt, '1');
    return { ok: true, slot_values: { s004: '합성 ETF', s017: 0 }, operations: [{ operation_ref: 'base:ka40001', status: 'bound' }] };
  } } };
  await f.context.hydrateBoardSlots(f.host, envelope, {});
  assert.equal(f.remounts[0].model.target, '합성 ETF · 654321');
  assert.equal(f.remounts[0].model.metrics[0].text, '0.00%');
  assert.equal(f.state.valuesByBoard.get('2WZK-0').s017, 0);
});

test('a failed period-return request is surfaced for list navigation even when the original envelope was a quote list', async () => {
  const f = fixture(), envelope = oldEnvelope(); await f.open(envelope);
  f.state.hydrationByBoard.set('2WZK-0', ['s017']);
  f.context.window = { athena: { invoke: async () => ({ ok: true,
    operations: [{ operation_ref: 'base:ka40001', status: 'failed', reason: 'unavailable' }] }) } };
  await assert.rejects(f.context.hydrateBoardSlots(f.host, envelope, {}), /종목 정보를 불러오지 못했습니다/);
  assert.equal(f.remounts.length, 0);
});

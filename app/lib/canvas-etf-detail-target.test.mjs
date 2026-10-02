import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('./board-template-registry');
const controls = require('./ranking-board-controls');
const { createLatestBoardLoad } = require('./board-mount');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const cacheKeys = ['valuesByBoard', 'unboundByBoard', 'hydrationByBoard', 'realtimeByBoard',
  'emptyRowsByBoard', 'emptyColumnsByBoard', 'emptyValueSlotsByBoard', 'deferredValueSlotsByBoard'];

function fixture(code, name = { value: '합성 ETF' }) {
  const state = { boardId: '2VIN-0', values: { s387: code, s386: name }, links: registry.stateLinksFor('2VIN-0') };
  for (const key of cacheKeys) state[key] = new Map([['15N5-2', ['stale detail']], ['2VIN-0', ['list']]]);
  state.load = createLatestBoardLoad();
  const host = { __athenaBoard: state, scrollTop: 0, hidden: false }, requests = [], notices = [];
  const context = vm.createContext({
    rankingBoardControls: controls, boardTemplateRegistry: registry, boardStateOf: () => state,
    cardStkCd: envelope => envelope.stk_cd || '',
    boardMount: { boardIdentityFromEnvelope: () => ({ code: '005930', name: 'stale envelope' }) },
    destroyBoardPrimary: () => {},
    showBoardLoading: () => { host.hidden = true; },
    showBoardReady: async () => { host.hidden = false; },
    showBoardLoadError: () => {},
    mountBoardState: (_host, id, envelope) => {
      state.boardId = id;
      state.links = registry.stateLinksFor(id);
      requests.push({ id, target: context.boardHydrateTarget(envelope, host),
        identity: context.boardMountOptions(host, envelope).identity });
    },
    errorNote: text => ({ text, classList: { add() {} }, setAttribute() {}, remove() {} }),
    boardLoadAnchor: () => ({ insertBefore: note => notices.push(note.text) }),
  });
  for (const [start, end] of [['const RANKING_BOARD_OPERATIONS =', 'function boardHydrateAccount('],
    ['function boardMountOptions(', '// 봉투가 실어온 계약'],
    ['function closeParentRankingFilter(', 'function wireStateControls('],
    ['function runBoardSurfaceLoad(', 'function renderBoardSurfaceCard(']]) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(source.slice(a, b), context);
  }
  return { state, host, requests, notices, context };
}

test('ETF detail action requests its received first-row symbol and discards earlier detail data', () => {
  assert.ok(registry.directStateLinksFor('2VIN-0').some(link =>
    link.control === 'ETF 상세 열기' && link.board_id === '15N5-2'));
  const envelope = { stk_cd: '005930', operation_ref: 'base:ka40004', operation_args: { stk_cd: '005930|000660' } };
  const original = JSON.stringify(envelope);
  const f = fixture({ value: '069500_AL', observation_id: 'synthetic-row' });
  f.context.switchStateBoard(f.host, '15N5-2', envelope, 'ETF 상세 열기');
  assert.equal(f.requests[0].target.stk_cd, '069500');
  assert.equal(f.requests[0].identity.code, '069500');
  assert.equal(f.requests[0].identity.name, '합성 ETF');
  for (const key of cacheKeys) {
    assert.equal(f.state[key].has('15N5-2'), false);
    assert.equal(f.state[key].has('2VIN-0'), true);
  }
  assert.equal(JSON.stringify(envelope), original);
  f.state.boardId = '2VIN-0';
  f.state.links = registry.stateLinksFor('2VIN-0');
  f.state.values = { s387: '102110', s386: '다음 ETF' };
  f.context.switchStateBoard(f.host, '15N5-2', envelope);
  assert.equal(f.requests[1].target.stk_cd, '102110');
  assert.equal(f.requests[1].identity.name, '다음 ETF');
});

test('ETF detail rejects missing, multiple and specimen-formatted codes without using envelope identity', () => {
  for (const code of [undefined, '', '000000', '069500|102110', '305720 · 1위', ['069500'],
    { value: '069500', missing: 'unavailable' }, { value: ['069500'] }, { text: '069500' }]) {
    const f = fixture(code);
    f.context.switchStateBoard(f.host, '15N5-2', { stk_cd: '005930' });
    assert.equal(f.requests.length, 0);
    assert.equal(f.state.boardId, '2VIN-0');
    assert.equal(f.state.etfDetailIdentity, undefined);
    assert.match(f.notices[0], /ETF 목록 첫 행의 종목코드/);
  }
});

test('ETF override is scoped to its detail and absent received names do not reuse the envelope name', () => {
  const f = fixture('069500', { value: 'specimen', missing: 'unavailable' });
  f.context.switchStateBoard(f.host, '15N5-2', { stk_cd: '005930' });
  assert.equal(f.requests[0].identity.name, '');
  f.state.boardId = '2VIN-0';
  assert.equal(f.context.boardHydrateTarget({ stk_cd: '005930' }, f.host).stk_cd, '005930');
  assert.equal(f.context.boardMountOptions(f.host, {}).identity.name, 'stale envelope');
});

test('an ETF information request failure is surfaced even when the envelope came from the list operation', async () => {
  const f = fixture('069500');
  f.context.switchStateBoard(f.host, '15N5-2', {});
  f.state.hydrationByBoard.set('15N5-2', ['s001']);
  f.context.boardHydrateAccount = () => '';
  f.context.RETRYABLE_BOARD_HYDRATE_REASONS = new Set(['unavailable']);
  f.context.window = { athena: { invoke: async (_channel, request) => {
    assert.equal(request.target.stk_cd, '069500');
    return { ok: true, operations: [{ operation_ref: 'base:ka40002', status: 'failed', reason: 'unavailable' }] };
  } } };
  const a = source.indexOf('async function hydrateBoardSlots(');
  const b = source.indexOf('// 마운트 결과에서', a);
  assert.ok(a >= 0 && b > a);
  vm.runInContext(source.slice(a, b), f.context);
  await assert.rejects(f.context.hydrateBoardSlots(f.host, { operation_ref: 'base:ka40004' }, {}), /종목 정보를 불러오지 못했습니다/);
});

test('state navigation starts at the new header and stale loads cannot move the current card', async () => {
  const f = fixture('153270');
  f.state.loadBody = { scrollTop: 1400 };
  f.host.scrollTop = 600;
  let readyScroll;
  f.context.showBoardReady = async () => {
    readyScroll = { outer: f.state.loadBody.scrollTop, inner: f.host.scrollTop };
    f.host.hidden = false;
  };
  await f.context.switchStateBoard(f.host, '15N5-2', {});
  assert.deepEqual(readyScroll, { outer: 1400, inner: 600 });
  assert.equal(f.host.hidden, false);
  assert.equal(f.host.scrollTop, 0);
  assert.equal(f.state.loadBody.scrollTop, 0);

  const settlement = fixture('153270');
  settlement.state.boardId = '2SKU-1';
  settlement.state.links = registry.stateLinksFor('2SKU-1');
  settlement.state.loadBody = { scrollTop: 900 };
  settlement.host.scrollTop = 700;
  await settlement.context.switchStateBoard(settlement.host, '3MTJ-0', {});
  assert.equal(settlement.state.loadBody.scrollTop, 0);
  assert.equal(settlement.host.scrollTop, 0);

  const stale = fixture('153270');
  stale.state.loadBody = { scrollTop: 1400 };
  stale.host.scrollTop = 600;
  stale.context.showBoardReady = async () => { stale.state.load.invalidate(); };
  await stale.context.switchStateBoard(stale.host, '15N5-2', {});
  assert.equal(stale.state.loadBody.scrollTop, 1400);
  assert.equal(stale.host.scrollTop, 600);
});

test('ordinary board loads preserve both scroll positions', async () => {
  const f = fixture('153270');
  f.state.loadBody = { scrollTop: 1400 };
  f.host.scrollTop = 600;
  await f.context.runBoardSurfaceLoad(f.host, {}, async () => ({}));
  assert.equal(f.state.loadBody.scrollTop, 1400);
  assert.equal(f.host.scrollTop, 600);
});

test('an earlier ready callback cannot reset scroll after a newer retry has finished', async () => {
  const f = fixture('153270');
  f.state.loadBody = { scrollTop: 250 };
  f.host.scrollTop = 900;
  let releaseFirst, beginRetry, readyCalls = 0, enteredFirst;
  const firstEntered = new Promise(resolve => { enteredFirst = resolve; });
  f.context.showBoardReady = async (_state, _host, _envelope, _mounted, retry) => {
    f.host.hidden = false;
    if (++readyCalls !== 1) return;
    beginRetry = retry;
    enteredFirst();
    await new Promise(resolve => { releaseFirst = resolve; });
  };
  const first = f.context.switchStateBoard(f.host, '15N5-2', {});
  await firstEntered;
  await beginRetry();
  assert.equal(f.state.loadBody.scrollTop, 0);
  assert.equal(f.host.scrollTop, 0);
  f.state.loadBody.scrollTop = 350;
  f.host.scrollTop = 1250;
  releaseFirst();
  await first;
  assert.equal(f.state.loadBody.scrollTop, 350);
  assert.equal(f.host.scrollTop, 1250);
});

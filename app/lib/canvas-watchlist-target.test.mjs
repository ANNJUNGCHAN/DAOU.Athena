import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('./board-template-registry');
const controls = require('./ranking-board-controls');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const cacheKeys = ['valuesByBoard', 'unboundByBoard', 'hydrationByBoard', 'realtimeByBoard',
  'emptyRowsByBoard', 'emptyColumnsByBoard', 'emptyValueSlotsByBoard', 'deferredValueSlotsByBoard'];

function fixture(rowCode) {
  const state = { boardId: '2U5L-1', values: { s029: rowCode }, links: registry.stateLinksFor('2U5L-1') };
  for (const key of cacheKeys) state[key] = new Map([['3D4I-0', ['stale']], ['2U5L-1', ['parent']]]);
  const host = { __athenaBoard: state }, requests = [], notices = [];
  const context = vm.createContext({
    rankingBoardControls: controls, boardTemplateRegistry: registry, boardStateOf: () => state,
    cardStkCd: envelope => envelope.stk_cd || '',
    boardMount: { boardIdentityFromEnvelope: () => ({}) },
    destroyBoardPrimary: () => {}, runBoardSurfaceLoad: (_host, _envelope, load) => load(() => true),
    mountBoardState: (_host, id, envelope) => {
      state.boardId = id;
      state.links = registry.stateLinksFor(id);
      requests.push({ id, target: context.boardHydrateTarget(envelope, host) });
    },
    errorNote: text => ({ text, classList: { add() {} }, setAttribute() {}, remove() {} }),
    boardLoadAnchor: () => ({ insertBefore: note => notices.push(note.text) }),
  });
  for (const [start, end] of [['const RANKING_BOARD_OPERATIONS =', 'function boardHydrateAccount('],
    ['function boardMountOptions(', '// 봉투가 실어온 계약'],
    ['function switchStateBoard(', 'function wireStateControls(']]) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(source.slice(a, b), context);
  }
  return { state, host, requests, notices, context };
}

test('watchlist first-row expansion uses its received code and preserves the parent group on return', () => {
  const envelope = { stk_cd: '005930', operation_args: { grp_nm: 'synthetic', stk_cd: '005930|000660' } };
  const original = JSON.stringify(envelope);
  const f = fixture({ value: '458730', observation_id: 'synthetic-row' });
  f.context.switchStateBoard(f.host, '3D4I-0', envelope, '삼성전자 행 펼침');
  assert.equal(f.requests[0].target.stk_cd, '458730');
  for (const key of cacheKeys) assert.equal(f.state[key].has('3D4I-0'), false);
  f.context.switchStateBoard(f.host, '2U5L-1', envelope);
  assert.equal(f.requests[1].target.stk_cd, '005930');
  assert.equal(f.requests[1].target.grp_nm, 'synthetic');
  assert.equal(JSON.stringify(envelope), original);
  f.state.values.s029 = '000660_AL';
  f.context.switchStateBoard(f.host, '3D4I-0', envelope);
  assert.equal(f.requests[2].target.stk_cd, '000660_AL');
  for (const key of cacheKeys) assert.equal(f.state[key].has('2U5L-1'), true);
});

test('missing or non-single watchlist codes never query an unrelated envelope stock', () => {
  for (const code of [undefined, '', '000000', '005930|000660', { value: '005930', missing: 'unavailable' }, ['005930']]) {
    const f = fixture(code);
    f.context.switchStateBoard(f.host, '3D4I-0', { stk_cd: '005930' });
    assert.equal(f.requests.length, 0);
    assert.equal(f.state.boardId, '2U5L-1');
    assert.equal(f.state.watchlistExpandedSymbol, undefined);
    assert.match(f.notices[0], /첫 행의 종목코드/);
  }
});

test('watchlist override is scoped to its expansion and pending full ranking exposes its exact operation', () => {
  const f = fixture('005930');
  f.state.watchlistExpandedSymbol = '000660';
  f.state.boardId = '3EWN-0';
  assert.equal(f.context.boardHydrateTarget({ stk_cd: '005930' }, f.host).stk_cd, '005930');
  f.state.boardId = '4B22-1';
  f.state.rankingExpandedSourceBoard = '2X5N-0';
  f.state.rankingResult = null;
  assert.equal(f.context.boardMountOptions(f.host, {}).rankingOperationRef, 'base:ka10030');
  f.state.rankingExpandedSourceBoard = '13K0-2';
  assert.equal(f.context.boardMountOptions(f.host, {}).rankingOperationRef, 'base:ka10032');
  f.state.boardId = '2U5L-1';
  assert.equal(f.context.boardMountOptions(f.host, {}).rankingOperationRef, null);
});

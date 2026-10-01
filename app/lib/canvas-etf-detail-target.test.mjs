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

function fixture(code, name = { value: '합성 ETF' }) {
  const state = { boardId: '2VIN-0', values: { s387: code, s386: name }, links: registry.stateLinksFor('2VIN-0') };
  for (const key of cacheKeys) state[key] = new Map([['15N5-2', ['stale detail']], ['2VIN-0', ['list']]]);
  const host = { __athenaBoard: state }, requests = [], notices = [];
  const context = vm.createContext({
    rankingBoardControls: controls, boardTemplateRegistry: registry, boardStateOf: () => state,
    cardStkCd: envelope => envelope.stk_cd || '',
    boardMount: { boardIdentityFromEnvelope: () => ({ code: '005930', name: 'stale envelope' }) },
    destroyBoardPrimary: () => {}, runBoardSurfaceLoad: (_host, _envelope, load) => load(() => true),
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
    ['function switchStateBoard(', 'function wireStateControls(']]) {
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

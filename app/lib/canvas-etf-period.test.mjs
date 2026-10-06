import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const cacheNames = [
  'valuesByBoard', 'unboundByBoard', 'hydrationByBoard', 'realtimeByBoard',
  'emptyRowsByBoard', 'emptyColumnsByBoard', 'emptyValueSlotsByBoard', 'deferredValueSlotsByBoard',
];
function fixture(boardId = '2WZK-0') {
  const state = { boardId };
  for (const name of cacheNames) state[name] = new Map([['2WZK-0', { old: true }], ['15N5-2', { preserved: true }]]);
  const host = { __athenaBoard: state };
  const calls = [];
  const context = vm.createContext({
    rankingBoardControls: null, cardStkCd: e => e.symbol, boardStateOf: () => state,
    destroyBoardPrimary: () => calls.push('destroy'),
    runBoardSurfaceLoad: (h, e, task) => task(() => true),
    mountBoardState: (h, id, envelope, isCurrent) => {
      calls.push({ id, target: context.boardHydrateTarget(envelope, h), current: isCurrent() });
      return Promise.resolve('mounted');
    },
  });
  for (const [start, end] of [
    ['function boardHydrateTarget(', 'function boardHydrateAccount('],
    ['function selectEtfReturnPeriod(', 'function selectRankingFilter('],
  ]) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(source.slice(a, b), context);
  }
  return { context, state, host, calls };
}

test('ETF period query preserves its symbol and clears only the active return board caches', async () => {
  const { context, state, host, calls } = fixture();
  const envelope = { symbol: '069500', operation_args: { dt: '1', market: 'KRX' } };
  for (const period of ['0', '2', '3', '1']) {
    assert.equal(await context.selectEtfReturnPeriod(host, envelope, period), 'mounted');
    assert.equal(state.etfReturnPeriod, period);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), {
      id: '2WZK-0', target: { dt: period, market: 'KRX', stk_cd: '069500' }, current: true,
    });
  }
  for (const name of cacheNames) {
    assert.equal(state[name].has('2WZK-0'), false);
    assert.deepEqual(state[name].get('15N5-2'), { preserved: true });
  }
  assert.deepEqual(envelope.operation_args, { dt: '1', market: 'KRX' });
});

test('unsupported periods, repeated selection and other boards do not request data', () => {
  const { context, state, host, calls } = fixture();
  const envelope = { operation_args: { stk_cd: '069500', dt: '1' } };
  for (const value of ['1', '4', '-1', '', null, undefined, '1;other']) {
    assert.equal(context.selectEtfReturnPeriod(host, envelope, value), null);
  }
  state.boardId = '15N5-2';
  assert.equal(context.selectEtfReturnPeriod(host, envelope, '2'), null);
  state.etfReturnPeriod = '3';
  assert.equal(context.boardHydrateTarget(envelope, host).dt, '1');
  assert.equal(calls.length, 0);
  assert.equal(state.valuesByBoard.has('2WZK-0'), true);
});

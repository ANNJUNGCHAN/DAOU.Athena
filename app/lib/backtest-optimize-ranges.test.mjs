import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');

function slice(startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, startText);
  return source.slice(start, end);
}

const formParams = {
  fast: { default: 20, min: 5, max: 30, step: 5, type: 'int' },
  slow: { default: 60, min: 40, max: 120, step: 20, type: 'int' },
};

function harness({ params = formParams } = {}) {
  const context = vm.createContext({
    spec: { params },
    runPath: 'form',
    userStrategyId: null,
    userStrategies: [],
    OPTIMIZE_METHODS: [['grid', '그리드'], ['random', '랜덤']],
    TECHNIQUE_EMPTY: { empty: true },
    clearTimeoutImpl: null,
    techniqueCheckTimer: null,
    techniqueRunTimer: null,
  });
  vm.runInContext(`
    var state = { optimizeMethod: 'grid' };
    function setState(patch) { state = Object.assign({}, state, patch); }
    function envelopeNote(payload) { return payload.note || null; }
    function isBusyView() { return false; }
    function busyReceipt(kind, note) { return { kind, note, busy: true }; }
    function makeReceipt(kind, extra) { return Object.assign({ kind }, extra); }
    function remember(receipt) { return receipt; }
    function dropTechniqueNodesView() {}
  `, context);
  vm.runInContext(slice('  function optimizeParamSpecs()', '  async function applyBestParams()'), context);
  vm.runInContext(slice('  function optimizeAction(payload)', '  // 채팅 카드의 [되돌리기]'), context);
  vm.runInContext(slice('  function resetTechnique()', '  // technique은 통째로'), context);
  return context;
}

test('chat ranges matching the current parameters drive the optimize grid', () => {
  const ctx = harness();
  const receipt = ctx.optimizeAction({
    method: 'random',
    ranges: [{ name: 'fast', start: 5, stop: 15, step: 5, is_int: false }],
  });
  assert.equal(receipt.applied, true);
  assert.equal(receipt.method, 'random');
  // 정수 여부는 모델이 보낸 값이 아니라 선언된 파라미터 type을 따른다.
  const expected = [{ name: 'fast', start: 5, stop: 15, step: 5, is_int: true }];
  assert.deepEqual(JSON.parse(JSON.stringify(receipt.ranges)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.optimizeRanges())), expected);
});

test('chat ranges that do not match the parameters are rejected without changing the grid', () => {
  const ctx = harness();
  const before = JSON.parse(JSON.stringify(ctx.optimizeRanges()));
  for (const ranges of [
    [{ name: 'unknown', start: 1, stop: 2, step: 1 }],
    [{ name: 'fast', start: 20, stop: 5, step: 5 }],
    [{ name: 'fast', start: 5, stop: 20, step: 0 }],
    [],
  ]) {
    const receipt = ctx.optimizeAction({ method: 'grid', ranges });
    assert.equal(receipt.applied, undefined);
    assert.match(receipt.errors[0], /파라미터와 맞지 않습니다/);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.optimizeRanges())), before);
});

test('ranges without an open technique report that no technique is open', () => {
  const ctx = harness();
  vm.runInContext('spec = null', ctx);
  const receipt = ctx.optimizeAction({ method: 'grid', ranges: [{ name: 'fast', start: 5, stop: 10, step: 5 }] });
  assert.match(receipt.errors[0], /열린 기법이 없어/);
});

test('stale ranges are dropped when parameters change and cleared on technique change', () => {
  const ctx = harness();
  ctx.optimizeAction({ method: 'grid', ranges: [{ name: 'fast', start: 5, stop: 15, step: 5 }] });
  // 수정 반영·IDE 저장으로 PARAMS 이름이 바뀌면 이전 범위는 더 이상 쓰지 않는다.
  vm.runInContext("spec = { params: { quick: { min: 1, max: 9, step: 1, type: 'int' } } }", ctx);
  const ranges = JSON.parse(JSON.stringify(ctx.optimizeRanges()));
  assert.deepEqual(ranges.map((range) => range.name), ['quick']);
  assert.equal(vm.runInContext('state.optimizeRanges', ctx), null);

  vm.runInContext('spec = { params: ' + JSON.stringify(formParams) + ' }', ctx);
  ctx.optimizeAction({ method: 'grid', ranges: [{ name: 'slow', start: 40, stop: 80, step: 20 }] });
  assert.equal(vm.runInContext('state.optimizeRanges.length', ctx), 1);
  ctx.resetTechnique();
  assert.equal(vm.runInContext('state.optimizeRanges', ctx), null);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.optimizeRanges())).map((range) => range.name), ['fast', 'slow']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');

test('a cached one-shot alternate opens and returns without a new hydrate request', async () => {
  const state = {};
  for (const key of ['valuesByBoard', 'unboundByBoard', 'hydrationByBoard', 'realtimeByBoard',
    'emptyRowsByBoard', 'emptyColumnsByBoard', 'emptyValueSlotsByBoard', 'deferredValueSlotsByBoard']) state[key] = new Map();
  const context = vm.createContext({
    Map, boardMount: { realtimeSlotIndex: () => new Map() },
    realtimeBindingsOf: () => [], boardStateOf: () => state,
    window: { athena: { invoke: () => { throw new Error('Unexpected new query'); } } },
  });
  for (const [start, end] of [
    ['function slotValuesOf(', '// 상태 보드 링크'],
    ['function seedBoardState(', 'function boardMountOptions('],
    ['async function hydrateBoardSlots(', '// 마운트 결과에서'],
  ]) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    vm.runInContext(source.slice(a, b), context);
  }
  const parent = { board_id: '2UN6-1', slot_values: [{ slot_id: 's045', value: '합성 종목' }], hydration_slot_ids: [] };
  const child = { board_id: '15L8-2', slot_values: [{ slot_id: 's013', value: '합성 종목' }], hydration_slot_ids: [], empty_rows: ['synthetic-empty-row'] };
  context.seedBoardState(state, parent, {});
  context.seedBoardState(state, child, {});
  context.activateBoardState(state, '15L8-2');
  assert.equal(state.values.s013, '합성 종목');
  assert.deepEqual(Array.from(state.emptyRows), ['synthetic-empty-row']);
  const mounted = { plan: { missing: ['static-unbound-slot'] } };
  assert.equal(await context.hydrateBoardSlots({}, {}, mounted), mounted);
  context.activateBoardState(state, '2UN6-1');
  assert.equal(state.values.s045, '합성 종목');
  assert.equal(state.values.s013, undefined);
});

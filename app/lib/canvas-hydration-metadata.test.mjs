import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { nextHydrationSlots } = require('./board-mount.js');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const begin = source.indexOf('async function hydrateBoardSlots(');
const end = source.indexOf('function rememberMountedBoard(', begin);
assert.ok(begin >= 0 && end > begin);

function fixture(reply) {
  const state = { boardId: '2SCE-1', hydrationByBoard: new Map([['2SCE-1', ['pending']]]),
    hydrationWarnings: [], values: { received: '0' }, valuesByBoard: new Map(), unbound: ['pending'],
    unboundByBoard: new Map(), realtimeSlots: new Map(), realtimeByBoard: new Map() };
  for (const key of ['emptyRows', 'emptyColumns', 'emptyValueSlots', 'deferredValueSlots']) {
    state[key] = key === 'deferredValueSlots' ? ['pending'] : [];
    state[key + 'ByBoard'] = new Map([['2SCE-1', state[key]], ['other', ['untouched']]]);
  }
  const mounts = [];
  const context = vm.createContext({ boardStateOf: () => state,
    window: { athena: { invoke: async () => reply } }, boardHydrateTarget: () => ({}), boardHydrateAccount: () => '',
    RETRYABLE_BOARD_HYDRATE_REASONS: new Set(), boardHydrationError: () => new Error('failed'),
    boardMount: { nextHydrationSlots,
      realtimeSlotIndex: () => Object.assign(new Map(), { observationByBinding: new Map() }),
      mountBoard: (_host, boardId, values, options) => { const result = { boardId, values, options }; mounts.push(result); return result; } },
    boardMountOptions: () => ({ emptyRows: state.emptyRows, emptyColumns: state.emptyColumns,
      emptyValueSlots: state.emptyValueSlots, deferredValueSlots: state.deferredValueSlots }),
    realtimeBindingsOf: () => [], rememberMountedBoard: () => {}, wireMountedBoardControls: () => {} });
  vm.runInContext(source.slice(begin, end), context);
  return { state, mounts, run: (isCurrent = () => true) => context.hydrateBoardSlots({}, {}, { original: true }, isCurrent) };
}

test('an answered empty hydration remounts and clears the initial deferred state without erasing earlier values', async () => {
  const contract = { board_id: '2SCE-1', empty_rows: [{ row: 'table:1', slot_ids: ['pending'] }],
    empty_columns: [], empty_value_slots: ['pending'], deferred_value_slots: [], hydration_slot_ids: [] };
  const f = fixture({ ok: true, slot_values: {}, surface_contract: contract });
  await f.run();
  assert.equal(f.mounts.length, 1);
  assert.deepEqual([...f.mounts[0].options.deferredValueSlots], []);
  assert.deepEqual([...f.mounts[0].options.emptyValueSlots], ['pending']);
  assert.equal(f.mounts[0].values.received, '0');
  assert.deepEqual([...f.state.hydrationByBoard.get('2SCE-1')], []);
  for (const key of ['emptyRows', 'emptyColumns', 'emptyValueSlots', 'deferredValueSlots']) {
    assert.equal(f.state[key + 'ByBoard'].get('2SCE-1'), f.state[key]);
    assert.deepEqual(f.state[key + 'ByBoard'].get('other'), ['untouched']);
  }
});

test('a filled response refreshes the metadata and retains genuinely deferred slots', async () => {
  const f = fixture({ ok: true, slot_values: { pending: '12' }, surface_contract: {
    board_id: '2SCE-1', empty_rows: [], empty_columns: [], empty_value_slots: [],
    deferred_value_slots: ['realtime'], hydration_slot_ids: [] } });
  await f.run();
  assert.equal(f.mounts[0].values.pending, '12');
  assert.deepEqual([...f.mounts[0].options.deferredValueSlots], ['realtime']);
  assert.equal(f.state.unbound.length, 0);
});

test('a legacy reply omitting metadata retains the prior state and does not remount empty values', async () => {
  const f = fixture({ ok: true, slot_values: {} });
  await f.run();
  assert.equal(f.mounts.length, 0);
  assert.deepEqual(f.state.deferredValueSlots, ['pending']);
});

test('late hydration cannot alter current metadata or mount after ownership is lost', async () => {
  const f = fixture({ ok: true, slot_values: {}, surface_contract: { empty_value_slots: ['pending'], deferred_value_slots: [] } });
  await f.run(() => false);
  assert.equal(f.mounts.length, 0);
  assert.deepEqual(f.state.deferredValueSlots, ['pending']);
  assert.deepEqual(f.state.emptyValueSlots, []);
});

test('metadata for another board does not overwrite the current board cache', async () => {
  const f = fixture({ ok: true, slot_values: {}, surface_contract: { board_id: 'other', deferred_value_slots: [] } });
  await f.run();
  assert.equal(f.mounts.length, 0);
  assert.deepEqual(f.state.deferredValueSlots, ['pending']);
});

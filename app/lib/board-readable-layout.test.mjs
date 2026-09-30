import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { inapplicableBasketRows, collapseEmptyRows, collapseEmptyColumns, applyPlan } = require('./board-mount.js');
const contract = { board_id: '3DZ1-0' };
const plan = (values) => ({ assignments: Object.entries(values).map(([slotId, text]) => ({ slotId, text })) });

test('only explicit inapplicable identity and allocation collapse a basket row', () => {
  const values = { s036: '해당 없음', s037: '해당 없음', s040: '삼성전자', s041: '미제공' };
  assert.deepEqual(inapplicableBasketRows(contract, plan(values), values), ['3EE8-0']);
});

test('missing responses and design label fallbacks keep the row visible', () => {
  const fallback = { s036: '해당 없음', s037: '해당 없음' };
  assert.deepEqual(inapplicableBasketRows(contract, plan(fallback), {}), []);
  assert.deepEqual(inapplicableBasketRows(contract, plan(fallback), { s036: '해당 없음' }), []);
  assert.deepEqual(inapplicableBasketRows(contract, plan({ s036: '미제공', s037: '미제공' }), { s036: null, s037: null }), []);
});

test('a later constituent response restores eligibility without an index based exclusion', () => {
  const previous = { s048: '해당 없음', s049: '해당 없음' };
  assert.deepEqual(inapplicableBasketRows(contract, plan(previous), previous), ['3EET-0']);
  const next = { s048: '새 구성종목', s049: '25.0%' };
  assert.deepEqual(inapplicableBasketRows(contract, plan(next), next), []);
});

test('inapplicable basket behavior is restricted to the authored basket state', () => {
  const values = { s036: '해당 없음', s037: '해당 없음' };
  assert.deepEqual(inapplicableBasketRows({ board_id: '3JZ3-0' }, plan(values), values), []);
});

test('a later full response restores rows previously collapsed by an empty response', () => {
  const row = { dataset: { bsRowCollapsed: 'true' }, style: { display: 'none' }, hidden: true, __bsDisplay: 'flex' };
  const surface = { dataset: {}, querySelectorAll: () => [row] };
  assert.deepEqual(collapseEmptyRows(surface, []), []);
  assert.equal(row.style.display, 'flex');
  assert.equal(row.hidden, false);
  assert.equal(row.dataset.bsRowCollapsed, undefined);
  assert.equal(surface.dataset.bsRowsCollapsed, '0');
});

test('empty-column metadata restores previous hiding and never removes the column position', () => {
  const cell = { dataset: { bsColumnCollapsed: 'true' }, style: { display: 'none' }, hidden: true, __bsDisplay: 'flex' };
  const surface = { dataset: {}, querySelectorAll: () => [cell] };
  assert.deepEqual(collapseEmptyColumns(surface, [{ column: 1, slot_ids: ['missing-value'] }]), []);
  assert.equal(cell.style.display, 'flex');
  assert.equal(cell.hidden, false);
  assert.equal(cell.dataset.bsColumnCollapsed, undefined);
  assert.equal(surface.dataset.bsColumnsCollapsed, '0');
});

test('full hydration restores only units hidden for empty values; partial ticks preserve that state', () => {
  const unit = { dataset: {}, style: { display: 'none' }, hidden: true, __bsDisplay: 'flex' };
  const sourceGraphic = { style: { display: 'none' }, hidden: true };
  const surface = { dataset: {}, __bsEmptyValueHidden: new Set([unit]), querySelectorAll: () => [] };
  const plan = { assignments: [], collapse: [] };
  applyPlan(surface, plan, { partial: true });
  assert.equal(unit.hidden, true);
  applyPlan(surface, plan);
  assert.equal(unit.hidden, false);
  assert.equal(unit.style.display, 'flex');
  assert.equal(surface.__bsEmptyValueHidden.size, 0);
  assert.equal(sourceGraphic.hidden, true);
});

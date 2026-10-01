import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('./board-template-registry');
const { mountPlan, applyPlan } = require('./board-mount');
const identity = { name: '합성 새종목', code: '000007' };

test('orderbook identity never replaces status or gold exchange slots with a stock code', async () => {
  for (const id of ['13BC-2', '2TRW-1', '3JZ3-0', '2QRP-1', '3JT4-0']) {
    await registry.loadBoard(id);
    const plan = mountPlan(registry.contractFor(id), {}, { identity });
    const texts = Object.fromEntries(plan.assignments.map(a => [a.slotId, a.text]));
    assert.notEqual(texts.s002, identity.code, id);
    assert.equal(texts.s003, identity.code, id);
  }
  for (const id of ['1JPU-0', '3N4O-0', '2QX1-1']) {
    await registry.loadBoard(id);
    const plan = mountPlan(registry.contractFor(id), { s002: '실제 종목', s003: 'KRX' }, { identity });
    assert.ok(plan.assignments.filter(a => ['s002', 's003'].includes(a.slotId)).every(a => a.text !== identity.code), id);
  }
});

test('an observed price matching specimen text remains an observed price for a different subject', async () => {
  await registry.loadBoard('13BC-2');
  const plan = mountPlan(registry.contractFor('13BC-2'), { s010: '150,850' }, { identity });
  const price = plan.assignments.find(a => a.slotId === 's010');
  assert.equal(price.missing, false);
  assert.match(price.text, /150,850/);
});

test('observed zero changes use neutral color while static and missing values do not become zero', () => {
  const contract = { board_id: 'synthetic', slots: [{ slot_id: 'amount', kind: 'value', format: { kind: 'number', tone: 'change' } }] };
  for (const value of ['-0', { value: '+0000', display_unit: '주' }]) {
    const item = mountPlan(contract, { amount: value }).assignments[0];
    assert.equal(item.tone, 'flat');
    assert.equal(item.forceFlatTone, true);
  }
  assert.equal(mountPlan(contract, {}).assignments[0].forceFlatTone, false);
  assert.equal(mountPlan(contract, { amount: '-3' }).assignments[0].tone, 'down');
});

test('actual ELW neutral quantity slots do not retain specimen buy or sell color for signed zero', async () => {
  for (const id of ['2Z49-0', '3TOM-0']) {
    await registry.loadBoard(id);
    for (const raw of ['-0', '0', '+0']) {
      const plan = mountPlan(registry.contractFor(id), { s053: raw, s054: raw });
      for (const slot of ['s053', 's054']) {
        const item = plan.assignments.find(a => a.slotId === slot);
        assert.equal(item.text, '0주', `${id}/${slot}/${raw}`);
        assert.equal(item.tone, 'flat');
        assert.equal(item.forceFlatTone, true);
      }
    }
  }
});

test('the first partial value restores its hidden unit and row without restoring a pending neighbor or primary mockup', () => {
  for (const mockup of [false, true]) {
    const row = { dataset: { bsRowCollapsed: 'true' }, style: { display: 'none' }, hidden: true, __bsDisplay: 'flex' };
    const value = { dataset: { node: 'observed', slotId: 'price' }, children: [], style: {}, textContent: '',
      closest: selector => selector.includes('primary-mockup') ? (mockup ? {} : null)
        : selector.includes('bs-row-collapsed') ? row : null };
    const unit = { style: { display: 'none' }, hidden: true, __bsDisplay: 'flex', contains: node => node === value };
    const neighbor = { style: { display: 'none' }, hidden: true, __bsDisplay: 'flex', contains: () => false };
    const root = { dataset: {}, __bsEmptyValueHidden: new Set([unit, neighbor]),
      querySelectorAll: selector => selector === '[data-node]' ? [value] : [] };
    applyPlan(root, { assignments: [{ node: 'observed', slotId: 'price', text: '0', valueSlot: true, missing: false }], collapse: [] }, { partial: true });
    assert.equal(unit.hidden, mockup);
    assert.equal(row.hidden, mockup);
    assert.equal(neighbor.hidden, true);
    assert.equal(root.__bsEmptyValueHidden.has(unit), mockup);
    assert.equal(root.__bsEmptyValueHidden.has(neighbor), true);
  }
});

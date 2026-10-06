import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatSlot } = require('./board-format.js');
const { mountPlan } = require('./board-mount.js');
const registry = require('./board-template-registry.js');

test('zero-padded received amounts and quantities stay numeric zero', () => {
  for (const raw of ['000000', '000000000000000', '+000000000000000', '-000000000000000']) {
    for (const [spec, text] of [[{ unit: 'krw_ko' }, '0'], [{ unit: 'shares' }, '0주'], [{ unit: 'percent', precision: 2 }, '0.00%'], [{ unit: 'text', f: 'amount' }, '0']]) {
      const result = formatSlot(spec, raw);
      assert.equal(result.text, text, `${JSON.stringify(spec)} ${raw}`);
      assert.equal(result.missing, false);
      assert.equal(formatSlot(spec, { value: raw }).text, text);
    }
  }
});

test('absent values, identifiers, date/time sentinels and unavailable prices remain distinct', () => {
  for (const raw of [null, undefined, '']) assert.equal(formatSlot({ unit: 'krw_ko' }, raw).missing, true);
  assert.equal(formatSlot({ unit: 'text', f: 'stk_cd' }, '000000').text, '000000');
  assert.equal(formatSlot({ unit: 'text', f: 'stk_cd' }, '005930').text, '005930');
  for (const unit of ['date', 'time']) assert.equal(formatSlot({ unit }, '000000').missing, true);
  const price = mountPlan(registry.contractFor('137X-2'), { s005: '000000000000000' }).assignments.find(a => a.slotId === 's005');
  assert.equal(price.missing, true);
});

test('actual account settlement and capacity contracts retain padded zero without mutating input', () => {
  const cases = [
    ['2SKU-1', ['s055', 's056', 's057', 's058', 's059', 's060', 's062', 's063', 's064', 's065', 's066', 's067', 's068']],
    ['3GRO-0', ['s110', 's112']],
  ];
  for (const [id, slots] of cases) {
    const values = Object.fromEntries(slots.map(s => [s, '000000000000000']));
    const original = JSON.stringify(values);
    const padded = mountPlan(registry.contractFor(id), values);
    const numeric = mountPlan(registry.contractFor(id), Object.fromEntries(slots.map(s => [s, 0])));
    for (const slot of slots) {
      const a = padded.assignments.find(a => a.slotId === slot);
      const b = numeric.assignments.find(a => a.slotId === slot);
      assert.equal(a.text, b.text, `${id} ${slot}`);
      assert.notEqual(a.text, '');
      assert.equal(a.missing, false);
      assert.equal(a.tone, b.tone);
      assert.equal(a.tone, 'flat');
    }
    assert.equal(JSON.stringify(values), original);
  }
});

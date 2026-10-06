import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { formatSlot } = require('./board-format');
const { mountPlan } = require('./board-mount');
const registry = require('./board-template-registry');

test('completed numeric text keeps its exact units and derives an omitted change tone', () => {
  const spec = { kind: 'number', tone: 'change', sign: true, prefix: 'unused ', suffix: 'unused' };
  for (const [value, tone] of [[1234, 'up'], ['-1234', 'down'], [0, 'flat'], ['-0', 'flat'], ['+0', 'flat']]) {
    const raw = { value, text: `${value}백만원`, display_unit: '백만원' };
    const before = JSON.stringify(raw);
    assert.deepEqual(formatSlot(spec, raw), { text: raw.text, tone, missing: false });
    assert.equal(JSON.stringify(raw), before);
  }
});

test('an explicit completed-text tone still wins and neutral or nonnumeric text gains no change color', () => {
  for (const tone of ['up', 'down', 'flat']) {
    assert.equal(formatSlot({ tone: 'change' }, { value: -5, text: '원문 유지', tone }).tone, tone);
  }
  assert.deepEqual(formatSlot({ tone: 'neutral' }, { value: 1234, text: '1,234백만원' }), {
    text: '1,234백만원', tone: null, missing: false,
  });
  assert.deepEqual(formatSlot({ tone: 'change' }, { value: '집계대상', text: '원문 집계대상' }), {
    text: '원문 집계대상', tone: null, missing: false,
  });
});

test('a completed string never turns an absent raw value into an observation', () => {
  for (const value of [null, undefined, '']) {
    const result = formatSlot({ tone: 'change' }, { value, text: '보여서는 안 되는 완성 문자열' });
    assert.equal(result.missing, true);
    assert.equal(result.tone, null);
    assert.equal(result.text, '미제공');
  }
});

test('real investor slots use the received sign instead of the authored personal and foreign colors', () => {
  const contract = registry.contractFor('3DI2-0');
  const source = JSON.parse(fs.readFileSync(new URL('../../backend/ref/card-surface-templates/3DI2-0/slots.json', import.meta.url)));
  const slots = ['ind_invsr', 'frgnr_invsr'].map(f => source.slots.find(s => s.f === f && s.mapping_id === 'base:ka10060'));
  assert.ok(slots.every(Boolean));
  for (const [value, tone] of [[5846278608, 'up'], [-5846278608, 'down'], [0, 'flat']]) {
    const raw = { value, text: `${value.toLocaleString('en-US')}백만원`, display_unit: '백만원' };
    const values = Object.fromEntries(slots.map(s => [s.slot_id, raw]));
    const before = JSON.stringify(values);
    const plan = mountPlan(contract, values);
    for (const slot of slots) {
      const assignment = plan.assignments.find(a => a.slotId === slot.slot_id);
      assert.equal(assignment.text, raw.text);
      assert.equal(assignment.tone, tone);
      assert.equal(assignment.missing, false);
      if (value === 0) assert.equal(assignment.forceFlatTone, true);
    }
    assert.equal(JSON.stringify(values), before);
  }
});

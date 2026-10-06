import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatSlot, formatTime } = require('./board-format.js');

test('time fields reject impossible HHmmss values instead of showing false clocks', () => {
  for (const value of ['888888', '240000', '126000', '125960', '88:88:88', '24:00']) {
    assert.equal(formatTime(value), null, value);
    assert.equal(formatSlot({ kind: 'time' }, value).missing, true, value);
    assert.equal(formatSlot({ unit: 'time' }, value).missing, true, value);
  }
});

test('valid clock boundaries and dated midnight keep their existing display', () => {
  for (const [value, text] of [['000001', '00:00:01'], ['093127', '09:31:27'], ['235959', '23:59:59'], ['09:30', '09:30']]) {
    assert.equal(formatSlot({ kind: 'time' }, value).text, text);
  }
  assert.equal(formatSlot({ kind: 'time' }, '000000').missing, true);
  assert.equal(formatSlot({ kind: 'time' }, '20261001888888').missing, true);
  assert.match(formatSlot({ kind: 'time' }, '20261001000000').text, /00:00:00$/);
});

test('clock validation does not rewrite identifiers or an explicit completed display wrapper', () => {
  assert.equal(formatSlot({ kind: 'text', f: 'stk_cd' }, '888888').text, '888888');
  assert.equal(formatSlot({ kind: 'time' }, { value: '888888', text: '제공자가 작성한 문구' }).text, '제공자가 작성한 문구');
});

test('ETF and ETN tax classifications retain their separate field labels', () => {
  const registry = require('./board-template-registry.js');
  const { mountPlan } = require('./board-mount.js');
  const contract = registry.contractFor('15N5-2');
  const source = JSON.parse(fs.readFileSync(new URL('../../backend/ref/card-surface-templates/15N5-2/slots.json', import.meta.url)));
  const assignments = mountPlan(contract, { s059: '비과세', s060: '분배금 과세' }).assignments;
  assert.equal(assignments.find(s => s.slotId === 's059').text, 'ETF 과세: 비과세');
  assert.equal(assignments.find(s => s.slotId === 's060').text, 'ETN 과세: 분배금 과세');
  for (const id of ['s059', 's060']) {
    assert.deepEqual(contract.slots.find(s => s.slot_id === id).format, source.slots.find(s => s.slot_id === id).format);
  }
  for (const id of ['s071', 's086', 's101']) {
    assert.equal(mountPlan(contract, { [id]: '888888' }).assignments.find(s => s.slotId === id).missing, true);
  }
  const index = mountPlan(contract, { s025: '-2658', s026: '-100' }).assignments;
  assert.equal(index.find(s => s.slotId === 's025').text, '추적현재가 -26.58');
  assert.equal(index.find(s => s.slotId === 's026').text, '추적전일대비 -1.00');
});

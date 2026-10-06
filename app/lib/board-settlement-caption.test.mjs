import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mountPlan } = require('./board-mount');
const registry = require('./board-template-registry');
const source = JSON.parse(fs.readFileSync(new URL('../../backend/ref/card-surface-templates/2SKU-1/slots.json', import.meta.url)));

test('settlement hero captions preserve each day, monetary sign and received zero', () => {
  const contract = registry.contractFor('2SKU-1');
  const cases = [[1234, '매도·매수 정산 +1,234원', 'up'], [-1234, '매도·매수 정산 -1,234원', 'down'],
    [0, '매도·매수 정산 0원', 'flat'], ['000000000000000', '매도·매수 정산 0원', 'flat'],
    ['-000000000001234', '매도·매수 정산 -1,234원', 'down']];
  for (const [raw, expected, tone] of cases) for (const value of [raw, {value:raw}]) {
    const values = {s032:'54321',s035:'98765',s033:value,s036:value};
    const before = JSON.stringify(values);
    const assignments = mountPlan(contract, values).assignments;
    for (const id of ['s033','s036']) {
      const slot = assignments.find(a => a.slotId === id);
      assert.equal(slot.text, expected);
      assert.equal(slot.tone, tone);
      assert.equal(slot.missing, false);
    }
    assert.equal(assignments.find(a => a.slotId === 's032').text, '54,321');
    assert.equal(assignments.find(a => a.slotId === 's035').text, '98,765');
    assert.equal(JSON.stringify(values), before);
  }
});

test('settlement hero metadata matches canonical fields and never fills missing amounts', () => {
  const contract = registry.contractFor('2SKU-1');
  for (const [id,field,paired] of [['s033','d1_slby_exct_amt','s032'],['s036','d2_slby_exct_amt','s035']]) {
    const slot = source.slots.find(s => s.slot_id === id);
    assert.equal(slot.mapping_id, 'detail:kt00001:settlement_forecast');
    assert.equal(slot.f, field);
    assert.equal(slot.paired_with, paired);
    assert.equal(slot.alt_mappings, null);
    assert.deepEqual(contract.slots.find(s => s.slot_id === id).format, slot.format);
    for (const value of [null, undefined, '']) {
      const assignment = mountPlan(contract, {[id]:value}).assignments.find(a => a.slotId === id);
      assert.equal(assignment.missing, true);
      assert.equal(assignment.text.includes('0원'), false);
    }
  }
});

test('reviewed account hero secondary scalars retain their own captions and units', () => {
  const expected = {
    '133H-2': {s013:'총수익률 ',s016:'인출가능 '},
    '2SKU-1': {s013:'총수익률 ',s016:'인출가능 ',s030:'랩 출금가능 ',s039:'익일 인출가능 '},
    '2SRV-1': {s013:'총수익률 ',s016:'출금가능 ',s030:'당일 투자원금 ',s033:'당월 투자원금 ',s036:'누적 투자원금 ',s039:'수수료 '},
    '2SYW-1': {s013:'총수익률 ',s016:'출금가능 ',s030:'약정금액 ',s033:'체결량 ',s036:'미체결량 '},
    '3GRO-0': {s017:'총수익률 ',s020:'출금가능 '},
    '3K7K-0': {s015:'기초 순자산 ',s018:'출금가능 '},
    '3MTJ-0': {s016:'출금가능 '},
    '3NVG-0': {s013:'총수익률 ',s016:'출금가능 '},
    '3UTA-0': {s018:'출금가능 '},
  };
  const inventory = JSON.parse(fs.readFileSync(new URL('../../backend/ref/kiwoom-tr-inventory.json', import.meta.url)));
  for (const [board, captions] of Object.entries(expected)) {
    const authored = JSON.parse(fs.readFileSync(new URL(`../../backend/ref/card-surface-templates/${board}/slots.json`, import.meta.url)));
    const contract = registry.contractFor(board);
    for (const [id, prefix] of Object.entries(captions)) {
      const slot = authored.slots.find(s => s.slot_id === id);
      assert.equal(slot.format.prefix, prefix);
      assert.deepEqual(contract.slots.find(s => s.slot_id === id).format, slot.format);
      const tr = slot.mapping_id.split(':')[1];
      const field = inventory.find(t => t.id === tr).resp_body.find(f => f.element.replace(/^[-\s]+/, '') === slot.f);
      assert.ok(field && field.type !== 'LIST', `${board}/${id} has scalar public evidence`);
      for (const raw of [1234,-1234,0,'000000000000000',{value:0}]) {
        const assignment = mountPlan(contract, {[id]:raw}).assignments.find(a => a.slotId === id);
        assert.equal(assignment.text.startsWith(prefix), true, `${board}/${id}`);
        assert.equal(assignment.missing, false);
      }
      const missing = mountPlan(contract, {}).assignments.find(a => a.slotId === id);
      assert.equal(missing.missing, true);
      assert.equal(missing.text.includes(prefix), false);
    }
  }
  const amount = (value) => mountPlan(registry.contractFor('2SRV-1'), {s036:value}).assignments.find(a => a.slotId === 's036');
  assert.equal(amount(1234).text, '누적 투자원금 1,234원');
  assert.equal(amount(-1234).text, '누적 투자원금 -1,234원');
  assert.equal(amount('000000000000000').text, '누적 투자원금 0원');
});

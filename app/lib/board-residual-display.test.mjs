import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { formatSlot } = require('./board-format');
const registry = require('./board-template-registry');
const { mountPlan } = require('./board-mount');
const slotSource = id => JSON.parse(fs.readFileSync(new URL(`../../backend/ref/card-surface-templates/${id}/slots.json`, import.meta.url))).slots;
const assignment = (id, slot, raw) => mountPlan(registry.contractFor(id), raw === undefined ? {} : {[slot]:raw})
  .assignments.find(x => x.slotId === slot);

test('signed zero quantities render neutral zero while nonzero direction and raw data stay intact', () => {
  for (const board of ['2Z49-0','3TOM-0']) {
    for (const slot of slotSource(board).filter(s => ['sel_trde_qty','buy_trde_qty','netprps_qty'].includes(s.f))) {
      for (const value of ['-0','-000000','+0','+000000','--0',-0,0]) {
        const raw = {value,observation_id:'synthetic-zero'};
        const before = JSON.stringify(raw);
        const result = assignment(board,slot.slot_id,raw);
        assert.equal(result.text,'0주',`${board}/${slot.slot_id}/${value}`);
        assert.ok(result.tone === null || result.tone === 'flat');
        assert.equal(JSON.stringify(raw),before);
      }
    }
  }
  assert.equal(formatSlot({unit:'shares',tone:'change',sign:true},'-3').text,'-3주');
  assert.equal(formatSlot({unit:'shares',tone:'change',sign:true},'-3').tone,'down');
  assert.equal(formatSlot({unit:'shares',tone:'change',sign:true},'+3').text,'+3주');
  assert.equal(formatSlot({unit:'shares',tone:'change',sign:true},'+3').tone,'up');
});

test('classification chips identify actual codes without inventing security classes', () => {
  for (const slot of ['s054','s066','s078','s090']) {
    assert.equal(assignment('2XKO-0',slot,'30').text,'분류 30');
    assert.equal(assignment('2XKO-0',slot,'25').text,'분류 25');
    assert.equal(assignment('2XKO-0',slot).missing,true);
  }
});

test('expected trades do not assert a premarket session and after-hours listings do not invent company data', () => {
  assert.equal(assignment('2XP6-0','s002').text,'예상체결 조회');
  assert.equal(assignment('2XP6-0','s157').text,'미제공');
  assert.equal(assignment('2YNQ-0','s149').text,'정규장 종가');
  assert.equal(assignment('2YNQ-0','s152').missing,true);
  assert.equal(assignment('2YNQ-0','s150','12345').text,'정규장 12,345원');
  assert.equal(assignment('2XP6-0','s153','0').text,'0주');
});

test('unbound risk states and expanded-list specimen comparisons remain unavailable', () => {
  for (const [board,slots] of [['2XKO-0',['s159','s160','s161','s162']],
    ['2YNQ-0',['s153','s154','s155','s156']],['4B22-1',['s138','s139','s140','s141']]]) {
    for (const slot of slots) {
      const result = assignment(board,slot);
      assert.equal(result.text,'상태 미확인');
      assert.equal(result.tone,null);
      assert.equal(result.missing,true);
    }
  }
  for (const slot of ['s124','s125','s126','s127','s128','s129','s130','s133','s135','s137']) {
    assert.equal(assignment('4B22-1',slot).missing,true,slot);
  }
  assert.equal(assignment('4B22-1','s143').text,'종목 상세 열기');
});

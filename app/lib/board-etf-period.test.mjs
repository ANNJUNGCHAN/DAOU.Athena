import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PERIODS, modelFor } = require('./board-etf-period');

test('period controls use only the four supported query periods', () => {
  assert.deepEqual(PERIODS, { 0:'1주', 1:'1개월', 2:'6개월', 3:'1년' });
  assert.equal(modelFor({ assignments:[] }, { operationArgs:{dt:'2'} }).period, '2');
  assert.equal(modelFor({ assignments:[] }).period, '');
  assert.equal(modelFor({ assignments:[] }, { operationArgs:{dt:'9'} }).period, '');
});
test('distinct response values retain zero and pending meanings', () => {
  const plan={ assignments:[
    {slotId:'s004',text:'합성 ETF',missing:false},
    {slotId:'s017',text:'0.00%',tone:'neutral'}, {slotId:'s020',text:'-1.20%',tone:'down'},
    {slotId:'s023',text:'0주'}, {slotId:'s026',text:''},
  ] };
  const model=modelFor(plan,{operationArgs:{stk_cd:'000001',dt:'1'},deferredValueSlots:['s026']});
  assert.equal(model.target,'합성 ETF · 000001');
  assert.deepEqual(model.metrics.map(x=>x.text),['0.00%','-1.20%','0주','조회 중']);
  assert.equal(modelFor({assignments:[]}).metrics[0].text,'미제공');
});

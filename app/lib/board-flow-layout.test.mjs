import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { investorCaption } = createRequire(import.meta.url)('./board-flow-layout.js');

test('investor caption names the received day and requested trade mode', () => {
  const plan = { assignments:[{ slotId:'s027',text:'2026-10-01',missing:false }] };
  assert.equal(investorCaption(plan, { operationRef:'base:ka10059', operationArgs:{dt:'20260930',trde_tp:'2',amt_qty_tp:'2'} }), '2026-10-01 · 매도 · 수량');
});

test('period sums describe the requested period and do not invent unavailable arguments', () => {
  const plan = { assignments:[{ slotId:'s027',text:'2026-09-30',missing:false }] };
  assert.equal(investorCaption(plan, { operationRef:'base:ka10061', operationArgs:{strt_dt:'20260101',end_dt:'20261001',trde_tp:'0',amt_qty_tp:'1'} }), '2026-01-01 ~ 2026-10-01 · 순매수 · 금액');
  assert.equal(investorCaption({ assignments:[] }, {}), '조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공');
});

const flow = createRequire(import.meta.url)('./board-flow-layout.js');

test('applied query context uses only an investor source for the same normalized stock', () => {
  const contract = {board_id:'2QFO-2',flow_query_context:{operation_ref:'base:ka10059',operation_args:{stk_cd:'123456_AL',dt:'20261002',trde_tp:'0',amt_qty_tp:'1',unit_tp:'1000',account_no:'synthetic-excluded'}}};
  const context=flow.queryContextFor(contract,'123456');
  assert.deepEqual(context,{operation_ref:'base:ka10059',operation_args:{stk_cd:'123456',dt:'20261002',trde_tp:'0',amt_qty_tp:'1',unit_tp:'1000'}});
  assert.equal(flow.investorCaption({assignments:[{slotId:'s027',text:'2026-10-02',missing:false}]},{flowQueryContext:context}), '2026-10-02 · 순매수 · 금액');
  assert.equal(flow.queryContextFor(contract,'654321'),null);
  assert.equal(flow.queryContextFor({...contract,board_id:'2QM7-2'},'123456'),null);
  assert.equal(flow.queryContextFor({...contract,flow_query_context:{...contract.flow_query_context,operation_ref:'base:ka10066'}},'123456'),null);
});

test('actual period context wins over old daily arguments and unknown stays unknown', () => {
  const context=flow.queryContextFor({board_id:'2QFO-2',flow_query_context:{operation_ref:'base:ka10061',operation_args:{stk_cd:'123456',strt_dt:'20260901',end_dt:'20261002',trde_tp:'2',amt_qty_tp:'2'}}},'123456');
  const plan={assignments:[{slotId:'s027',text:'2026-09-30',missing:false}]};
  assert.equal(flow.investorCaption(plan,{operationRef:'base:ka10059',operationArgs:{trde_tp:'1',amt_qty_tp:'1'},flowQueryContext:context}),'2026-09-01 ~ 2026-10-02 · 매도 · 수량');
  assert.equal(flow.investorCaption({assignments:[]},{}),'조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공');
});

test('explicitly rejected query context never falls back to a former request or observation date', () => {
  const plan={assignments:[{slotId:'s027',text:'2026-01-01',missing:false}]};
  const legacy={operationRef:'base:ka10059',operationArgs:{dt:'20260101',trde_tp:'1',amt_qty_tp:'1'}};
  assert.equal(flow.investorCaption(plan,legacy),'2026-01-01 · 매수 · 금액');
  assert.equal(flow.investorCaption(plan,{...legacy,flowQueryContext:undefined}),'2026-01-01 · 매수 · 금액');
  assert.equal(flow.investorCaption(plan,{...legacy,flowQueryContext:null}),'조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공');
});

test('received name pairs require the same code and preserve wrapped fields', () => {
  const base={stk_cd:'123456',data:{fields:[{key:'stk_cd',value:{value:'123456_NX'}},{key:'stk_nm',value:{value:'합성 종목'}}]}};
  for(const id of ['2QFO-2','2QM7-2','2S4E-1']) {
    assert.deepEqual(flow.identityFor(id,base,{}, {code:'123456',name:''}),{code:'123456',name:'합성 종목'});
  }
  assert.equal(flow.identityFor('2QFO-2',{stk_cd:'123456',data:{stk_cd:'654321',stk_nm:'다른 종목'}},{},{code:'123456',name:'다른 종목'}).name,'투자자별 매매');
  assert.equal(flow.identityFor('2QM7-2',{stk_cd:'123456',caption:'추정 종목'},{},{code:'123456',name:''}).name,'거래원별 매매');
  assert.equal(flow.identityFor('2S4E-1',{stk_cd:'123456'},{s001:'응답 종목',s003:'654321'},{code:'123456',name:'응답 종목'}).name,'종목 동향');
  assert.equal(flow.identityFor('2S4E-1',{stk_cd:'123456'},{s001:{value:'응답 종목'},s003:{value:'123456'}},{code:'123456',name:''}).name,'응답 종목');
});

test('explicit top, data and argument identities retain verified names; non-flow identity is untouched', () => {
  for(const envelope of [{stk_cd:'123456',stk_nm:'합성 종목'},{stk_cd:'123456',data:{stk_nm:'합성 종목'}},{operation_args:{stk_cd:'123456',stk_nm:'합성 종목'}}]) {
    assert.equal(flow.identityFor('2QFO-2',envelope,{}, {code:'123456',name:'합성 종목'}).name,'합성 종목');
  }
  const etf={code:'123456',name:'ETF'};
  assert.equal(flow.identityFor('2WZK-0',{}, {}, etf),etf);
  assert.equal(flow.identityFor('2QFO-2',{stk_cd:'123456',data:{fields:[{key:'stk_cd',value:'123456'},{key:'stk_nm',value:{value:'없는 이름',missing:'unavailable'}}]}},{},{code:'123456'}).name,'투자자별 매매');
});

test('stock trend generated broker names are received values and missing rows never use authored companies', () => {
  const require = createRequire(import.meta.url);
  const mount = require('./board-mount');
  const contract = require('./board-template-registry').contractFor('2S4E-1');
  const names = ['s114','s116','s118','s121','s123','s125'];
  const empty = mount.mountPlan(contract,{s115:0});
  for (const id of names) {
    const item=empty.assignments.find(slot=>slot.slotId===id);
    assert.equal(item.designText,false);
    assert.equal(item.missing,true);
    assert.equal(item.valueSlot,true);
  }
  assert.equal(empty.assignments.find(slot=>slot.slotId==='s115').text,'0주');
  const received = mount.mountPlan(contract,{s114:{value:'합성 매수1'},s115:0,s123:'합성 매도2',s124:-5});
  assert.equal(received.assignments.find(slot=>slot.slotId==='s114').text,'합성 매수1');
  assert.equal(received.assignments.find(slot=>slot.slotId==='s123').text,'합성 매도2');
});

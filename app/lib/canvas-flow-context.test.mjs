import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const mount = require('./board-mount');
const registry = require('./board-template-registry');
const flow = require('./board-flow-layout');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const argumentContext={operation_ref:'base:ka10059',operation_args:{stk_cd:'123456',dt:'20261002',trde_tp:'0',amt_qty_tp:'1',unit_tp:'1000'}};
function fixture(boardId='2QFO-2') {
  const state={boardId,values:{},unbound:['s038'],realtimeSlots:new Map(),hydrationWarnings:[]};
  for(const key of ['valuesByBoard','unboundByBoard','hydrationByBoard','realtimeByBoard','emptyRowsByBoard','emptyColumnsByBoard','emptyValueSlotsByBoard','deferredValueSlotsByBoard']) state[key]=new Map();
  state.hydrationByBoard.set(boardId,['s038','s073']);
  state.realtimeSlots.observationByBinding=new Map();
  const host={__athenaBoard:state}, envelope={stk_cd:'123456',operation_ref:'base:ka10059',data:{fields:[{key:'stk_cd',value:'123456'},{key:'stk_nm',value:'합성 종목'}]}};
  const remounts=[];
  const context=vm.createContext({Map,Set,boardFlowLayout:flow,boardStateOf:()=>state,boardHydrateTarget:e=>({stk_cd:e.stk_cd}),
    slotValuesOf:contract=>Object.fromEntries((contract.slot_values||[]).map(entry=>[entry.slot_id,entry.value])),realtimeBindingsOf:()=>[],
    boardHydrateAccount:()=>'',RETRYABLE_BOARD_HYDRATE_REASONS:new Set(['upstream_error']),
    boardMount:{...mount,mountBoard:(_host,id,values,options)=>{const result={plan:mount.mountPlan(registry.contractFor(id),values,options),options};remounts.push(result);return result;}},
    rememberMountedBoard(){},wireMountedBoardControls(){},selectEtfReturnPeriod(){},switchStateBoard(){},
    boardHydrationError:()=>new Error('hydrate error'),
  });
  for(const [start,end] of [['function seedBoardState(', 'function activateBoardState('],['function boardMountOptions(', '// 봉투가 실어온 계약'],['async function hydrateBoardSlots(', '// 마운트 결과에서']]) {
    const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);vm.runInContext(source.slice(a,b),context);
  }
  return {state,host,envelope,context,remounts,reply(value){context.window={athena:{invoke:async()=>value}};}};
}
test('initial flow contract seeds the applied context and verified received name',()=>{
  const f=fixture();f.context.seedBoardState(f.state,{board_id:'2QFO-2',slot_values:[],flow_query_context:argumentContext},f.envelope);
  const options=f.context.boardMountOptions(f.host,f.envelope);
  assert.equal(options.flowQueryContext.operation_args.amt_qty_tp,'1');
  assert.equal(options.identity.name,'합성 종목');
  assert.equal(flow.investorCaption({assignments:[]},options),'2026-10-02 · 순매수 · 금액');
});
test('hydrate returns applied arguments through surface contract and keeps numeric zero',async()=>{
  const f=fixture();f.reply({ok:true,operations:[{operation_ref:'base:ka10059',status:'bound'}],slot_values:{s038:{value:0,text:'0백만원'}},surface_contract:{board_id:'2QFO-2',flow_query_context:argumentContext}});
  await f.context.hydrateBoardSlots(f.host,f.envelope,{plan:{missing:['s038']}});
  assert.equal(f.remounts.length,1);const result=f.remounts[0];
  assert.equal(result.plan.assignments.find(s=>s.slotId==='s038').text,'0백만원');
  assert.equal(result.options.flowQueryContext.operation_args.trde_tp,'0');
  assert.equal(flow.investorCaption(result.plan,result.options),'2026-10-02 · 순매수 · 금액');
  assert.equal(f.state.valuesByBoard.get('2QFO-2').s038.value,0);
});
test('empty successful data still updates its caption context',async()=>{
  const f=fixture();f.reply({ok:true,operations:[],slot_values:{},surface_contract:{board_id:'2QFO-2',flow_query_context:argumentContext}});
  await f.context.hydrateBoardSlots(f.host,f.envelope,{plan:{missing:[]}});
  assert.equal(f.remounts.length,1);assert.equal(f.remounts[0].options.flowQueryContext.operation_args.dt,'20261002');
});
test('late or other-board context cannot rewrite the active caption',async()=>{
  const f=fixture();f.state.flowQueryContextByBoard=new Map([['2QFO-2',argumentContext]]);
  let resolve;f.context.window={athena:{invoke:()=>new Promise(r=>{resolve=r;})}};
  const pending=f.context.hydrateBoardSlots(f.host,f.envelope,{});
  f.state.boardId='2QM7-2';resolve({ok:true,surface_contract:{board_id:'2QFO-2',flow_query_context:{...argumentContext,operation_args:{stk_cd:'654321'}}}});
  await pending;assert.equal(f.remounts.length,0);assert.equal(f.state.flowQueryContextByBoard.get('2QFO-2'),argumentContext);
  f.state.boardId='2QFO-2';f.reply({ok:true,slot_values:{},operations:[],surface_contract:{board_id:'2QM7-2',flow_query_context:null}});
  await f.context.hydrateBoardSlots(f.host,f.envelope,{});assert.equal(f.state.flowQueryContextByBoard.get('2QFO-2'),argumentContext);
});
test('mismatched symbols and ambiguous source metadata clear authority without borrowing old conditions',async()=>{
  const f=fixture();
  assert.equal(f.context.boardMountOptions(f.host,f.envelope).flowQueryContext,undefined);
  f.context.boardHydrateTarget=e=>({stk_cd:e.stk_cd,dt:'20260101',trde_tp:'1',amt_qty_tp:'1'});
  f.state.flowQueryContextByBoard=new Map([['2QFO-2',{...argumentContext,operation_args:{...argumentContext.operation_args,stk_cd:'654321'}}]]);
  assert.equal(f.context.boardMountOptions(f.host,f.envelope).flowQueryContext,null);
  assert.equal(flow.investorCaption({assignments:[]},f.context.boardMountOptions(f.host,f.envelope)),'조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공');
  f.reply({ok:true,operations:[],slot_values:{},surface_contract:{board_id:'2QFO-2',flow_query_context:null}});
  await f.context.hydrateBoardSlots(f.host,f.envelope,{});assert.equal(f.remounts.at(-1).options.flowQueryContext,null);
  assert.equal(flow.investorCaption(f.remounts.at(-1).plan,f.remounts.at(-1).options),'조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공');
});

test('the production IPC adapter retains the bounded surface query context', async () => {
  const { hydrateBoard } = require('./main/board-hydrate');
  const reply = await hydrateBoard({ backendBase:'http://synthetic.invalid', boardId:'2QFO-2',
    target:{stk_cd:'123456'}, slotIds:['s038'],
    fetchImpl:async () => ({ok:true,status:200,json:async () => ({
      board_id:'2QFO-2',operations:[{operation_ref:'base:ka10059',status:'bound'}],
      surface_contract:{board_id:'2QFO-2',flow_query_context:argumentContext,
        slot_values:[{slot_id:'s038',value:{value:'0',text:'0백만원'}}]},
    })}),
  });
  assert.equal(reply.ok,true);
  assert.deepEqual(reply.surface_contract.flow_query_context,argumentContext);
  const f=fixture();f.reply(reply);
  await f.context.hydrateBoardSlots(f.host,f.envelope,{});
  assert.equal(f.remounts[0].options.flowQueryContext.operation_args.amt_qty_tp,'1');
  assert.equal(f.remounts[0].plan.assignments.find(s=>s.slotId==='s038').text,'0백만원');
});

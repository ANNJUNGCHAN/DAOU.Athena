import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bridge = require('./main/board-hydrate');
const controls = require('./ranking-board-controls');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const watchSourceSlots = JSON.parse(source.match(/^const WATCH_SOURCE_SLOTS = (.+);$/m)[1]);

test('expanded result bridge binds request and response to its exact ranking operation', async () => {
  const projection = {board_id:'4B22-1',operation_ref:'base:ka10032',rows:[{stk_cd:'005930',cur_prc:0}],columns:[]};
  let request;
  const fetchImpl = async (_url, options) => {
    request = JSON.parse(options.body);
    return {ok:true,status:200,json:async()=>({surface_contract:{slot_values:[]},ranking_result:projection})};
  };
  const reply = await bridge.hydrateBoard({boardId:'4B22-1',rankingOperationRef:'base:ka10032',fetchImpl});
  assert.equal(request.ranking_operation_ref,'base:ka10032');
  assert.deepEqual(reply.ranking_result,projection);
  const mismatch = await bridge.hydrateBoard({boardId:'4B22-1',rankingOperationRef:'base:ka10030',fetchImpl});
  assert.equal(mismatch.ranking_result,null);
  assert.equal(bridge.buildHydrateBody({boardId:'13K0-2',rankingOperationRef:'base:ka10032'}).ranking_operation_ref,'base:ka10032');
  assert.equal(bridge.buildHydrateBody({boardId:'2X5N-0',rankingOperationRef:'base:ka10032'}).ranking_operation_ref,undefined);
});

function fixture(replyPromise) {
  const state={boardId:'4B22-1',rankingReturnBoard:'2X5N-0',rankingSourceBoard:'13K0-2',rankingSourceOperation:'base:ka00198',
    links:[{board_id:'4B22-1'},{board_id:'4A9H-1'}],
    rankingCriteria:{market:'001',liquidity:'all'},hydrationByBoard:new Map([['4B22-1',[]]]),hydrationWarnings:[],values:{},unbound:[],
    valuesByBoard:new Map(),unboundByBoard:new Map(),realtimeByBoard:new Map(),realtimeSlots:new Map()};
  const requests=[],mounts=[];
  const context=vm.createContext({rankingBoardControls:controls,cardStkCd:()=>'',boardStateOf:()=>state,boardHydrateAccount:()=>'',
    WATCH_SOURCE_SLOTS:watchSourceSlots,
    window:{athena:{invoke:async(_name,payload)=>{requests.push(payload);return replyPromise;}}},
    RETRYABLE_BOARD_HYDRATE_REASONS:new Set(['upstream_error']),boardHydrationError:()=>new Error('조회 실패'),
    boardMount:{nextHydrationSlots:()=>[],realtimeSlotIndex:()=>Object.assign(new Map(),{observationByBinding:new Map()}),mountBoard:(_host,id,_values,options)=>{mounts.push({id,options});return {updated:true};}},
    realtimeBindingsOf:()=>[],boardMountOptions:()=>({rankingResult:state.rankingResult}),rememberMountedBoard:()=>{},wireMountedBoardControls:()=>{},
    boardTemplateRegistry:{navigationTargetRequirement:()=>null,loadBoard:async()=>{}},destroyBoardPrimary:()=>{},
    openParentRankingMenu:(_surface,_filter,options)=>({options,close(){}}),
    stateLinksOf:()=>[],seedBoardState:()=>{},initialSurfaceContractOf:()=>null,
    runBoardSurfaceLoad:(_host,_envelope,load)=>load(()=>true),mountBoardState:(_host,id)=>{state.boardId=id;}});
  vm.runInContext(source.slice(source.indexOf('function excludeRetiredWatchlistSlots('), source.indexOf('function receiveWatchlistMetadata(')), context);
  vm.runInContext(source.slice(source.indexOf('function sectorHydratedPrimaryEnvelope('), source.indexOf('async function hydrateBoardSlots(')),context);
  for(const [start,end]of [['const RANKING_BOARD_OPERATIONS =','function boardHydrateAccount('],['async function hydrateBoardSlots(','function rememberMountedBoard('],
    ['function closeParentRankingFilter(','function wireStateControls('],['function clearRankingBoardCache(','function selectEtfReturnPeriod('],
    ['function selectRankingFilter(','function applyRankingCriteriaLabels('],['async function openBoardSurface(','// 봉투가 싣는 실시간 바인딩 표.']]) {
    const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);vm.runInContext(source.slice(a,b),context);
  }
  return {state,requests,mounts,context,host:{__athenaBoard:state}};
}

test('full-list query follows the current ranking and preserves source-specific filter semantics', async () => {
  const result={board_id:'4B22-1',operation_ref:'base:ka10030',rows:[],columns:[]};
  const f=fixture(Promise.resolve({ok:true,slot_values:{},ranking_result:result,operations:[]}));
  assert.equal(f.context.expandedRankingOperation(f.state),'base:ka10030');
  assert.equal(f.context.boardHydrateTarget({},f.host).mang_stk_incls,'0');
  f.state.rankingReturnBoard='13K0-2';
  assert.equal(f.context.expandedRankingOperation(f.state),'base:ka00198');
  assert.equal(f.context.boardHydrateTarget({},f.host).mang_stk_incls,'1');
  f.state.rankingReturnBoard='2X5N-0';
  await f.context.hydrateBoardSlots(f.host,{operation_ref:'base:ka00198'},{plan:{missing:[]}});
  assert.equal(f.requests[0].rankingOperationRef,'base:ka10030');
  assert.equal(f.mounts.length,1);
  assert.equal(f.mounts[0].options.rankingResult,result);
});

test('direct full-list entry interprets include flags using the verified query operation', async () => {
  for(const [operation,included] of [['base:ka10032','1'],['base:ka10030','0']]) {
    const f=fixture(Promise.resolve({}));
    await f.context.openBoardSurface(f.host,{board_id:'4B22-1'},{operation_ref:operation,operation_args:{mang_stk_incls:included}});
    assert.equal(f.state.rankingCriteria.liquidity,'all');
    assert.equal(f.context.expandedRankingOperation(f.state),operation);
    assert.equal(f.context.boardHydrateTarget({},f.host).mang_stk_incls,included);
  }
});

test('a filter opened inside the full list preserves its query source on return', async () => {
  const result={board_id:'4B22-1',operation_ref:'base:ka10030',rows:[],columns:[]};
  const f=fixture(Promise.resolve({ok:true,slot_values:{},ranking_result:result,operations:[]}));
  f.state.boardId='2X5N-0';
  f.context.switchStateBoard(f.host,'4B22-1',{});
  f.context.window.AthenaLib = {BoardPopoverLayout:{}};
  await f.context.switchStateBoard(f.host,'4A9H-1',{},'KOSPI');
  assert.equal(f.state.boardId,'4B22-1');
  assert.equal(f.state.rankingParentMenu.parentBoard,'4B22-1');
  assert.equal(f.state.rankingParentMenu.handle.options.unavailableReason,'');
  assert.equal(f.state.rankingReturnBoard,'2X5N-0');
  f.state.rankingResult={rows:[{stk_cd:'old'}]};
  f.context.selectRankingFilter(f.host,{}, {criteria:{market:'101'}});
  assert.equal(f.state.rankingResult,null);
  assert.equal(f.state.boardId,'4B22-1');
  assert.equal(f.context.expandedRankingOperation(f.state),'base:ka10030');
  assert.equal(f.context.boardHydrateTarget({},f.host).mang_stk_incls,'0');
  assert.equal(f.context.boardHydrateTarget({},f.host).mrkt_tp,'101');
  await f.context.hydrateBoardSlots(f.host,{},{});
  assert.equal(f.requests[0].rankingOperationRef,'base:ka10030');
  assert.equal(f.requests[0].target.mrkt_tp,'101');
});

test('late full-list replies cannot update a different active board', async () => {
  let resolve;
  const f=fixture(new Promise(done=>{resolve=done}));
  const pending=f.context.hydrateBoardSlots(f.host,{},{});
  f.state.boardId='2YNQ-0';
  resolve({ok:true,slot_values:{},ranking_result:{rows:[{stk_cd:'005930'}]},operations:[]});
  await pending;
  assert.equal(f.state.rankingResult,undefined);
  assert.equal(f.mounts.length,0);
});

const railGroups = [['s128','s129','s131','s132','s134'],['s145','s146'],['s147','s148'],['s149','s150']];
const railValues = {s128:'합성 첫 종목',s129:'000201',s131:100,s132:'5',s134:0,
  s145:'비교 A',s146:1,s147:'같은 비교 이름',s148:2,s149:'비교 C',s150:3,s043:100};
const railContract = (changes={}) => ({board_id:'13K0-2',ranking_rail_rows:railGroups.map((_,row)=>({
  row,source:'base:ka10032',code:'00020'+(row+1),empty_slots:[],...changes[row],
}))});
function explorerFixture(reply) {
  const f=fixture(reply);
  f.context.reconcileWatchlistState=(_state,contract)=>contract;
  Object.assign(f.state,{boardId:'13K0-2',rankingSourceOperation:'base:ka10032',values:{...railValues},
    surface:{},mountContract:{},emptyRowsByBoard:new Map(),emptyColumnsByBoard:new Map(),
    emptyValueSlotsByBoard:new Map(),deferredValueSlotsByBoard:new Map()});
  f.state.hydrationByBoard.set('13K0-2',['s131']);
  f.state.rankingRailRowsByBoard=new Map([['13K0-2',f.context.rankingRailRows(railContract())]]);
  f.context.slotValuesOf=c=>Array.isArray(c.slot_values)?Object.fromEntries(c.slot_values.map(e=>[e.slot_id,e.value])):c.slot_values;
  for(const[start,end]of [['function seedBoardState(','function boardMountOptions('],
    ['function applyBoardRealtimeTick(','function mountBoardState('],
    ['async function applyRealtimeFallbackData(','function handleRealtimeFallbackData(']]) {
    vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start))),f.context);
  }
  return f;
}

test('13K0 forwards selected source through canvas and IPC and rejects its own failed source',async()=>{
  for(const active of ['base:ka10032','base:ka00198']) {
    const contract=railContract(),f=explorerFixture(Promise.resolve({ok:true,slot_values:{s134:0},surface_contract:contract,operations:[]}));
    f.state.rankingSourceOperation=active;
    await f.context.hydrateBoardSlots(f.host,{operation_ref:'base:ka10032'},{});
    assert.equal(bridge.buildHydrateBody(f.requests[0]).ranking_operation_ref,active);
    assert.equal(f.state.values.s134,0);
  }
  const f=explorerFixture(Promise.resolve({ok:true,slot_values:{s129:'999999'},operations:[{operation_ref:'base:ka00198',status:'unbound',reason:'upstream_error'}]}));
  f.state.rankingSourceOperation='base:ka00198';
  await assert.rejects(f.context.hydrateBoardSlots(f.host,{operation_ref:'base:ka10032'},{}),/불러오지/);
  assert.equal(f.state.values.s129,'000201');assert.equal(f.mounts.length,0);
});

test('13K0 entry preserves explicit search source and the bridge carries row identities without expanded results',async()=>{
  for(const[operation,expected]of [['base:ka10032','base:ka10032'],['base:ka00198','base:ka00198'],['legacy','base:ka10032']]) {
    const f=fixture(Promise.resolve({}));
    await f.context.openBoardSurface(f.host,{board_id:'13K0-2'},{operation_ref:operation});
    assert.equal(f.context.selectedRankingRailSource(f.state),expected);
  }
  const contract=railContract(),reply=await bridge.hydrateBoard({boardId:'13K0-2',rankingOperationRef:'base:ka00198',fetchImpl:async()=>({
    ok:true,status:200,json:async()=>({surface_contract:contract,ranking_result:{board_id:'4B22-1',operation_ref:'base:ka00198',rows:[]}}),
  })});
  assert.deepEqual(reply.surface_contract.ranking_rail_rows,contract.ranking_rail_rows);
  assert.equal(reply.ranking_result,null);
});

test('13K0 same-code partials retain absent values and zero; changed comparison code clears only its own old rate',async()=>{
  const scenarios=[
    [railContract(),{s128:'표시 이름 변경'},v=>assert.equal(v.s131,100)],
    [railContract({0:{source:'base:ka00198'}}),{s128:'검색 표시'},v=>assert.equal(v.s134,0)],
    [railContract({0:{code:'999001'}}),{s129:'999001',s128:'새 종목'},v=>assert.equal(Object.hasOwn(v,'s131'),false)],
    [railContract({2:{code:'999002'}}),{s147:'같은 비교 이름'},v=>{assert.equal(Object.hasOwn(v,'s148'),false);assert.equal(v.s146,1);assert.equal(v.s131,100)}],
    [railContract({0:{code:'999003'}}),{s129:'999003',s131:0,s134:{value:0,text:'0'}},v=>{assert.equal(v.s131,0);assert.equal(v.s134.value,0)}],
    [railContract({0:{empty_slots:['s131']}}),{},v=>{assert.equal(Object.hasOwn(v,'s131'),false);assert.equal(v.s134,0)}],
    [{board_id:'13K0-2',ranking_rail_rows:[]},{},v=>assert.deepEqual(v,railValues)],
    [railContract(Object.fromEntries([0,1,2,3].map(row=>[row,{code:null}]))),{},v=>{for(const sid of railGroups.flat())assert.equal(Object.hasOwn(v,sid),false);assert.equal(v.s043,100)}],
    [{board_id:'13K0-2',ranking_rail_rows:[{row:99}]},{s129:'999999',s145:'새 비교'},v=>{assert.equal(Object.hasOwn(v,'s131'),false);assert.equal(Object.hasOwn(v,'s146'),false)}],
  ];
  for(const[contract,values,verify]of scenarios) {
    const f=explorerFixture(Promise.resolve({ok:true,slot_values:values,surface_contract:contract,operations:[]}));
    await f.context.hydrateBoardSlots(f.host,{},{});
    verify({...f.state.values});assert.equal(f.state.valuesByBoard.get('13K0-2'),f.state.values);
  }
});

test('13K0 stale completion and wrong-board replies do not clear row identity',async()=>{
  for(const gate of [false,true]) {
    let resolve;const f=explorerFixture(new Promise(done=>{resolve=done}));
    const pending=f.context.hydrateBoardSlots(f.host,{}, {},()=>gate);
    if(gate)f.state.boardId='2X5N-0';
    resolve({ok:true,slot_values:{s129:'999999'},surface_contract:railContract({0:{code:'999999'}}),operations:[]});
    await pending;assert.equal(f.state.values.s129,'000201');assert.equal(f.mounts.length,0);
  }
});

test('13K0 retired source-row bindings cannot overwrite a new stock or reattach on later hydrate; fresh envelope resets them',async()=>{
  const M=require('./board-mount');
  const old={...railContract(),slot_values:[{slot_id:'s131',value:100,observation_id:'obs_aaaaaaaaaaaaaaaaaaaa'},{slot_id:'s043',value:100,observation_id:'obs_aaaaaaaaaaaaaaaaaaaa'}]};
  const next={...railContract({0:{code:'999999'}}),slot_values:[{slot_id:'s131',value:0,observation_id:'obs_aaaaaaaaaaaaaaaaaaaa'}]};
  const binding={binding_id:'rtb_aaaaaaaaaaaa',observation_id:'obs_aaaaaaaaaaaaaaaaaaaa'};
  const f=explorerFixture(Promise.resolve({ok:true,slot_values:{s129:'999999',s131:0},surface_contract:next,operations:[]}));
  f.context.boardMount.realtimeSlotIndex=M.realtimeSlotIndex;f.context.realtimeBindingsOf=()=>[binding];
  f.context.boardMount.updateRealtimeValue=M.updateRealtimeValue;f.context.boardMount.applyRealtimeSlots=()=>{};
  f.context.semanticWorkspace={semanticRealtimeUpdates:()=>[{bindingId:binding.binding_id,value:777777}]};
  f.state.realtimeSlots=M.realtimeSlotIndex(old,[binding]);
  for(let pass=0;pass<2;pass++) {
    f.state.hydrationByBoard.set('13K0-2',['s131']);
    await f.context.hydrateBoardSlots(f.host,{},{});
    assert.equal(f.state.realtimeSlots.get(binding.binding_id).includes('s131'),false);
    assert.equal(f.state.realtimeSlots.get(binding.binding_id).includes('s043'),true);
    f.context.applyBoardRealtimeTick(f.host,{});assert.equal(f.state.values.s131,0);assert.equal(f.state.values.s043,777777);
  }
  f.context.seedBoardState(f.state,next,{});f.context.activateBoardState(f.state,'13K0-2');
  assert.equal(f.state.rankingRailRetiredByBoard.get('13K0-2').size,0);
  assert.equal(f.state.realtimeSlots.get(binding.binding_id).includes('s131'),true);
  f.context.clearRankingBoardCache(f.state);
  assert.equal(f.state.rankingRailRowsByBoard.has('13K0-2'),false);
  assert.equal(f.state.rankingRailRetiredByBoard.has('13K0-2'),false);
});

test('13K0 REST slot patches preserve same identity and clear changed or legacy comparison identities',async()=>{
  const f=explorerFixture(Promise.resolve({})),session={kind:'integrated-board',card:{querySelector:()=>f.host},slotIds:railGroups.flat(),envelope:{}};
  const payload={kind:session.kind,source:'kiwoom-rest',transport:'rest-fallback',mode:'slot-patch',boardId:'13K0-2',slotValues:{s134:0},surface_contract:railContract()};
  assert.equal(await f.context.applyRealtimeFallbackData(session,payload),true);assert.equal(f.state.values.s131,100);
  await f.context.applyRealtimeFallbackData(session,{...payload,slotValues:{s129:'999999',s131:0},surface_contract:railContract({0:{code:'999999'}})});
  assert.equal(f.state.values.s131,0);assert.equal(Object.hasOwn(f.state.values,'s134'),false);
  await f.context.applyRealtimeFallbackData(session,{...payload,slotValues:{s147:'새 비교 이름'},surface_contract:undefined});
  assert.equal(Object.hasOwn(f.state.values,'s148'),false);assert.equal(f.state.values.s146,1);
});

test('actual REST fallback projector preserves rail metadata through the canvas consumer',async()=>{
  const main=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8');
  const start=main.indexOf('function projectRealtimeFallbackResult('),end=main.indexOf('async function refreshRealtimeFallback(',start);
  for(const[values,code,verify]of [
    [{s147:'동일 종목 표시 이름'},'000203',state=>assert.equal(state.values.s148,2)],
    [{s148:0},'999203',state=>{assert.equal(Object.hasOwn(state.values,'s147'),false);assert.equal(state.values.s148,0)}],
  ]) {
    const f=explorerFixture(Promise.resolve({}));vm.runInContext(main.slice(start,end),f.context);
    const session={kind:'integrated-board',card:{querySelector:()=>f.host},slotIds:['s147','s148'],envelope:{}};
    const projected=f.context.projectRealtimeFallbackResult({kind:session.kind,boardId:'13K0-2',slotIds:session.slotIds},
      {slotValues:values,surfaceContract:railContract({2:{code}})});
    assert.ok(projected.surfaceContract);assert.equal(projected.surface_contract,undefined);
    const payload={kind:session.kind,source:'kiwoom-rest',transport:'rest-fallback',...projected};
    assert.equal(await f.context.applyRealtimeFallbackData(session,payload),true);
    verify(f.state);assert.equal(f.state.rankingRailRowsByBoard.get('13K0-2').get(2).code,code);
    assert.equal(f.state.values.s043,100);
  }
});

test('production fallback authority creation, hydrate update and refresh retain only the 13K0 selected source',async()=>{
  const main=fs.readFileSync(new URL('../main.js',import.meta.url),'utf8');
  for(const[boardId,operation,expected]of [['13K0-2','base:ka00198','base:ka00198'],['13K0-2','base:ka10032','base:ka10032'],['2X5N-0','base:ka00198',undefined]]) {
    const f=explorerFixture(Promise.resolve({})),authorities=new Map(),requests=[],sender={},handlers=new Map();
    const contract=railContract({2:{code:'999203'}});
    Object.assign(f.context,{realtimeFallbackAuthorities:authorities,realtimeAccountGeneration:1,
      restCorrelationKey:c=>c?.key||'',crypto:{randomUUID:()=> 'fixture-uuid'},isQueryOnlyRetryDataset:()=>true,
      activeRestAccountId:()=> 'fixture-account',process:{env:{}},shellWin:{isDestroyed:()=>false,webContents:sender},orbWin:null,
      restPaintWaiters:new Map(),ipcMain:{handle:(key,fn)=>handlers.set(key,fn)},
      hydrateCanvasBoardForActiveAccount:async payload=>{requests.push(payload);return {ok:true,board_id:boardId,slot_values:{s148:0},surface_contract:{...contract,board_id:boardId}};},
    });
    for(const[start,end]of [['function rememberRealtimeFallbackAuthority(','function rememberLiveRealtimeFallbackAuthority('],
      ['function projectRealtimeFallbackResult(','function sendRealtimeFallbackEvent('],
      ["ipcMain.handle('athena:canvas-board-hydrate',",'function emitRestReceiptAndWaitForPaint(']]) {
      const a=main.indexOf(start),b=main.indexOf(end,a);assert.ok(a>=0&&b>a);vm.runInContext(main.slice(a,b),f.context);
    }
    f.context.rememberRealtimeFallbackAuthority({operationRef:operation,operationArgs:{mrkt_tp:'001'},
      envelope:{correlation:{key:'fixture'},surface_contract:{board_id:boardId}}});
    assert.equal(authorities.get('fixture').boardHydrate.rankingOperationRef,expected);
    const descriptor={kind:'integrated-board',accountGeneration:1,authorityKey:'fixture',boardId,slotIds:['s147','s148']};
    await f.context.refreshRealtimeFallback(descriptor);
    assert.equal(requests.at(-1).rankingOperationRef,expected);
    const replacement=operation==='base:ka00198'?'base:ka10032':'base:ka00198';
    await handlers.get('athena:canvas-board-hydrate')({sender},{boardId,rankingOperationRef:replacement,target:{mrkt_tp:'101'},correlation:{key:'fixture'}});
    const updated=boardId==='13K0-2'?replacement:undefined;
    assert.equal(authorities.get('fixture').boardHydrate.rankingOperationRef,updated);
    const refreshed=await f.context.refreshRealtimeFallback(descriptor);
    assert.equal(requests.at(-1).rankingOperationRef,updated);assert.equal(requests.at(-1).target.mrkt_tp,'101');
    if(boardId==='13K0-2') {
      const projected=f.context.projectRealtimeFallbackResult(descriptor,refreshed);
      const session={kind:'integrated-board',card:{querySelector:()=>f.host},slotIds:descriptor.slotIds,envelope:{}};
      await f.context.applyRealtimeFallbackData(session,{kind:session.kind,source:'kiwoom-rest',transport:'rest-fallback',...projected});
      assert.equal(f.state.values.s148,0);assert.equal(Object.hasOwn(f.state.values,'s147'),false);
    }
  }
});

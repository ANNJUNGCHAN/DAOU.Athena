import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const bridge = require('./main/board-hydrate');
const controls = require('./ranking-board-controls');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');

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
  assert.equal(bridge.buildHydrateBody({boardId:'13K0-2',rankingOperationRef:'base:ka10032'}).ranking_operation_ref,undefined);
});

function fixture(replyPromise) {
  const state={boardId:'4B22-1',rankingReturnBoard:'2X5N-0',rankingSourceBoard:'13K0-2',rankingSourceOperation:'base:ka00198',
    links:[{board_id:'4B22-1'},{board_id:'4A9H-1'}],
    rankingCriteria:{market:'001',liquidity:'all'},hydrationByBoard:new Map([['4B22-1',[]]]),hydrationWarnings:[],values:{},unbound:[],
    valuesByBoard:new Map(),unboundByBoard:new Map(),realtimeByBoard:new Map(),realtimeSlots:new Map()};
  const requests=[],mounts=[];
  const context=vm.createContext({rankingBoardControls:controls,cardStkCd:()=>'',boardStateOf:()=>state,boardHydrateAccount:()=>'',
    window:{athena:{invoke:async(_name,payload)=>{requests.push(payload);return replyPromise;}}},
    RETRYABLE_BOARD_HYDRATE_REASONS:new Set(['upstream_error']),boardHydrationError:()=>new Error('조회 실패'),
    boardMount:{nextHydrationSlots:()=>[],realtimeSlotIndex:()=>Object.assign(new Map(),{observationByBinding:new Map()}),mountBoard:(_host,id,_values,options)=>{mounts.push({id,options});return {updated:true};}},
    realtimeBindingsOf:()=>[],boardMountOptions:()=>({rankingResult:state.rankingResult}),rememberMountedBoard:()=>{},wireMountedBoardControls:()=>{},
    boardTemplateRegistry:{navigationTargetRequirement:()=>null},destroyBoardPrimary:()=>{},
    stateLinksOf:()=>[],seedBoardState:()=>{},initialSurfaceContractOf:()=>null,
    runBoardSurfaceLoad:(_host,_envelope,load)=>load(()=>true),mountBoardState:(_host,id)=>{state.boardId=id;}});
  for(const [start,end]of [['const RANKING_BOARD_OPERATIONS =','function boardHydrateAccount('],['async function hydrateBoardSlots(','function rememberMountedBoard('],
    ['function switchStateBoard(','function wireStateControls('],['function clearRankingBoardCache(','function selectEtfReturnPeriod('],
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
  f.context.switchStateBoard(f.host,'4A9H-1',{},'KOSPI');
  assert.equal(f.state.rankingReturnBoard,'4B22-1');
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

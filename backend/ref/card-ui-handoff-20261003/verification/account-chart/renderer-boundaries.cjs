'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../../../../../app/canvas.js'),'utf8').replace(/\r\n/g,'\n');
const start=source.indexOf('async function mountBoardPrimary('),end=source.indexOf('\n}\n',start);
assert.ok(start>=0&&end>start);const fn=source.slice(start,end+2);
function environment(){
 const surface={};const state={surface,primaryRemount:{panelId:'public-old',generation:1},primaryPanelId:''};
 const notes=[],settled=[],cancelled=[];let rejectInvoke,resolvePaint,draws=0,destroys=0,removed=0;
 const card={dataset:{sessionCardId:'public-card'},__athenaSessionCard:{envelope:{correlation:{dataset_id:'public',item_id:'chart',ordinal:1}}}};
 const host={isConnected:true,closest:()=>card};const point={isConnected:true,dataset:{},prepend:x=>notes.push(x),appendChild() {}};
 const mounted={surface,primary:{renderer:'chart',mountPoint:point}};
 const context=vm.createContext({boardStateOf:()=>state,BOARD_ORDERBOOK_RENDERER:'hoga',BOARD_CHART_RENDERER:'chart',boardPrimaryAcceptsEnvelope:()=>true,
  settleBoardChartMount:(_,x)=>settled.push(x),errorNote:x=>x,
  window:{athena:{invoke:(channel)=>channel==='athena:cancel-chart-remount'?(cancelled.push(channel),Promise.resolve(true)):new Promise((resolve,reject)=>{rejectInvoke=reject;context.reply=resolve;}),send(){}}},
  boardChartDescriptor:()=>({rendererId:'aits-chart-v1',panelId:'public-new'}),beginBoardChartMount(){},
  boardMount:{collapsePrimaryMockup:()=>[],restorePrimaryMockup(){}},
  document:{createElement:()=>({style:{},remove(){removed++;}})},releaseBoardChartPanel(){},
  mountAitsChartPanel:async()=>{draws++;return {body:{candles:[{}]},generation:1,destroy(){destroys++;}};},
  waitForVisiblePaint:()=>new Promise(resolve=>{resolvePaint=resolve;}),startBoardChartRefresh(){},setBoardChartStatus(){},clearBoardChartIdentity(){}
 });vm.runInContext(fn,context);
 return {context,state,host,mounted,notes,settled,cancelled,reject:()=>rejectInvoke(Error('public rejection')),paint:()=>resolvePaint({verifiedVisible:true}),counters:()=>({draws,destroys,removed})};
}
(async()=>{
 const first=environment();const p=first.context.mountBoardPrimary(first.host,{},first.mounted);
 first.state.primaryRemount={panelId:'public-newer',generation:1};first.reject();await p;
 assert.equal(first.notes.length,0);assert.deepEqual(first.settled,[]);
 const second=environment();const q=second.context.mountBoardPrimary(second.host,{},second.mounted);
 second.context.reply({ok:true,token:'public-ticket',envelope:{operation_ref:'public',correlation:{dataset_id:'public-next',item_id:'chart',ordinal:1}}});
 for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(second.counters().draws,1);second.state.surface={};second.paint();await q;
 assert.deepEqual(second.counters(),{draws:1,destroys:1,removed:1});assert.equal(second.cancelled.length,1);
 const {createChartRemounts}=require(path.resolve(__dirname,'../../../../../app/lib/main/chart-remount.js'));
 let uid=0;const leases=createChartRemounts({correlationKey:x=>x&&x.dataset_id,panelIdFor:x=>x.correlation.dataset_id,randomUUID:()=> 'public-new-'+(++uid)});
 const correlation={dataset_id:'public-old'},paint={renderState:'data',rendererId:'aits-chart-v1',panelId:'public-old',generation:1};
 const authority={accountId:'public-account',correlation,operationRef:'public-day',operationArgs:{},chartBody:{},chartMeta:{}};
 leases.remember({key:'public-old',paint,authority,envelope:{correlation,data:{}},senderId:11,conversationId:'public-conversation',accountGeneration:1});
 leases.retire('public-old');
 assert.throws(()=>leases.begin({correlation,panelId:'public-old',generation:2,cardId:'public-card'},{senderId:11,conversationId:'public-conversation',accountGeneration:1,accountId:'public-account',cardId:'public-card',cardKey:'public-old'}));
 console.log(JSON.stringify({decision:'AUTHOR_BOUNDARY_REPROS_PASS',actualRendererRepros:[{case:'stale lease rejection same surface changed retired identity',notes:first.notes.length,settled:first.settled},{case:'surface change during visible paint await',...second.counters(),cancellations:second.cancelled.length}],helperGeneration2:'REJECTED after initial generation1 memory, production period update integration missing',productWrites:0,rendererProcessLaunches:0,networkCalls:0},null,2));
})().catch(e=>{console.error(e.name+': '+e.message);process.exitCode=1});

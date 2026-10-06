const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const raw=fs.readFileSync(path.join(__dirname,'renderer-boundaries.cjs'),'utf8');
const prefix=raw.slice(0,raw.indexOf('(async()=>{'));
const {environment}=new Function('require','__dirname',prefix+'return {environment};')(require,__dirname);
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function newer(h){const attempt={};h.state.primaryMount=attempt;h.state.primaryPanelId='public-newer';h.mounted.primary.mountPoint.dataset.bsPrimaryMounted='public-newer-marker';return attempt;}
function preserved(h,attempt){assert.deepEqual(h.settled,[]);assert.equal(h.mounted.primary.mountPoint.dataset.bsPrimaryMounted,'public-newer-marker');assert.equal(h.state.primaryPanelId,'public-newer');assert.equal(h.state.primaryMount,attempt);}
(async()=>{
 const out=[];
 const rejectMount=environment();rejectMount.state.primaryRemount=null;let reject;
 rejectMount.context.mountAitsChartPanel=()=>new Promise((_,no)=>{reject=no;});
 const pending=rejectMount.context.mountBoardPrimary(rejectMount.host,{},rejectMount.mounted);await flush();
 const newerAttempt=newer(rejectMount);reject(Error('public mount rejection'));await pending;
 preserved(rejectMount,newerAttempt);assert.equal(rejectMount.counters().removed,1);out.push({case:'independent V2 old mount reject after newer marker/attempt',result:'PASS',...rejectMount.counters()});
 const paintReject=environment();let rejectPaint;
 paintReject.context.waitForVisiblePaint=()=>new Promise((_,no)=>{rejectPaint=no;});
 const paintPending=paintReject.context.mountBoardPrimary(paintReject.host,{},paintReject.mounted);
 paintReject.context.reply({ok:true,token:'public-ticket',envelope:{operation_ref:'public',correlation:{dataset_id:'public-next',item_id:'chart',ordinal:1}}});await flush();
 const paintNewer=newer(paintReject);rejectPaint(Error('public paint rejection'));await paintPending;
 preserved(paintReject,paintNewer);assert.deepEqual(paintReject.counters(),{draws:1,destroys:1,removed:1});out.push({case:'old visible-paint rejection after newer marker/attempt',result:'PASS',...paintReject.counters()});
 const resolves=environment();resolves.state.primaryRemount=null;let resolve;
 resolves.context.mountAitsChartPanel=()=>new Promise(yes=>{resolve=yes;});
 const resolvesPending=resolves.context.mountBoardPrimary(resolves.host,{},resolves.mounted);await flush();
 const resolvesNewer=newer(resolves);let closed=0;
 resolve({body:{candles:[{}]},generation:1,destroy(){closed++;}});await resolvesPending;
 preserved(resolves,resolvesNewer);assert.equal(closed,1);assert.equal(resolves.counters().removed,1);out.push({case:'old resolved mount after newer marker/attempt',result:'PASS',oldSessionDestroyed:closed});
 const current=environment();current.state.primaryRemount=null;
 current.context.mountAitsChartPanel=async()=>{throw Error('public current owner failure');};
 await current.context.mountBoardPrimary(current.host,{},current.mounted);
 assert.equal(current.notes.length,1);assert.deepEqual(current.settled,['error']);out.push({case:'current-owner genuine failure remains visible',result:'PASS',notes:current.notes.length,settled:current.settled});
 fs.writeFileSync(path.join(__dirname,'AWAIT-BOUNDARIES.json'),JSON.stringify({cases:out,productWrites:0,rendererProcesses:0,providerCalls:0},null,2)+'\n');console.log(JSON.stringify(out));
})().catch(e=>{console.error(e);process.exitCode=1;});

const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const outcomes=[{"script":"check-v2.cjs","exit":0},{"script":"await-boundaries.cjs","exit":0}];
const raw=fs.readFileSync(path.join(__dirname,'renderer-boundaries.cjs'),'utf8'),prefix=raw.slice(0,raw.indexOf('(async()=>{'));
const {environment}=new Function('require','__dirname',prefix+'return {environment};')(require,__dirname);
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
(async()=>{
 const extra=[];
 const mutations={surface:h=>h.state.surface={},host:h=>h.host.isConnected=false,point:h=>h.mounted.primary.mountPoint.isConnected=false,retired:h=>h.state.primaryRemount={panelId:'public-newer',generation:1}};
 for(const [kind,change]of Object.entries(mutations)){
  const h=environment();const pending=h.context.mountBoardPrimary(h.host,{},h.mounted);change(h);h.reject();await pending;
  extra.push({case:'invoke-reject/'+kind,notes:h.notes.length,settled:h.settled,pass:h.notes.length===0&&h.settled.length===0});
 }
 for(const [kind,change]of Object.entries(mutations)){
  const h=environment();let rejectPaint;h.context.waitForVisiblePaint=()=>new Promise((_,reject)=>{rejectPaint=reject;});
  const pending=h.context.mountBoardPrimary(h.host,{},h.mounted);
  h.context.reply({ok:true,token:'public-ticket',envelope:{operation_ref:'public',correlation:{dataset_id:'public-next',item_id:'chart',ordinal:1}}});await flush();
  change(h);h.mounted.primary.mountPoint.dataset.bsPrimaryMounted='public-owner-marker';rejectPaint(Error('public paint rejection'));await pending;
  extra.push({case:'paint-reject/'+kind,notes:h.notes.length,settled:h.settled,marker:h.mounted.primary.mountPoint.dataset.bsPrimaryMounted,counters:h.counters(),pass:h.notes.length===0&&h.settled.length===0&&h.mounted.primary.mountPoint.dataset.bsPrimaryMounted==='public-owner-marker'&&h.counters().destroys===1&&h.counters().removed===1});
 }
 const current=environment();current.context.waitForVisiblePaint=async()=>{throw Error('public paint rejection');};
 const pending=current.context.mountBoardPrimary(current.host,{},current.mounted);current.context.reply({ok:true,token:'public-ticket',envelope:{operation_ref:'public',correlation:{dataset_id:'public-next',item_id:'chart',ordinal:1}}});await pending;
 extra.push({case:'current-owner-paint-reject',notes:current.notes,settled:current.settled,counters:current.counters(),pass:current.notes.length===1&&current.settled.join()==='error'&&current.counters().destroys===1&&current.counters().removed===1});
 const result={outcomes,extra,pass:extra.filter(x=>x.pass).length,fail:extra.filter(x=>!x.pass).length,productWrites:0,nativeProviderNetwork:0};
 fs.writeFileSync(path.join(__dirname,'INDEPENDENT-RESULT.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));assert.equal(result.fail,0,'stale owner failure guard missing');
})().catch(e=>{console.error(e.message);process.exitCode=1;});

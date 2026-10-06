'use strict';
// PREPARED ONLY. Root must grant the isolated renderer slot before execution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{app,BrowserWindow,session}=require('electron');
const dir=__dirname,root=path.resolve(dir,'../../../../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'PORTABLE-MANIFEST.json')));
const mode=process.argv.find(a=>a.startsWith('--fixture-mode='))?.split('=')[1];if(!['baseline','candidate'].includes(mode))throw Error('Explicit variant required');
for(const [file,pin]of Object.entries({...manifest.phaseFiles,...manifest.snapshot}))if(sha(fs.readFileSync(path.join(dir,file)))!==pin)throw Error('Phase identity failed');
for(const [file,pin]of Object.entries(manifest.livePins))if(sha(fs.readFileSync(path.join(root,file)))!==pin)throw Error('Shared live source identity failed');
const out=path.join(root,'.omc/artifacts/card-ui-handoff-resume/rest-state/runs',mode);if(fs.existsSync(out))throw Error('Existing run must be preserved');fs.mkdirSync(out,{recursive:true});app.setName('AthenaPublicRestState-'+mode);app.setPath('userData',path.join(out,'isolated-public-profile'));app.disableHardwareAcceleration();
let win;const states=[],captures=[],network=[],exceptions=[];const allowed=new Set(manifest.exceptions);const safeName=error=>allowed.has(error?.name)?error.name:'UnclassifiedError';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;fs.writeFileSync(path.join(out,'run-error.json'),JSON.stringify({pid:process.pid,category:'FixtureTimeout',timedOut:true,rawErrorExcluded:true}));if(win&&!win.isDestroyed())win.destroy();app.exit(2);},90000);
const call=(method,...args)=>win.webContents.executeJavaScript('restPublic.'+method+'('+args.map(a=>JSON.stringify(a)).join(',')+')');
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('rest-state-public-'+mode+'-'+process.pid);isolated.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(details,cb)=>{network.push({scheme:details.url.split(':')[0]});cb({cancel:true});});
 win=new BrowserWindow({show:false,width:2560,height:1392,webPreferences:{session:isolated,offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());win.webContents.on('console-message',event=>{if(event.level==='error')exceptions.push('RendererConsoleError');});
 await win.loadFile(path.join(dir,mode+'.html'));await win.webContents.executeJavaScript('document.fonts.ready');
 for(let ordinal=0;ordinal<manifest.cases.length;ordinal++){
  const entry=manifest.cases[ordinal];const mounted=await call('mount',entry);
  for(const stage of manifest.stages){win.setContentSize(stage.width,stage.height);await pause(120);const measured=await call('measure',stage.id);const name=String(ordinal+1).padStart(2,'0')+'-'+entry.id+'-'+stage.id;states.push({ordinal:ordinal+1,caseId:entry.id,stage:stage.id,viewport:win.getContentSize(),mounted,...measured});win.webContents.invalidate();await pause(90);const png=(await win.webContents.capturePage()).toPNG();fs.writeFileSync(path.join(out,name+'.png'),png);captures.push({ordinal:ordinal+1,stage:stage.id,path:name+'.png',sha256:sha(png)});}
 }
 const cleanup=await call('destroy');clearTimeout(timeout);const sourceUnchanged=Object.entries(manifest.livePins).every(([file,pin])=>sha(fs.readFileSync(path.join(root,file)))===pin);
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({mode,pid:process.pid,ppid:process.ppid,states,captures,cleanup,sourceUnchanged,network,exceptions,timedOut,productWrites:0,providerCalls:0,privateReads:0},null,2)+'\n');console.log(JSON.stringify({mode,pid:process.pid,states:states.length,captures:captures.length,cleanup,sourceUnchanged,networkCount:network.length,exceptionCount:exceptions.length}));win.destroy();app.quit();
}).catch(error=>{clearTimeout(timeout);fs.writeFileSync(path.join(out,'run-error.json'),JSON.stringify({pid:process.pid,category:safeName(error),timedOut,rawErrorExcluded:true}));if(win&&!win.isDestroyed())win.destroy();app.exit(1);});

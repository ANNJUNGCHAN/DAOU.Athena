'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../../../..');
const excerpt=(text,start,end)=>{const a=text.indexOf(start),b=text.indexOf(end,a);assert.ok(a>=0&&b>a,'source boundary '+start);return text.slice(a,b);};
const source=fs.readFileSync(path.join(root,'app/canvas.js'),'utf8');
const extracted=[
 excerpt(source,'function attachRestRetryAction(',"window.athena.on('athena:rest-retry-available'"),
 excerpt(source,'function paintedDataCardsFor(','function renderLiveNotice('),
 excerpt(source,'function makeCard(','async function addCard('),
].join('\n').replace(/\r\n/g,'\n');
const consumer=fs.readFileSync(path.join(__dirname,'snapshot/candidate/consumer.js'),'utf8').replace(/\r\n/g,'\n');
assert.equal(consumer,extracted,'candidate consumer must be extracted from installed canvas.js');
assert.deepEqual(fs.readFileSync(path.join(__dirname,'snapshot/candidate/canvas.css')),fs.readFileSync(path.join(root,'app/canvas.css')),'candidate CSS must equal installed canvas.css');
assert.match(source,/card\.dataset\.restState = envelope\.state;/,'REST renderer marker');
assert.doesNotMatch(source.slice(source.indexOf('function stampWorkflowState('),source.indexOf('function taskRealtimeLifecycle(')),/restState/,'workflow stamping must not gain REST marker');
console.log(JSON.stringify({status:'CURRENT_SOURCE_EXTRACTION_PASS',consumerBytes:Buffer.byteLength(consumer),cssBytes:fs.statSync(path.join(root,'app/canvas.css')).size}));

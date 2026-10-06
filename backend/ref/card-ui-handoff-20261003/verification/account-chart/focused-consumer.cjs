'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../../..');
const { createChartReloadAuthority } = require(path.join(root, 'app/lib/main/chart-reload'));
const paintModule = require(path.join(root, 'app/lib/rest-canvas-paint'));
const panelModule = require(path.join(root, 'app/lib/aits-chart-panel'));
const { createChartRemounts } = require(path.join(root,'app/lib/main/chart-remount'));
const { performance } = require('node:perf_hooks');
const keyOf = paintModule.correlationKey;
const envelope = {
  renderer_id: 'aits-chart-v1', canvas_type: 'chart', operation_ref: 'base:ka10081',
  operation_args: { stk_cd: 'QA0001', base_dt: '20261001', upd_stkpc_tp: '1' },
  correlation: { dataset_id: 'public-original', item_id: 'chart', ordinal: 1 },
  data: { symbol: 'QA0001', chart: { period: 'day', target: 'stock', trId: 'ka10081', candles: [{ time: 1600000000, open: 10, high: 11, low: 9, close: 10, volume: 100 }] },
    chart_meta: { series_scope: 'stock', reload_group: 'stock', reload_targets: {
      day: { operation_ref: 'base:ka10081', request_fields: ['stk_cd','base_dt','upd_stkpc_tp'] },
      week: { operation_ref: 'base:ka10082', request_fields: ['stk_cd','base_dt','upd_stkpc_tp'] },
    } },
  },
};
function ipcSource(source, kind, channel) {
  const start = source.indexOf(`ipcMain.${kind}('${channel}',`);
  if (start < 0) throw new Error('Missing actual IPC source ' + channel);
  const end = source.indexOf('\n});', start);
  return source.slice(start, end + 4);
}
function functionSource(source, name, async = false) {
  const start = source.indexOf(`${async ? 'async ' : ''}function ${name}(`);
  const end = source.indexOf('\n}\n', start);
  if (start < 0 || end < 0) throw new Error('Missing actual function ' + name);
  return source.slice(start, end + 2);
}
function harness(mode) {
  const source = fs.readFileSync(mode === 'candidate' ? path.join(root,'app/main.js') : path.join(__dirname,'main.baseline.js'), 'utf8').replace(/\r\n/g, '\n');
  const handlers = new Map();
  let sequence = 0;
  const remounts = createChartRemounts({ correlationKey: keyOf, panelIdFor: panelModule.panelIdFor, randomUUID: () => `public-lease-${++sequence}` });
  const authority = createChartReloadAuthority({ today: () => '20261001' });
  const sender = { id: 11, send() {} };
  const state = { conversationId: 'public-conversation', accountId: 'public-account', generation: 1, cards: [{cardId:'public-card',envelope}] };
  const waiters = new Map();
  const context = vm.createContext({
    ipcMain: { on: (channel, fn) => handlers.set(channel, fn), handle: (channel, fn) => handlers.set(channel, fn) },
    shellWin: { isDestroyed: () => false, webContents: sender },
    chartReloadAuthority: authority, chartRemounts: remounts,
    restCorrelationKey: keyOf, decidePaintAck: paintModule.decidePaintAck,
    timedOutPaint: paintModule.timedOutPaint, PENDING_MOUNT_ACK_TIMEOUT_MS: 30000,
    restPaintWaiters: waiters, chartRealtimePanelSymbols: new Map(), ensureChartRealtime() {},
    setTimeout: () => 1, clearTimeout() {}, performance, revealShell() {}, rememberRealtimeFallbackAuthority() {},
    getSessionBridge: () => ({ flush() {}, load: () => ({ canvasCards: state.cards }) }),
    historyConversationId: () => state.conversationId, activeRestAccountId: () => state.accountId,
    realtimeAccountGeneration: 1,
  });
  const execute = s => vm.runInContext(s, context);
  execute(functionSource(source, 'emitRestCanvasAndWaitForPaint', true));
  execute(ipcSource(source, 'on', 'athena:rest-canvas-painted'));
  execute(ipcSource(source, 'on', 'athena:chart-panel-destroyed'));
  if (mode === 'candidate') {
    execute(functionSource(source, 'chartRemountContext'));
    execute(ipcSource(source, 'handle', 'athena:remount-chart-panel'));
    execute(ipcSource(source, 'handle', 'athena:cancel-chart-remount'));
  }
  const initial = context.emitRestCanvasAndWaitForPaint({ envelope, operationRef: envelope.operation_ref,
    operationArgs: envelope.operation_args, canvasType: 'chart', accountId: state.accountId }, { conversationId: state.conversationId });
  const originalPanel = panelModule.panelIdFor({ correlation: envelope.correlation });
  const event = { sender };
  const paint = correlation => ({...correlation,render_state:'data',renderer_id:'aits-chart-v1',panel_id:panelModule.panelIdFor({correlation}),generation:1,verified_visible:true,pending:false});
  handlers.get('athena:rest-canvas-painted')(event, paint(envelope.correlation));
  initial.catch(() => {});
  assert.equal(authority.buildDataset({panelId:originalPanel,generation:1,period:'W'}).items[0].operationRef,'base:ka10082');
  handlers.get('athena:chart-panel-destroyed')(event,{panelId:originalPanel});
  const request = {correlation:envelope.correlation,cardId:'public-card',panelId:originalPanel,generation:1};
  return {handlers,authority,context,state,event,paint,originalPanel,request,waiters};
}
const observations = [];
assert.equal(panelModule.parseAitsChartSnapshot(envelope).body.candles.length, 1);
const baseline = harness('baseline');
// Actual baseline main callback ignores a repeated original-correlation paint: no waiter exists.
baseline.handlers.get('athena:rest-canvas-painted')(baseline.event,baseline.paint(envelope.correlation));
assert.throws(() => baseline.authority.buildDataset({panelId:baseline.originalPanel,generation:1,period:'W'}), /권위가 없는 패널/);
observations.push({name:'original verified paint -> destroy -> local remount ACK -> week reload',baseline:'FAIL missing authority',consumer:'actual main IPC callbacks + actual chart-reload'});
const candidate = harness('candidate');
const reply = candidate.handlers.get('athena:remount-chart-panel')(candidate.event,candidate.request);
assert.notEqual(reply.envelope.correlation.dataset_id,envelope.correlation.dataset_id);
const freshPanel = panelModule.panelIdFor({correlation:reply.envelope.correlation});
assert.equal(panelModule.parseAitsChartSnapshot(reply.envelope).body.candles.length, 1);
assert.notEqual(freshPanel,candidate.originalPanel);
assert.throws(() => candidate.authority.buildDataset({panelId:freshPanel,generation:1,period:'W'}), /권위가 없는 패널/);
candidate.handlers.get('athena:rest-canvas-painted')(candidate.event,candidate.paint(reply.envelope.correlation));
assert.equal(candidate.authority.buildDataset({panelId:freshPanel,generation:1,period:'W'}).items[0].operationRef,'base:ka10082');
assert.throws(() => candidate.authority.buildDataset({panelId:candidate.originalPanel,generation:1,period:'W'}), /권위가 없는 패널/);
observations.push({name:'one-shot fresh primary paint -> week reload',candidate:'PASS',retiredPanelStillRejected:true,newPanelIdentity:true});
for (const name of ['wrong-sender','unknown-card','other-conversation','changed-account','changed-account-generation','forged-correlation','retired-generation','wrong-panel']) {
  const h = harness('candidate');
  let event=h.event; const request={...h.request};
  if(name==='wrong-sender')event={sender:{id:12}};
  if(name==='unknown-card')request.cardId='unowned-card';
  if(name==='other-conversation')h.state.conversationId='other-public-conversation';
  if(name==='changed-account')h.state.accountId='other-public-account';
  if(name==='changed-account-generation')h.context.realtimeAccountGeneration=2;
  if(name==='forged-correlation')request.correlation={...request.correlation,dataset_id:'forged'};
  if(name==='retired-generation')request.generation=0;
  if(name==='wrong-panel')request.panelId='unowned-panel';
  assert.throws(()=>h.handlers.get('athena:remount-chart-panel')(event,request));
  observations.push({name,candidate:'REJECTED'});
}
const cancelled = harness('candidate');
const cancelledReply=cancelled.handlers.get('athena:remount-chart-panel')(cancelled.event,cancelled.request);
assert.equal(cancelled.handlers.get('athena:cancel-chart-remount')(cancelled.event,{...cancelled.request,token:cancelledReply.token}),true);
cancelled.handlers.get('athena:rest-canvas-painted')(cancelled.event,cancelled.paint(cancelledReply.envelope.correlation));
assert.throws(()=>cancelled.authority.buildDataset({panelId:panelModule.panelIdFor({correlation:cancelledReply.envelope.correlation}),generation:1,period:'W'}));
observations.push({name:'cancelled lease late paint',candidate:'REJECTED'});
for (const name of ['disposed-card-before-paint','conversation-change-before-paint','account-generation-change-before-paint','wrong-generation-paint']) {
  const h = harness('candidate');
  const reply = h.handlers.get('athena:remount-chart-panel')(h.event,h.request);
  if (name === 'disposed-card-before-paint') h.state.cards = [];
  if (name === 'conversation-change-before-paint') h.state.conversationId = 'other-public-conversation';
  if (name === 'account-generation-change-before-paint') h.context.realtimeAccountGeneration = 2;
  const paint = h.paint(reply.envelope.correlation);
  if (name === 'wrong-generation-paint') paint.generation = 2;
  h.handlers.get('athena:rest-canvas-painted')(h.event,paint);
  assert.throws(() => h.authority.buildDataset({panelId:panelModule.panelIdFor({correlation:reply.envelope.correlation}),generation:1,period:'W'}));
  observations.push({name,candidate:'REJECTED'});
}
const result={status:'PUBLIC_MEMORY_CONSUMER_AUTHOR_RESULTS',observations,rendererRuns:0,nativeActions:0,providerCalls:0,privateReads:0,productWrites:0,
  limits:['Memory execution uses actual extracted main IPC/functions and actual authority modules with public synthetic owners.','No DOM mount, chart library draw, period provider response or native pixel approval is implied.','Candidate remains a draft pending source/renderer boundary review.']};
fs.writeFileSync(path.join(__dirname,'FOCUSED-CONSUMER-DRAFT.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));

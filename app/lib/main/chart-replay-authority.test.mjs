import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createChartReloadAuthority } = require('./chart-reload.js');
const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const start = source.indexOf("ipcMain.handle('athena:session-replay-cards',");
const handlerSource = source.slice(start, source.indexOf('\n});', start) + 4);
const envelope = {
  canvas_type: 'chart', operation_ref: 'base:ka10081',
  operation_args: { stk_cd: '005930', base_dt: '20260923', upd_stkpc_tp: '1' },
  correlation: { dataset_id: 'saved', item_id: 'chart', ordinal: 1 },
  data: {
    chart: { period: 'day', target: 'stock', trId: 'ka10081' },
    chart_meta: {
      series_scope: 'stock', reload_group: 'stock',
      reload_targets: {
        day: { operation_ref: 'base:ka10081', request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] },
        week: { operation_ref: 'base:ka10082', request_fields: ['stk_cd', 'base_dt', 'upd_stkpc_tp'] },
      },
    },
  },
};

function harness(cards) {
  let replay;
  const paintRequests = [];
  const sends = [];
  const logs = [];
  let replaySequence = 0;
  const bridge = { flush() {}, load() { return { canvasCards: cards }; } };
  Function('ipcMain', 'getSessionBridge', 'shellWin', 'flushDeferredShellEvents',
    'restCorrelationKey', 'emitRestCanvasAndWaitForPaint', 'activeRestAccountId', 'mdlog', 'crypto', 'historyConversationId', handlerSource)(
    { handle: (_, callback) => { replay = callback; } }, () => bridge,
    { isDestroyed: () => false, webContents: { send: (channel, value) => sends.push({ channel, value }) } },
    () => {}, (value) => value?.dataset_id && value.item_id && value.ordinal ? 'correlation' : null,
    (payload, options) => new Promise((resolve, reject) => { paintRequests.push({ payload, options, resolve, reject }); }),
    () => 'qa-account', (message) => logs.push(message),
    { randomUUID: () => `replay-${++replaySequence}` },
    () => 'saved-conversation',
  );
  return { replay, paintRequests, sends, logs };
}

test('restored chart follows the verified paint path before its period reload authority is registered', () => {
  const authority = createChartReloadAuthority();
  const h = harness([{ cardId: 'saved-card', channel: 'live', envelope }]);
  assert.equal(h.replay(null, { id: 'saved-conversation' }).replayed, 1);
  assert.equal(h.sends.length, 0);
  assert.equal(h.paintRequests.length, 1);
  const { payload, options } = h.paintRequests[0];
  assert.equal(payload.sessionCardId, 'saved-card');
  assert.equal(payload.accountId, 'qa-account');
  assert.equal(options.conversationId, 'saved-conversation');
  assert.equal(options.expand, false);
  assert.equal(authority.has('panel'), false);
  const paint = { renderState: 'data', rendererId: 'aits-chart-v1', panelId: 'panel', generation: 1 };
  assert.equal(authority.registerPaint(paint, {
    correlation: payload.envelope.correlation,
    operationRef: payload.operationRef, operationArgs: payload.operationArgs,
    accountId: payload.accountId, chartBody: payload.envelope.data.chart,
    chartMeta: payload.envelope.data.chart_meta,
  }), true);
  assert.equal(authority.buildDataset({ panelId: 'panel', generation: 1, period: 'W' }).items[0].operationRef, 'base:ka10082');
  h.paintRequests[0].resolve(paint);
});

test('rapid chart replays remain independently paintable while the first acknowledgment is pending', () => {
  const h = harness([{ cardId: 'saved-card', channel: 'live', envelope }]);
  h.replay(null, { id: 'saved-conversation' });
  h.replay(null, { id: 'saved-conversation' });
  assert.equal(h.paintRequests.length, 2);
  const [first, second] = h.paintRequests;
  assert.notDeepEqual(first.payload.envelope.correlation, second.payload.envelope.correlation);
  assert.notEqual(first.payload.envelope.correlation.dataset_id, envelope.correlation.dataset_id);
  assert.equal(first.payload.sessionCardId, second.payload.sessionCardId);
  assert.equal(second.payload.operationRef, first.payload.operationRef);
  assert.deepEqual(second.payload.operationArgs, first.payload.operationArgs);
  assert.equal(envelope.correlation.dataset_id, 'saved');
  first.resolve({ renderState: 'data' });
  second.resolve({ renderState: 'data' });
});

test('non-chart cards retain their existing replay route and failed chart paint is contained', async () => {
  const h = harness([
    { cardId: 'chart', channel: 'live', envelope },
    { cardId: 'table', channel: 'live', envelope: { canvas_type: 'table' } },
  ]);
  assert.equal(h.replay(null, { id: 'saved-conversation' }).replayed, 2);
  assert.equal(h.sends.length, 1);
  assert.equal(h.sends[0].value.sessionCardId, 'table');
  h.paintRequests[0].reject(new Error('paint timeout'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.logs.length, 1);
});

test('live model charts also establish paint authority while background charts only persist', () => {
  const functionStart = source.indexOf('function sendLiveCanvasResult(');
  const functionSource = source.slice(functionStart, source.indexOf('\n}', functionStart) + 2);
  const paints = [];
  const saved = [];
  const sent = [];
  const send = Function('rememberLiveRealtimeFallbackAuthority', 'crypto', 'historyConversationId',
    'persistBackgroundCanvasCard', 'shellWin', 'restCorrelationKey',
    'emitRestCanvasAndWaitForPaint', 'activeRestAccountId', 'mdlog',
    `${functionSource}; return sendLiveCanvasResult;`)(
    () => {}, { randomUUID: () => 'live-card' }, () => 'current',
    (...args) => saved.push(args),
    { isDestroyed: () => false, webContents: { send: (channel) => sent.push(channel) } },
    () => 'correlation', (payload, options) => { paints.push({ payload, options }); return Promise.resolve(); },
    () => 'qa-account', () => {},
  );
  send({ status: 'success', envelope }, { conversationId: 'current' });
  assert.equal(paints.length, 1);
  assert.equal(paints[0].payload.operationRef, 'base:ka10081');
  assert.equal(paints[0].payload.sessionCardId, 'live-card');
  assert.equal(sent.includes('athena:add-canvas-live'), false);
  send({ status: 'success', envelope }, { conversationId: 'background' });
  assert.equal(paints.length, 1);
  assert.equal(saved.length, 1);
});

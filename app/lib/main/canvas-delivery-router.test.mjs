import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCanvasDeliveryRouter } = require('./canvas-delivery-router');
const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const first = 'a'.repeat(32);
const second = 'b'.repeat(32);

function harness() {
  let active = 'original';
  const painted = [];
  const saved = [];
  const send = Function('rememberLiveRealtimeFallbackAuthority', 'crypto', 'historyConversationId',
    'persistBackgroundCanvasCard', 'shellWin', `${declaration('sendLiveCanvasResult')}; return sendLiveCanvasResult;`)(
    () => {}, { randomUUID: () => 'card-id' }, () => active,
    (conversationId, result, cardId) => saved.push({ conversationId, result, cardId }),
    { isDestroyed: () => false, webContents: { send: (channel, payload) => {
      if (channel === 'athena:add-canvas-live') painted.push(payload);
    } } },
  );
  const router = createCanvasDeliveryRouter({ deliver: send });
  return { router, painted, saved, select(id) { active = id; } };
}

test('WS data arriving after New chat is persisted to the originating conversation when its receipt arrives', () => {
  const h = harness();
  h.select('new-chat');
  h.router.receiveEnvelope({ delivery_id: first, canvas_type: 'chart', data: { fixture: true } });
  assert.equal(h.painted.length, 0);
  h.router.receiveReceipt({ delivery_id: first }, { conversationId: 'original' });
  assert.equal(h.painted.length, 0);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].conversationId, 'original');
  assert.equal(h.saved[0].result.envelope.canvas_type, 'chart');
});

test('receipt before WS data paints after returning to the original conversation, without duplication', () => {
  const h = harness();
  h.select('new-chat');
  h.router.receiveReceipt({ delivery_id: first }, { conversationId: 'original' });
  h.select('original');
  const envelope = { delivery_id: first, canvas_type: 'table' };
  h.router.receiveEnvelope(envelope);
  h.router.receiveEnvelope(envelope);
  h.router.receiveReceipt({ delivery_id: first }, { conversationId: 'new-chat' });
  assert.equal(h.painted.length, 1);
  assert.equal(h.painted[0].conversationId, 'original');
  assert.equal(h.saved.length, 0);
});

test('interleaved conversations and unrelated broadcasts keep independent ownership', () => {
  const h = harness();
  h.router.receiveEnvelope({ delivery_id: first, canvas_type: 'chart' });
  h.router.receiveReceipt({ delivery_id: second }, { conversationId: 'second' });
  h.router.receiveEnvelope({ delivery_id: second, canvas_type: 'table' });
  h.router.receiveReceipt({ delivery_id: first }, { conversationId: 'original' });
  assert.equal(h.saved[0].conversationId, 'second');
  assert.equal(h.saved[0].result.envelope.canvas_type, 'table');
  assert.equal(h.painted[0].envelope.canvas_type, 'chart');
  assert.equal(h.router.receiveEnvelope({ canvas_type: 'facts' }), false);
  assert.equal(h.router.receiveReceipt({ delivery_id: first }, {}), false);
});

test('persistent inline and pushed results retain their trusted conversation identity', () => {
  const sends = [];
  const receipts = [];
  const context = { conversationId: 'original', origin: 'shell', canvasTypesSeen: [], canvasCaptionsSeen: [] };
  const handle = Function('rememberLiveRealtimeFallbackAuthority', 'persistentTurnContexts',
    'shouldMarkProviderCanvasVisible', 'markProviderFirstVisible', 'canvasDeliveryRouter',
    'sendLiveCanvasResult', `${declaration('handlePersistentCanvasResult')}; return handlePersistentCanvasResult;`)(
    () => {}, new Map([['submit', context]]), () => false, () => {},
    { receiveReceipt: (receipt, metadata) => { receipts.push({ receipt, metadata }); return true; } },
    (result, metadata) => sends.push({ result, metadata }),
  );
  handle({ clientSubmitId: 'submit', status: 'success', envelope: { canvas_type: 'table' } });
  handle({ clientSubmitId: 'submit', status: 'pushed', envelope: { canvas_type: 'chart', delivery_id: first } });
  assert.equal(sends[0].metadata.conversationId, 'original');
  assert.equal(receipts[0].metadata.conversationId, 'original');
  assert.equal(receipts[0].receipt.delivery_id, first);
});

test('returning immediately after a background card flushes its pending save before replay', () => {
  let replay;
  let stored = [];
  let pending = [{ cardId: 'saved-card', channel: 'live', envelope: { canvas_type: 'chart' } }];
  const sent = [];
  const bridge = {
    flush(id) { assert.equal(id, 'original'); stored = pending; pending = []; },
    load(id) { assert.equal(id, 'original'); return { canvasCards: stored }; },
  };
  const start = source.indexOf("ipcMain.handle('athena:session-replay-cards',");
  const code = source.slice(start, source.indexOf('\n});', start) + 4);
  Function('ipcMain', 'getSessionBridge', 'shellWin', 'flushDeferredShellEvents', code)(
    { handle: (_name, handler) => { replay = handler; } }, () => bridge,
    { isDestroyed: () => false, webContents: { send: (channel, payload) => sent.push({ channel, payload }) } },
    () => {},
  );
  assert.equal(replay(null, { id: 'original' }).replayed, 1);
  assert.equal(sent[0].payload.envelope.canvas_type, 'chart');
  assert.equal(sent[0].payload.sessionCardId, 'saved-card');
});

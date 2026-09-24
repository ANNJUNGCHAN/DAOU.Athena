import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..');
const require = createRequire(import.meta.url);
const { createSessionBridge } = require('./main/session-bridge');
const { buildActiveCardContext } = require('./main/active-card-context');

test('question submit reports the current card stack before invoking the live query', async () => {
  const source = fs.readFileSync(path.join(appDir, 'chat.js'), 'utf8');
  const start = source.indexOf("if (window.AthenaCanvasCards && typeof window.AthenaCanvasCards.flushReport === 'function')");
  const end = source.indexOf('if (cardContext) cardComponentTarget.clearSelection(cardContext);', start);
  assert.ok(start >= 0 && end > start, 'submit card-context block is present');

  const events = [];
  const window = {
    AthenaCanvasCards: { flushReport() { events.push('session-cards'); } },
    AthenaProviderFirstPaint: { registerSubmit() {} },
    AthenaCanvasMode: null,
    AthenaBacktestCanvas: null,
    AthenaAgentCanvas: null,
    AthenaPluginCanvas: null,
    crypto: { randomUUID: () => 'submit-1' },
    athena: {
      async invoke(channel, payload) {
        events.push(channel);
        return { ok: true, payload };
      },
    },
  };
  const context = {
    window,
    cardComponentTarget: { getContext: () => ({ selectedCardId: 'card-fresh' }), clearSelection() {} },
    text: '이 수치는 왜 바뀌었어?',
    userText: '이 수치는 왜 바뀌었어?',
    prefs: { autoExpandCanvas: true },
    cid: 'conversation-1',
    clientSubmitId: null,
    rendererSubmittedAt: null,
    result: null,
    performance: { now: () => 42 },
    augmentMentions: (value) => value,
  };
  vm.createContext(context);
  await vm.runInContext(`(async () => {${source.slice(start, end)}})()`, context);

  assert.deepEqual(events, ['session-cards', 'athena__render_canvas']);
  assert.equal(context.result.payload.cardContext.selectedCardId, 'card-fresh');
});

test('canvas exposes the live DOM card reporter used by submit', () => {
  const source = fs.readFileSync(path.join(appDir, 'canvas.js'), 'utf8');
  assert.match(source, /AthenaCanvasCards\s*=\s*Object\.assign[\s\S]*flushReport:\s*reportSessionCards/);
});

test('main bridge flush makes a just-reported selected card available before context lookup', () => {
  let canvasCards = [];
  const bridge = createSessionBridge({
    store: {
      putCards(_sessionId, cards) { canvasCards = cards; },
      getSession() { return { canvasCards }; },
    },
    now: () => '2026-09-14T04:00:00.000Z',
    setTimer: () => 1,
    clearTimer() {},
    log() {},
  });
  bridge.saveCards({
    sessionId: 'conversation-1',
    cards: [{
      cardId: 'card-fresh', kind: 'chart', channel: 'live',
      envelope: { data: { chart: { candles: [{ close: 22200 }] } } },
    }],
  });
  assert.equal(bridge.load('conversation-1').canvasCards.length, 0, 'card remains in debounce buffer before main flush');

  bridge.flush('conversation-1');
  const active = buildActiveCardContext({
    cards: bridge.load('conversation-1').canvasCards,
    requested: {
      selectedCardId: 'card-fresh',
      selectedComponent: { path: 'data.chart', label: '차트' },
      selectionMode: 'explicit-component',
    },
    now: '2026-09-14T04:00:01.000Z',
  });

  assert.equal(active.status, 'available');
  assert.equal(active.selectionStatus, 'valid');
  assert.equal(active.selection.cardId, 'card-fresh');
  assert.deepEqual(active.selection.value, { candles: [{ close: 22200 }] });
});

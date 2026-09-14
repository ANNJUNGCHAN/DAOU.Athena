import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import cardContext from './active-card-context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');

function sourceSlice(startText, endText) {
  const start = mainSource.indexOf(startText);
  const end = mainSource.indexOf(endText, start);
  assert.ok(start >= 0 && end > start, `${startText} must remain executable`);
  return mainSource.slice(start, end);
}

function loadPersistBackgroundCanvasCard() {
  const source = sourceSlice(
    'function persistBackgroundCanvasCard(',
    '// 배경 대화의 턴이 만든 채팅 전용 카드',
  );
  const saved = [];
  let stored = [];
  let pending = null;
  const bridge = {
    flush() {
      if (pending) stored = pending;
      pending = null;
    },
    load: () => ({ canvasCards: stored }),
    saveCards(payload) {
      saved.push(payload);
      pending = payload.cards;
    },
  };
  const persist = Function(
    'crypto', 'ensureSessionRecord',
    `${source}\nreturn persistBackgroundCanvasCard;`,
  )({ randomUUID: () => 'generated-id' }, () => bridge);
  return {
    persist,
    saved,
    reportCards(cards) { pending = cards; },
    pendingCards: () => pending,
  };
}

test('Orb relay card id is the same authoritative id persisted for grounded Q&A', () => {
  const { persist, saved } = loadPersistBackgroundCanvasCard();
  const envelope = { canvas_type: 'chart', data: { code: '023590', close: 40950 } };
  const cardId = persist('orb-conversation', { status: 'success', envelope }, 'orb-card-1');

  assert.equal(cardId, 'orb-card-1');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].sessionId, 'orb-conversation');
  assert.equal(saved[0].cards[0].cardId, 'orb-card-1');
  assert.equal(saved[0].cards[0].envelope, envelope);

  const context = cardContext.buildActiveCardContext({
    cards: saved[0].cards,
    requested: { selectedCardId: 'orb-card-1', selectionMode: 'implicit-active-card' },
  });
  assert.equal(context.status, 'available');
  assert.equal(context.selection.cardId, 'orb-card-1');
  assert.equal(context.selection.value.data.close, 40950);
});

test('Orb appends merge with every latest renderer report and never resurrect removed cached cards', () => {
  const { persist, reportCards, pendingCards } = loadPersistBackgroundCanvasCard();
  const card = (cardId) => ({ cardId, kind: 'chart', channel: 'live',
    envelope: { canvas_type: 'chart', data: { cardId } }, protected: false });

  reportCards([card('A')]);
  persist('orb-conversation', { status: 'success', envelope: card('B').envelope }, 'B');
  reportCards([card('A'), card('B'), card('C')]);
  persist('orb-conversation', { status: 'success', envelope: card('D').envelope }, 'D');
  assert.deepEqual(pendingCards().map((entry) => entry.cardId), ['A', 'B', 'C', 'D']);

  reportCards([card('A'), card('B'), card('D')]);
  persist('orb-conversation', { status: 'success', envelope: card('E').envelope }, 'E');
  assert.deepEqual(pendingCards().map((entry) => entry.cardId), ['A', 'B', 'D', 'E']);
});

test('main passes bounded Orb selection context and relays the persisted card id on every card path', () => {
  const handler = sourceSlice(
    "ipcMain.handle('athena:orb-chat-submit'",
    '// method/body를 받는다',
  );
  assert.match(handler, /cardContext: payload\.cardContext && typeof payload\.cardContext === 'object'/);

  const persistent = sourceSlice('function handlePersistentCanvasResult(', 'function createProviderRuntimeControllerInstance(');
  assert.match(persistent, /persistBackgroundCanvasCard\([\s\S]*sessionCardId/);
  assert.match(persistent, /athena:orb-canvas-result'[\s\S]*sessionCardId/);

  const live = sourceSlice('const turnCallbacks = {', '// 상주 세션\(기본\)');
  assert.match(live, /persistBackgroundCanvasCard\([\s\S]*sessionCardId/);
  assert.match(live, /athena:orb-canvas-result'[\s\S]*sessionCardId/);

  const rest = sourceSlice('function emitRestCanvasForOrigin(', 'async function notifyStartupFailuresAfterExpansion(');
  assert.match(rest, /orbSessionCardId/);
  assert.match(rest, /persistBackgroundCanvasCard\([\s\S]*orbSessionCardId/);
  assert.match(rest, /athena:orb-canvas-result'[\s\S]*sessionCardId: orbSessionCardId/);
});

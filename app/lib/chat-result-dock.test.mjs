import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}

function fixture() {
  const element = () => ({
    textContent: '', hidden: true,
    classList: { remove() {} }, appendChild() {},
  });
  const events = new Map();
  const context = vm.createContext({
    $resultDock: element(), $resultDockCaption: element(),
    $resultDockChips: element(), $resultDockSources: element(),
    $resultDockCanvasCount: element(), $resultDockSourceCount: element(),
    $conversationRetry: element(),
    resultDockHasResults: false, resultDockDismissed: false,
    displayedConversationId: 'new-table', conversationSelectionRevision: 1,
    document: { createElement: element },
    window: { addEventListener: (name, handler) => events.set(name, handler) },
    canvasTypeLabel: (type) => type,
    turnRecordFor: () => ({ state: 'idle', progressEl: null, token: 0 }),
    applyRemoteLock() {}, setDot() {}, setLocked() {},
    stashDisplayedPane() {}, closeOrderTicketForConversationChange() {},
    clearAttachmentsForConversationChange() {},
  });
  vm.runInContext([
    declaration('refreshResultDockVisibility'),
    declaration('updateResultDock'),
    declaration('syncDisplayedTurn'),
  ].join('\n'), context);
  const start = source.indexOf("window.addEventListener('athena:new-conversation', () => {");
  assert.notEqual(start, -1);
  vm.runInContext(source.slice(start, source.indexOf('\n});', start) + 4), context);
  context.updateResultDock(1, ['table'], ['이번 대화에서 정한 테스트 암호']);
  assert.equal(context.$resultDock.hidden, false);
  return { context, events };
}

test('binding another conversation clears the previous result title and source chips', () => {
  const { context } = fixture();
  context.$resultDockChips.hidden = false;
  context.displayedConversationId = 'older-per';
  context.syncDisplayedTurn();
  assert.equal(context.$resultDock.hidden, true);
  assert.equal(context.$resultDockCaption.textContent, '');
  assert.equal(context.$resultDockChips.textContent, '');
  assert.equal(context.$resultDockChips.hidden, true);
  assert.equal(context.resultDockHasResults, false);
  context.refreshResultDockVisibility();
  assert.equal(context.$resultDock.hidden, true);
});

test('new conversation clears the result bar immediately while its ID is still pending', () => {
  const { context, events } = fixture();
  events.get('athena:new-conversation')();
  assert.equal(context.displayedConversationId, null);
  assert.equal(context.$resultDock.hidden, true);
  assert.equal(context.$resultDockCaption.textContent, '');
});

test('a later live result can reopen the bar with only the current result metadata', () => {
  const { context } = fixture();
  context.resultDockDismissed = true;
  context.syncDisplayedTurn();
  context.updateResultDock(2, ['chart'], ['현재 대화 차트']);
  assert.equal(context.$resultDock.hidden, false);
  assert.equal(context.$resultDockCaption.textContent, '현재 대화 차트');
  assert.equal(context.$resultDockCanvasCount.textContent, '+2 카드');
  assert.equal(context.$resultDockSourceCount.textContent, '출처 1');
});

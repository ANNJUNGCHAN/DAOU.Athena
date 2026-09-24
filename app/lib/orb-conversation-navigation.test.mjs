import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import snapshotLib from './session-snapshot.js';
import { fakeNode } from './graph-mode/fake-dom.js';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const main = read('../main.js');
const sidebar = read('./sidebar.js');
const chat = read('../chat.js');
function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `source section: ${start}`);
  return source.slice(from, to);
}
function declaration(source, name) {
  const from = source.indexOf(`function ${name}(`);
  assert.ok(from >= 0);
  return source.slice(from, source.indexOf('\n}', from) + 2);
}
function mainRoute(orbId = 'orb') {
  const sent = [], cards = [], reveals = [];
  let route;
  const context = vm.createContext({
    ipcMain: { on: (_, fn) => { route = fn; } }, orbConversationId: orbId,
    shellWin: { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } },
    revealShell: (options) => reveals.push(options),
    sendLiveCanvasResult: (card) => cards.push(card), routineEventToFactsEnvelope: (event) => event,
  });
  vm.runInContext(section(main, "ipcMain.on('athena:orb-open-shell'", '// ----------'), context);
  return { route, sent, cards, reveals };
}

test('actual orb chat-go button requests its existing conversation; alerts keep their reveal/card behavior', () => {
  const { route, sent, cards, reveals } = mainRoute();
  let click;
  vm.runInNewContext(section(read('../orb.js'), "  $chatGo.addEventListener('click'", '  // Esc:'), {
    $chatGo: { addEventListener: (_, callback) => { click = callback; } },
    window: { athena: { send: (channel, payload) => {
      assert.equal(channel, 'athena:orb-open-shell'); route({}, payload);
    } } },
  });
  click();
  assert.equal(sent[0][0], 'athena:conversation-open-requested');
  assert.equal(sent[0][1].conversationId, 'orb');
  const event = { id: 'alert' };
  route({}, { event, openConversation: true });
  route({}, {});
  assert.equal(sent.length, 1);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].envelope, event);
  assert.equal(reveals.length, 3);
  const empty = mainRoute(null);
  empty.route({}, { openConversation: true });
  assert.equal(empty.sent.length, 0);
  assert.equal(empty.reveals.length, 1);
  assert.match(read('../preload.js'), /'athena:conversation-open-requested'/);
});

test('orb request uses the history selection path to leave Pallas, load messages and refresh the project without aborting jobs', async () => {
  const listeners = new Map(), calls = [];
  let loads = 0;
  const rows = [{ id: 'orb', title: 'Orb question', projectId: 'orb-project', mode: 'chat' }];
  let state = { activeId: 'pallas', activeMode: 'backtest', currentProjectId: 'pallas-project', conversations: rows, projects: [] };
  const history = fakeNode('history');
  const ctx = vm.createContext({
    selectedNotifyId: null, $roomBanner: {}, activeConversationId: 'pallas', currentProjectId: 'pallas-project',
    conversationsCache: rows, projectsCache: [], lastListSnapshot: null,
    state: 'idle', abortToken: 0, displayedConversationId: 'pallas', switchingConversation: false, conversationSelectionRevision: 0,
    conversationPanes: new Map(), turnRecords: new Map(), $history: history, $input: { value: '' }, stickToBottom: true,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { createElement: fakeNode },
    renderList() {}, updateModeCounts() {}, stashDisplayedPane() {}, closeOrderTicketForConversationChange() {},
    clearAttachmentsForConversationChange() {}, syncDisplayedTurn() {}, mountStoredPane: () => false,
    setLocked() {}, autoGrowInput() {}, scrollHistoryToBottom() {}, scrollAfterRender() {},
    pastMessageTurn: (message) => { const node = fakeNode('message'); node.textContent = message.text; return node; },
    window: {
      athena: {
        on: (name, fn) => listeners.set(name, fn),
        invoke: async (name, payload) => {
          calls.push(name);
          if (name === 'athena:conversations-set-active') {
            assert.equal(payload.id, 'orb');
            state = { ...state, activeId: 'orb', activeMode: 'chat', currentProjectId: 'orb-project' };
            return { ...state, restorable: true };
          }
          if (name === 'athena:session-load') {
            loads++;
            // Completion arrives while selection awaits its older partial snapshot.
            if (loads === 1) listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
            return { currentId: 'answer', messages: [
              { id: 'question', parentId: null, role: 'user', text: '7+11 GLAUX-4826' },
              { id: 'answer', parentId: 'question', role: 'assistant', text: loads === 1 ? 'partial' : '18 GLAUX-4826' },
            ] };
          }
          if (name === 'athena:conversations-list') return state;
          if (name === 'athena:session-replay-cards') return {};
          throw new Error(`Unexpected IPC: ${name}`);
        },
      },
      AthenaLib: { SessionSnapshot: snapshotLib, RoutineMainCard: { conversationScopeChanged: (a, b) => a !== b } },
      AthenaShell: { registerOpenConversation: (fn) => listeners.set('open', fn), clearCanvases() {} },
      AthenaCanvasMode: { setView: (view) => calls.push(`view:${view}`) },
      AthenaModeNav: { setActive: (view) => calls.push(`mode:${view}`) },
      AthenaBacktestCanvas: { flushEditor: async () => true },
      dispatchEvent() {},
    },
  });
  vm.runInContext(declaration(chat, 'restoreConversation')
    + section(chat, 'window.AthenaShell.registerOpenConversation(', '// Claude 데스크톱의 @')
    + 'let pendingOrbConversationRefresh = null;\n' + section(chat, 'async function refreshOrbConversation(', '// ---------- 루틴 승인 카드')
    + section(sidebar, '  async function loadConversations(', '  async function openRoutineInAgent(')
    + section(sidebar, "    window.athena.on('athena:conversation-open-requested'", "    window.athena.on('athena:routine-event'"), ctx);
  ctx.window.AthenaShell.openConversation = listeners.get('open');
  const { route, sent } = mainRoute();
  route({}, { openConversation: true });
  await listeners.get(sent[0][0])(sent[0][1]);
  await new Promise(setImmediate);
  assert.equal(ctx.displayedConversationId, 'orb');
  assert.equal(ctx.currentProjectId, 'orb-project');
  assert.equal(ctx.activeConversationId, 'orb');
  assert.deepEqual(history.children.map((node) => node.textContent), ['7+11 GLAUX-4826', '18 GLAUX-4826']);
  assert.ok(calls.includes('view:summary'));
  assert.ok(calls.includes('mode:summary'));
  assert.equal(calls.filter((call) => call === 'athena:conversations-set-active').length, 1);
  assert.equal(loads, 2);
  assert.equal(vm.runInContext('pendingOrbConversationRefresh', ctx), null);
  assert.equal(rows.length, 1);
  ctx.displayedConversationId = 'pallas';
  ctx.conversationPanes.set('orb', fakeNode('partial-pane'));
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  assert.equal(ctx.conversationPanes.has('orb'), false);
  await listeners.get(sent[0][0])(sent[0][1]);
  assert.deepEqual(history.children.map((node) => node.textContent), ['7+11 GLAUX-4826', '18 GLAUX-4826']);
});

test('orb completion replaces a restored partial turn once and never appends to another conversation', async () => {
  const listeners = new Map();
  const history = fakeNode('history');
  let resolveLoad;
  const ctx = vm.createContext({
    state: 'idle', abortToken: 0, switchingConversation: false, displayedConversationId: 'orb', conversationSelectionRevision: 1,
    conversationPanes: new Map(), turnRecords: new Map(), $history: history, scrollAfterRender() {},
    pastMessageTurn: (message) => { const node = fakeNode('message'); node.textContent = message.text; return node; },
    window: { AthenaLib: { SessionSnapshot: snapshotLib }, athena: {
      on: (name, fn) => listeners.set(name, fn),
      invoke: () => new Promise((resolve) => { resolveLoad = resolve; }),
    } },
  });
  vm.runInContext('let pendingOrbConversationRefresh = null;\n' + section(chat, 'async function refreshOrbConversation(', '// ---------- 루틴 승인 카드'), ctx);
  const question = fakeNode('message'); question.textContent = '7+11'; history.appendChild(question);
  const partial = fakeNode('message'); partial.textContent = 'partial'; history.appendChild(partial);
  const snapshot = { currentId: 'answer', messages: [
    { id: 'question', parentId: null, role: 'user', text: '7+11' },
    { id: 'answer', parentId: 'question', role: 'assistant', text: '18' },
  ] };
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  resolveLoad(snapshot);
  await new Promise(setImmediate);
  assert.deepEqual(history.children.map((node) => node.textContent), ['7+11', '18']);
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  ctx.displayedConversationId = 'other'; ctx.conversationSelectionRevision++;
  ctx.conversationPanes.set('orb', partial);
  history.children[0].textContent = 'Other conversation';
  resolveLoad(snapshot);
  await new Promise(setImmediate);
  assert.equal(history.children[0].textContent, 'Other conversation');
  assert.equal(ctx.conversationPanes.has('orb'), false, 'leaving during reload invalidates the stale cached pane');
  ctx.conversationPanes.set('orb', partial);
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  assert.equal(ctx.conversationPanes.has('orb'), false, 'completion while away forces the next history selection to load saved messages');
  ctx.displayedConversationId = 'orb';
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  ctx.state = 'calling'; ctx.abortToken++;
  const liveQuestion = fakeNode('message'); liveQuestion.textContent = 'Follow-up';
  history.appendChild(liveQuestion);
  resolveLoad(snapshot);
  await new Promise(setImmediate);
  assert.equal(history.children.at(-1), liveQuestion, 'a new live turn stays attached');
  assert.equal(vm.runInContext('pendingOrbConversationRefresh', ctx), 'orb');
  vm.runInContext(declaration(chat, 'isDisplayedConversation') + declaration(chat, 'setTurnState'), ctx);
  ctx.setTurnState({ conversationId: 'orb', state: 'calling' }, 'idle');
  await Promise.resolve();
  resolveLoad({ currentId: 'followup-answer', messages: [...snapshot.messages,
    { id: 'followup', parentId: 'answer', role: 'user', text: 'Follow-up' },
    { id: 'followup-answer', parentId: 'followup', role: 'assistant', text: 'New answer' },
  ] });
  await new Promise(setImmediate);
  assert.deepEqual(history.children.map((node) => node.textContent), ['7+11', '18', 'Follow-up', 'New answer']);
  assert.equal(vm.runInContext('pendingOrbConversationRefresh', ctx), null);
  ctx.displayedConversationId = 'other';
  const localTurn = { conversationId: 'orb', state: 'calling' };
  ctx.turnRecords.set('orb', localTurn);
  ctx.conversationPanes.set('orb', liveQuestion);
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  assert.equal(ctx.conversationPanes.get('orb'), liveQuestion, 'background live DOM stays attached');
  ctx.setTurnState(localTurn, 'idle');
  await Promise.resolve();
  assert.equal(ctx.conversationPanes.has('orb'), false);
  ctx.switchingConversation = true;
  listeners.get('athena:orb-turn-committed')({ conversationId: 'orb' });
  assert.equal(vm.runInContext('pendingOrbConversationRefresh', ctx), 'orb');
});

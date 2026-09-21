import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fakeNode } = require('./graph-mode/fake-dom.js');
const chat = fs.readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
const markdown = fs.readFileSync(new URL('./markdown.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = chat.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  return chat.slice(start, chat.indexOf('\n}', start) + 2);
}
function context(extra = {}) {
  const document = {
    createElement(tag) {
      const node = fakeNode(tag);
      node.append = (...children) => children.forEach((child) => node.appendChild(child));
      return node;
    },
    createTextNode(text) { const node = fakeNode('#text'); node.textContent = text; return node; },
  };
  const ctx = vm.createContext({ document, window: { AthenaLib: {} }, ...extra });
  vm.runInContext(markdown, ctx);
  return ctx;
}

test('restored assistant Markdown uses safe DOM rendering; user input stays literal', () => {
  const ctx = context();
  vm.runInContext(declaration('pastMessageTurn'), ctx);
  const text = '# Heading\n\n**bold** <script>alert(1)</script>';
  const assistant = ctx.pastMessageTurn({ role: 'assistant', text });
  const body = assistant.children[0];
  assert.equal(body.children[0].nodeName, 'h2');
  assert.equal(body.children[0].textContent, 'Heading');
  const nodes = [];
  function walk(node) { nodes.push(node); node.children.forEach(walk); }
  walk(body);
  assert.ok(nodes.some((node) => node.nodeName === 'strong' && node.textContent === 'bold'));
  assert.ok(!nodes.some((node) => node.nodeName === 'script'));
  assert.ok(body.textContent.includes('<script>alert(1)</script>'));
  const user = ctx.pastMessageTurn({ role: 'user', text }).children[0];
  assert.equal(user.textContent, text);
  assert.equal(user.children.length, 0);
});

test('opening saved Aegis conversation refreshes tasks after workspace restoration', () => {
  const calls = [];
  const ctx = context({
    $history: fakeNode('history'), $input: { value: '' },
    mountStoredPane: () => false, setLocked() {}, autoGrowInput() {},
    scrollHistoryToBottom() {}, stickToBottom: true,
  });
  Object.assign(ctx.window, {
    AthenaShell: { clearCanvases() {} },
    AthenaCanvasMode: { setView(view) { calls.push(`view:${view}`); } },
    AthenaModeNav: { setActive() {} },
    AthenaSessionWorkspace: { clear() {}, restore() { calls.push('restore'); } },
    AthenaAgentCanvas: { refresh() { calls.push('refresh'); return Promise.resolve(); } },
  });
  ctx.window.AthenaLib.SessionSnapshot = { modeToView: (mode) => mode };
  vm.runInContext(declaration('pastMessageTurn') + '\n' + declaration('restoreConversation'), ctx);
  ctx.restoreConversation({ activeMode: 'agent' }, [], { workspace: {} });
  assert.deepEqual(calls, ['view:agent', 'restore', 'refresh']);
  calls.length = 0;
  ctx.restoreConversation({ activeMode: 'summary' }, [], { workspace: {} });
  assert.deepEqual(calls, ['view:summary', 'restore']);
});

test('restored failed tool work retains the answer and its failure notice', () => {
  const ctx = context();
  vm.runInContext(declaration('renderFailureBubble') + '\n' + declaration('pastMessageTurn'), ctx);
  const line = ctx.pastMessageTurn({ role: 'assistant', text: '**부분 응답**', error: '조회가 차단되었습니다.' });
  assert.equal(line.children[0].textContent, '부분 응답');
  assert.equal(line.children[1].className, 'turn-fail-card');
  assert.ok(line.children[1].textContent.includes('작업 미완료'));
  assert.ok(line.children[1].textContent.includes('조회가 차단되었습니다.'));
});

test('conversation roundtrip replaces shared input with destination draft, including empty or missing', () => {
  let grows = 0;
  const ctx = context({
    $history: fakeNode('history'), $input: { value: 'previous conversation draft' },
    mountStoredPane: () => false, setLocked() {}, autoGrowInput() { grows++; },
    scrollHistoryToBottom() {}, stickToBottom: true,
  });
  ctx.window.AthenaLib.SessionSnapshot = { modeToView: (mode) => mode };
  vm.runInContext(declaration('pastMessageTurn') + '\n' + declaration('restoreConversation'), ctx);
  const restore = (snapshot) => ctx.restoreConversation({ activeMode: 'summary' }, [], snapshot);
  const dartSnapshot = { workspace: { draft: { text: 'DART company question' } } };
  const aegisSnapshot = { workspace: { draft: { text: '' } } };
  restore(dartSnapshot);
  assert.equal(ctx.$input.value, 'DART company question');
  restore(aegisSnapshot);
  assert.equal(ctx.$input.value, '');
  restore(dartSnapshot);
  assert.equal(ctx.$input.value, 'DART company question');
  restore(null);
  assert.equal(ctx.$input.value, '');
  assert.equal(grows, 4);
});

test('Enter clears persisted draft before submission and cancels pending draft debounce', () => {
  const sent = [];
  const timers = new Map();
  let nextTimer = 0;
  const input = fakeNode('textarea');
  input.value = 'submitted prompt';
  const ctx = context({
    $input: input, state: 'idle', remoteQueryBusy: false,
    mentionState: { open: false },
    consumeReferences: (s) => s, consumeAttachments: (s) => s,
    autoGrowInput() {},
    dispatchUserQuery(text) { sent.push({ submit: text }); },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  ctx.window.athena = { send(channel, data) { sent.push({ channel, text: data.patch.draft.text }); } };
  vm.runInContext('let chatDraftTimer = null;\n' + declaration('reportChatDraft'), ctx);
  ctx.reportChatDraft();
  const start = chat.indexOf("$input.addEventListener('keydown', (e) => {");
  const end = chat.indexOf('\n});', start) + 4;
  vm.runInContext(chat.slice(start, end), ctx);
  input.dispatchEvent({ type: 'keydown', key: 'Enter', shiftKey: false, preventDefault() {} });
  assert.equal(input.value, '');
  assert.equal(timers.size, 0);
  assert.deepEqual(sent, [
    { channel: 'athena:session-workspace', text: '' },
    { submit: 'submitted prompt' },
  ]);
});

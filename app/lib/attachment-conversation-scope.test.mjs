import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fakeNode } from './graph-mode/fake-dom.js';
const require = createRequire(import.meta.url);
const { buildLiveTurnPrompt } = require('./main/live-prompt');
const { buildTurnStartParams } = require('./main/codex-app-server-session');

const source = readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }

function setup(invoke = async () => ({ ok: true, attachments: [{ id: 'chosen', path: '/qa/file.txt', isDir: true, context: 'LILAC-4826 total 18' }] })) {
  const listeners = new Map();
  let renders = 0;
  const errors = [];
  const context = vm.createContext({
    attachments: [{ id: 'previous', path: '/qa/previous.txt', isDir: false, context: 'previous content' }],
    displayedConversationId: 'old', conversationSelectionRevision: 1, switchingConversation: false,
    renderAttachChips() { renders++; }, closeKiumiMenu() {},
    appendSystemLine(message) { errors.push(message); },
    $input: { focus() {} }, $conversationRetry: {},
    window: { athena: { invoke, on: (name, callback) => listeners.set(name, callback) },
      AthenaShell: { registerOpenConversation: (callback) => listeners.set('openConversation', callback) },
      addEventListener: (name, callback) => listeners.set(name, callback) },
    stashDisplayedPane() {}, closeOrderTicketForConversationChange() {},
    mountStoredPane() {}, syncDisplayedTurn() {}, updateResultDock() {},
    applyRemoteLock() {}, setDot() {},
    conversationPanes: new Map([['new', {}]]), restoreConversation() {},
    state: 'idle', liveProgressEl: null, abortToken: 0,
  });
  vm.runInContext(section('function clearAttachmentsForConversationChange(', 'function renderAttachChips(')
    + section('async function pickAttachments(', '// 참조 칩(보드 21,')
    + section("window.athena.on('athena:conversation-active'", '// 배경 대화의 턴이')
    + section('window.AthenaShell.registerOpenConversation(', '// Claude 데스크톱의 @')
    + 'let pendingOrbConversationRefresh = null;\n' + section('async function refreshOrbConversation(', '// ---------- 루틴 승인 카드')
    + section("window.addEventListener('athena:new-conversation'", '// 실행 중 턴 중단'), context);
  return { context, listeners, renders: () => renders, errors };
}

test('new chat removes existing attachment chips and prevents paths from entering the next prompt', () => {
  const { context, listeners, renders } = setup();
  listeners.get('athena:new-conversation')();
  assert.equal(context.attachments.length, 0);
  assert.equal(renders(), 1);
  assert.equal(context.consumeAttachments('New question'), 'New question');
});

test('history selection clears only after a successful transition and preserves rejected or same selection', async () => {
  for (const kind of ['failed', 'same', 'changed']) {
    const { context, listeners } = setup(async (channel) => channel === 'athena:conversations-set-active'
      ? { restorable: kind !== 'failed', isCurrent: kind === 'same' } : null);
    await listeners.get('openConversation')({ id: kind === 'same' ? 'old' : 'new' });
    assert.equal(context.attachments.length, kind === 'changed' ? 0 : 1);
  }
});

test('active conversation change clears attachments, same conversation refresh preserves them', () => {
  const { context, listeners, renders } = setup();
  listeners.get('athena:conversation-active')({ conversationId: 'old' });
  assert.equal(context.attachments.length, 1);
  assert.equal(renders(), 0);
  listeners.get('athena:conversation-active')({ conversationId: 'new' });
  assert.equal(context.attachments.length, 0);
  assert.equal(context.displayedConversationId, 'new');
});

test('late file selection cannot cross new-chat or away-and-back conversation boundaries', async () => {
  for (const newChat of [true, false]) {
    let resolve;
    const { context, listeners } = setup(() => new Promise((done) => { resolve = done; }));
    const pending = context.pickAttachments(false);
    if (newChat) listeners.get('athena:new-conversation')();
    else {
      listeners.get('athena:conversation-active')({ conversationId: 'other' });
      listeners.get('athena:conversation-active')({ conversationId: 'old' });
    }
    resolve({ ok: true, attachments: [{ id: 'late', path: '/qa/late.txt', context: 'late content' }] });
    await pending;
    assert.equal(context.attachments.length, 0);
    assert.equal(context.consumeAttachments('Question'), 'Question');
  }
});

test('unchanged conversation accepts chosen files and folders and consumes them exactly once', async () => {
  const { context } = setup();
  await context.pickAttachments(true);
  await context.pickAttachments(true);
  assert.equal(context.attachments.length, 2);
  assert.equal(context.attachments[1].isDir, true);
  const prompt = context.consumeAttachments('Read these');
  assert.match(prompt, /\/qa\/file.txt/);
  assert.match(prompt, /LILAC-4826 total 18/);
  assert.doesNotMatch(prompt, /Read\(파일\)/);
  const providerPrompt = buildLiveTurnPrompt(prompt);
  const turn = buildTurnStartParams({ turnId: 'attachment-turn', userText: providerPrompt }, 'thread', {}, false);
  assert.match(turn.input[0].text, /LILAC-4826 total 18/);
  assert.equal(context.attachments.length, 0);
  assert.equal(context.consumeAttachments('Next'), 'Next');
});

test('failed attachment reads display errors without advertising an unread file', async () => {
  const { context, errors } = setup(async () => ({ ok: true, attachments: [
    { id: 'bad', path: '/qa/binary.pdf', error: 'UTF-8 텍스트만 지원합니다' },
  ] }));
  await context.pickAttachments(false);
  assert.equal(context.attachments.length, 1);
  assert.match(errors[0], /binary.pdf.*UTF-8/);
  assert.doesNotMatch(context.consumeAttachments('Read'), /binary.pdf/);
});

test('reselecting the same file refreshes its captured content without duplicating chips', async () => {
  const { context } = setup(async () => ({ ok: true, attachments: [
    { id: 'updated', path: '/qa/previous.txt', context: 'UPDATED-BYTES', isDir: false },
  ] }));
  await context.pickAttachments(false);
  assert.equal(context.attachments.length, 1);
  assert.match(context.consumeAttachments('Read'), /UPDATED-BYTES/);
});

test('live and restored bubbles show question and attachment names while provider/retry text retains bytes', async () => {
  const { context } = setup();
  await context.pickAttachments(false);
  const prompt = context.consumeAttachments('What is the code?');
  context.document = {
    createElement: fakeNode,
    createTextNode: text => Object.assign(fakeNode('#text'), { textContent: text }),
  };
  const declaration = name => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\n}', start) + 2);
  };
  vm.runInContext(declaration('attachmentDisplayText') + declaration('paintUserBubbleText') + declaration('pastMessageTurn'), context);
  const live = fakeNode('div');
  context.paintUserBubbleText(live, prompt);
  const restored = context.pastMessageTurn({ role: 'user', text: prompt }).children[0];
  for (const bubble of [live, restored]) {
    assert.match(bubble.textContent, /What is the code/);
    assert.match(bubble.textContent, /file.txt/);
    assert.doesNotMatch(bubble.textContent, /LILAC-4826|previous content|"content"/);
    assert.ok(bubble.textContent.length < 200);
  }
  assert.match(prompt, /LILAC-4826 total 18/);
  assert.match(context.attachmentDisplayText(`${prompt}\n\n[참조 @strategy]`), /\[참조 @strategy\]/);
});

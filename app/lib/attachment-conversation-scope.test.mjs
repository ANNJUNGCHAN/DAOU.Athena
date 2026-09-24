import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); }

function setup(invoke = async () => ({ ok: true, paths: ['/qa/file.txt'] })) {
  const listeners = new Map();
  let renders = 0;
  const context = vm.createContext({
    attachments: [{ path: '/qa/previous.txt', isDir: false }],
    displayedConversationId: 'old', conversationSelectionRevision: 1, switchingConversation: false,
    renderAttachChips() { renders++; }, closeKiumiMenu() {},
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
    + section("window.addEventListener('athena:new-conversation'", '// 실행 중 턴 중단'), context);
  return { context, listeners, renders: () => renders };
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
    resolve({ ok: true, paths: ['/qa/late.txt'] });
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
  assert.equal(context.attachments.length, 0);
  assert.equal(context.consumeAttachments('Next'), 'Next');
});

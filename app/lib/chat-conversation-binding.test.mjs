import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness(invoke) {
  const ctx = vm.createContext({
    displayedConversationId: null, switchingConversation: false,
    conversationSelectionRevision: 0, remoteQueryBusy: false, locked: false,
    $conversationRetry: { hidden: true }, $stopBtn: { hidden: false },
    window: { athena: { invoke } },
  });
  vm.runInContext(`
    function applyRemoteLock() { remoteQueryBusy = displayedConversationId === null; locked = remoteQueryBusy; }
    function syncDisplayedTurn() { $conversationRetry.hidden = true; applyRemoteLock(); }
    function setRemoteLock(value, text) { locked = value; globalThis.hint = text; }
    ${declaration('hydrateInitialConversation')}
  `, ctx);
  return ctx;
}

test('missing init event: first submission stays locked until an actual conversation is bound', async () => {
  const pending = deferred();
  const ctx = harness((channel) => { assert.equal(channel, 'athena:conversations-list'); return pending.promise; });
  const hydration = ctx.hydrateInitialConversation();
  assert.equal(ctx.remoteQueryBusy, true);
  assert.equal(ctx.locked, true);
  assert.equal(ctx.$stopBtn.hidden, true);
  pending.resolve({ activeId: 'initial-conversation' });
  await hydration;
  assert.equal(ctx.displayedConversationId, 'initial-conversation');
  assert.equal(ctx.remoteQueryBusy, false);
  assert.equal(ctx.locked, false);
});

test('initial hydration cannot steal a newer selection or a pending new conversation', async () => {
  for (const selected of ['new-selection', null]) {
    const pending = deferred();
    const ctx = harness(() => pending.promise);
    const hydration = ctx.hydrateInitialConversation();
    ctx.conversationSelectionRevision += 1;
    ctx.displayedConversationId = selected;
    pending.resolve({ activeId: 'old-selection' });
    await hydration;
    assert.equal(ctx.displayedConversationId, selected);
  }
});

test('failed initial binding exposes retry and never permits a null-id query; retry recovers', async () => {
  let calls = 0;
  const ctx = harness(() => ++calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ activeId: 'recovered' }));
  await ctx.hydrateInitialConversation();
  assert.equal(ctx.displayedConversationId, null);
  assert.equal(ctx.remoteQueryBusy, true);
  assert.equal(ctx.locked, true);
  assert.equal(ctx.$conversationRetry.hidden, false);
  assert.match(ctx.hint, /열지 못했습니다/);
  await ctx.hydrateInitialConversation();
  assert.equal(ctx.displayedConversationId, 'recovered');
  assert.equal(ctx.$conversationRetry.hidden, true);
  assert.equal(ctx.locked, false);
});

test('a response without an active conversation is recoverable rather than a false successful bind', async () => {
  const ctx = harness(() => Promise.resolve({}));
  await ctx.hydrateInitialConversation();
  assert.equal(ctx.displayedConversationId, null);
  assert.equal(ctx.$conversationRetry.hidden, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import storeLib from './session-store.js';
import exporter from './history-export.js';
import bridgeLib from './session-bridge.js';

function fixture(t) {
  const store = storeLib.createSessionStore({ dbPath: ':memory:' });
  t.after(() => store.close());
  return { store, flush() {}, load: id => store.getSession(id) };
}
function brain(conversations) {
  return async (url, { params }) => url.endsWith('/conversations')
    ? { ok: true, body: { conversations: conversations.map(({ messages, ...item }) => ({ ...item, message_count: messages.length })) } }
    : { ok: true, body: { messages: conversations.find(item => item.conversation_id === params.conversation_id).messages } };
}

test('failed streaming journal marks local export partial and preserves the buffer for a retry', async t => {
  const { store } = fixture(t);
  const bridge = bridgeLib.createSessionBridge({ store, setTimer: () => 1, clearTimer() {} });
  bridge.ensureSession({ id: 'streaming' });
  bridge.recordUserMessage({ sessionId: 'streaming', messageId: 'u', text: 'question' });
  bridge.beginAssistant({ sessionId: 'streaming', messageId: 'a', parentId: 'u' });
  bridge.journalDelta({ sessionId: 'streaming', messageId: 'a', text: 'visible pending answer' });
  store.db.exec("CREATE TRIGGER fail_export_journal BEFORE UPDATE ON session_messages BEGIN SELECT RAISE(FAIL, 'SQLITE_FULL'); END");
  const failed = await exporter.collectHistoryExport({ bridge, limit: 100, fetchBrainJson: brain([]) });
  assert.equal(failed.partial, true);
  assert.equal(failed.sources.local.status, 'partial');
  assert.match(failed.sources.local.error, /SQLITE_FULL/);
  assert.equal(failed.counts.localMessages, 2);
  assert.ok(bridge.pendingCount() > 0);
  store.db.exec('DROP TRIGGER fail_export_journal');
  const retried = await exporter.collectHistoryExport({ bridge, limit: 100, fetchBrainJson: brain([]) });
  assert.equal(retried.partial, false);
  assert.equal(retried.sources.local.conversations[0].messages[1].text, 'visible pending answer');
});

test('offline export retains complete local branches, long text, attachments and archived conversations', async t => {
  const bridge = fixture(t);
  bridge.store.createSession({ id: 'local' });
  const text = 'LILAC-4826 '.repeat(7000);
  bridge.store.appendMessage('local', { id: 'root', role: 'user', text, done: true,
    attachments: [{ id: 'selected-file', ownerKey: 'synthetic-owner' }] });
  bridge.store.appendMessage('local', { id: 'branch-a', parentId: 'root', role: 'assistant', text: 'A', done: true });
  bridge.store.appendMessage('local', { id: 'branch-b', parentId: 'root', role: 'assistant', text: 'B', done: true });
  bridge.store.db.prepare('UPDATE sessions SET archived = 1 WHERE id = ?').run('local');
  const exported = await exporter.collectHistoryExport({ bridge, limit: 100,
    fetchBrainJson: async () => ({ ok: false, error: 'offline' }) });
  const copy = JSON.parse(JSON.stringify(exported));
  assert.equal(copy.partial, true);
  assert.equal(copy.sources.brain.status, 'unavailable');
  assert.equal(copy.sources.local.status, 'complete');
  const saved = copy.sources.local.conversations[0];
  assert.equal(saved.messages.length, 3);
  assert.equal(saved.messages[0].text, text);
  assert.equal(saved.messages[0].attachments[0].ownerKey, 'synthetic-owner');
  assert.equal(saved.messages[1].parentId, 'root');
  assert.equal(saved.messages[2].parentId, 'root');
  assert.equal(saved.currentId, 'branch-b');
  assert.equal(saved.archived, true);
});

test('legacy Brain and same-ID local transcripts remain separate without content deduplication', async t => {
  const bridge = fixture(t);
  bridge.store.createSession({ id: 'same' });
  bridge.store.appendMessage('same', { id: 'local-msg', role: 'user', text: 'repeat', done: true });
  const exported = await exporter.collectHistoryExport({ bridge, limit: 100, fetchBrainJson: brain([
    { conversation_id: 'same', messages: [{ message_id: 'brain-msg', text: 'repeat' }, { message_id: 'repeat-again', text: 'repeat' }] },
    { conversation_id: 'legacy', messages: [{ message_id: 'old', text: 'legacy data' }] },
  ]) });
  assert.equal(exported.partial, false);
  assert.deepEqual(exported.counts, { localConversations: 1, localMessages: 1, brainConversations: 2, brainMessages: 3, uniqueConversations: 2 });
  assert.equal(exported.sources.brain.conversations[0].messages.length, 2);
});

test('local-only export with empty Brain is complete and an absent local store preserves legacy Brain', async t => {
  const bridge = fixture(t);
  bridge.store.createSession({ id: 'local' });
  bridge.store.appendMessage('local', { id: 'm', role: 'user', text: 'local', done: true });
  const local = await exporter.collectHistoryExport({ bridge, limit: 100, fetchBrainJson: brain([]) });
  assert.equal(local.partial, false);
  assert.equal(local.counts.localMessages, 1);
  const legacy = await exporter.collectHistoryExport({ bridge: null, limit: 100,
    fetchBrainJson: brain([{ conversation_id: 'legacy', messages: [{ text: 'legacy' }] }]) });
  assert.equal(legacy.partial, true);
  assert.equal(legacy.counts.brainMessages, 1);
});

test('Brain page limits and interrupted fetching remain explicit', async t => {
  const bridge = fixture(t);
  const truncated = await exporter.collectHistoryExport({ bridge, limit: 1,
    fetchBrainJson: brain([{ conversation_id: 'old', messages: [{ text: 'one' }] }]) });
  assert.equal(truncated.sources.brain.truncated, true);
  assert.equal(truncated.partial, true);
  const interrupted = await exporter.collectHistoryExport({ bridge, limit: 100,
    fetchBrainJson: async (url, options) => {
      if (url.endsWith('/conversations')) return { ok: true, body: { conversations: [
        { conversation_id: 'first', message_count: 1 }, { conversation_id: 'second', message_count: 1 },
      ] } };
      if (options.params.conversation_id === 'first') return { ok: true, body: { messages: [{ text: 'preserved' }] } };
      throw new Error('connection lost');
    } });
  assert.equal(interrupted.sources.brain.status, 'partial');
  assert.equal(interrupted.sources.brain.error, 'connection lost');
  assert.equal(interrupted.sources.brain.conversations[0].messages[0].text, 'preserved');
});

test('settings export reports separate source counts, partial status and restores controls after cancellation', async () => {
  const source = fs.readFileSync(new URL('../settings-cards.js', import.meta.url), 'utf8');
  const start = source.indexOf('  async function onExportClick()');
  const end = source.indexOf('  function onDeleteClick()', start);
  const node = text => ({ textContent: text || '', children: [], appendChild(child) { this.children.push(child); } });
  const label = node();
  const resultBox = node();
  const exportBtn = { disabled: false, querySelector: () => label };
  let response = { ok: true, partial: true, uniqueConversations: 2, localConversations: 1,
    localMessages: 3, brainConversations: 2, brainMessages: 4, localStatus: 'complete', brainStatus: 'partial', path: 'export.json' };
  const context = vm.createContext({ resultBox, exportBtn,
    clear: target => { target.children = []; }, el: (_tag, _class, text) => node(text), errorNote: node,
    window: { athena: { invoke: async () => response } } });
  vm.runInContext(source.slice(start, end), context);
  await context.onExportClick();
  const lines = resultBox.children[0].children.map(item => item.textContent);
  assert.ok(lines[0].includes('일부 완료 — 대화 2건'));
  assert.ok(lines[1].includes('로컬 대화 1건 · 메시지 3건 / 브레인 대화 2건 · 메시지 4건'));
  assert.ok(lines[3].includes('로컬: 완료, 브레인: 불완전'));
  response = { ok: true, canceled: true };
  await context.onExportClick();
  assert.equal(resultBox.children.length, 0);
  assert.equal(exportBtn.disabled, false);
  assert.equal(label.textContent, '이력 내보내기');
});

test('main saves local history while Brain is offline and returns matching source counts', async t => {
  const bridge = fixture(t);
  bridge.store.createSession({ id: 'local' });
  bridge.store.appendMessage('local', { id: 'm', role: 'user', text: 'LILAC-4826', done: true });
  let handler, written;
  const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const start = source.indexOf("ipcMain.handle('athena:history-export'");
  const end = source.indexOf('// 캔버스 빈 상태', start);
  const context = vm.createContext({
    ipcMain: { handle: (_channel, fn) => { handler = fn; } },
    require: () => exporter, getSessionBridge: () => bridge, BRAIN_HISTORY_PAGE_LIMIT: 100,
    fetchBrainJson: async () => ({ ok: false, error: 'offline' }),
    dialog: { showSaveDialog: async () => ({ filePath: 'synthetic.json' }) },
    shellWin: {}, app: { getPath: () => 'downloads' }, path: { join: (...args) => args.join('/') },
    fs: { promises: { writeFile: async (_path, text) => { written = JSON.parse(text); } } },
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await handler();
  assert.equal(result.ok, true);
  assert.equal(result.partial, true);
  assert.equal(result.localMessages, written.counts.localMessages);
  assert.equal(written.sources.local.conversations[0].messages[0].text, 'LILAC-4826');
});

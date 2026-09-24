import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function revealRoutineDraft('), source.indexOf('// ---------- 코드 알람 검사 카드'));

function setup(invoke) {
  const rendered = [];
  const context = vm.createContext({
    window: { athena: { invoke } },
    displayedConversationId: 'new-conversation', conversationSelectionRevision: 1,
    firstSeenSignatureById: new Map([['saved', 'same-candidate']]),
    firstSeenAtById: new Map(), routineDraftViewsById: new Map(),
    mainCardCandidateSignature: () => 'same-candidate',
    retireRoutineDraftViews() {},
    renderApprovalCard: (routine, options) => rendered.push({ routine, options }),
  });
  vm.runInContext(code, context);
  return { context, rendered, open: context.window.AthenaRoutineDrafts.openSaved };
}
const draft = { id: 'saved', status: 'draft' };

test('saved draft is explicitly reopened in the current conversation after global dedup', async () => {
  const { context, rendered, open } = setup(async () => ({ ok: true, data: draft }));
  assert.equal(context.revealRoutineDraft(draft), false);
  assert.equal((await open('saved')).ok, true);
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].options.conversationId, 'new-conversation');
  assert.equal(rendered[0].options.autoCheck, false);
});

test('explicit reopen focuses an already mounted card without duplicating it', async () => {
  const { context, rendered, open } = setup(async () => ({ ok: true, data: draft }));
  let scrolled = 0;
  context.routineDraftViewsById.set('saved', new Set([{
    renderedSnapshot: JSON.stringify(draft),
    originConversationId: 'new-conversation', line: { isConnected: true, scrollIntoView() { scrolled++; } },
  }]));
  assert.equal((await open('saved')).ok, true);
  assert.equal(scrolled, 1);
  assert.equal(rendered.length, 0);
});

test('same candidate with changed detail replaces the stale card with current approval data', async () => {
  for (const changed of [{ note: 'Updated instruction' }, { activation_blocker: 'Missing source' },
    { cooldown_s: 900 }]) {
    const latest = { ...draft, ...changed };
    const { context, rendered, open } = setup(async () => ({ ok: true, data: latest }));
    let removed = 0;
    context.routineDraftViewsById.set('saved', new Set([{
      renderedSnapshot: JSON.stringify(draft), originConversationId: 'new-conversation',
      line: { isConnected: true, remove() { removed++; } },
    }]));
    assert.equal((await open('saved')).ok, true);
    assert.equal(removed, 1);
    assert.equal(rendered.length, 1);
    assert.deepEqual(rendered[0].routine, latest);
    assert.equal(rendered[0].options.autoCheck, false);
  }
});

test('late detail response cannot mount into another conversation or a revisited conversation', async () => {
  for (const changeId of [true, false]) {
    let resolve;
    const { context, rendered, open } = setup(() => new Promise((r) => { resolve = r; }));
    const pending = open('saved');
    if (changeId) context.displayedConversationId = 'other';
    context.conversationSelectionRevision++;
    resolve({ ok: true, data: draft });
    assert.equal((await pending).ok, false);
    assert.equal(rendered.length, 0);
  }
});

test('failed detail, wrong routine, and no longer draft cannot expose approval controls', async () => {
  for (const result of [{ ok: false, error: 'offline' }, { ok: true, data: { id: 'other', status: 'draft' } },
    { ok: true, data: { id: 'saved', status: 'active' } }]) {
    const { rendered, open } = setup(async () => result);
    assert.equal((await open('saved')).ok, false);
    assert.equal(rendered.length, 0);
  }
});

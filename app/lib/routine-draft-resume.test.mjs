import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import proposalTurn from './routine-proposal-turn.js';
import routineMainCardLib from './routine-main-card.js';

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

function adoptionHarness(invoke) {
  const drafts = [];
  const failures = [];
  const submitted = [];
  const context = vm.createContext({ window: { athena: { invoke } },
    routineMainCardLib,
    document: { dispatchEvent: event => submitted.push(event.detail.text) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    revealRoutineDraft: (routine, options) => drafts.push({ routine, options }),
    emitControlResult: (model, retry, conversationId) => failures.push({ model, retry, conversationId }),
  });
  for (const prefix of ['function adoptSeedText(', 'async function acceptProposal(']) {
    const start = source.indexOf(prefix);
    assert.ok(start >= 0);
    vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  }
  return { context, drafts, failures, submitted };
}

const onceProposal = {
  symbol: '005930', mode: 'scheduled',
  condition: { source: 'schedule.once', op: 'at', value: '2030-09-30T20:30:00+09:00' },
  note: '조회 없이 합성 문구를 한 번만 출력', cooldown_s: 300, expires_days: 1,
  main_card_candidate: { operation_ref: 'qa-read-only', args: { stk_cd: '005930' }, title: 'QA' },
};

test('adopting a complete once schedule creates its exact draft without rewriting or activation', async () => {
  const calls = [];
  const returned = { ...onceProposal, id: 'once', status: 'draft', main_card_pending: true };
  const h = adoptionHarness(async (channel, request) => {
    calls.push({ channel, body: request.body });
    return { ok: true, data: returned };
  });
  const turn = proposalTurn.buildProposalTurn({ control: 'adopt', proposed: onceProposal });
  assert.match(turn.lead, /예약 초안 만들기/);
  await h.context.acceptProposal(turn, 'origin');
  assert.deepEqual(calls, [{ channel: 'athena:routine-draft', body: onceProposal }]);
  assert.equal(h.drafts[0].routine, returned);
  assert.equal(h.drafts[0].options.autoCheck, false);
  assert.equal(h.drafts[0].options.conversationId, 'origin');
  assert.equal(h.submitted.length, 0);
  assert.equal(h.failures.length, 0);
});

test('partial adoption retains all proposal fields and requests drafting without changing a once schedule', async () => {
  const h = adoptionHarness(() => { throw new Error('no direct draft for incomplete proposal'); });
  const proposed = { ...onceProposal, main_card_candidate: null, prompt: '원래 실행 내용' };
  await h.context.acceptProposal({ control: 'adopt', subject: '한 번 알림', proposed }, 'origin');
  assert.equal(h.submitted.length, 1);
  assert.match(h.submitted[0], /athena_routine action=draft/);
  assert.match(h.submitted[0], /반복 예약이나 코드 감시로 바꾸지 말고/);
  assert.match(h.submitted[0], /활성화는 하지 마/);
  assert.deepEqual(JSON.parse(h.submitted[0].split('제안값: ')[1]), proposed);
  assert.equal(h.drafts.length, 0);
});

test('failed adoption exposes retry without claiming a draft or triggering approval', async () => {
  let calls = 0;
  const h = adoptionHarness(async () => { calls++; throw new Error('draft failed'); });
  await h.context.acceptProposal({ control: 'adopt', proposed: onceProposal, badge: '제안 채택' }, 'origin');
  assert.equal(h.drafts.length, 0);
  assert.equal(h.failures[0].model.reason, 'draft failed');
  assert.equal(h.failures[0].conversationId, 'origin');
  await h.failures[0].retry();
  assert.equal(calls, 2);
  assert.equal(h.submitted.length, 0);
});

test('missing condition or card fields go through completion instead of an unretryable draft loop', async () => {
  for (const patch of [
    { condition: { source: 'schedule.once' } },
    { condition: { source: 'schedule.once', op: 'at' } },
    { main_card_candidate: { operation_ref: 'qa-read-only', args: {} } },
    { main_card_candidate: { operation_ref: 'qa-read-only', title: 'QA' } },
    { condition: { source: 'code.watch', op: '==', value: true } },
  ]) {
    const proposed = { ...onceProposal, ...patch };
    const h = adoptionHarness(() => { throw new Error('incomplete proposal must be completed'); });
    await h.context.acceptProposal({ control: 'adopt', proposed }, 'origin');
    assert.equal(h.failures.length, 0);
    assert.equal(h.submitted.length, 1);
    assert.deepEqual(JSON.parse(h.submitted[0].split('제안값: ')[1]), proposed);
  }
});

test('complete code watch adoption keeps automatic draft checking without activation', async () => {
  const proposed = { ...onceProposal, condition: { source: 'code.watch', op: '==', value: true },
    watch: { project_id: 'p', path: 'watch/check.py', version_hash: 'a'.repeat(64) } };
  const calls = [];
  const h = adoptionHarness(async channel => {
    calls.push(channel);
    return { ok: true, data: { ...proposed, id: 'watch', status: 'draft', mode: 'code-watch' } };
  });
  await h.context.acceptProposal({ control: 'adopt', proposed }, 'origin');
  assert.deepEqual(calls, ['athena:routine-draft']);
  assert.equal(h.drafts[0].options.autoCheck, true);
  assert.equal(h.submitted.length, 0);
});

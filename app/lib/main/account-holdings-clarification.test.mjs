import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const product = process.env.ATHENA_PUBLIC_SOURCE_ROOT || resolve(here, '../../..');
const sourceRequire = file => require(resolve(product, 'app/lib/main', file));
const helper = require('./account-holdings-clarification');
const fast = require('./selector-fast-path');
const owner = { conversationId: 'public-a', accountId: 'public-account' };
const question = '보유 종목별 평가 손익';
const resolvedRequests = [];
after(() => {
  if (process.env.ATHENA_PUBLIC_ARTIFACT_DIR) writeFileSync(resolve(process.env.ATHENA_PUBLIC_ARTIFACT_DIR, 'merged-requests.json'),
    JSON.stringify(resolvedRequests.map(({ question, arguments: args, preferred_ref }) => ({ question, arguments: args, preferred_ref })), null, 2)+'\n');
});
const preflight = () => ({ status: 'needs_inference', code: 'INVALID_ARGUMENTS', candidates: [{
  operation_ref: helper.REF, kind: 'query', required_arguments: [{ alias: 'qry_tp' }, { alias: 'dmst_stex_tp' }],
}] });
const mainSource = readFileSync(resolve(here, '../../main.js'), 'utf8');
const mainBody = mainSource.slice(mainSource.indexOf('async function runLiveQueryInnerBody('), mainSource.indexOf('// 한 대화의 진행 중 작업만 끊는다'));
const abortBody = mainSource.slice(mainSource.indexOf('function abortRuntimeWork('), mainSource.indexOf('function interruptProviderRuntime('));

function harness({ responses, stale = false, accountChange = false, supersedeAt = null, replaceController = true } = {}) {
  const submitted = [], answers = [], requests = [], emitted = [], cold = [];
  const runtimes = sourceRequire('conversation-runtimes').createConversationRuntimes();
  const contexts = new Map();
  let accountId = owner.accountId;
  const newerPending = { operationRef: helper.REF, conversationId: owner.conversationId,
    accountId: owner.accountId, question: 'newer public selection', arguments: { qry_tp: '1' } };
  const newerController = new AbortController();
  function supersede(at) {
    if (supersedeAt !== at || !requests.length) return;
    contexts.set(owner.conversationId, {});
    const runtime = runtimes.get(owner.conversationId);
    runtime.pendingAccountHoldings = newerPending;
    if (replaceController) runtime.activeSelectorFastRun = newerController;
  }
  const fetch = async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (requests.length > 1) supersede('fetch');
    if (stale) contexts.set(owner.conversationId, {});
    const reply = responses?.shift();
    if (reply instanceof Error) throw reply;
    if (reply) return { ok: true, json: async () => reply };
    if (!body.question.includes('보유')) return { ok: true, json: async () => ({ status: 'needs_inference', code: 'NO_CONFIDENT_MATCH', candidates: [] }) };
    if (!body.arguments.qry_tp || !body.arguments.dmst_stex_tp) return { ok: true, json: async () => preflight() };
    const correlation = { dataset_id: body.dataset_id, item_id: body.item_id, ordinal: body.ordinal };
    return { ok: true, json: async () => ({ status: 'rendered', delivery: 'inline', queued: false,
      operation_ref: helper.REF, canvas_type: 'facts', screen_id: 'public-synthetic', correlation,
      envelope: { canvas_type: 'facts', screen_id: 'public-synthetic', correlation, operation_args: body.arguments,
        data: { fields: [{ label: '합성 0', value: 0 }] } } }) };
  };
  const ctx = vm.createContext({ performance, crypto, AbortController, fetch,
    require: name => {
      assert.equal(name, './lib/main/graph-model-access');
      return { checkGraphModelAccess: async () => { supersede('graph'); return null; } };
    },
    prefs: { get: () => ({}) }, historySink: { getBackendUrl() {}, getBearerToken() {}, saveChatMessage() {} }, emitHistorySaveFailed() {},
    liveSubmitContexts: contexts, liveRuntimes: runtimes,
    accountHoldingsClarification: helper, activeRestAccountId: () => accountId,
    activeCardQna: sourceRequire('active-card-context'), restDatasetRunner: sourceRequire('rest-dataset-runner'),
    simpleChartFastPath: sourceRequire('simple-chart-fast-path'), selectorFastPath: { ...fast,
      runSelectorFastPath: options => fast.runSelectorFastPath({ ...options, fetchImpl: fetch }) },
    goldOrderIntent: sourceRequire('gold-order-intent'), goldQuoteIntent: sourceRequire('gold-quote-intent'),
    chartFollowupTracker: { answer: () => null, invalidateForQuery() {} },
    stockMasterClient: { resolveCurrentStockMasterQuery: async () => { supersede('stock'); return { ready: true, instrument: null }; },
      createQueryScopedIndex: Constructor => new Constructor() },
    stockMasterAbortController: new AbortController(), BACKEND_HTTP_BASE: 'http://public.invalid',
    accountBoundDataset: sourceRequire('account-bound-dataset'),
    accounts: { resolveBackendAlias: async () => {
      supersede('binding');
      if (accountChange && requests.length) accountId = 'public-other-account';
      return { ok: true, backendAlias: 'synthetic-public' };
    } }, backendAccountAuthorization: () => '',
    persistLocalLiveResult: (_query, result) => { answers.push(result); return result; },
    emitRestCanvasForOrigin: async payload => { emitted.push(payload); return { verifiedVisible: true }; },
    selectorColdHedge: { runSelectorColdHedge: async request => { cold.push(request); return { handled: false, reason: 'synthetic-decline' }; } },
    isLayaCatalogEnabled: () => false,
    selectorClaudePool: {}, mdlog() {},
    getLiveMcpConfig: () => { throw Object.assign(new Error('Public provider boundary, not executed'), { code: 'PUBLIC_PROVIDER_BOUNDARY' }); },
  });
  vm.runInContext(mainBody + '\n' + abortBody, ctx);
  return { requests, answers, emitted, cold, runtimes, ctx, newerPending, newerController,
    setAccount: value => { accountId = value; },
    async turn(text, conversationId = owner.conversationId, submit = {}) {
      contexts.set(conversationId, submit); submitted.push(text);
      return ctx.runLiveQueryInnerBody(text, true, 'shell', conversationId, 'public-assistant');
    } };
}

test('only exact query holdings INVALID_ARGUMENTS with the two required aliases starts collection', () => {
  assert.ok(helper.begin(question, preflight(), owner).state);
  for (const change of [{ code: 'NO_CONFIDENT_MATCH' }, { status: 'ambiguous' }, { candidates: [] },
    { candidates: [...preflight().candidates, ...preflight().candidates] },
    { candidates: [{ ...preflight().candidates[0], operation_ref: 'base:kt10000', kind: 'order' }] },
    { candidates: [{ ...preflight().candidates[0], required_arguments: [{ alias: 'stk_cd' }] }] }]) {
    assert.equal(helper.begin(question, { ...preflight(), ...change }, owner).state, null);
  }
});

test('종목별 is not an implicit query-mode or exchange default; explicit supported terms are bound', () => {
  assert.deepEqual(helper.begin(question, preflight(), owner).state.arguments, {});
  assert.deepEqual(helper.begin('KRX 보유 개별 종목 평가 손익', preflight(), owner).state.arguments, { dmst_stex_tp: 'KRX' });
  assert.deepEqual(helper.begin(`${question} NXT50`, preflight(), owner).state.arguments, {});
  const ready = helper.begin(`${question} KRX 개별 조회`, preflight(), owner);
  assert.deepEqual(ready.request.options.arguments, { dmst_stex_tp: 'KRX', qry_tp: '2' });
  assert.equal(ready.state, null);
  assert.deepEqual(helper.resume('한국거래소와 개별로 조회해 주세요', helper.begin(question, preflight(), owner).state, owner).request.options.arguments,
    { dmst_stex_tp: 'KRX', qry_tp: '2' });
});

test('actual main→frontend consumer carries partial explicit choices across same-conversation turns', async () => {
  const h = harness();
  const first = await h.turn(question);
  assert.equal(first.status, 'needs_input'); assert.equal(h.emitted.length, 0); assert.equal(h.cold.length, 0);
  assert.deepEqual(h.requests[0].arguments, {});
  const second = await h.turn('개별');
  assert.match(second.answerText, /거래소/); assert.equal(h.requests.length, 1);
  const result = await h.turn('KRX');
  assert.equal(result.ok, true); assert.equal(result.operationRef, helper.REF);
  assert.deepEqual(h.requests[1].arguments, { qry_tp: '2', dmst_stex_tp: 'KRX' });
  assert.equal(h.requests[1].preferred_ref, helper.REF);
  assert.equal(h.emitted.length, 1); assert.equal(h.cold.length, 0);
  resolvedRequests.push(h.requests[1]);
  assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, null);
});

test('explicit initial choices trigger one bounded redispatch with both values', async () => {
  const h = harness(); const result = await h.turn(`${question} NXT 합산 조회`);
  assert.equal(result.ok, true); assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[1].arguments, { dmst_stex_tp: 'NXT', qry_tp: '1' });
  resolvedRequests.push(h.requests[1]);
  assert.equal(h.cold.length, 0);
});

test('conflicting, unsupported and unrelated replies never produce a holdings request', () => {
  const state = helper.begin(question, preflight(), owner).state;
  for (const text of ['KRX NXT', '합산 개별', 'KRX 말고', 'NYSE', '조회 구분 3', 'KRX 삼성전자 매수 주문']) {
    assert.equal(helper.resume(text, state, owner).request, null, text);
  }
  assert.equal(helper.resume('삼성전자 차트', state, owner).state, null);
  assert.equal(helper.resume('취소', state, owner).state, null);
});

test('conversation, account, candidate, blocked mode and explicit abort invalidate pending selection', async () => {
  const state = helper.begin(question, preflight(), owner).state;
  for (const changes of [{ conversationId: 'public-b' }, { accountId: 'other' }, { blocked: true }]) {
    assert.equal(helper.resume('KRX 개별', state, { ...owner, ...changes }).request, null);
  }
  assert.equal(helper.resume('KRX 개별', { ...state, operationRef: 'base:kt00004' }, owner).state, null);
  const h = harness(); await h.turn(question);
  const cancelled = await h.turn('취소');
  assert.equal(cancelled.status, 'cancelled'); assert.equal(h.requests.length, 1);
  await h.turn(question);
  h.ctx.abortRuntimeWork(h.runtimes.get(owner.conversationId), new Error('synthetic cancellation'));
  assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, null);
  await h.turn(question);
  await assert.rejects(h.turn('개별', owner.conversationId, { canvasMode: 'backtest' }), { code: 'PUBLIC_PROVIDER_BOUNDARY' });
  assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, null);
});

test('other conversation and stale result cannot consume or create a pending account selection', async () => {
  const h = harness(); await h.turn(question);
  await assert.rejects(h.turn('KRX 개별', 'public-b'), { code: 'PUBLIC_PROVIDER_BOUNDARY' });
  assert.ok(h.runtimes.get(owner.conversationId).pendingAccountHoldings);
  await assert.rejects(h.turn('오늘 날씨 알려줘'), { code: 'PUBLIC_PROVIDER_BOUNDARY' });
  assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, null);
  assert.equal(h.emitted.length, 0);
  assert.deepEqual(h.requests.at(-1).arguments, {});
  const stale = harness({ stale: true });
  await assert.rejects(stale.turn(question), { code: 'PUBLIC_PROVIDER_BOUNDARY' });
  assert.equal(stale.runtimes.get(owner.conversationId).pendingAccountHoldings, null);
});

test('account changes during the follow-up binding stop before a query with old choices', async () => {
  const h = harness({ accountChange: true }); await h.turn(question);
  const result = await h.turn('KRX 개별');
  assert.equal(result.ok, false); assert.equal(result.code, 'ACCOUNT_SELECTION_CHANGED');
  assert.equal(h.requests.length, 1); assert.equal(h.emitted.length, 0);
});

test('other selector errors, ambiguous candidates and transport failure retain fallback; no fake card', async () => {
  for (const reply of [{ ...preflight(), code: 'NO_CONFIDENT_MATCH' },
    { ...preflight(), candidates: [...preflight().candidates, ...preflight().candidates] },
    new Error('synthetic transport failure')]) {
    const h = harness({ responses: [reply] });
    await assert.rejects(h.turn(question), { code: 'PUBLIC_PROVIDER_BOUNDARY' });
    assert.equal(h.emitted.length, 0); assert.equal(h.answers.length, 0);
  }
});

test('allowlisted preflight code survives actual consumer, unknown codes do not', async () => {
  for (const code of ['INVALID_ARGUMENTS', 'MCP_READINESS_PROTOCOL', 'UNKNOWN_PUBLIC_CODE']) {
    const out = await fast.runSelectorFastPath({ question, backendAccountAlias: 'synthetic-public',
      fetchImpl: async () => ({ ok: true, json: async () => ({ ...preflight(), code }) }) });
    assert.equal(out.preflight.code, code === 'INVALID_ARGUMENTS' ? code : undefined);
    assert.equal(out.handled, false);
  }
});

for (const [at, reply] of [['graph', '개별'], ['graph', 'KRX 개별'], ['stock', 'KRX 개별'], ['binding', 'KRX 개별']]) {
  test('superseded holdings turn at '+at+' / '+reply+' cannot mutate or dispatch over newer work', async () => {
    const h = harness({ supersedeAt: at });
    await h.turn(question);
    const answers = h.answers.length;
    await h.turn(reply).catch(() => {});
    assert.equal(h.answers.length, answers, 'old reply persisted');
    assert.equal(h.requests.length, 1, 'old request dispatched');
    assert.equal(h.emitted.length, 0, 'old card emitted');
    const runtime = h.runtimes.get(owner.conversationId);
    assert.equal(runtime.pendingAccountHoldings, h.newerPending, 'new pending changed');
    assert.equal(runtime.activeSelectorFastRun, h.newerController, 'new controller changed');
    assert.equal(h.newerController.signal.aborted, false, 'new controller aborted');
  });
}
test('superseded holdings response after dispatch cannot emit a late card or reply', async () => {
  const h = harness({ supersedeAt: 'fetch' }); await h.turn(question);
  const answers = h.answers.length;
  await h.turn('KRX 개별').catch(() => {});
  assert.equal(h.requests.length, 2, 'one request began before supersession');
  assert.equal(h.answers.length, answers);
  assert.equal(h.emitted.length, 0);
  const runtime = h.runtimes.get(owner.conversationId);
  assert.equal(runtime.pendingAccountHoldings, h.newerPending);
  assert.equal(runtime.activeSelectorFastRun, h.newerController);
  assert.equal(h.newerController.signal.aborted, false);
});

test('submit-only replacement during account binding stops before dispatch', async () => {
  const h = harness({ supersedeAt: 'binding', replaceController: false }); await h.turn(question);
  const answers = h.answers.length;
  await h.turn('KRX 개별').catch(() => {});
  assert.equal(h.requests.length, 1);
  assert.equal(h.answers.length, answers);
  assert.equal(h.emitted.length, 0);
  assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, h.newerPending);
});

test('explicit initial choices redispatch rejects a submit-only stale response', async () => {
 const h = harness({ supersedeAt: 'fetch', replaceController: false });
 await h.turn(question+' KRX 개별 조회').catch(() => {});
 assert.equal(h.requests.length, 2);
 assert.equal(h.emitted.length, 0);
 assert.equal(h.answers.length, 0);
 assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, h.newerPending);
});
test('explicit initial choices complete through the actual consumer', async () => {
 const h = harness();
 await h.turn(question+' KRX 개별 조회');
 assert.equal(h.requests.length, 2);
 assert.deepEqual(h.requests.at(-1).arguments, { qry_tp: '2', dmst_stex_tp: 'KRX' });
 assert.equal(h.emitted.length, 1);
 assert.equal(h.runtimes.get(owner.conversationId).pendingAccountHoldings, null);
});

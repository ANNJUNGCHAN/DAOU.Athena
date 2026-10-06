import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import prompt from './live-prompt.js';
import providerOrderTicket from './provider-order-ticket.js';
import orderTicket from '../order-ticket.js';

const require = createRequire(import.meta.url);

// Scope (2026-10-06): mock-account orders confirmed on the order ticket are in scope.
// Real or unknown accounts and automated trading stay blocked.
const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const chatSource = fs.readFileSync(new URL('../../chat.js', import.meta.url), 'utf8');
function declaration(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function line(pattern) {
  return source.match(pattern)[0];
}
const policy = [
  line(/^const TRADING_OUT_OF_SCOPE_MESSAGE = .*;\r?$/m),
  line(/^const ORDERS_UNAVAILABLE_MESSAGE = .*;\r?$/m),
  line(/^const ORDER_ACCOUNT_ALIAS_RE = .*;\r?$/m),
  declaration('function tradingOutOfScope('),
  declaration('function activeOrderAccountAlias('),
  declaration('async function orderEnvironment('),
  declaration('function orderRefusal('),
].join('\n');

const REAL = { mock: false, available: false };
const MOCK_OFF = { mock: true, available: false };
const MOCK_ON = { mock: true, available: true };

function environmentFetch(env, calls = [], { orderThrows = false } = {}) {
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/api/v1/llm/order-environment')) {
      if (env === 'error') throw new Error('backend down');
      return { ok: true, json: async () => ({
        order_environment: env.mock ? 'mock' : 'real', mock: env.mock, orders_available: env.available,
      }) };
    }
    if (orderThrows) throw new Error('socket hang up');
    return { ok: true, status: 200, json: async () => ({ return_code: 0, ord_no: '0000123' }) };
  };
}

function accountsWith(backendAlias, extra = {}) {
  return { list: () => ({ accounts: [{ id: 'a1', active: true, backendAlias }] }), ...extra };
}

function baseContext(extra = {}) {
  return vm.createContext({
    BACKEND_HTTP_BASE: 'http://127.0.0.1:1', AbortSignal, accounts: accountsWith('acct-1'), ...extra,
  });
}

function executor(env, calls, options = {}) {
  const published = [];
  const ctx = baseContext({
    fetch: environmentFetch(env, calls, options),
    process: { env: { ATHENA_LOCAL_BEARER_TOKEN: 'synthetic' } },
    backendLauncher: { orderKey: () => 'launch-key' },
    orderTicket,
    protectedCards: { buildOrderActionCard: (card) => card },
    mdlog() {},
  });
  vm.runInContext(policy + '\n' + declaration('async function executeOrderRequest('), ctx);
  const run = (payload = {}) => ctx.executeOrderRequest(
    { trId: 'kt10000', body: { ord_qty: '1' }, idempotencyKey: 'k1', conversationId: 'c1',
      accountAlias: 'acct-1', ...payload },
    { activeConversationId: () => 'c1', publishResult: (card) => published.push(card) },
  );
  return { run, published };
}

test('order execution needs a mock account with orders available, bound to the ticket account', async () => {
  for (const [env, message] of [[REAL, /실계좌 주문과 자동매매는/], ['error', /실계좌 주문과 자동매매는/],
    [MOCK_OFF, /주문 API가 꺼져 있습니다/]]) {
    const calls = [];
    const result = await executor(env, calls).run();
    assert.equal(result.status, 403);
    assert.match(result.error, message);
    assert.deepEqual(calls.map((call) => call.url), ['http://127.0.0.1:1/api/v1/llm/order-environment']);
    assert.equal(calls[0].options.headers['X-Athena-Account'], 'acct-1');
  }
  for (const payload of [{ accountAlias: 'other-acct' }, { accountAlias: '' }]) {
    const calls = [];
    const result = await executor(MOCK_ON, calls).run(payload);
    assert.equal(result.status, 412);
    assert.equal(calls.length, 0);
  }

  const calls = [];
  const { run, published } = executor(MOCK_ON, calls);
  const result = await run();
  assert.equal(result.ok, true);
  assert.equal(calls[1].url, 'http://127.0.0.1:1/api/v1/order/kt10000');
  const headers = calls[1].options.headers;
  assert.equal(headers['X-Athena-Confirm'], 'true');
  assert.equal(headers['X-Athena-Account'], 'acct-1');
  assert.equal(headers['X-Athena-Order-Key'], 'launch-key');
  assert.equal(headers['Idempotency-Key'], 'k1');
  assert.equal(published[0].outcome, 'done');
});

test('an order request that may have left is reported in doubt, never as a retryable failure', async () => {
  const calls = [];
  const { run, published } = executor(MOCK_ON, calls, { orderThrows: true });
  const result = await run();
  assert.equal(result.status, 0);
  assert.equal(published[0].outcome, 'in_doubt');
  for (const status of [0, 409, 500, 502, 504]) {
    assert.equal(orderTicket.interpretExecuteStatus(status), 'in_doubt', String(status));
  }
  for (const status of [400, 403, 412, 422, 503]) {
    assert.equal(orderTicket.interpretExecuteStatus(status), 'failed', String(status));
  }
  assert.match(orderTicket.executeOutcomeCopy('in_doubt'), /주문이 전송됐을 수 있습니다.*체결·잔고/);

  // One idempotency key per ticket; only a confirmed non-acceptance gets a new one.
  const ticket = orderTicket.createTicket({ symbol: '005930', side: 'buy', qty: 1 });
  const first = ticket.idempotencyKey;
  assert.match(first, /^ticket-/);
  for (const outcome of ['in_doubt', 'needs_confirm', 'done']) {
    assert.equal(orderTicket.rotateIdempotencyKeyAfter(ticket, outcome), first);
  }
  assert.notEqual(orderTicket.rotateIdempotencyKeyAfter(ticket, 'failed'), first);
  assert.equal(orderTicket.ticketStateAfterExecute('in_doubt'), 'in_doubt');
  assert.throws(() => orderTicket.transition({ state: 'in_doubt' }, 'executing'));
  assert.match(chatSource, /idempotencyKey: ticket\.idempotencyKey,/);
  assert.doesNotMatch(chatSource, /idempotencyKey: orderTicketLib\.newIdempotencyKey\(\)/);
  assert.match(chatSource, /res = \{ ok: false, status: 0, error:/);
});

test('order permission turns on only for a connected mock account and always turns off', async () => {
  for (const [env, backendAlias] of [[REAL, 'acct-1'], ['error', 'acct-1'], [MOCK_ON, '']]) {
    const writes = [];
    const ctx = baseContext({
      fetch: environmentFetch(env),
      accounts: accountsWith(backendAlias, {
        orderApiSet: (id, enabled) => { writes.push({ id, enabled }); return { ok: true }; },
      }),
      syncSelectedAccount: async () => ({ ok: true }),
    });
    vm.runInContext(policy + '\n' + declaration('async function handleOrderApiSet('), ctx);
    const result = await ctx.handleOrderApiSet(null, { id: 'a1', enabled: true });
    assert.equal(result.code, 'TRADING_OUT_OF_SCOPE');
    assert.equal(result.orderApi, false);
    assert.deepEqual(writes, []);
  }

  const calls = [];
  const writes = [];
  const ctx = baseContext({
    // The permission is still off while it is being turned on, so only `mock` is required.
    fetch: environmentFetch(MOCK_OFF, calls),
    accounts: accountsWith('acct-1', {
      orderApiSet: (id, enabled) => { writes.push({ id, enabled }); return { ok: true, orderApi: enabled }; },
    }),
    syncSelectedAccount: async () => ({ ok: true }),
  });
  vm.runInContext(policy + '\n' + declaration('async function handleOrderApiSet('), ctx);
  assert.equal((await ctx.handleOrderApiSet(null, { id: 'a1', enabled: true })).ok, true);
  assert.equal(calls[0].options.headers['X-Athena-Account'], 'acct-1');
  assert.equal((await ctx.handleOrderApiSet(null, { id: 'a1', enabled: false })).ok, true);
  assert.deepEqual(writes, [{ id: 'a1', enabled: true }, { id: 'a1', enabled: false }]);
  assert.equal(calls.length, 1);
});

test('the per-launch order key reaches only the backend child, never main or other children', () => {
  const launcher = require('./backend-launcher.js');
  const env = launcher.buildBackendEnv({ PATH: 'synthetic', ATHENA_ORDER_KEY: 'inherited' });
  assert.equal(env.ATHENA_ENABLE_ORDER_API, 'true');
  assert.match(env.ATHENA_ORDER_KEY, /^[0-9a-f]{64}$/);
  assert.equal(env.ATHENA_ORDER_KEY, launcher.orderKey());
  assert.equal(launcher.buildBackendEnv({ ATHENA_ENABLE_ORDER_API: 'false' }).ATHENA_ENABLE_ORDER_API, 'false');
  assert.equal(process.env.ATHENA_ORDER_KEY, undefined);
  const launcherSource = fs.readFileSync(new URL('./backend-launcher.js', import.meta.url), 'utf8');
  assert.doesNotMatch(launcherSource, /process\.env\.ATHENA_ORDER_KEY|process\.env\[['"]ATHENA_ORDER_KEY/);
  assert.doesNotMatch(source, /ATHENA_ORDER_KEY/);
  // Provider and MCP children are spawned from copies of process.env, which never holds the key.
  for (const file of ['claude-runner.js', 'grok-runner.js', 'mcp-env.js', 'claude-chat-session.js']) {
    const text = fs.readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /ATHENA_ORDER_KEY|orderKey|buildBackendEnv/, file);
  }
  // Only executeOrderRequest sends the key.
  assert.equal(source.split("'X-Athena-Order-Key'").length - 1, 1);
});

test('deployment, arming and evaluation stay blocked before backend startup but ordinary backtest reads work', async () => {
  const handlers = new Map(), requests = [];
  const ctx = vm.createContext({
    backtestBridge: new Proxy({}, { get: (_target, name) => name }),
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    callBacktestBridge: async (method, body) => { requests.push({ method, body }); return { ok: true }; },
  });
  const start = source.indexOf('const BACKTEST_EXTRA_CHANNELS =');
  const end = source.indexOf('// 프로젝트 파일 API', start);
  vm.runInContext(policy + '\n' + source.slice(start, end), ctx);
  for (const channel of ['deployment-create', 'deployment-arm', 'evaluate']) {
    const result = await handlers.get(`athena:backtest-${channel}`)(null, { armed: true });
    assert.equal(result.code, 'TRADING_OUT_OF_SCOPE');
  }
  assert.equal(requests.length, 0);
  for (const channel of ['coverage', 'strategies', 'versions', 'deployment-stop']) {
    assert.equal((await handlers.get(`athena:backtest-${channel}`)(null, {})).ok, true);
  }
  assert.equal(requests.length, 4);
});

const confirmation = {
  clientSubmitId: 'turn-1',
  status: 'needs_confirmation',
  message: '주문 티켓을 열었습니다. 앱에서 내용을 확인한 뒤 전송하세요.',
  ticketCreated: true,
  operationRef: 'base:kt10000',
  orderDraft: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '1', trde_tp: '3' },
};

async function providerConfirmation(env, { displayed = 'conversation-1' } = {}) {
  const context = { conversationId: 'conversation-1' };
  const terminal = new Map();
  const sent = [];
  const ctx = baseContext({
    fetch: environmentFetch(env),
    rememberLiveRealtimeFallbackAuthority() {},
    persistentTurnContexts: new Map([['turn-1', context]]),
    persistentTerminalAnswers: terminal,
    presentProviderOrderTicket: providerOrderTicket.presentProviderOrderTicket,
    historyConversationId: () => displayed,
    shellWin: { isDestroyed: () => false },
    revealShell() {},
    shellForConversation: (id) => ({ send: (channel, payload) => sent.push({ id, channel, payload }) }),
  });
  vm.runInContext(policy + '\n' + line(/^const pendingOrderTickets = .*;\r?$/m)
    + '\n' + declaration('function emitProviderOrderDraft(')
    + '\n' + declaration('async function presentMockOrderTicket(')
    + '\n' + declaration('function trackPendingOrderTicket(')
    + '\n' + declaration('async function settlePendingOrderTicket(')
    + '\n' + declaration('function handlePersistentCanvasResult('), ctx);
  ctx.handlePersistentCanvasResult(confirmation);
  assert.match(context.terminalAnswerText, /실계좌 주문과 자동매매는 지원하지 않습니다/);
  // The turn waits for this before saving its answer.
  await ctx.settlePendingOrderTicket('conversation-1');
  return { context, terminal, sent };
}

test('provider order confirmation settles before the turn ends and opens a ticket only when orders are available', async () => {
  for (const [env, message] of [[REAL, /실계좌 주문과 자동매매는/], ['error', /실계좌 주문과 자동매매는/],
    [MOCK_OFF, /주문 API가 꺼져 있습니다/]]) {
    const { context, terminal, sent } = await providerConfirmation(env);
    assert.deepEqual(sent, []);
    assert.match(context.terminalAnswerText, message);
    assert.equal(terminal.get('conversation-1'), context.terminalAnswerText);
  }
  const moved = await providerConfirmation(MOCK_ON, { displayed: 'conversation-2' });
  assert.deepEqual(moved.sent, []);
  assert.match(moved.context.terminalAnswerText, /대화가 바뀌어 주문 티켓을 열지 않았습니다/);

  const { context, terminal, sent } = await providerConfirmation(MOCK_ON);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channel, 'athena:selector-order-draft');
  assert.equal(sent[0].payload.order_draft.stk_cd, '005930');
  assert.equal(sent[0].payload.backend_account_alias, 'acct-1');
  assert.equal(context.terminalAnswerText, confirmation.message);
  assert.equal(terminal.get('conversation-1'), confirmation.message);
  assert.match(source, /commitSuccess: async \(result\) => \{\r?\n\s+await settlePendingOrderTicket\(result\.conversationId\);/);
});

test('all provider prompts route mock orders to the ticket and never offer real or automated trading', () => {
  for (const provider of ['claude', 'codex', 'grok']) {
    const text = prompt.buildLiveSystemPrompt(provider);
    assert.match(text, /모의투자 계좌 주문을 지원한다/);
    assert.match(text, /실계좌 주문과 자동매매 배포는 개발 범위가 아니며/);
    assert.match(text, /athena_resolve\(intent=order\)/);
    assert.match(text, /지정가는 trde_tp "0"과 ord_uv/);
    assert.match(text, /자동매매\(배포·무장·조건 충족 시 자동 주문\)는 모의투자 계좌에서도 제공하지 않는다/);
    assert.match(text, /백테스트 안의 매수·매도 신호와 모의 체결/);
    assert.match(text, /지속 감시는 승인된 루틴으로만 존재/);
    assert.doesNotMatch(text, /자동 매매가.*된다고 답|한도 안에서 자동으로 주문합니다/);
    const backtest = prompt.buildBacktestModePrefix({}, '20260930');
    assert.match(backtest, /모의 체결·비용·손익 분석은 계속 지원/);
    assert.doesNotMatch(backtest, /navigate\(deploy\)|한도 안에서 자동으로 주문합니다/);
  }
});

function routeStockOrder(env, backendAlias = 'acct-1') {
  const startText = '  const orderDraft = selectorFastPath.buildMarketOrderDraft(';
  const endText = '  const selectorController =';
  const start = source.indexOf(startText), end = source.indexOf(endText, start);
  assert.ok(start >= 0 && end > start);
  const ctx = baseContext({
    fetch: environmentFetch(env),
    accounts: accountsWith(backendAlias),
    selectorFastPath: { buildMarketOrderDraft: () => ({ intent: 'order', arguments: { trde_tp: '0', ord_uv: '200000' } }) },
    routingQuery: '삼성전자 1주 지정가 200000원 매수', queryStockEntityIndex: {}, query: '주문 요청',
    holdingsRequest: null,
    turnConversationId: 'test', queryStartedAt: 0, performance: { now: () => 1 },
    persistLocalLiveResult: (_query, result) => result,
  });
  vm.runInContext(policy + '\nasync function invoke() {\n' + source.slice(start, end) + '\n}', ctx);
  return ctx.invoke();
}

test('recognized stock orders reach the ticket flow only when the active mock account can order', async () => {
  for (const [env, alias, message] of [[REAL, 'acct-1', /실계좌 주문과 자동매매는/],
    ['error', 'acct-1', /실계좌 주문과 자동매매는/], [MOCK_OFF, 'acct-1', /주문 API가 꺼져 있습니다/],
    [MOCK_ON, '', /계좌가 연결되지 않았거나/]]) {
    const result = await routeStockOrder(env, alias);
    assert.equal(result.code, 'TRADING_OUT_OF_SCOPE');
    assert.match(result.answerText, message);
    assert.equal(result.modelCalls, 0);
  }
  // An available mock account falls through to the guarded selector draft (no early answer).
  assert.equal(await routeStockOrder(MOCK_ON), undefined);
  assert.match(source, /intent: orderDraft \? orderDraft\.intent : 'auto'/);
  assert.match(source, /\.\.\.payload, backend_account_alias: orderAccountAlias,/);
  // An order draft that needs inference never turns into the holdings clarification flow.
  assert.match(source, /selectorResult\.preflight && !holdingsRequest && !orderDraft/);
});

test('gold order requests still end with scope guidance before a ticket or account call', () => {
  const start = source.indexOf('    runtime.pendingGoldOrder = null;');
  const end = source.indexOf('    const goldQuote =', start);
  assert.ok(start >= 0 && end > start);
  const ctx = vm.createContext({
    runtime: {}, goldOrderIntent: { resolveGoldOrderTurn: () => ({ handled: true }) },
    query: '금 1g 사줘', turnConversationId: 'test', queryStartedAt: 0, performance: { now: () => 1 },
    persistLocalLiveResult: (_query, result) => result,
  });
  vm.runInContext(policy + '\nfunction invoke() {\n' + source.slice(start, end) + '\n}', ctx);
  const result = ctx.invoke();
  assert.equal(result.code, 'TRADING_OUT_OF_SCOPE');
  assert.equal(result.modelCalls, 0);
});

test('the shell ticket is the only execution surface, bound to its account, and needs a user click', () => {
  assert.match(chatSource, /window\.athena\.on\('athena:selector-order-draft'/);
  assert.match(chatSource, /openOrderTicket\(\{ \.\.\.prefill, accountAlias \}\)/);
  assert.match(chatSource, /accountAlias: \(prefill && prefill\.accountAlias\) \|\| '',/);
  const executeCalls = chatSource.split("window.athena.invoke('athena:order-execute'").length - 1;
  assert.equal(executeCalls, 1);
  const handlerStart = chatSource.indexOf("execBtn.addEventListener('click', async () => {");
  assert.ok(handlerStart > 0);
  assert.ok(chatSource.indexOf("window.athena.invoke('athena:order-execute'") > handlerStart);
  // Fired alerts do not open an order ticket.
  assert.doesNotMatch(chatSource, /주문 티켓 열기/);
  // The Paper title stays; the restored status line names the mock account.
  const shell = fs.readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
  assert.match(shell, /<span id="orderTitle" class="settings-title">주문 티켓<\/span>/);
  assert.match(chatSource, /주문 API 활성 \(모의계좌\)/);
});

test('new one-time alerts use the real draft action and retain user constraints', () => {
  const text = prompt.buildLiveSystemPrompt('codex');
  assert.match(text, /새 알림·예약 생성 요청은 action=draft로 처리/);
  assert.match(text, /schedule\.once.*op:"at"/);
  assert.match(text, /시각·문구·조회 금지 등 제약을 그대로 유지/);
  assert.match(text, /adopt 제안은 비영속 제안일 뿐 알림 초안 생성이 아니다/);
  assert.match(text, /status="draft"를 확인하기 전에는 초안을 만들었다고 말하지 않는다/);
});

test('global quiet-hour proposals use the read-only guard tool across providers', () => {
  for (const provider of ['claude', 'codex', 'grok']) {
    const text = prompt.buildLiveSystemPrompt(provider);
    assert.match(text, /알림 방해 금지 시간·조용 시간·말걸기 횟수는 개별 루틴이 아니라 전역 말걸기 가드/);
    assert.match(text, /athena_nudge_guard action=get/);
    assert.match(text, /action=propose의\npropose\.quiet_hours=\{start:"HH:MM",end:"HH:MM"\}/);
    assert.match(text, /개별 알림의 시간·조건 변경은 기존 루틴 경로/);
    assert.match(text, /사용자가 \[확인\]을 누르기 전에는\n적용됐다고 말하지 마라/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import prompt from './live-prompt.js';

const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
function declaration(signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
const policy = source.match(/^const TRADING_OUT_OF_SCOPE_MESSAGE = .*;$/m)[0]
  + '\n' + declaration('function tradingOutOfScope(');

test('old order execution and enabling permissions return scope outcome without I/O', async () => {
  const ctx = vm.createContext({});
  vm.runInContext(policy + '\n' + declaration('async function executeOrderRequest(')
    + '\n' + declaration('async function handleOrderApiSet('), ctx);
  for (const operation of [
    () => ctx.executeOrderRequest({ trId: 'kt10000', body: { ord_qty: '1' } }),
    () => ctx.handleOrderApiSet(null, { id: 'old-account', enabled: true }),
  ]) {
    const result = await operation();
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.code, 'TRADING_OUT_OF_SCOPE');
  }
});

test('excluding trading still allows a saved order permission to be turned off', async () => {
  const calls = [];
  const ctx = vm.createContext({
    accounts: { orderApiSet: (id, enabled) => { calls.push({ id, enabled }); return { ok: true, orderApi: false }; } },
    syncSelectedAccount: async id => { calls.push({ sync: id }); return { ok: true }; },
  });
  vm.runInContext(policy + '\n' + declaration('async function handleOrderApiSet('), ctx);
  assert.equal((await ctx.handleOrderApiSet(null, { id: 'old-account', enabled: false })).ok, true);
  assert.deepEqual(calls, [{ id: 'old-account', enabled: false }, { sync: 'old-account' }]);
});

test('restored deployment actions stop before backend startup but ordinary backtest reads work', async () => {
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

test('old provider confirmation cannot reopen an order ticket', () => {
  const context = { conversationId: 'conversation-1' };
  const terminal = new Map();
  const ctx = vm.createContext({
    rememberLiveRealtimeFallbackAuthority() {},
    persistentTurnContexts: new Map([['turn-1', context]]),
    persistentTerminalAnswers: terminal,
  });
  vm.runInContext(policy + '\n' + declaration('function handlePersistentCanvasResult('), ctx);
  ctx.handlePersistentCanvasResult({ clientSubmitId: 'turn-1', status: 'needs_confirmation', message: 'old order message' });
  assert.match(context.terminalAnswerText, /증권사 주문과 자동매매는 제공하지 않습니다/);
  assert.equal(terminal.get('conversation-1'), context.terminalAnswerText);
  assert.doesNotMatch(source, /presentProviderOrderTicket\(|send\('athena:selector-order-draft'/);
});

test('all provider prompts retain analysis and simulated trades without offering live execution', () => {
  for (const provider of ['claude', 'codex', 'grok']) {
    const text = prompt.buildLiveSystemPrompt(provider);
    assert.match(text, /실매매·증권사 주문 실행·자동매매 배포는 개발 범위가 아니며/);
    assert.match(text, /백테스트 안의 매수·매도 신호와 모의 체결/);
    assert.match(text, /지속 감시는 승인된 루틴으로만 존재/);
    assert.doesNotMatch(text, /intent=order|자동 매매가.*된다고 답|앱이 주문 티켓을 연다/);
    const backtest = prompt.buildBacktestModePrefix({}, '20260930');
    assert.match(backtest, /모의 체결·비용·손익 분석은 계속 지원/);
    assert.doesNotMatch(backtest, /navigate\(deploy\)|한도 안에서 자동으로 주문합니다/);
  }
});

test('recognized stock and gold order requests end with scope guidance before a ticket or account call', () => {
  for (const [startText, endText, extras] of [
    ['    runtime.pendingGoldOrder = null;', '    const goldQuote =', {
      runtime: {}, goldOrderIntent: { resolveGoldOrderTurn: () => ({ handled: true }) },
    }],
    ['  if (selectorFastPath.buildMarketOrderDraft(routingQuery', '  const selectorController =', {
      selectorFastPath: { buildMarketOrderDraft: () => ({ intent: 'order' }) }, routingQuery: '삼성전자 1주 사줘', queryStockEntityIndex: {},
    }],
  ]) {
    const start = source.indexOf(startText), end = source.indexOf(endText, start);
    assert.ok(start >= 0 && end > start);
    const ctx = vm.createContext({ ...extras, query: '주문 요청', turnConversationId: 'test',
      queryStartedAt: 0, performance: { now: () => 1 }, persistLocalLiveResult: (_query, result) => result });
    vm.runInContext(policy + '\nfunction invoke() {\n' + source.slice(start, end) + '\n}', ctx);
    const result = ctx.invoke();
    assert.equal(result.code, 'TRADING_OUT_OF_SCOPE');
    assert.equal(result.modelCalls, 0);
  }
});

test('new one-time alerts use the real draft action and retain user constraints', () => {
  const text = prompt.buildLiveSystemPrompt('codex');
  assert.match(text, /새 알림·예약 생성 요청은 action=draft로 처리/);
  assert.match(text, /schedule\.once.*op:"at"/);
  assert.match(text, /시각·문구·조회 금지 등 제약을 그대로 유지/);
  assert.match(text, /adopt 제안은 비영속 제안일 뿐 알림 초안 생성이 아니다/);
  assert.match(text, /status="draft"를 확인하기 전에는 초안을 만들었다고 말하지 않는다/);
});

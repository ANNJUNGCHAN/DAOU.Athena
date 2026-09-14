import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const activeCardQna = require('./active-card-context.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');
const functionStart = mainSource.indexOf('async function runLiveQueryInnerBody(');
const functionEnd = mainSource.indexOf('\n// 한 대화의 진행 중 작업만 끊는다', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart,
  'production runLiveQueryInnerBody must remain executable in the regression harness');
const runLiveQueryInnerBodySource = mainSource.slice(functionStart, functionEnd);

function chartCard({ verifiedVisible = true } = {}) {
  return {
    cardId: 'chart-daou-new',
    kind: 'chart',
    createdAt: '2026-09-14T12:21:28.000Z',
    envelope: {
      canvas_type: 'chart',
      card_title: '다우기술 차트',
      data: {
        code: '023590',
        candles: [{ time: '2026-09-14', close: 40900, volume: 33291 }],
      },
    },
    verifiedVisible,
    isDataCanvas: true,
  };
}

function createHarness({
  query = '다우기술 차트 분석해줘',
  selectedCardId = 'chart-daou-old',
  paintVerified = true,
  supersedeOnPaint = false,
  providerResult = {
    ok: true,
    finalResult: { result: '카드 기준 현재가는 40,900원이며 거래량은 33,291주입니다.' },
  },
} = {}) {
  const conversationId = 'conversation-A';
  const assistantId = 'assistant-A';
  const submit = {
    clientSubmitId: 'submit-A',
    cardContext: { selectedCardId, selectionMode: 'implicit-active-card' },
  };
  const events = [];
  const assistantHistory = [];
  const providerPrompts = [];
  const finishedAssistants = [];
  const liveSubmitContexts = new Map([[conversationId, submit]]);
  const runtime = {
    activeSelectorFastRun: null,
    activeStockMasterLookup: null,
    activeLiveQuery: null,
    goldOrderContextInitialized: true,
    pendingGoldOrder: null,
    pendingGoldQuote: null,
    liveSessionId: null,
    liveSessionOwnerKey: null,
  };
  const oldCard = {
    cardId: selectedCardId,
    kind: 'chart',
    createdAt: '2026-09-14T12:20:29.000Z',
    envelope: { canvas_type: 'chart', data: { code: '023590', candles: [{ close: 40800 }] } },
  };
  const displayed = chartCard({ verifiedVisible: paintVerified });
  const bridge = {
    flush: () => events.push('flush-card-report'),
    load: () => ({ canvasCards: [oldCard] }),
    finishAssistant: (entry) => finishedAssistants.push(entry),
    recordToolStep() {},
    journalDelta() {},
  };

  class ReplayTurnCapture {
    observe() {}
    buildJudgment() { return null; }
  }

  const context = vm.createContext({
    AbortController,
    Buffer,
    Date,
    Error,
    Map,
    Math,
    Object,
    Promise,
    Set,
    String,
    URL,
    activeCardQna,
    activeRestAccountId: () => 'local-account',
    accountBoundDataset: {
      createAccountBoundInvoker: async ({ run }) => ({
        ok: true,
        accountId: 'local-account',
        run: (options) => run(options),
      }),
    },
    accounts: { resolveBackendAlias: async () => ({ ok: true, backendAlias: 'server-account' }) },
    activeAgentProject: () => null,
    backendAccountAuthorization: () => 'Bearer test-only',
    BACKEND_HTTP_BASE: 'http://backend.test',
    briefingRunner: { killInProgressBriefing() {} },
    buildLivePrompt: ({ userText }) => userText,
    buildLiveTurnPrompt: ({ userText, activeCardContext }) => {
      providerPrompts.push({ userText, activeCardContext });
      return userText;
    },
    canonicalHash: () => 'owner-key',
    chartFollowupTracker: { answer: () => null, invalidateForQuery() {} },
    cliAccounts: { peekActiveAccount: () => ({ accountId: 'provider-account' }) },
    conversations: { setResumeCursor() {} },
    createSubagentTracker: () => () => {},
    createToolStepTracker: () => () => {},
    crypto: { randomUUID: () => 'fixture-uuid' },
    currentProviderSelection: { activeAccount: { accountId: 'provider-account' }, disabled: null },
    emitHistorySaveFailed() {},
    emitProviderOrderDraft() {},
    emitRestCanvasForOrigin: async (payload) => {
      events.push('paint-ack');
      assert.equal(payload.envelope, displayed.envelope);
      if (supersedeOnPaint) liveSubmitContexts.set(conversationId, { clientSubmitId: 'submit-B' });
      return { verifiedVisible: paintVerified };
    },
    fastPath: { runCachedReplay: async () => ({ ok: false }) },
    fetch: async () => { throw new Error('unexpected network fetch'); },
    getLiveMcpConfig: () => ({ dir: 'C:\\fixture', configFile: 'C:\\fixture\\mcp.json' }),
    getSessionBridge: () => bridge,
    goldOrderIntent: { resolveGoldOrderTurn: () => ({ handled: false }) },
    goldQuoteIntent: { resolveGoldQuoteTurn: () => ({ handled: false }) },
    historyConversationId: () => conversationId,
    historySink: {
      saveChatMessage: (entry) => {
        if (entry.role === 'assistant') assistantHistory.push(entry);
        return { failed: false };
      },
    },
    liveGrokSecurityKey: () => null,
    liveProviderWarmOptions: () => ({}),
    liveQueryCache: { get: () => null, set() {}, invalidate() {} },
    liveResumeCursor: () => null,
    liveRuntimes: { get: () => runtime },
    liveSubmitContexts,
    mdlog() {},
    noteLiveQueryProvider() {},
    onCanvasResult() {},
    performance: { now: (() => { let now = 0; return () => ++now; })() },
    persistentChatEnabled: () => true,
    persistentTerminalAnswers: { delete() {} },
    persistentTurnContexts: { set() {}, deleteIfSame() {} },
    presentProviderOrderTicket() {},
    process: { env: {} },
    providerRuntimeEnabled: false,
    query,
    ReplayTurnCapture,
    resolveActiveModelSelection: () => ({ model: null, effort: null }),
    resolveLiveQueryProviderId: () => 'codex',
    resolveTerminalAnswerText: (primary, secondary) => primary ?? secondary ?? null,
    restDatasetRunner: {
      StockEntityIndex: class {},
      buildDomesticMarketSnapshotDataset: () => null,
      buildCompoundScreenDataset: () => null,
      buildQuoteDataset: () => null,
      buildChartDataset: () => null,
      buildOrderBookDataset: () => null,
      buildInvestorFlowDataset: () => null,
      buildTradingSourceDataset: () => null,
      buildStockInfoDataset: () => null,
      buildProgramTradeDataset: () => null,
    },
    runClaudeQuery: async () => providerResult,
    runGrokQuery: async () => providerResult,
    runLiveProviderChatTurn: async (_provider, _conversation, options) => {
      events.push('provider');
      assert.equal(_conversation, conversationId);
      assert.equal(options.prompt, query);
      return providerResult;
    },
    selectorClaudePool: { run: async () => { throw new Error('unexpected cold classifier'); } },
    selectorColdHedge: { runSelectorColdHedge: async () => ({ handled: false }) },
    selectorFastPath: {
      DEFAULT_DEADLINE_MS: 2700,
      DEFAULT_GUARDED_ORDER_DEADLINE_MS: 10_000,
      buildMarketOrderDraft: () => null,
      runSelectorFastPath: async (options) => {
        events.push('lookup');
        await options.emitCanvas({
          envelope: displayed.envelope,
          canvasType: 'chart',
          paintDeadlineAt: 10_000,
        });
        return {
          handled: true,
          ok: true,
          source: 'selector-fast',
          answerText: '조회 결과를 카드로 표시했습니다.',
          canvasTypes: ['chart'],
          canvasCaptions: ['다우기술 차트'],
          durationMs: 1,
        };
      },
    },
    sendLiveCanvasResult() {},
    sendLiveTextDelta() {},
    sendLiveToolStep() {},
    shellForConversation: () => ({ send() {} }),
    shellWin: null,
    simpleChartFastPath: { runSimpleChartFastPath: async () => ({ handled: false }) },
    stockMasterAbortController: { signal: new AbortController().signal },
    stockMasterClient: {
      resolveCurrentStockMasterQuery: async () => ({ ready: true, instrument: { code: '023590' } }),
      createQueryScopedIndex: () => ({}),
    },
    todayYyyymmdd: () => '20260914',
  });
  vm.runInContext(`${runLiveQueryInnerBodySource}\nthis.runLiveQueryInnerBody = runLiveQueryInnerBody;`, context);

  return {
    assistantHistory,
    assistantId,
    bridge,
    context,
    conversationId,
    events,
    finishedAssistants,
    liveSubmitContexts,
    providerPrompts,
    run: () => context.runLiveQueryInnerBody(query, false, 'shell', conversationId, assistantId),
    submit,
  };
}

test('combined chart analysis paints the fresh card before provider synthesis with one assistant final', async () => {
  const harness = createHarness();

  const result = await harness.run();

  assert.deepEqual(harness.events, ['flush-card-report', 'lookup', 'paint-ack', 'provider']);
  assert.equal(harness.providerPrompts.length, 1);
  assert.equal(harness.providerPrompts[0].activeCardContext.cards[0].cardId, 'selector:1');
  assert.equal(harness.providerPrompts[0].activeCardContext.cards[0].envelope.data.candles[0].close, 40900);
  assert.equal(harness.finishedAssistants.length, 1);
  assert.equal(harness.finishedAssistants[0].messageId, harness.assistantId);
  assert.deepEqual(harness.assistantHistory.map(({ role, text }) => ({ role, text })), [{
    role: 'assistant',
    text: '카드 기준 현재가는 40,900원이며 거래량은 33,291주입니다.',
  }]);
  assert.equal(result.answerText, '카드 기준 현재가는 40,900원이며 거래량은 33,291주입니다.');
  assert.deepEqual(Array.from(result.canvasTypes), ['chart']);
  assert.deepEqual(Array.from(result.canvasCaptions), ['다우기술 차트']);
});

test('deictic existing-card analysis bypasses lookup and sends the selected card directly to provider', async () => {
  const harness = createHarness({ query: '이 차트 분석해줘' });

  const result = await harness.run();

  assert.deepEqual(harness.events, ['flush-card-report', 'provider']);
  assert.equal(harness.providerPrompts.length, 1);
  assert.equal(harness.providerPrompts[0].activeCardContext.selectionStatus, 'valid');
  assert.equal(harness.providerPrompts[0].activeCardContext.selection.value.data.candles[0].close, 40800);
  assert.equal(harness.assistantHistory.length, 1);
  assert.equal(result.ok, true);
});

test('provider failure after an accepted paint retains card metadata without persisting a fake receipt', async () => {
  const harness = createHarness({ providerResult: { ok: false, error: 'provider unavailable' } });

  const result = await harness.run();

  assert.deepEqual(harness.events, ['flush-card-report', 'lookup', 'paint-ack', 'provider']);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'provider unavailable');
  assert.equal(result.answerText, null);
  assert.deepEqual(Array.from(result.canvasTypes), ['chart']);
  assert.deepEqual(Array.from(result.canvasCaptions), ['다우기술 차트']);
  assert.equal(harness.assistantHistory.length, 0);
});

test('non-visible paint does not start provider continuation and persists one bounded card receipt', async () => {
  const harness = createHarness({ paintVerified: false });

  const result = await harness.run();

  assert.deepEqual(harness.events, ['flush-card-report', 'lookup', 'paint-ack']);
  assert.equal(harness.providerPrompts.length, 0);
  assert.equal(harness.finishedAssistants.length, 0);
  assert.deepEqual(harness.assistantHistory.map(({ role, text }) => ({ role, text })), [{
    role: 'assistant',
    text: '조회 결과를 카드로 표시했습니다.',
  }]);
  assert.equal(result.answerText, '조회 결과를 카드로 표시했습니다.');
});

test('superseding submit after paint prevents stale provider work and assistant persistence', async () => {
  const harness = createHarness({ supersedeOnPaint: true });

  const result = await harness.run();

  assert.deepEqual(harness.events, ['flush-card-report', 'lookup', 'paint-ack']);
  assert.equal(result.ok, false);
  assert.equal(result.answerText, null);
  assert.deepEqual(Array.from(result.canvasTypes), ['chart']);
  assert.equal(harness.providerPrompts.length, 0);
  assert.equal(harness.finishedAssistants.length, 0);
  assert.equal(harness.assistantHistory.length, 0);
});

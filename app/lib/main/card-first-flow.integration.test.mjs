import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const cardContext = require('./active-card-context.js');
const { buildActiveCardContext, finishDisplayedCardResult } = cardContext;
const here = path.dirname(fileURLToPath(import.meta.url));

function runMainCardRoutingDecision({ query, submit, activeCardContext }) {
  const source = fs.readFileSync(path.join(here, '..', '..', 'main.js'), 'utf8');
  const start = source.indexOf('  const cardFirstLookupRequired = ');
  const end = source.indexOf('  const finishCardProducingResult = ', start);
  assert.ok(start >= 0 && end > start, 'main card-first routing decision must remain executable');
  const activeCardQna = cardContext;
  const continuation = null;
  const providerAnswerRequired = true;
  const modePromptRequired = false;
  return Function(
    'activeCardQna', 'query', 'submit', 'activeCardContext', 'continuation',
    'providerAnswerRequired', 'modePromptRequired',
    `${source.slice(start, end)}\nreturn { cardFirstLookupRequired, cardRetrievalBlocked };`,
  )(activeCardQna, query, submit, activeCardContext, continuation,
    providerAnswerRequired, modePromptRequired);
}

function displayedChart(overrides = {}) {
  return {
    envelope: {
      canvas_type: 'chart',
      data: {
        code: '023590',
        candles: [{ close: 40900 }, { close: 40950 }],
      },
    },
    verifiedVisible: true,
    isDataCanvas: true,
    ...overrides,
  };
}

function initialCardResult(overrides = {}) {
  return {
    ok: true,
    datasetId: 'quote-023590',
    answerText: '조회 결과를 카드로 표시했습니다.',
    canvasTypes: ['chart'],
    canvasCaptions: ['다우기술 차트'],
    ...overrides,
  };
}

test('does not start the provider before a data card has a verified paint receipt', async () => {
  let providerCalls = 0;
  let receiptCalls = 0;

  const result = await finishDisplayedCardResult({
    result: initialCardResult(),
    cards: [displayedChart({ verifiedVisible: false })],
    runProvider: async () => { providerCalls += 1; },
    persistReceipt: async () => { receiptCalls += 1; },
  });

  assert.equal(providerCalls, 0);
  assert.equal(receiptCalls, 1);
  assert.equal(result.answerText, '조회 결과를 카드로 표시했습니다.');
});

test('continues with the same assistant identity and the accepted card envelope', async () => {
  const submitIdentity = { id: 'submit-A' };
  const providerRequests = [];
  let receiptCalls = 0;

  const result = await finishDisplayedCardResult({
    result: initialCardResult(),
    cards: [displayedChart()],
    requested: { selectedCardId: 'old-card', selectionMode: 'implicit-active-card' },
    now: '2026-09-14T12:34:56.000Z',
    isCurrent: () => true,
    providerRequest: {
      query: '다우기술 차트 분석해줘',
      turnConversationId: 'conversation-A',
      sessionAssistantId: 'assistant-A',
      submitIdentity,
    },
    runProvider: async (request) => {
      providerRequests.push(request);
      return {
        ok: true,
        source: 'live',
        answerText: '최근 종가는 40,950원입니다.',
        canvasTypes: request.initialResult.canvasTypes,
      };
    },
    persistReceipt: async () => { receiptCalls += 1; },
  });

  assert.equal(providerRequests.length, 1);
  assert.equal(providerRequests[0].sessionAssistantId, 'assistant-A');
  assert.equal(providerRequests[0].submitIdentity, submitIdentity);
  assert.equal(providerRequests[0].initialResult.answerText, '조회 결과를 카드로 표시했습니다.');
  assert.equal(providerRequests[0].activeCardContext.cards.length, 1);
  assert.equal(providerRequests[0].activeCardContext.cards[0].cardId, 'quote-023590:1');
  assert.equal(providerRequests[0].activeCardContext.cards[0].capturedAt, '2026-09-14T12:34:56.000Z');
  assert.equal(providerRequests[0].activeCardContext.cards[0].envelope.data.candles[1].close, 40950);
  assert.equal(receiptCalls, 0);
  assert.equal(result.answerText, '최근 종가는 40,950원입니다.');
});

test('keeps the displayed card metadata when the provider fails', async () => {
  let providerCalls = 0;
  let receiptCalls = 0;

  const result = await finishDisplayedCardResult({
    result: initialCardResult(),
    cards: [displayedChart()],
    isCurrent: () => true,
    runProvider: async () => {
      providerCalls += 1;
      return { ok: false, source: 'live', error: 'provider unavailable', answerText: null };
    },
    persistReceipt: async () => { receiptCalls += 1; },
  });

  assert.equal(providerCalls, 1);
  assert.equal(receiptCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'provider unavailable');
  assert.deepEqual(result.canvasTypes, ['chart']);
  assert.deepEqual(result.canvasCaptions, ['다우기술 차트']);
});

test('lets a newer turn continue while refusing the superseded turn', async () => {
  const providerTurns = [];
  const runProvider = async (request) => {
    providerTurns.push(request.sessionAssistantId);
    return {
      ok: true,
      answerText: `answer:${request.sessionAssistantId}`,
      canvasTypes: request.initialResult.canvasTypes,
    };
  };

  const older = await finishDisplayedCardResult({
    result: initialCardResult(),
    cards: [displayedChart()],
    isCurrent: () => false,
    providerRequest: { sessionAssistantId: 'assistant-A' },
    runProvider,
  });
  const newer = await finishDisplayedCardResult({
    result: initialCardResult(),
    cards: [displayedChart()],
    isCurrent: () => true,
    providerRequest: { sessionAssistantId: 'assistant-B' },
    runProvider,
  });

  assert.equal(older.ok, false);
  assert.equal(older.answerText, null);
  assert.equal(newer.answerText, 'answer:assistant-B');
  assert.deepEqual(providerTurns, ['assistant-B']);
});

test('uses a new lookup card instead of an older implicit selection', async () => {
  let context;

  await finishDisplayedCardResult({
    result: initialCardResult({ datasetId: 'new-lookup' }),
    cards: [displayedChart({
      cardId: 'new-card',
      envelope: { canvas_type: 'chart', data: { code: '005930', currentPrice: 78000 } },
    })],
    requested: { selectedCardId: 'old-card', selectionMode: 'implicit-active-card' },
    isCurrent: () => true,
    runProvider: async (request) => {
      context = request.activeCardContext;
      return { ok: true, answerText: '새 조회 설명', canvasTypes: ['chart'] };
    },
  });

  assert.equal(context.status, 'available');
  assert.equal(context.selectionStatus, 'none');
  assert.equal(context.cards.length, 1);
  assert.equal(context.cards[0].cardId, 'new-card');
  assert.equal(context.cards[0].envelope.data.code, '005930');
});

test('actual main routing paints a combined chart-analysis lookup before the same-turn provider', async () => {
  const requested = { selectedCardId: 'old-card', selectionMode: 'implicit-active-card' };
  const oldContext = buildActiveCardContext({
    cards: [displayedChart({ cardId: 'old-card' })],
    requested,
  });
  const route = runMainCardRoutingDecision({
    query: '다우기술 차트 분석해줘', submit: { cardContext: requested }, activeCardContext: oldContext,
  });
  assert.deepEqual(route, { cardFirstLookupRequired: true, cardRetrievalBlocked: false });

  const events = [];
  let result;
  if (!route.cardRetrievalBlocked) {
    events.push('lookup');
    events.push('paint');
    result = await finishDisplayedCardResult({
      result: initialCardResult(),
      cards: [displayedChart({ cardId: 'new-card' })],
      requested,
      isCurrent: () => true,
      runProvider: async () => {
        events.push('provider');
        return { ok: true, answerText: '새 차트 근거 설명', canvasTypes: ['chart'] };
      },
      persistReceipt: async () => events.push('receipt'),
    });
  }

  assert.deepEqual(events, ['lookup', 'paint', 'provider']);
  assert.equal(result.answerText, '새 차트 근거 설명');
});

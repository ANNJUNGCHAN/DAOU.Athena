import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_ACTION_IDS,
  CONVERSATION_ROUTER_ID,
  CONVERSATION_UNSUPPORTED_MESSAGE,
  CONTROL_CATALOG_VERSION,
  FINANCIAL_API_VERSION,
  FINANCIAL_CARD_VERSION,
  FINANCIAL_ERROR_CODES,
  FINANCIAL_ERROR_MESSAGES,
  FINANCIAL_MAX_PAGE_BYTES,
  FINANCIAL_METHODS,
  FINANCIAL_PROFILE,
  FINANCIAL_RENDER_KINDS,
  HOST_NAME,
  LEGACY_CONTROL_CATALOG_VERSION,
  MARKET_MENU_PROFILE,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  ProtocolValidationError,
  PROVIDER_ERROR_CODES,
  PROVIDER_ERROR_MESSAGES,
  PROVIDER_METHODS,
  RUNTIME_HELLO_PROVIDER_METADATA,
  SOURCE_API_VERSION,
  SOURCE_CARD_NOTICE,
  SOURCE_PROFILE,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from '../wts-foundation.mjs';

const schemaUrl = new URL('../wts-foundation.protocol.schema.json', import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, 'utf8'));
const validator = createProtocolValidator(schema);
const providerIds = Object.freeze({
  operation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  cancellation: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  submission: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
});

const observation = Object.freeze({
  id: 'c485344b-936a-4a5e-a001-182d310c987e',
  capturedAt: '2026-10-18T09:30:00.000+09:00',
  source: {
    origin: 'https://wts.kiwoom.com',
    path: '/trade/chart',
    tabId: 11,
    windowId: 3,
    frameId: 0,
    documentId: 'doc-20261018-1',
  },
  title: '키움증권 WTS',
  headings: ['차트'],
  controls: [
    {
      ref: 'control-1',
      tag: 'button',
      role: 'button',
      name: '일봉',
      type: 'button',
      disabled: false,
      visible: true,
    },
  ],
  frames: [
    {
      origin: 'https://wts.kiwoom.com',
      path: '/trade/chart',
    },
  ],
  canvasCount: 1,
  truncated: false,
});

const capture = Object.freeze({
  id: 'dd8d1eef-4eb9-4b0c-b83c-16f145768705',
  capturedAt: observation.capturedAt,
  observations: [observation],
});

function request(method, params) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261018-0001',
    method,
    params,
  };
}

function success(method, result) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261019-0001',
    method,
    ok: true,
    result,
  };
}

function providerSnapshot(overrides = {}) {
  return {
    operationId: providerIds.operation,
    kind: 'connect',
    state: 'running',
    revision: 1,
    cancellable: true,
    result: null,
    error: null,
    ...overrides,
  };
}

function providerStatus(overrides = {}) {
  return {
    provider: 'openai-chatgpt-siwc-v1',
    connection: 'signed-out',
    accountResetAvailable: true,
    catalog: 'unavailable',
    selectedModel: null,
    operation: null,
    ...overrides,
  };
}

function expectInvalid(action, issuePattern) {
  assert.throws(action, (error) => {
    assert.ok(error instanceof ProtocolValidationError);
    assert.equal(error.code, 'INVALID_PROTOCOL_MESSAGE');
    assert.equal(error.message, 'WTS protocol message is invalid');
    assert.ok(error.issues.length > 0);
    if (issuePattern) {
      assert.match(error.issues.join('\n'), issuePattern);
    }
    return true;
  });
}

test('exports protocol 8 financial and provider identities while preserving control identities', () => {
  assert.equal(PROTOCOL_VERSION, 8);
  assert.equal(HOST_NAME, 'com.athena.wts');
  assert.equal(MAX_MESSAGE_BYTES, 131072);
  assert.equal(PROVIDER_METHODS.length, 9);
  assert.equal(CONTROL_CATALOG_VERSION, 'wts-main-control-3');
  assert.equal(LEGACY_CONTROL_CATALOG_VERSION, 'wts-chart-pilot-1');
  assert.equal(PREVIOUS_CONTROL_CATALOG_VERSION, 'wts-chart-pilot-2');
  assert.equal(CHART_OPEN_ACTION_ID, 'wts.main.p3.chart.open');
  assert.equal(CHART_PERIOD_SET_ACTION_ID, 'wts.main.p3.chart.period.set');
  assert.equal(SITEMAP_OPEN_ACTION_ID, 'wts.main.sitemap.open');
  assert.equal(MARKET_NAVIGATE_ACTION_ID, 'wts.main.p1.market.navigate');
  assert.deepEqual(CONTROL_ACTION_IDS, [
    CHART_OPEN_ACTION_ID,
    CHART_PERIOD_SET_ACTION_ID,
    SITEMAP_OPEN_ACTION_ID,
    MARKET_NAVIGATE_ACTION_ID,
  ]);
  assert.deepEqual(MARKET_MENU_PROFILE, {
    id: 'market-menu-navigation-20261019', targetCount: 25,
  });
  assert.equal(MARKET_MENU_TARGETS.length, 25);
  assert.ok(MARKET_MENU_TARGETS.every(Object.isFrozen));
  assert.ok(MARKET_MENU_TARGETS.every((target) => Object.isFrozen(target.assertion)));
  assert.equal(SOURCE_PROFILE, 'wts-readonly-v1');
  assert.equal(SOURCE_API_VERSION, 'selector-readonly-v1');
  assert.equal(SOURCE_CARD_NOTICE, '기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.');
  assert.equal(FINANCIAL_PROFILE, 'wts-financial-read-v1');
  assert.equal(FINANCIAL_API_VERSION, 'selector-financial-read-v1');
  assert.equal(FINANCIAL_CARD_VERSION, 'wts-financial-card-1');
  assert.equal(FINANCIAL_MAX_PAGE_BYTES, 98304);
  assert.deepEqual(FINANCIAL_RENDER_KINDS, ['facts', 'table', 'compound', 'chart']);
  assert.deepEqual(FINANCIAL_METHODS, [
    'source.credentials.status',
    'source.credentials.configure',
    'source.credentials.delete',
    'source.query.start',
    'source.query.status',
    'source.query.page',
    'source.query.continue',
    'source.query.cancel',
  ]);
  assert.ok(FINANCIAL_ERROR_CODES.includes('QUERY_JOB_NOT_FOUND'));
  assert.ok(Object.isFrozen(FINANCIAL_ERROR_MESSAGES));
  assert.deepEqual(Object.keys(FINANCIAL_ERROR_MESSAGES), FINANCIAL_ERROR_CODES);
  assert.equal(CONVERSATION_ROUTER_ID, 'deterministic-wts-conversation-v1');
  assert.equal(
    CONVERSATION_UNSUPPORTED_MESSAGE,
    '지금은 차트 명령, “시장 메뉴 열어줘: 그룹 > 메뉴”, “조회 기능 찾아줘: 검색어”만 지원합니다.',
  );
});

test('accepts the nine exact provider requests and enforces provider-only input bounds', () => {
  const requests = [
    request('provider.status', {}),
    request('provider.connect.start', {}),
    request('provider.models.start', {}),
    request('provider.model.select', { slug: 'gpt-test.1' }),
    request('provider.plan.start', {
      submissionId: providerIds.submission,
      text: '😀'.repeat(512),
    }),
    request('provider.operation.get', {
      operationId: providerIds.operation,
      consume: false,
    }),
    request('provider.operation.cancel', {
      operationId: providerIds.operation,
      expectedRevision: 1,
      cancellationId: providerIds.cancellation,
    }),
    request('provider.disconnect.start', {}),
    request('provider.account.reset.start', {}),
  ];
  assert.deepEqual(
    requests.map((value) => validator.validateRequest(value).method),
    PROVIDER_METHODS,
  );

  for (const invalid of [
    request('provider.operation.get', {
      operationId: providerIds.operation.toUpperCase(), consume: false,
    }),
    request('provider.operation.cancel', {
      operationId: providerIds.operation, expectedRevision: 1, cancellationId: 'c1',
    }),
    request('provider.plan.start', {
      submissionId: providerIds.submission.toUpperCase(), text: '차트 열어줘',
    }),
    request('provider.plan.start', {
      submissionId: providerIds.submission, text: 'x'.repeat(513),
    }),
    request('provider.plan.start', {
      submissionId: providerIds.submission, text: '\ud800',
    }),
    request('provider.model.select', { slug: 'bad/slug' }),
  ]) {
    expectInvalid(() => validator.validateRequest(invalid), /provider|canonical|Unicode|allowed shape/iu);
  }
});

test('validates exact provider operation lifecycles, typed results, and fixed errors', () => {
  const runningByMethod = [
    ['provider.connect.start', providerSnapshot()],
    ['provider.models.start', providerSnapshot({ kind: 'models' })],
    ['provider.plan.start', providerSnapshot({ kind: 'plan' })],
    ['provider.disconnect.start', providerSnapshot({ kind: 'disconnect', cancellable: false })],
    ['provider.account.reset.start', providerSnapshot({
      kind: 'account-reset', cancellable: false,
    })],
  ];
  for (const [method, snapshot] of runningByMethod) {
    assert.equal(validator.validateResponse(success(method, snapshot)).ok, true);
  }
  assert.equal(validator.validateResponse(success('provider.operation.cancel', providerSnapshot({
    kind: 'plan', state: 'cancelling', revision: 2,
  }))).ok, true);
  assert.equal(validator.validateResponse(success('provider.operation.cancel', providerSnapshot({
    kind: 'plan', state: 'cancelled', revision: 3, cancellable: false,
    error: {
      code: 'PROVIDER_PLAN_CANCELLED',
      message: PROVIDER_ERROR_MESSAGES.PROVIDER_PLAN_CANCELLED,
    },
  }))).ok, true);

  const terminal = [
    providerSnapshot({
      state: 'succeeded', revision: 2, cancellable: false,
      result: { connection: 'connected' },
    }),
    providerSnapshot({
      kind: 'models', state: 'succeeded', revision: 2, cancellable: false,
      result: { models: [
        { slug: 'gpt-test.1', displayName: 'GPT Test' },
        { slug: 'gpt-test-한글-invalid', displayName: '모델' },
      ].slice(0, 1) },
    }),
    providerSnapshot({
      kind: 'plan', state: 'succeeded', revision: 2, cancellable: false,
      result: {
        submissionId: providerIds.submission,
        catalogVersion: CONTROL_CATALOG_VERSION,
        assistantText: '실행 전 제안입니다.',
        proposal: { kind: 'wts-control', text: '주봉으로' },
      },
    }),
    providerSnapshot({
      kind: 'disconnect', state: 'succeeded', revision: 2, cancellable: false,
      result: { connection: 'signed-out', revocation: 'unconfirmed' },
    }),
    providerSnapshot({
      kind: 'account-reset', state: 'succeeded', revision: 2, cancellable: false,
      result: { connection: 'signed-out', registration: 'already-empty' },
    }),
    providerSnapshot({
      kind: 'plan', state: 'failed', revision: 2, cancellable: false,
      error: {
        code: 'PROVIDER_PLAN_INPUT_SENSITIVE',
        message: PROVIDER_ERROR_MESSAGES.PROVIDER_PLAN_INPUT_SENSITIVE,
      },
    }),
    providerSnapshot({
      kind: 'models', state: 'cancelled', revision: 3, cancellable: false,
      error: {
        code: 'PROVIDER_MODELS_CANCELLED',
        message: PROVIDER_ERROR_MESSAGES.PROVIDER_MODELS_CANCELLED,
      },
    }),
  ];
  for (const snapshot of terminal) {
    assert.equal(
      validator.validateResponse(success('provider.operation.get', snapshot)).ok,
      true,
    );
  }

  const adversarial = [
    providerSnapshot({ operationId: providerIds.operation.toUpperCase() }),
    providerSnapshot({ result: { connection: 'connected' } }),
    providerSnapshot({ kind: 'disconnect', cancellable: true }),
    providerSnapshot({ state: 'cancelling', revision: 1 }),
    providerSnapshot({
      state: 'succeeded', revision: 2, cancellable: true, result: null, error: null,
    }),
    providerSnapshot({
      kind: 'models', state: 'succeeded', revision: 2, cancellable: false,
      result: { connection: 'connected' },
    }),
    providerSnapshot({
      kind: 'models', state: 'succeeded', revision: 2, cancellable: false,
      result: { models: [
        { slug: 'duplicate', displayName: 'First' },
        { slug: 'duplicate', displayName: 'Second' },
      ] },
    }),
    providerSnapshot({
      kind: 'models', state: 'succeeded', revision: 2, cancellable: false,
      result: { models: Array.from({ length: 101 }, (_, index) => ({
        slug: `model-${index}`, displayName: `Model ${index}`,
      })) },
    }),
    providerSnapshot({
      kind: 'plan', state: 'succeeded', revision: 2, cancellable: false,
      result: {
        submissionId: providerIds.submission,
        catalogVersion: CONTROL_CATALOG_VERSION,
        assistantText: '제안',
        proposal: { kind: 'wts-control', text: '매수해줘' },
      },
    }),
    providerSnapshot({
      kind: 'connect', state: 'failed', revision: 2, cancellable: false,
      error: {
        code: 'PROVIDER_PLAN_FAILED',
        message: PROVIDER_ERROR_MESSAGES.PROVIDER_PLAN_FAILED,
      },
    }),
  ];
  for (const snapshot of adversarial) {
    expectInvalid(
      () => validator.validateResponse(success('provider.operation.get', snapshot)),
      /provider|operation|result|catalog|lifecycle|allowed shape|duplicated|too many/iu,
    );
  }
  expectInvalid(() => validator.validateResponse(success('provider.connect.start', terminal[0])),
    /must be running/);
  expectInvalid(() => validator.validateResponse(success('provider.operation.cancel',
    providerSnapshot())), /cancelling or cancelled/);
});

test('connect diagnostics require a fixed message and a failed connect operation', () => {
  const codes = [
    'PROVIDER_CONNECT_EXCHANGE_FAILED',
    'PROVIDER_CONNECT_EXCHANGE_TIMEOUT',
    'PROVIDER_CONNECT_TOKEN_REJECTED',
    'PROVIDER_CONNECT_TOKEN_RESPONSE_INVALID',
    'PROVIDER_CONNECT_IDENTITY_INVALID',
    'PROVIDER_CONNECT_ACCOUNT_MISMATCH',
    'PROVIDER_CONNECT_REGISTRATION_FAILED',
    'PROVIDER_CONNECT_SESSION_FAILED',
    'PROVIDER_CONNECT_TIMEOUT',
  ];
  for (const code of codes) {
    const snapshot = providerSnapshot({
      state: 'failed', revision: 2, cancellable: false,
      error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
    });
    assert.equal(validator.validateResponse(success('provider.operation.get', snapshot)).ok, true);
    for (const invalid of [
      { ...snapshot, kind: 'models' },
      { ...snapshot, kind: 'plan' },
      { ...snapshot, kind: 'disconnect' },
      { ...snapshot, kind: 'account-reset' },
      { ...snapshot, state: 'cancelled', revision: 3 },
      { ...snapshot, error: { code, message: PROVIDER_ERROR_MESSAGES.PROVIDER_CONNECT_FAILED } },
      { ...snapshot, error: { code, message: 'upstream secret response' } },
    ]) {
      expectInvalid(() => validator.validateResponse(success('provider.operation.get', invalid)),
        /approved provider code and constant message/);
    }
    expectInvalid(() => validator.validateResponse({
      protocolVersion: PROTOCOL_VERSION, requestId: 'req-connect-diagnostic',
      method: 'provider.status', ok: false, error: snapshot.error,
    }), /approved provider code and constant message/);
  }
  assert.deepEqual(
    schema.$defs.providerOperationSnapshot.properties.error.anyOf[1].properties.code.enum,
    PROVIDER_ERROR_CODES.slice(10),
  );
  assert.deepEqual(PROVIDER_ERROR_CODES.slice(0, 10), [
    'PROVIDER_BUSY', 'PROVIDER_PREVIOUS_RESULT_PENDING', 'PROVIDER_STATE_INVALID',
    'PROVIDER_MODEL_CATALOG_REQUIRED', 'PROVIDER_MODEL_NOT_SELECTED', 'PROVIDER_MODEL_INVALID',
    'PROVIDER_OPERATION_NOT_FOUND', 'PROVIDER_OPERATION_NOT_TERMINAL',
    'PROVIDER_OPERATION_CONFLICT', 'PROVIDER_OPERATION_NOT_CANCELLABLE',
  ]);
});

test('model diagnostics require exact messages and failed models operations', () => {
  const codes = [
    'PROVIDER_MODELS_AUTH_REQUIRED', 'PROVIDER_MODELS_ACCESS_DENIED',
    'PROVIDER_MODELS_RATE_LIMITED', 'PROVIDER_MODELS_SERVICE_UNAVAILABLE',
    'PROVIDER_MODELS_HTTP_FAILED', 'PROVIDER_MODELS_TIMEOUT', 'PROVIDER_MODELS_NETWORK_FAILED',
    'PROVIDER_MODELS_SESSION_UNAVAILABLE', 'PROVIDER_MODELS_RESPONSE_TOO_LARGE',
    'PROVIDER_MODELS_RESPONSE_FORMAT_INVALID', 'PROVIDER_MODELS_RESPONSE_READ_FAILED',
    'PROVIDER_MODELS_RESPONSE_SCHEMA_INVALID', 'PROVIDER_MODELS_MODEL_METADATA_INVALID',
    'PROVIDER_MODELS_REDIRECT_REJECTED', 'PROVIDER_MODELS_COUNT_EXCEEDED',
  ];
  for (const code of codes) {
    const snapshot = providerSnapshot({
      kind: 'models', state: 'failed', revision: 2, cancellable: false,
      error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
    });
    assert.equal(validator.validateResponse(success('provider.operation.get', snapshot)).ok, true);
    for (const invalid of [
      ...['connect', 'plan', 'disconnect', 'account-reset'].map((kind) => ({ ...snapshot, kind })),
      { ...snapshot, state: 'cancelled', revision: 3 },
      { ...snapshot, error: { code, message: PROVIDER_ERROR_MESSAGES.PROVIDER_MODELS_FAILED } },
      { ...snapshot, error: { code, message: 'private-upstream-response' } },
    ]) {
      expectInvalid(() => validator.validateResponse(success('provider.operation.get', invalid)),
        /approved provider code and constant message/);
    }
    expectInvalid(() => validator.validateResponse({
      protocolVersion: PROTOCOL_VERSION, requestId: 'req-model-diagnostic',
      method: 'provider.status', ok: false, error: snapshot.error,
    }), /approved provider code and constant message/);
  }
});

test('validates provider status state ownership and exact provider error pairs', () => {
  assert.equal(validator.validateResponse(success(
    'provider.status', providerStatus(),
  )).ok, true);
  assert.equal(validator.validateResponse(success('provider.model.select', providerStatus({
    connection: 'connected',
    accountResetAvailable: false,
    catalog: 'ready',
    selectedModel: {
      slug: 'gpt-test.1', displayName: 'GPT Test', compatibility: 'untested',
    },
  }))).ok, true);
  assert.equal(validator.validateResponse(success('provider.status', providerStatus({
    connection: 'connecting',
    accountResetAvailable: false,
    operation: {
      operationId: providerIds.operation,
      kind: 'connect', state: 'running', revision: 1, cancellable: true,
    },
  }))).ok, true);

  for (const status of [
    providerStatus({ provider: 'other-provider' }),
    providerStatus({
      selectedModel: {
        slug: 'gpt-test.1', displayName: 'GPT Test', compatibility: 'untested',
      },
    }),
    providerStatus({ connection: 'connecting', accountResetAvailable: false }),
    providerStatus({
      connection: 'connected', accountResetAvailable: false, catalog: 'loading',
      operation: {
        operationId: providerIds.operation,
        kind: 'plan', state: 'running', revision: 1, cancellable: true,
      },
    }),
    providerStatus({
      connection: 'resetting', accountResetAvailable: true,
      operation: {
        operationId: providerIds.operation,
        kind: 'account-reset', state: 'running', revision: 1, cancellable: false,
      },
    }),
  ]) {
    expectInvalid(
      () => validator.validateResponse(success('provider.status', status)),
      /provider|selected|connection|operation|catalog|accountResetAvailable|allowed shape/iu,
    );
  }

  for (const code of PROVIDER_ERROR_CODES.slice(0, 10)) {
    assert.equal(validator.validateResponse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-provider-error',
      method: 'provider.status',
      ok: false,
      error: { code, message: PROVIDER_ERROR_MESSAGES[code] },
    }).ok, false);
  }
  expectInvalid(() => validator.validateResponse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-provider-error',
    method: 'provider.status',
    ok: false,
    error: { code: 'PROVIDER_BUSY', message: 'raw upstream failure' },
  }), /constant message/);
  expectInvalid(() => validator.validateResponse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-provider-terminal-error',
    method: 'provider.status',
    ok: false,
    error: {
      code: 'PROVIDER_CONNECT_FAILED',
      message: PROVIDER_ERROR_MESSAGES.PROVIDER_CONNECT_FAILED,
    },
  }), /approved provider code/);
  expectInvalid(() => validator.validateResponse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-provider-error',
    method: 'provider.status',
    ok: false,
    error: {
      code: 'PROVIDER_BUSY',
      message: PROVIDER_ERROR_MESSAGES.PROVIDER_BUSY,
      details: { secret: true },
    },
  }), /allowed shape/);
});

const controlObservation = Object.freeze({
  id: '11efbb4a-f12a-4ea7-a4d0-18f252a57866',
  capturedAt: '2026-10-18T09:30:00.000+09:00',
  source: {
    origin: 'https://wts.kiwoom.com',
    path: '/',
    tabId: 11,
    windowId: 3,
    frameId: 0,
    documentId: 'document-chart-1',
  },
  state: {
    screenId: 'main-other',
    activeTab: 'quote',
    period: 'none',
    blocked: false,
    chartOpenEnabled: true,
    periodEnabled: false,
    instrumentToken: 'f'.repeat(64),
    contextToken: 'a'.repeat(64),
  },
});

const openProposal = Object.freeze({
  id: '22efbb4a-f12a-4ea7-a4d0-18f252a57866',
  catalogVersion: CONTROL_CATALOG_VERSION,
  observation: controlObservation,
  actionId: CHART_OPEN_ACTION_ID,
  args: {},
  expiresAt: '2026-10-18T09:30:05.000+09:00',
});

const openReceipt = Object.freeze({
  id: '33efbb4a-f12a-4ea7-a4d0-18f252a57866',
  proposalId: openProposal.id,
  catalogVersion: CONTROL_CATALOG_VERSION,
  actionId: CHART_OPEN_ACTION_ID,
  args: {},
  before: controlObservation,
  after: null,
  status: 'cancelled',
  reason: 'CANCELLED',
  completedAt: '2026-10-18T09:30:02.000+09:00',
});

const legacyControlObservation = Object.freeze(structuredClone(controlObservation));
const legacyOpenProposal = Object.freeze({
  ...openProposal,
  id: '24efbb4a-f12a-4ea7-a4d0-18f252a57866',
  catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
  observation: legacyControlObservation,
});
const legacyOpenReceipt = Object.freeze({
  ...openReceipt,
  id: '34efbb4a-f12a-4ea7-a4d0-18f252a57866',
  proposalId: legacyOpenProposal.id,
  catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
  before: legacyControlObservation,
});

const marketObservation = Object.freeze({
  id: '91efbb4a-f12a-4ea7-a4d0-18f252a57866',
  capturedAt: '2026-10-18T09:30:00.000+09:00',
  source: structuredClone(controlObservation.source),
  state: {
    stateKind: 'market-navigation',
    screenId: 'main-market-navigation',
    targetId: 'market-menu-001',
    blocked: false,
    sitemapVisible: false,
    sitemapOpenEnabled: true,
    targetAvailable: false,
    activeTargetId: null,
    instrumentToken: 'f'.repeat(64),
    contextToken: 'c'.repeat(64),
  },
});

function marketProposal(actionId, observation = marketObservation) {
  return {
    id: actionId === SITEMAP_OPEN_ACTION_ID
      ? '92efbb4a-f12a-4ea7-a4d0-18f252a57866'
      : '93efbb4a-f12a-4ea7-a4d0-18f252a57866',
    catalogVersion: CONTROL_CATALOG_VERSION,
    observation: structuredClone(observation),
    actionId,
    args: { targetId: 'market-menu-001' },
    expiresAt: '2026-10-18T09:30:05.000+09:00',
  };
}

function verifiedMarketReceipt(actionId) {
  const proposal = marketProposal(actionId);
  const after = structuredClone(marketObservation);
  after.id = actionId === SITEMAP_OPEN_ACTION_ID
    ? '94efbb4a-f12a-4ea7-a4d0-18f252a57866'
    : '95efbb4a-f12a-4ea7-a4d0-18f252a57866';
  after.capturedAt = '2026-10-18T09:30:01.000+09:00';
  after.state.contextToken = 'd'.repeat(64);
  if (actionId === SITEMAP_OPEN_ACTION_ID) {
    after.state.sitemapVisible = true;
    after.state.targetAvailable = true;
  } else {
    after.state.sitemapOpenEnabled = true;
    after.state.activeTargetId = 'market-menu-001';
  }
  return {
    id: actionId === SITEMAP_OPEN_ACTION_ID
      ? '96efbb4a-f12a-4ea7-a4d0-18f252a57866'
      : '97efbb4a-f12a-4ea7-a4d0-18f252a57866',
    proposalId: proposal.id,
    catalogVersion: CONTROL_CATALOG_VERSION,
    actionId,
    args: proposal.args,
    before: proposal.observation,
    after,
    status: 'verified',
    reason: 'POSTCONDITION_MET',
    completedAt: '2026-10-18T09:30:02.000+09:00',
  };
}

test('fixed market catalog exactly matches the 25 authoritative navigation rows', async () => {
  const evidence = JSON.parse(await readFile(
    new URL('../../backend/ref/wts/market-menu-navigation-20261019.json', import.meta.url),
    'utf8',
  ));
  const expected = evidence.checks.map((check) => ({
    id: check.id,
    sitemapGroup: check.sitemapGroup,
    buttonLabel: check.buttonLabel,
    assertion: check.assertionType === 'p1-top-active'
      ? { kind: 'top-active', topActive: check.expected.topActive }
      : { kind: 'group-child', group: check.expected.group, child: check.expected.child },
  }));
  assert.deepEqual(MARKET_MENU_TARGETS, expected);
  assert.equal(new Set(MARKET_MENU_TARGETS.map((target) => target.id)).size, 25);
});

test('validates exact market actions, target binding, and verified postconditions', () => {
  assert.equal(validator.validateControlObservation(marketObservation).state.targetId, 'market-menu-001');
  for (const actionId of [SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID]) {
    assert.equal(validator.validateControlProposal(marketProposal(actionId)).actionId, actionId);
    assert.equal(validator.validateControlReceipt(verifiedMarketReceipt(actionId)).actionId, actionId);
  }

  for (const mutate of [
    (proposal) => { proposal.args.targetId = 'market-menu-999'; },
    (proposal) => { proposal.args.label = '급등락'; },
    (proposal) => { proposal.observation.state.targetId = 'market-menu-002'; },
    (proposal) => { proposal.catalogVersion = PREVIOUS_CONTROL_CATALOG_VERSION; },
  ]) {
    const proposal = marketProposal(SITEMAP_OPEN_ACTION_ID);
    mutate(proposal);
    expectInvalid(() => validator.validateControlProposal(proposal));
  }

  const badOpen = verifiedMarketReceipt(SITEMAP_OPEN_ACTION_ID);
  badOpen.after.state.targetAvailable = false;
  expectInvalid(() => validator.validateControlReceipt(badOpen), /visible and available/);
  const badNavigate = verifiedMarketReceipt(MARKET_NAVIGATE_ACTION_ID);
  badNavigate.after.state.activeTargetId = 'market-menu-002';
  expectInvalid(() => validator.validateControlReceipt(badNavigate), /requested market target/);
  const wrongTargetCancelled = verifiedMarketReceipt(SITEMAP_OPEN_ACTION_ID);
  wrongTargetCancelled.status = 'cancelled';
  wrongTargetCancelled.reason = 'CANCELLED';
  wrongTargetCancelled.after = null;
  wrongTargetCancelled.before.state.targetId = 'market-menu-002';
  expectInvalid(
    () => validator.validateControlReceipt(wrongTargetCancelled),
    /must match the market action target/,
  );
  const chartWithMarketState = marketProposal(SITEMAP_OPEN_ACTION_ID);
  chartWithMarketState.actionId = CHART_OPEN_ACTION_ID;
  chartWithMarketState.args = {};
  expectInvalid(
    () => validator.validateControlProposal(chartWithMarketState),
    /must use chart state/,
  );
});

test('accepts a task-next ready outcome after exactly one satisfied step', () => {
  const task = {
    schemaVersion: 1,
    id: '98efbb4a-f12a-4ea7-a4d0-18f252a57866',
    submissionId: '99efbb4a-f12a-4ea7-a4d0-18f252a57866',
    revision: 2,
    createdAt: '2026-10-18T09:30:00.000+09:00',
    updatedAt: '2026-10-18T09:30:01.000+09:00',
    catalogVersion: CONTROL_CATALOG_VERSION,
    compiler: {
      kind: 'deterministic', id: 'deterministic-korean-wts-v3', version: '3',
      generative: false, bundleHash: null,
    },
    status: 'ready',
    input: { text: '시장 메뉴 열어줘: 시세분석 > 급등락' },
    cursor: 1,
    steps: [
      {
        id: '90efbb4a-f12a-4ea7-a4d0-18f252a57866', index: 0,
        actionId: SITEMAP_OPEN_ACTION_ID, args: { targetId: 'market-menu-001' },
        status: 'satisfied', proposalId: null, receiptId: null,
      },
      {
        id: '89efbb4a-f12a-4ea7-a4d0-18f252a57866', index: 1,
        actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId: 'market-menu-001' },
        status: 'pending', proposalId: null, receiptId: null,
      },
    ],
    activeProposal: null,
    cancelRequested: false,
    message: '다음 작업을 실행하려면 화면을 다시 확인합니다.',
  };
  const response = success('control.task.next', {
    task,
    outcome: { status: 'ready', message: task.message, proposal: null },
  });
  assert.equal(validator.validateResponse(response).result.task.cursor, 1);
});

test('accepts every pre-v7 request method under protocol 7', () => {
  assert.equal(
    validator.validateRequest(request('runtime.hello', {})).method,
    'runtime.hello',
  );
  assert.equal(
    validator.validateRequest(request('inventory.record', { capture })).method,
    'inventory.record',
  );
  assert.equal(
    validator.validateRequest(request('inventory.summary', {})).method,
    'inventory.summary',
  );
  assert.equal(
    validator.validateRequest(request('control.plan', {
      command: '차트 열어줘',
      observation: controlObservation,
    })).method,
    'control.plan',
  );
  assert.equal(
    validator.validateRequest(request('control.receipt.record', { receipt: openReceipt })).method,
    'control.receipt.record',
  );
  assert.equal(
    validator.validateRequest(request('control.task.start', {
      submissionId: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
      text: '차트 열고 주봉으로',
    })).method,
    'control.task.start',
  );
  assert.equal(
    validator.validateRequest(request('control.task.next', {
      taskId: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
      expectedRevision: 1,
      observation: controlObservation,
    })).method,
    'control.task.next',
  );
  assert.equal(
    validator.validateRequest(request('control.task.get', {
      taskId: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
    })).method,
    'control.task.get',
  );
  assert.equal(
    validator.validateRequest(request('control.task.step.commit', {
      taskId: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
      stepId: '55efbb4a-f12a-4ea7-a4d0-18f252a57866',
      expectedRevision: 2,
      receipt: openReceipt,
    })).method,
    'control.task.step.commit',
  );
  assert.equal(
    validator.validateRequest(request('control.task.cancel', {
      taskId: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
      expectedRevision: 2,
      cancellationId: '66efbb4a-f12a-4ea7-a4d0-18f252a57866',
    })).method,
    'control.task.cancel',
  );
  assert.equal(validator.validateRequest(request('backend.status', {})).method, 'backend.status');
  assert.equal(validator.validateRequest(request('backend.ensure', {})).method, 'backend.ensure');
  assert.equal(validator.validateRequest(request('source.manifest', {})).method, 'source.manifest');
  assert.equal(validator.validateRequest(request('source.search', {
    query: '주식 시세',
    limit: 5,
    expectedCatalogVersion: `sha256:${'a'.repeat(64)}`,
  })).method, 'source.search');
  assert.equal(validator.validateRequest(request('source.describe', {
    operationRef: 'detail:stock:basic_info',
    expectedCatalogVersion: `sha256:${'a'.repeat(64)}`,
  })).method, 'source.describe');
  assert.equal(validator.validateRequest(request('conversation.route', {
    submissionId: '77efbb4a-f12a-4ea7-a4d0-18f252a57866',
    text: '조회 기능 찾아줘: 종목 조회',
  })).method, 'conversation.route');
});

test('validates strict conversation route requests and results', () => {
  const submissionId = '77efbb4a-f12a-4ea7-a4d0-18f252a57866';
  const control = { submissionId, kind: 'wts-control', text: '차트 열고 주봉으로' };
  const source = { submissionId, kind: 'source-search', query: '종목 조회' };
  const unsupported = {
    submissionId,
    kind: 'unsupported',
    message: CONVERSATION_UNSUPPORTED_MESSAGE,
  };

  assert.deepEqual(validator.validateConversationRoute(control), control);
  assert.deepEqual(validator.validateConversationRoute(source), source);
  assert.deepEqual(validator.validateConversationRoute(unsupported), unsupported);
  assert.deepEqual(
    validator.validateResponse(success('conversation.route', source)).result,
    source,
  );

  for (const params of [
    { submissionId, text: ' 차트 열어줘' },
    { submissionId, text: '차트 열어줘 ' },
    { submissionId, text: 'x'.repeat(513) },
    { submissionId, text: '차트 열어줘', selector: '#secret' },
    { submissionId: 'not-a-uuid', text: '차트 열어줘' },
  ]) {
    expectInvalid(
      () => validator.validateRequest(request('conversation.route', params)),
      /must match exactly one allowed shape/,
    );
  }

  for (const result of [
    { ...control, text: ' 차트 열어줘' },
    { ...source, query: 'x' },
    { ...unsupported, message: '다른 안내' },
    { ...source, selector: '#secret' },
  ]) {
    expectInvalid(() => validator.validateConversationRoute(result), /must match exactly one allowed shape/);
  }
});

const sourceCatalogVersion = `sha256:${'a'.repeat(64)}`;

const capabilityList = Object.freeze({
  schemaVersion: 1,
  kind: 'capability-list',
  canvasId: '77efbb4a-f12a-4ea7-a4d0-18f252a57866',
  title: '조회 기능 찾기',
  catalogVersion: sourceCatalogVersion,
  fetchedAt: '2026-10-19T01:02:03.123456789Z',
  notice: SOURCE_CARD_NOTICE,
  query: '주식 시세',
  items: [{
    operationRef: 'detail:stock:basic_info',
    kind: 'query',
    domain: 'stock',
    name: '  주식 기본정보  ',
    groupTitle: null,
  }],
});

const capabilityDetail = Object.freeze({
  schemaVersion: 1,
  kind: 'capability-detail',
  canvasId: '88efbb4a-f12a-4ea7-a4d0-18f252a57866',
  title: '주식 기본정보',
  catalogVersion: sourceCatalogVersion,
  fetchedAt: '2026-10-19T01:02:03.000Z',
  notice: SOURCE_CARD_NOTICE,
  operationRef: 'detail:stock:basic_info',
  domain: 'stock',
  name: '주식 기본정보',
  executionPolicy: 'selector_detail_required',
  requiredArguments: [{
    alias: 'stk_cd',
    description: '  종목 코드  ',
    required: true,
    jsonSchema: { type: 'string' },
  }],
  optionalArguments: [{
    alias: 'tm_tp',
    description: null,
    required: false,
    jsonSchema: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      default: null,
    },
  }],
  responseFields: [{ alias: 'cur_prc', description: null, required: false }],
  execution: { available: false, reason: 'FINANCIAL_QUERY_NOT_CONNECTED' },
});

test('rejects invalid or extra source transport input before dispatch', () => {
  const cases = [
    request('backend.status', { timeout: 1 }),
    request('backend.ensure', { url: 'http://127.0.0.1' }),
    request('source.manifest', { path: '/manifest' }),
    request('source.search', {
      query: ' 주식 시세 ', limit: 5, expectedCatalogVersion: sourceCatalogVersion,
    }),
    request('source.search', {
      query: '주식 시세', limit: 6, expectedCatalogVersion: sourceCatalogVersion,
    }),
    request('source.search', {
      query: '주식 시세', limit: 5, expectedCatalogVersion: sourceCatalogVersion, headers: {},
    }),
    request('source.describe', {
      operationRef: 'detail:Stock:basic-info', expectedCatalogVersion: sourceCatalogVersion,
    }),
    request('source.describe', {
      operationRef: 'detail:stock:basic_info', expectedCatalogVersion: sourceCatalogVersion, intent: 'execute',
    }),
  ];
  for (const value of cases) {
    expectInvalid(() => validator.validateRequest(value), /must match exactly one allowed shape/);
  }
});

test('validates strict backend status, ensure, and source manifest results', () => {
  const unconfigured = {
    configured: false,
    state: 'unconfigured',
    profile: SOURCE_PROFILE,
    apiVersion: null,
    catalogVersion: null,
    ownedChild: false,
  };
  assert.equal(validator.validateBackendStatus(unconfigured).state, 'unconfigured');
  assert.equal(validator.validateResponse(success('backend.status', unconfigured)).ok, true);

  const inconsistent = { ...unconfigured, ownedChild: true };
  expectInvalid(
    () => validator.validateResponse(success('backend.status', inconsistent)),
    /must match exactly one allowed shape/,
  );

  const ready = {
    configured: true,
    state: 'ready',
    profile: SOURCE_PROFILE,
    apiVersion: SOURCE_API_VERSION,
    catalogVersion: sourceCatalogVersion,
    ownedChild: true,
  };
  assert.equal(validator.validateResponse(success('backend.ensure', ready)).result.state, 'ready');
  expectInvalid(
    () => validator.validateResponse(success('backend.ensure', { ...ready, state: 'starting' })),
    /must match exactly one allowed shape/,
  );

  const manifest = {
    profile: SOURCE_PROFILE,
    apiVersion: SOURCE_API_VERSION,
    catalogVersion: sourceCatalogVersion,
    operationCount: 123,
  };
  assert.equal(validator.validateSourceManifest(manifest).operationCount, 123);
  assert.equal(validator.validateResponse(success('source.manifest', manifest)).ok, true);
  expectInvalid(
    () => validator.validateSourceManifest({ ...manifest, operationCount: 0 }),
    /below the allowed minimum/,
  );
});

test('validates exact flat source cards while preserving raw non-query text', () => {
  const list = validator.validateSourceCard(capabilityList);
  assert.equal(list.items[0].name, '  주식 기본정보  ');
  assert.equal(validator.validateResponse(success('source.search', capabilityList)).result, capabilityList);
  const detail = validator.validateSourceCard(capabilityDetail);
  assert.equal(detail.requiredArguments[0].description, '  종목 코드  ');
  assert.deepEqual(detail.requiredArguments[0].jsonSchema, { type: 'string' });
  assert.deepEqual(detail.optionalArguments[0].jsonSchema, {
    anyOf: [{ type: 'string' }, { type: 'null' }],
    default: null,
  });
  assert.equal(validator.validateResponse(success('source.describe', capabilityDetail)).result, capabilityDetail);

  expectInvalid(
    () => validator.validateResponse(success('source.search', capabilityDetail)),
    /must match exactly one allowed shape/,
  );
  expectInvalid(
    () => validator.validateSourceCard({ canvasKind: 'capability-list.v1', data: {} }),
    /must match exactly one allowed shape/,
  );
  expectInvalid(
    () => validator.validateSourceCard({ ...capabilityList, raw: {} }),
    /must match exactly one allowed shape/,
  );
});

test('rejects sparse, calendar-invalid, non-UTC, and incomplete source cards', () => {
  const sparse = structuredClone(capabilityList);
  sparse.items = new Array(1);
  expectInvalid(() => validator.validateSourceCard(sparse), /must match exactly one allowed shape/);

  expectInvalid(
    () => validator.validateSourceCard({ ...capabilityList, fetchedAt: '2026-02-30T01:02:03Z' }),
    /real canonical UTC timestamp/,
  );
  expectInvalid(
    () => validator.validateSourceCard({ ...capabilityList, fetchedAt: '2026-10-19T10:02:03\+09:00' }),
    /must match exactly one allowed shape/,
  );

  const stringField = structuredClone(capabilityDetail);
  stringField.requiredArguments = ['stk_cd'];
  expectInvalid(() => validator.validateSourceCard(stringField), /must match exactly one allowed shape/);

  const argumentCases = [
    (card) => { delete card.requiredArguments[0].jsonSchema; },
    (card) => {
      card.requiredArguments[0].json_schema = card.requiredArguments[0].jsonSchema;
      delete card.requiredArguments[0].jsonSchema;
    },
    (card) => { card.requiredArguments[0].jsonSchema = { type: 'integer' }; },
    (card) => { card.requiredArguments[0].jsonSchema = { type: 'string', maxLength: 4 }; },
    (card) => {
      card.optionalArguments[0].jsonSchema =
        { anyOf: [{ type: 'null' }, { type: 'string' }], default: null };
    },
    (card) => {
      card.optionalArguments[0].jsonSchema =
        { anyOf: [{ type: 'string' }, { type: 'string' }], default: null };
    },
    (card) => {
      card.optionalArguments[0].jsonSchema = {
        anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'string' }],
        default: null,
      };
    },
    (card) => {
      card.optionalArguments[0].jsonSchema =
        { anyOf: [{ type: 'string' }, { type: 'null' }] };
    },
    (card) => { card.requiredArguments[0].required = false; },
    (card) => { card.optionalArguments[0].required = true; },
  ];
  for (const mutate of argumentCases) {
    const invalid = structuredClone(capabilityDetail);
    mutate(invalid);
    expectInvalid(
      () => validator.validateSourceCard(invalid),
      /must match exactly one allowed shape|requiredArguments entries|optionalArguments entries/,
    );
  }
  const responseSchemaLeak = structuredClone(capabilityDetail);
  responseSchemaLeak.responseFields[0].jsonSchema = { type: 'string' };
  expectInvalid(
    () => validator.validateSourceCard(responseSchemaLeak),
    /must match exactly one allowed shape/,
  );

  const clippedCatalog = { ...capabilityList, catalogVersion: `sha256:${'A'.repeat(64)}` };
  expectInvalid(() => validator.validateSourceCard(clippedCatalog), /must match exactly one allowed shape/);

  const urlItem = structuredClone(capabilityList);
  urlItem.items[0].operationRef = 'https://example.invalid/operation';
  expectInvalid(() => validator.validateSourceCard(urlItem), /must match exactly one allowed shape/);

  const longItem = structuredClone(capabilityList);
  longItem.items[0].operationRef = `base:${'a'.repeat(124)}`;
  assert.equal(longItem.items[0].operationRef.length, 129);
  expectInvalid(() => validator.validateSourceCard(longItem), /must match exactly one allowed shape/);

  const urlDetail = { ...capabilityDetail, operationRef: 'https://example.invalid/operation' };
  expectInvalid(() => validator.validateSourceCard(urlDetail), /must match exactly one allowed shape/);

  const longDetail = { ...capabilityDetail, operationRef: `detail:a:${'b'.repeat(120)}` };
  assert.equal(longDetail.operationRef.length, 129);
  expectInvalid(() => validator.validateSourceCard(longDetail), /must match exactly one allowed shape/);
});

test('validates strict control observations, proposals, and receipts', () => {
  assert.equal(validator.validateControlObservation(controlObservation).source.frameId, 0);
  assert.equal(validator.validateControlProposal(openProposal).actionId, CHART_OPEN_ACTION_ID);
  assert.equal(validator.validateControlReceipt(openReceipt).reason, 'CANCELLED');

  const wrongPath = structuredClone(controlObservation);
  wrongPath.source.path = '/chart';
  expectInvalid(() => validator.validateControlObservation(wrongPath), /source\.path has an unsupported value/);

  const secret = structuredClone(controlObservation);
  secret.stockLabel = '삼성전자';
  expectInvalid(() => validator.validateControlObservation(secret), /stockLabel is not allowed/);

  const arbitraryAction = structuredClone(openProposal);
  arbitraryAction.actionId = 'screen.click';
  expectInvalid(() => validator.validateControlProposal(arbitraryAction), /must match exactly one allowed shape/);

  const commandLeak = structuredClone(openReceipt);
  commandLeak.command = '차트 열어줘';
  expectInvalid(() => validator.validateControlReceipt(commandLeak), /must match exactly one allowed shape/);

  const verified = structuredClone(openReceipt);
  verified.status = 'verified';
  verified.reason = 'POSTCONDITION_MET';
  verified.after = structuredClone(controlObservation);
  verified.after.id = '44efbb4a-f12a-4ea7-a4d0-18f252a57866';
  verified.after.capturedAt = '2026-10-18T09:30:01.000+09:00';
  verified.after.state.screenId = 'main-chart';
  verified.after.state.activeTab = 'chart';
  verified.after.state.period = 'day';
  verified.after.state.contextToken = 'b'.repeat(64);
  assert.equal(validator.validateControlReceipt(verified).status, 'verified');

  const changedInstrument = structuredClone(verified);
  changedInstrument.after.state.instrumentToken = 'e'.repeat(64);
  expectInvalid(
    () => validator.validateControlReceipt(changedInstrument),
    /instrumentToken must match the verified precondition/,
  );

  const changedDocument = structuredClone(verified);
  changedDocument.after.source.documentId = 'document-chart-2';
  expectInvalid(
    () => validator.validateControlReceipt(changedDocument),
    /documentId must match the verified precondition/,
  );
});

test('accepts complete frozen legacy and current four-period record families', () => {
  assert.equal(validator.validateControlProposal(legacyOpenProposal).catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(validator.validateControlReceipt(legacyOpenReceipt).catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);

  const legacyWeekBefore = structuredClone(legacyControlObservation);
  legacyWeekBefore.id = '61efbb4a-f12a-4ea7-a4d0-18f252a57866';
  legacyWeekBefore.state.screenId = 'main-chart';
  legacyWeekBefore.state.activeTab = 'chart';
  legacyWeekBefore.state.period = 'day';
  legacyWeekBefore.state.chartOpenEnabled = false;
  legacyWeekBefore.state.periodEnabled = true;
  const legacyWeekAfter = structuredClone(legacyWeekBefore);
  legacyWeekAfter.id = '62efbb4a-f12a-4ea7-a4d0-18f252a57866';
  legacyWeekAfter.capturedAt = '2026-10-18T09:30:01.000+09:00';
  legacyWeekAfter.state.period = 'week';
  legacyWeekAfter.state.contextToken = 'b'.repeat(64);
  const legacyWeekProposal = {
    id: '63efbb4a-f12a-4ea7-a4d0-18f252a57866',
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    observation: legacyWeekBefore,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: 'week' },
    expiresAt: '2026-10-18T09:30:05.000+09:00',
  };
  const legacyWeekReceipt = {
    id: '64efbb4a-f12a-4ea7-a4d0-18f252a57866',
    proposalId: legacyWeekProposal.id,
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: 'week' },
    before: legacyWeekBefore,
    after: legacyWeekAfter,
    status: 'verified',
    reason: 'POSTCONDITION_MET',
    completedAt: '2026-10-18T09:30:02.000+09:00',
  };
  assert.equal(validator.validateControlProposal(legacyWeekProposal).args.period, 'week');
  assert.equal(validator.validateControlReceipt(legacyWeekReceipt).after.state.period, 'week');

  const monthBefore = structuredClone(controlObservation);
  monthBefore.id = '71efbb4a-f12a-4ea7-a4d0-18f252a57866';
  monthBefore.state.screenId = 'main-chart';
  monthBefore.state.activeTab = 'chart';
  monthBefore.state.period = 'week';
  monthBefore.state.chartOpenEnabled = false;
  monthBefore.state.periodEnabled = true;
  const monthAfter = structuredClone(monthBefore);
  monthAfter.id = '72efbb4a-f12a-4ea7-a4d0-18f252a57866';
  monthAfter.capturedAt = '2026-10-18T09:30:01.000+09:00';
  monthAfter.state.period = 'month';
  monthAfter.state.contextToken = 'b'.repeat(64);
  const monthProposal = {
    id: '73efbb4a-f12a-4ea7-a4d0-18f252a57866',
    catalogVersion: CONTROL_CATALOG_VERSION,
    observation: monthBefore,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: 'month' },
    expiresAt: '2026-10-18T09:30:05.000+09:00',
  };
  const monthReceipt = {
    id: '74efbb4a-f12a-4ea7-a4d0-18f252a57866',
    proposalId: monthProposal.id,
    catalogVersion: CONTROL_CATALOG_VERSION,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: 'month' },
    before: monthBefore,
    after: monthAfter,
    status: 'verified',
    reason: 'POSTCONDITION_MET',
    completedAt: '2026-10-18T09:30:02.000+09:00',
  };
  assert.equal(validator.validateControlObservation(monthAfter).state.period, 'month');
  assert.equal(validator.validateControlProposal(monthProposal).args.period, 'month');
  assert.equal(validator.validateControlReceipt(monthReceipt).after.state.period, 'month');

  const currentTask = {
    schemaVersion: 1,
    id: '75efbb4a-f12a-4ea7-a4d0-18f252a57866',
    submissionId: '76efbb4a-f12a-4ea7-a4d0-18f252a57866',
    revision: 2,
    createdAt: '2026-10-18T09:30:00.000+09:00',
    updatedAt: '2026-10-18T09:30:01.000+09:00',
    catalogVersion: CONTROL_CATALOG_VERSION,
    compiler: {
      kind: 'deterministic', id: 'deterministic-korean-wts-v3', version: '3',
      generative: false, bundleHash: null,
    },
    status: 'awaiting_receipt',
    input: { text: '월봉으로' },
    cursor: 0,
    steps: [{
      id: '77efbb4a-f12a-4ea7-a4d0-18f252a57866', index: 0,
      actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'month' },
      status: 'awaiting_receipt', proposalId: monthProposal.id, receiptId: null,
    }],
    activeProposal: monthProposal,
    cancelRequested: false,
    message: '월봉 전환을 제안했습니다.',
  };
  assert.equal(validator.validateControlTask(currentTask).compiler.version, '3');

  const previousTask = structuredClone(currentTask);
  previousTask.id = '72efbb4a-f12a-4ea7-a4d0-18f252a57866';
  previousTask.submissionId = '71efbb4a-f12a-4ea7-a4d0-18f252a57866';
  previousTask.catalogVersion = PREVIOUS_CONTROL_CATALOG_VERSION;
  previousTask.compiler.id = 'deterministic-korean-chart-v2';
  previousTask.compiler.version = '2';
  previousTask.activeProposal.catalogVersion = PREVIOUS_CONTROL_CATALOG_VERSION;
  previousTask.activeProposal.observation = structuredClone(monthBefore);
  previousTask.steps[0].proposalId = previousTask.activeProposal.id;
  assert.equal(validator.validateControlTask(previousTask).compiler.version, '2');

  const legacyTask = structuredClone(currentTask);
  legacyTask.id = '78efbb4a-f12a-4ea7-a4d0-18f252a57866';
  legacyTask.submissionId = '79efbb4a-f12a-4ea7-a4d0-18f252a57866';
  legacyTask.catalogVersion = LEGACY_CONTROL_CATALOG_VERSION;
  legacyTask.compiler.id = 'deterministic-korean-chart-v1';
  legacyTask.compiler.version = '1';
  legacyTask.input.text = '주봉으로';
  legacyTask.steps[0].args = { period: 'week' };
  legacyTask.steps[0].proposalId = legacyWeekProposal.id;
  legacyTask.activeProposal = legacyWeekProposal;
  assert.equal(validator.validateControlTask(legacyTask).compiler.version, '1');

  const yearProposal = structuredClone(monthProposal);
  yearProposal.id = '80efbb4a-f12a-4ea7-a4d0-18f252a57866';
  yearProposal.args.period = 'year';
  assert.equal(validator.validateControlProposal(yearProposal).args.period, 'year');
  const yearReceipt = structuredClone(monthReceipt);
  yearReceipt.id = '85efbb4a-f12a-4ea7-a4d0-18f252a57866';
  yearReceipt.proposalId = yearProposal.id;
  yearReceipt.args.period = 'year';
  yearReceipt.after.state.period = 'year';
  assert.equal(validator.validateControlReceipt(yearReceipt).after.state.period, 'year');
});

test('rejects mixed legacy/current catalog, compiler, observation, and proposal identities', () => {
  const legacyMonthProposal = {
    id: '81efbb4a-f12a-4ea7-a4d0-18f252a57866',
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    observation: { ...structuredClone(legacyControlObservation), state: {
      ...legacyControlObservation.state,
      period: 'month',
    } },
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: 'month' },
    expiresAt: '2026-10-18T09:30:05.000+09:00',
  };
  expectInvalid(() => validator.validateControlProposal(legacyMonthProposal), /must match exactly one allowed shape/);

  const currentCompilerLegacyTask = {
    schemaVersion: 1,
    id: '82efbb4a-f12a-4ea7-a4d0-18f252a57866',
    submissionId: '83efbb4a-f12a-4ea7-a4d0-18f252a57866',
    revision: 1,
    createdAt: '2026-10-18T09:30:00.000+09:00',
    updatedAt: '2026-10-18T09:30:00.000+09:00',
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    compiler: {
      kind: 'deterministic', id: 'deterministic-korean-chart-v2', version: '2',
      generative: false, bundleHash: null,
    },
    status: 'ready',
    input: { text: '주봉으로' },
    cursor: 0,
    steps: [{
      id: '84efbb4a-f12a-4ea7-a4d0-18f252a57866', index: 0,
      actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'week' },
      status: 'pending', proposalId: null, receiptId: null,
    }],
    activeProposal: null,
    cancelRequested: false,
    message: '다음 단계를 기다립니다.',
  };
  expectInvalid(() => validator.validateControlTask(currentCompilerLegacyTask), /must match exactly one allowed shape/);

  const legacyCompilerCurrentTask = structuredClone(currentCompilerLegacyTask);
  legacyCompilerCurrentTask.catalogVersion = CONTROL_CATALOG_VERSION;
  legacyCompilerCurrentTask.compiler.id = 'deterministic-korean-chart-v1';
  legacyCompilerCurrentTask.compiler.version = '1';
  expectInvalid(() => validator.validateControlTask(legacyCompilerCurrentTask), /must match exactly one allowed shape/);

  const mixedActiveTask = structuredClone(currentCompilerLegacyTask);
  mixedActiveTask.catalogVersion = CONTROL_CATALOG_VERSION;
  mixedActiveTask.status = 'awaiting_receipt';
  mixedActiveTask.steps[0].status = 'awaiting_receipt';
  mixedActiveTask.steps[0].actionId = CHART_OPEN_ACTION_ID;
  mixedActiveTask.steps[0].args = {};
  mixedActiveTask.steps[0].proposalId = legacyOpenProposal.id;
  mixedActiveTask.activeProposal = legacyOpenProposal;
  expectInvalid(() => validator.validateControlTask(mixedActiveTask), /must match exactly one allowed shape/);

  const legacyMonthReceipt = {
    ...legacyOpenReceipt,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: 'month' },
    before: legacyMonthProposal.observation,
  };
  expectInvalid(() => validator.validateControlReceipt(legacyMonthReceipt), /must match exactly one allowed shape/);
});

test('rejects unknown fields at nested boundaries', () => {
  const unsafe = structuredClone(observation);
  unsafe.controls[0].value = 'account-secret';

  expectInvalid(
    () => validator.validateRequest(
      request('inventory.record', { capture: { ...capture, observations: [unsafe] } }),
    ),
    /must match exactly one allowed shape/,
  );
});

test('rejects observations from an origin other than the exact WTS origin', () => {
  const unsafe = structuredClone(observation);
  unsafe.source.origin = 'https://evil.example';

  expectInvalid(
    () => validator.validateObservation(unsafe),
    /source\.origin has an unsupported value/,
  );
});

test('rejects source and frame paths containing query strings or fragments', () => {
  const sourceQuery = structuredClone(observation);
  sourceQuery.source.path = '/trade/chart?account=secret';
  expectInvalid(
    () => validator.validateObservation(sourceQuery),
    /source\.path has an invalid format/,
  );

  const frameFragment = structuredClone(observation);
  frameFragment.frames[0].path = '/trade/chart#private';
  expectInvalid(
    () => validator.validateObservation(frameFragment),
    /frames\[0\]\.path must match exactly one allowed shape/,
  );
});

test('requires one to sixteen observations in an atomic capture', () => {
  assert.equal(validator.validateCapture(capture).observations.length, 1);

  expectInvalid(
    () => validator.validateCapture({ ...capture, observations: [] }),
    /contains too few items/,
  );
  expectInvalid(
    () => validator.validateCapture({
      ...capture,
      observations: Array.from({ length: 17 }, () => observation),
    }),
    /contains too many items/,
  );
});

test('rejects messages over the 128 KiB wire limit', () => {
  const oversized = request('runtime.hello', {});
  oversized.padding = 'x'.repeat(MAX_MESSAGE_BYTES);

  expectInvalid(
    () => validator.validateRequest(oversized),
    /exceeds the 128 KiB protocol limit/,
  );
});

test('rejects unsupported methods', () => {
  expectInvalid(
    () => validator.validateRequest(request('screen.click', {})),
    /must match exactly one allowed shape/,
  );
});

test('accepts method-discriminated success and safe error responses', () => {
  const hello = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261018-0001',
    method: 'runtime.hello',
    ok: true,
    result: {
      runtimeVersion: '0.8.0',
      capabilities: {
        observationStorage: true,
        screenControl: true,
        laya: false,
        localPlanner: false,
      },
      control: {
        catalogVersion: CONTROL_CATALOG_VERSION,
        actions: CONTROL_ACTION_IDS,
        commandMode: 'bounded-korean-v3',
        taskMode: 'bounded-compound-v1',
        maxTaskSteps: 12,
        planner: {
          kind: 'deterministic',
          id: 'deterministic-korean-wts-v3',
          version: '3',
          bundleHash: null,
          generative: false,
          localModelReady: false,
        },
        market: MARKET_MENU_PROFILE,
      },
      storage: 'user-local',
      lifecycle: 'native-port',
      source: {
        configured: false,
        profile: SOURCE_PROFILE,
        apiVersion: SOURCE_API_VERSION,
        metadataOnly: true,
        financialQuery: false,
        externalAi: false,
      },
      financial: {
        configured: false,
        profile: FINANCIAL_PROFILE,
        apiVersion: FINANCIAL_API_VERSION,
        cardVersion: FINANCIAL_CARD_VERSION,
        methods: FINANCIAL_METHODS,
        renderKinds: FINANCIAL_RENDER_KINDS,
        queryOnly: true,
        credentialSetup: true,
        order: false,
        websocket: false,
        externalAi: false,
      },
      conversation: {
        routerId: CONVERSATION_ROUTER_ID,
        generative: false,
        routes: ['wts-control', 'source-search'],
      },
      provider: RUNTIME_HELLO_PROVIDER_METADATA,
    },
  };
  assert.equal(validator.validateResponse(hello).ok, true);
  const missingSource = structuredClone(hello);
  delete missingSource.result.source;
  expectInvalid(() => validator.validateResponse(missingSource), /must match exactly one allowed shape/);
  const oldRuntime = structuredClone(hello);
  oldRuntime.result.runtimeVersion = '0.3.0';
  expectInvalid(() => validator.validateResponse(oldRuntime), /must match exactly one allowed shape/);
  const financialQuery = structuredClone(hello);
  financialQuery.result.source.financialQuery = true;
  expectInvalid(() => validator.validateResponse(financialQuery), /must match exactly one allowed shape/);
  const duplicateActions = structuredClone(hello);
  duplicateActions.result.control.actions = [CHART_OPEN_ACTION_ID, CHART_OPEN_ACTION_ID];
  expectInvalid(() => validator.validateResponse(duplicateActions), /must match exactly one allowed shape/);
  const missingConversation = structuredClone(hello);
  delete missingConversation.result.conversation;
  expectInvalid(() => validator.validateResponse(missingConversation), /must match exactly one allowed shape/);
  const reversedRoutes = structuredClone(hello);
  reversedRoutes.result.conversation.routes.reverse();
  expectInvalid(() => validator.validateResponse(reversedRoutes), /deterministic route order/);

  const failure = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261018-0001',
    method: 'inventory.record',
    ok: false,
    error: {
      code: 'INVALID_OBSERVATION',
      message: 'Observation failed validation',
    },
  };
  assert.equal(validator.validateResponse(failure).ok, false);
  const sourceFailure = {
    ...failure,
    method: 'source.search',
    error: {
      code: 'SOURCE_RESPONSE_INVALID',
      message: 'Local source response is invalid.',
    },
  };
  assert.equal(validator.validateResponse(sourceFailure).method, 'source.search');
});

test('validates task state semantics and rejects inconsistent active proposals', () => {
  const task = {
    schemaVersion: 1,
    id: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
    submissionId: '44efbb4a-f12a-4ea7-a4d0-18f252a57866',
    revision: 2,
    createdAt: '2026-10-18T09:30:00.000+09:00',
    updatedAt: '2026-10-18T09:30:01.000+09:00',
    catalogVersion: CONTROL_CATALOG_VERSION,
    compiler: {
      kind: 'deterministic',
      id: 'deterministic-korean-wts-v3',
      version: '3',
      generative: false,
      bundleHash: null,
    },
    status: 'awaiting_receipt',
    input: { text: '차트 열어줘' },
    cursor: 0,
    steps: [{
      id: '55efbb4a-f12a-4ea7-a4d0-18f252a57866',
      index: 0,
      actionId: CHART_OPEN_ACTION_ID,
      args: {},
      status: 'awaiting_receipt',
      proposalId: openProposal.id,
      receiptId: null,
    }],
    activeProposal: openProposal,
    cancelRequested: false,
    message: '차트 열기를 제안했습니다.',
  };
  assert.equal(validator.validateControlTask(task).status, 'awaiting_receipt');
  assert.equal(validator.validateResponse(success('control.task.start', { task })).ok, true);

  const legacyTask = structuredClone(task);
  legacyTask.catalogVersion = LEGACY_CONTROL_CATALOG_VERSION;
  legacyTask.compiler.id = 'deterministic-korean-chart-v1';
  legacyTask.compiler.version = '1';
  legacyTask.steps[0].proposalId = legacyOpenProposal.id;
  legacyTask.activeProposal = legacyOpenProposal;
  assert.equal(validator.validateControlTask(legacyTask).catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(validator.validateResponse(success('control.task.get', { task: legacyTask })).ok, true);
  expectInvalid(
    () => validator.validateResponse(success('control.task.start', { task: legacyTask })),
    /must match exactly one allowed shape/,
  );

  const taskResponse = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'task-response-01',
    method: 'control.task.next',
    ok: true,
    result: {
      task,
      outcome: {
        status: 'proposed',
        message: task.message,
        proposal: openProposal,
      },
    },
  };
  assert.equal(validator.validateResponse(taskResponse).result.outcome.status, 'proposed');
  const mismatchedOutcome = structuredClone(taskResponse);
  mismatchedOutcome.result.outcome.message = '다른 메시지';
  expectInvalid(() => validator.validateResponse(mismatchedOutcome), /outcome does not match/);

  const sameIdDifferentObservation = structuredClone(taskResponse);
  sameIdDifferentObservation.result.outcome.proposal = structuredClone(openProposal);
  sameIdDifferentObservation.result.outcome.proposal.observation.state.contextToken = 'c'.repeat(64);
  expectInvalid(
    () => validator.validateResponse(sameIdDifferentObservation),
    /outcome does not match/,
  );

  const crossCatalogOutcome = {
    ...taskResponse,
    result: {
      task: legacyTask,
      outcome: {
        status: 'proposed',
        message: legacyTask.message,
        proposal: {
          ...structuredClone(openProposal),
          id: legacyOpenProposal.id,
        },
      },
    },
  };
  expectInvalid(
    () => validator.validateResponse(crossCatalogOutcome),
    /outcome does not match/,
  );

  const wrongCursor = structuredClone(task);
  wrongCursor.cursor = 1;
  expectInvalid(() => validator.validateControlTask(wrongCursor), /activeProposal does not match/);

  const wrongArgs = structuredClone(task);
  wrongArgs.steps[0].args = { period: 'week' };
  expectInvalid(() => validator.validateControlTask(wrongArgs), /must match exactly one allowed shape/);

  const wrongProposalAction = structuredClone(task);
  wrongProposalAction.activeProposal.actionId = CHART_PERIOD_SET_ACTION_ID;
  wrongProposalAction.activeProposal.args = { period: 'week' };
  expectInvalid(
    () => validator.validateControlTask(wrongProposalAction),
    /activeProposal action does not match the current step/,
  );
});

test('rejects a result that does not match its response method', () => {
  const mismatched = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261018-0001',
    method: 'inventory.summary',
    ok: true,
    result: {
      captureId: capture.id,
      observationCount: 1,
      stored: true,
    },
  };

  expectInvalid(
    () => validator.validateResponse(mismatched),
    /must match exactly one allowed shape/,
  );
});

test('accepts inventory result shapes and rejects claimed future capabilities', () => {
  const recordResponse = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261018-0001',
    method: 'inventory.record',
    ok: true,
    result: {
      captureId: capture.id,
      observationCount: 1,
      stored: true,
    },
  };
  assert.equal(validator.validateResponse(recordResponse).result.stored, true);

  const summaryResponse = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-20261018-0001',
    method: 'inventory.summary',
    ok: true,
    result: {
      captureCount: 1,
      observationCount: 1,
      lastObservedAt: observation.capturedAt,
      coverage: 'partial',
      controlEnabled: true,
      layaReady: false,
    },
  };
  assert.equal(validator.validateResponse(summaryResponse).result.observationCount, 1);

  const falseCapability = structuredClone(summaryResponse);
  falseCapability.result.controlEnabled = false;
  expectInvalid(
    () => validator.validateResponse(falseCapability),
    /must match exactly one allowed shape/,
  );
});

const financialIds = Object.freeze({
  profile: '11111111-1111-4111-8111-111111111111',
  mutation: '22222222-2222-4222-8222-222222222222',
  submission: '33333333-3333-4333-8333-333333333333',
  job: '44444444-4444-4444-8444-444444444444',
  parentJob: '55555555-5555-4555-8555-555555555555',
  cancellation: '66666666-6666-4666-8666-666666666666',
});
const futureTimestamp = '2099-10-19T12:00:00.000Z';
const opaqueToken = 'A'.repeat(43);
const catalogVersion = `sha256:${'a'.repeat(64)}`;

function financialProvenance() {
  return {
    provider: 'kiwoom-rest',
    environment: 'mock',
    profileId: financialIds.profile,
    trId: 'ka10001',
    endpoint: '/api/dostk/stkinfo',
    catalogVersion,
    fetchedAt: '2026-10-19T12:00:00.000Z',
    sourceAsOf: null,
    sourceStatusCode: '0',
    argumentsSha256: `sha256:${'b'.repeat(64)}`,
  };
}

function pageDescriptor(overrides = {}) {
  return {
    pageIndex: 0,
    pageCount: 1,
    itemStart: 0,
    itemEndExclusive: 1,
    itemCount: 1,
    totalItems: 1,
    initial: true,
    previousPageToken: null,
    nextPageToken: null,
    expiresAt: futureTimestamp,
    ...overrides,
  };
}

function factsCard(overrides = {}) {
  return {
    cardVersion: FINANCIAL_CARD_VERSION,
    jobId: financialIds.job,
    submissionId: financialIds.submission,
    operationRef: 'generic:ka10001',
    renderKind: 'facts',
    rendererId: 'facts-card-v1',
    title: '주식 기본정보',
    provenance: financialProvenance(),
    page: pageDescriptor(),
    continuation: {
      available: false,
      continuationToken: null,
      expiresAt: null,
    },
    data: {
      kind: 'facts',
      fields: [{ key: 'name', label: '종목명', value: '삼성전자' }],
    },
    ...overrides,
  };
}

function completedJob(overrides = {}) {
  return {
    jobId: financialIds.job,
    submissionId: financialIds.submission,
    parentJobId: null,
    profileId: financialIds.profile,
    operationRef: 'generic:ka10001',
    state: 'completed',
    revision: 3,
    createdAt: '2026-10-19T11:59:58.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
    queueDeadlineAt: '2026-10-19T12:00:28.000Z',
    runDeadlineAt: '2026-10-19T12:00:29.000Z',
    terminalAt: '2026-10-19T12:00:00.000Z',
    errorCode: null,
    card: factsCard(),
    ...overrides,
  };
}

test('freezes the complete protocol 6 baseline before the additive v7 contract', async () => {
  const fixtureUrl = new URL('./fixtures/wts-protocol6-pre-v7-baseline.json', import.meta.url);
  const baseline = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  assert.equal(baseline.capturedBeforeSource07Edits, true);
  assert.equal(baseline.protocol, 6);
  assert.equal(Object.keys(baseline.schema.$defs).length, 125);
  assert.equal(
    createHash('sha256').update(JSON.stringify(baseline.schema)).digest('hex'),
    '70eb8f14f4ff5c7227103617d23a017edfdb39603fdc9587a4a7da8a1cf4c34c',
  );

  const normalized = structuredClone(schema);
  const baselineNames = new Set(Object.keys(baseline.schema.$defs));
  for (const name of Object.keys(normalized.$defs)) {
    if (!baselineNames.has(name)) delete normalized.$defs[name];
  }
  const normalizeProtocol = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (
      !Array.isArray(value) &&
      (value.properties?.protocolVersion?.const === 7 ||
        value.properties?.protocolVersion?.const === 8)
    ) {
      value.properties.protocolVersion.const = 6;
    }
    Object.values(value).forEach(normalizeProtocol);
  };
  normalizeProtocol(normalized.$defs);
  assert.deepEqual(
    normalized.$defs.sourceField,
    baseline.schema.$defs.sourceField,
  );
  assert.equal(
    normalized.$defs.capabilityDetailCard.properties.requiredArguments.items.$ref,
    '#/$defs/sourceArgumentField',
  );
  assert.equal(
    normalized.$defs.capabilityDetailCard.properties.optionalArguments.items.$ref,
    '#/$defs/sourceArgumentField',
  );
  assert.equal(
    normalized.$defs.capabilityDetailCard.properties.responseFields.items.$ref,
    '#/$defs/sourceField',
  );
  normalized.$defs.capabilityDetailCard.properties.requiredArguments.items.$ref =
    baseline.schema.$defs.capabilityDetailCard.properties.requiredArguments.items.$ref;
  normalized.$defs.capabilityDetailCard.properties.optionalArguments.items.$ref =
    baseline.schema.$defs.capabilityDetailCard.properties.optionalArguments.items.$ref;
  normalized.$defs.request.oneOf =
    normalized.$defs.request.oneOf.slice(0, baseline.schema.$defs.request.oneOf.length);
  normalized.$defs.response.oneOf = [
    ...normalized.$defs.response.oneOf.slice(
      0,
      baseline.schema.$defs.response.oneOf.length - 1,
    ),
    normalized.$defs.response.oneOf.at(-1),
  ];
  normalized.$defs.errorResponse.properties.method.enum =
    normalized.$defs.errorResponse.properties.method.enum.slice(
      0,
      baseline.schema.$defs.errorResponse.properties.method.enum.length,
    );
  normalized.$defs.helloResult.required =
    normalized.$defs.helloResult.required.filter(
      (name) => name !== 'financial' && name !== 'provider',
    );
  delete normalized.$defs.helloResult.properties.financial;
  delete normalized.$defs.helloResult.properties.provider;
  assert.equal(
    normalized.$defs.helloResult.properties.runtimeVersion.const,
    '0.8.0',
  );
  normalized.$defs.helloResult.properties.runtimeVersion.const =
    baseline.schema.$defs.helloResult.properties.runtimeVersion.const;
  assert.deepEqual(
    normalized.$defs.helloResult.properties.source,
    baseline.schema.$defs.helloResult.properties.source,
  );
  assert.deepEqual(normalized, baseline.schema);

  const moduleFixtureUrl = new URL('./fixtures/wts-protocol6-pre-v7-module.mjs', import.meta.url);
  const protocol6 = await import(moduleFixtureUrl);
  assert.equal(protocol6.PROTOCOL_VERSION, 6);
  assert.deepEqual(protocol6.CONTROL_ACTION_IDS, CONTROL_ACTION_IDS);
  assert.deepEqual(protocol6.MARKET_MENU_TARGETS, MARKET_MENU_TARGETS);
  assert.equal(protocol6.SOURCE_PROFILE, SOURCE_PROFILE);
  assert.equal(protocol6.SOURCE_API_VERSION, SOURCE_API_VERSION);
});

test('carries the approved 609 direct and 88 nullable field shapes without changing responses', () => {
  const probedFieldSchemaShapes = Object.freeze({ type: 609, anyOf: 88 });
  const fields = [
    ...Array.from({ length: probedFieldSchemaShapes.type }, (_, index) => ({
      alias: `direct_${index}`,
      description: null,
      required: true,
      jsonSchema: { type: 'string' },
    })),
    ...Array.from({ length: probedFieldSchemaShapes.anyOf }, (_, index) => ({
      alias: `nullable_${index}`,
      description: null,
      required: false,
      jsonSchema: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
        default: null,
      },
    })),
  ];
  let validated = 0;
  for (let offset = 0; offset < fields.length; offset += 64) {
    const chunk = fields.slice(offset, offset + 64);
    const card = structuredClone(capabilityDetail);
    card.requiredArguments = chunk.filter((field) => field.required);
    card.optionalArguments = chunk.filter((field) => !field.required);
    validator.validateSourceCard(card);
    validated += chunk.length;
  }
  assert.equal(validated, 697);
  assert.deepEqual(capabilityDetail.responseFields, [
    { alias: 'cur_prc', description: null, required: false },
  ]);
});

test('binds hello runtimeVersion to the source 0.8 package identities', async () => {
  const runtimePackage = JSON.parse(await readFile(
    new URL('../../local-runtime/package.json', import.meta.url),
    'utf8',
  ));
  const extensionPackage = JSON.parse(await readFile(
    new URL('../../extension/package.json', import.meta.url),
    'utf8',
  ));
  const extensionManifest = JSON.parse(await readFile(
    new URL('../../extension/src/manifest.json', import.meta.url),
    'utf8',
  ));
  const helloRuntimeVersion = schema.$defs.helloResult.properties.runtimeVersion.const;
  assert.equal(helloRuntimeVersion, '0.8.0');
  assert.equal(runtimePackage.version, helloRuntimeVersion);
  assert.equal(extensionPackage.version, helloRuntimeVersion);
  assert.equal(extensionManifest.version, helloRuntimeVersion);
});

test('accepts all eight exact financial requests and rejects secret-invalid input safely', () => {
  const requests = [
    request('source.credentials.status', { mutationId: null }),
    request('source.credentials.configure', {
      mutationId: financialIds.mutation,
      profileId: financialIds.profile,
      expectedRevision: null,
      label: '모의 조회',
      environment: 'mock',
      appKey: 'app-key',
      secretKey: 'secret-key',
    }),
    request('source.credentials.delete', {
      mutationId: financialIds.mutation,
      profileId: financialIds.profile,
      expectedRevision: 1,
    }),
    request('source.query.start', {
      submissionId: financialIds.submission,
      profileId: financialIds.profile,
      operationRef: 'generic:ka10001',
      arguments: { stk_cd: '005930', nullable: null, include: true, count: 1 },
    }),
    request('source.query.status', { jobId: financialIds.job }),
    request('source.query.page', { jobId: financialIds.job, pageToken: opaqueToken }),
    request('source.query.continue', {
      submissionId: financialIds.submission,
      parentJobId: financialIds.parentJob,
      continuationToken: opaqueToken,
    }),
    request('source.query.cancel', {
      jobId: financialIds.job,
      cancellationId: financialIds.cancellation,
    }),
  ];
  assert.deepEqual(requests.map((value) => validator.validateRequest(value).method), FINANCIAL_METHODS);

  const secretCanary = 'do-not-reflect-this-secret'.repeat(12);
  const invalidSecret = structuredClone(requests[1]);
  invalidSecret.params.secretKey = secretCanary;
  assert.throws(() => validator.validateRequest(invalidSecret), (error) => {
    assert.equal(error.message, 'WTS protocol message is invalid');
    assert.equal(error.code, 'INVALID_PROTOCOL_MESSAGE');
    assert.doesNotMatch(error.issues.join('\n'), new RegExp(secretCanary, 'u'));
    assert.ok(error.issues.every((issue) => !issue.includes(secretCanary)));
    return true;
  });

  const tooManyArguments = structuredClone(requests[3]);
  tooManyArguments.params.arguments = Object.fromEntries(
    Array.from({ length: 65 }, (_, index) => [`field${index}`, index]),
  );
  expectInvalid(
    () => validator.validateRequest(tooManyArguments),
    /must match exactly one allowed shape/,
  );
  const nestedArgument = structuredClone(requests[3]);
  nestedArgument.params.arguments = { stk_cd: { nested: true } };
  expectInvalid(() => validator.validateRequest(nestedArgument), /must match exactly one allowed shape/);
  const nonFiniteArgument = structuredClone(requests[3]);
  nonFiniteArgument.params.arguments = { value: Number.NaN };
  expectInvalid(() => validator.validateRequest(nonFiniteArgument), /must match exactly one allowed shape/);
});

test('validates financial profiles, mutations, jobs, pages, and safe errors', () => {
  const queuedMutation = {
    mutationId: financialIds.mutation,
    kind: 'configure',
    profileId: financialIds.profile,
    state: 'queued',
    revision: 0,
    createdAt: '2026-10-19T12:00:00.000Z',
    updatedAt: '2026-10-19T12:00:00.000Z',
    queueDeadlineAt: '2026-10-19T12:00:30.000Z',
    runDeadlineAt: null,
    terminalAt: null,
    errorCode: null,
  };
  const readyProfile = {
    profileId: financialIds.profile,
    label: '모의 조회',
    environment: 'mock',
    revision: 1,
    state: 'ready',
    reasonCode: null,
    tokenExpiresAt: futureTimestamp,
    keyCharacterCounts: { appKey: 8, secretKey: 10 },
  };
  assert.equal(validator.validateResponse(success('source.credentials.status', {
    profile: FINANCIAL_PROFILE,
    apiVersion: FINANCIAL_API_VERSION,
    catalogVersion,
    profiles: [readyProfile],
    mutation: queuedMutation,
  })).ok, true);
  assert.equal(validator.validateResponse(success('source.credentials.configure', {
    mutation: queuedMutation,
  })).ok, true);
  assert.equal(validator.validateResponse(success('source.credentials.delete', {
    mutation: { ...queuedMutation, kind: 'delete' },
  })).ok, true);

  const job = completedJob();
  for (const method of ['source.query.start', 'source.query.status']) {
    assert.equal(validator.validateResponse(success(method, { job })).ok, true);
  }
  const continuationJob = completedJob({ parentJobId: financialIds.parentJob });
  assert.equal(validator.validateResponse(success('source.query.continue', {
    job: continuationJob,
  })).ok, true);
  assert.equal(validator.validateResponse(success('source.query.page', {
    jobId: financialIds.job,
    jobRevision: 3,
    card: factsCard(),
  })).ok, true);
  assert.equal(validator.validateResponse(success('source.query.cancel', {
    job,
    cancellationId: financialIds.cancellation,
    accepted: false,
  })).ok, true);

  expectInvalid(
    () => validator.validateResponse(success('source.credentials.configure', {
      mutation: { ...queuedMutation, kind: 'delete' },
    })),
    /must be configure/,
  );
  expectInvalid(
    () => validator.validateResponse(success('source.credentials.delete', {
      mutation: queuedMutation,
    })),
    /must be delete/,
  );
  expectInvalid(
    () => validator.validateResponse(success('source.query.start', {
      job: continuationJob,
    })),
    /must be null for source\.query\.start/,
  );
  expectInvalid(
    () => validator.validateResponse(success('source.query.continue', { job })),
    /is required for source\.query\.continue/,
  );
  const wrongProfileJob = completedJob({
    profileId: '77777777-7777-4777-8777-777777777777',
  });
  expectInvalid(
    () => validator.validateResponse(success('source.query.status', {
      job: wrongProfileJob,
    })),
    /provenance profile does not match the job/,
  );

  for (const method of FINANCIAL_METHODS) {
    const failure = {
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-financial-error',
      method,
      ok: false,
      error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Financial data source is unavailable.' },
    };
    assert.equal(validator.validateResponse(failure).ok, false);
  }
  for (const code of FINANCIAL_ERROR_CODES) {
    assert.equal(validator.validateResponse({
      protocolVersion: PROTOCOL_VERSION,
      requestId: 'req-financial-error-coverage',
      method: 'source.query.status',
      ok: false,
      error: { code, message: FINANCIAL_ERROR_MESSAGES[code] },
    }).ok, false);
  }
  expectInvalid(() => validator.validateResponse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-financial-error',
    method: 'source.query.status',
    ok: false,
    error: { code: 'UPSTREAM_UNAVAILABLE', message: 'secret upstream body' },
  }), /approved financial code and constant message/);
  expectInvalid(() => validator.validateResponse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'req-financial-error',
    method: 'source.query.status',
    ok: false,
    error: { code: 'ARBITRARY_CODE', message: 'Financial data source is unavailable.' },
  }), /approved financial code and constant message/);

  const expired = structuredClone(readyProfile);
  expired.tokenExpiresAt = '2020-10-19T12:00:00.000Z';
  expectInvalid(() => validator.validateResponse(success('source.credentials.status', {
    profile: FINANCIAL_PROFILE,
    apiVersion: FINANCIAL_API_VERSION,
    catalogVersion,
    profiles: [expired],
    mutation: null,
  })), /future token expiry/);
  const leakedMutation = { ...queuedMutation, errorCode: 'do-not-reflect-secret' };
  expectInvalid(
    () => validator.validateResponse(success('source.credentials.configure', {
      mutation: leakedMutation,
    })),
    /must match exactly one allowed shape/,
  );
});

test('enforces card discriminators, lossless page bounds, exact row keys, and race states', () => {
  const tableCard = factsCard({
    renderKind: 'table',
    rendererId: 'table-card-v1',
    data: {
      kind: 'table',
      columns: [
        { key: 'price', label: '현재가' },
        { key: 'volume', label: '거래량' },
      ],
      rows: [{ price: 70000, volume: 1234 }],
    },
  });
  assert.equal(validator.validateResponse(success('source.query.page', {
    jobId: financialIds.job,
    jobRevision: 4,
    card: tableCard,
  })).ok, true);

  const compoundCard = factsCard({
    renderKind: 'compound',
    rendererId: 'compound-card-v1',
    data: {
      kind: 'compound',
      header: [{ key: 'name', label: '종목명', value: '삼성전자' }],
      columns: [{ key: 'price', label: '현재가' }],
      rows: [{ price: 70000 }],
    },
  });
  assert.equal(validator.validateResponse(success('source.query.page', {
    jobId: financialIds.job,
    jobRevision: 4,
    card: compoundCard,
  })).ok, true);

  const chartCard = factsCard({
    renderKind: 'chart',
    rendererId: 'aits-chart-v1',
    provenance: {
      ...financialProvenance(),
      trId: 'ka10081',
    },
    data: {
      kind: 'chart',
      symbol: '005930',
      chart: {
        period: 'day',
        target: 'stock',
        trId: 'ka10081',
        candles: [
          { time: '20261017', open: 69000, high: 70500, low: 68800, close: 70000, volume: null },
          { time: '20261018', open: 70000, high: 71000, low: 69500, close: 70800, volume: 1200 },
        ],
      },
    },
    page: pageDescriptor({
      itemEndExclusive: 2,
      itemCount: 2,
      totalItems: 2,
    }),
  });
  assert.equal(validator.validateResponse(success('source.query.page', {
    jobId: financialIds.job,
    jobRevision: 4,
    card: chartCard,
  })).ok, true);
  const reversedChart = structuredClone(chartCard);
  reversedChart.data.chart.candles.reverse();
  expectInvalid(
    () => validator.validateResponse(success('source.query.page', {
      jobId: financialIds.job, jobRevision: 4, card: reversedChart,
    })),
    /must be chronological/,
  );
  const wrongChartTr = structuredClone(chartCard);
  wrongChartTr.data.chart.trId = 'ka10082';
  expectInvalid(
    () => validator.validateResponse(success('source.query.page', {
      jobId: financialIds.job, jobRevision: 4, card: wrongChartTr,
    })),
    /must match provenance\.trId/,
  );

  const continuedCard = structuredClone(tableCard);
  continuedCard.continuation = {
    available: true,
    continuationToken: opaqueToken,
    expiresAt: futureTimestamp,
  };
  assert.equal(validator.validateResponse(success('source.query.page', {
    jobId: financialIds.job, jobRevision: 4, card: continuedCard,
  })).ok, true);
  for (const continuation of [
    { available: false, continuationToken: opaqueToken, expiresAt: null },
    { available: false, continuationToken: null, expiresAt: futureTimestamp },
    { available: true, continuationToken: opaqueToken, expiresAt: null },
    { available: true, continuationToken: null, expiresAt: futureTimestamp },
  ]) {
    const halfNull = structuredClone(tableCard);
    halfNull.continuation = continuation;
    expectInvalid(
      () => validator.validateResponse(success('source.query.page', {
        jobId: financialIds.job, jobRevision: 4, card: halfNull,
      })),
      /continuation fields are inconsistent/,
    );
  }

  for (const invalidRow of [
    { price: 70000 },
    { price: 70000, volume: 1234, secret: 'unexpected' },
    { volume: 1234, price: 70000 },
  ]) {
    const invalid = structuredClone(tableCard);
    invalid.data.rows = [invalidRow];
    expectInvalid(
      () => validator.validateResponse(success('source.query.page', {
        jobId: financialIds.job,
        jobRevision: 4,
        card: invalid,
      })),
      /keys must exactly match ordered columns/,
    );
  }

  const wrongRenderer = structuredClone(tableCard);
  wrongRenderer.rendererId = 'facts-card-v1';
  expectInvalid(
    () => validator.validateResponse(success('source.query.page', {
      jobId: financialIds.job, jobRevision: 4, card: wrongRenderer,
    })),
    /render kind, renderer, and data kind must match/,
  );
  const clippedBounds = structuredClone(tableCard);
  clippedBounds.page.itemEndExclusive = 2;
  expectInvalid(
    () => validator.validateResponse(success('source.query.page', {
      jobId: financialIds.job, jobRevision: 4, card: clippedBounds,
    })),
    /inconsistent bounds/,
  );

  const cancelling = completedJob({
    state: 'cancelling',
    terminalAt: null,
    errorCode: null,
    card: null,
  });
  assert.equal(validator.validateResponse(success('source.query.cancel', {
    job: cancelling,
    cancellationId: financialIds.cancellation,
    accepted: true,
  })).ok, true);
  expectInvalid(
    () => validator.validateResponse(success('source.query.cancel', {
      job: completedJob(),
      cancellationId: financialIds.cancellation,
      accepted: true,
    })),
    /accepted is inconsistent/,
  );
  const running = completedJob({
    state: 'running',
    terminalAt: null,
    errorCode: null,
    card: null,
  });
  expectInvalid(
    () => validator.validateResponse(success('source.query.cancel', {
      job: running,
      cancellationId: financialIds.cancellation,
      accepted: false,
    })),
    /accepted is inconsistent/,
  );
  const cancelled = completedJob({
    state: 'cancelled',
    terminalAt: '2026-10-19T12:00:00.000Z',
    errorCode: 'QUERY_CANCELLED',
    card: null,
  });
  assert.equal(validator.validateResponse(success('source.query.cancel', {
    job: cancelled,
    cancellationId: financialIds.cancellation,
    accepted: true,
  })).ok, true);
  const lateResult = structuredClone(cancelled);
  lateResult.card = factsCard();
  expectInvalid(
    () => validator.validateResponse(success('source.query.cancel', {
      job: lateResult,
      cancellationId: financialIds.cancellation,
      accepted: true,
    })),
    /must match exactly one allowed shape|cancelled job/,
  );
});

test('rejects a financial card page over 96 KiB before the Native envelope limit', () => {
  const oversized = factsCard({
    data: {
      kind: 'facts',
      fields: Array.from({ length: 13 }, (_, index) => ({
        key: `field-${index}`,
        label: `Field ${index}`,
        value: 'x'.repeat(8192),
      })),
    },
    page: pageDescriptor({
      itemEndExclusive: 13,
      itemCount: 13,
      totalItems: 13,
    }),
  });
  assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > FINANCIAL_MAX_PAGE_BYTES);
  assert.ok(new TextEncoder().encode(JSON.stringify(success('source.query.page', {
    jobId: financialIds.job, jobRevision: 4, card: oversized,
  }))).byteLength < MAX_MESSAGE_BYTES);
  expectInvalid(
    () => validator.validateResponse(success('source.query.page', {
      jobId: financialIds.job, jobRevision: 4, card: oversized,
    })),
    /exceeds the 96 KiB card page limit/,
  );
});


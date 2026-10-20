import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_CATALOG_VERSION,
  MARKET_NAVIGATE_ACTION_ID,
  PROTOCOL_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from '../../contracts/wts-foundation.mjs';
import { ControlPlanner, normalizeControlCommand } from '../src/control-planner.mjs';
import { createRequestHandler } from '../src/host.mjs';
import { InventoryStore } from '../src/inventory-store.mjs';
import { ReceiptStore } from '../src/receipt-store.mjs';

const schema = JSON.parse(await readFile(
  new URL('../../contracts/wts-foundation.protocol.schema.json', import.meta.url),
  'utf8',
));
const validator = createProtocolValidator(schema);
const NOW = Date.parse('2026-10-18T10:00:00.000Z');

function observation(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    capturedAt: new Date(NOW - 1_000).toISOString(),
    source: {
      origin: 'https://wts.kiwoom.com',
      path: '/',
      tabId: 12,
      windowId: 3,
      frameId: 0,
      documentId: 'document-1',
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
      ...overrides,
    },
  };
}

function marketObservation(overrides = {}) {
  return observation({
    stateKind: 'market-navigation',
    screenId: 'main-market-navigation',
    targetId: 'market-menu-001',
    blocked: false,
    sitemapVisible: false,
    sitemapOpenEnabled: true,
    targetAvailable: false,
    activeTargetId: null,
    instrumentToken: 'f'.repeat(64),
    contextToken: 'a'.repeat(64),
    ...overrides,
  });
}

function receipt(proposal, overrides = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    proposalId: proposal.id,
    catalogVersion: proposal.catalogVersion,
    actionId: proposal.actionId,
    args: proposal.args,
    before: proposal.observation,
    after: null,
    status: 'cancelled',
    reason: 'CANCELLED',
    completedAt: new Date(NOW + 1_000).toISOString(),
    ...overrides,
  };
}

function createPlanner() {
  let nextId = 0;
  const ids = [
    '22222222-2222-4222-8222-222222222221',
    '22222222-2222-4222-8222-222222222222',
    '22222222-2222-4222-8222-222222222223',
  ];
  return new ControlPlanner({ now: () => NOW, createId: () => ids[nextId++] });
}

test('normalizes whitespace but accepts only the ten fixed Korean commands', () => {
  assert.equal(normalizeControlCommand('  일봉으로   바꿔줘  '), '일봉으로 바꿔줘');
  const planner = createPlanner();
  const open = planner.plan('차트 열어줘', observation());
  assert.equal(open.status, 'proposed');
  assert.equal(open.proposal.actionId, CHART_OPEN_ACTION_ID);
  assert.deepEqual(open.proposal.args, {});
  assert.equal(open.proposal.catalogVersion, CONTROL_CATALOG_VERSION);
  assert.equal(open.proposal.expiresAt, new Date(NOW + 5_000).toISOString());
  assert.equal(planner.plan('차트 열어줘 그리고 매수', observation()).status, 'unsupported');

  const chart = observation({
    screenId: 'main-chart', activeTab: 'chart', period: 'day',
    chartOpenEnabled: true, periodEnabled: true,
  });
  const week = planner.plan('주봉으로 바꿔줘', chart);
  assert.equal(week.status, 'proposed');
  assert.equal(week.proposal.actionId, CHART_PERIOD_SET_ACTION_ID);
  assert.deepEqual(week.proposal.args, { period: 'week' });

  const monthPlanner = createPlanner();
  const month = monthPlanner.plan('월봉으로 바꿔줘', chart);
  assert.equal(month.status, 'proposed');
  assert.deepEqual(month.proposal.args, { period: 'month' });

  const yearPlanner = createPlanner();
  const year = yearPlanner.plan('년봉으로', chart);
  assert.equal(year.status, 'proposed');
  assert.deepEqual(year.proposal.args, { period: 'year' });
});

test('planner fails closed for stale, blocked, ambiguous, and non-chart observations', () => {
  const planner = createPlanner();
  const stale = observation();
  stale.capturedAt = new Date(NOW - 5_001).toISOString();
  assert.equal(planner.plan('차트 열기', stale).status, 'blocked');
  assert.equal(planner.plan('차트 열기', observation({ blocked: true })).status, 'blocked');
  assert.equal(planner.plan('차트 열기', observation({ chartOpenEnabled: false })).status, 'blocked');
  assert.equal(planner.plan('주봉으로', observation()).status, 'blocked');
});

test('planner reports already satisfied commands without issuing proposals', () => {
  const planner = createPlanner();
  const chart = observation({
    screenId: 'main-chart', activeTab: 'chart', period: 'week',
    chartOpenEnabled: true, periodEnabled: true,
  });
  assert.deepEqual(planner.plan('차트 열기', chart).proposal, null);
  assert.equal(planner.plan('차트 열기', chart).status, 'satisfied');
  assert.equal(planner.plan('주봉으로', chart).status, 'satisfied');
  const month = observation({
    screenId: 'main-chart', activeTab: 'chart', period: 'month',
    chartOpenEnabled: true, periodEnabled: true,
  });
  assert.equal(planner.plan('월봉으로', month).status, 'satisfied');
});

test('market planner treats a closed sitemap targetAvailable false as a normal opener precondition', () => {
  const target = { targetId: 'market-menu-001' };
  const open = createPlanner().planAction(SITEMAP_OPEN_ACTION_ID, target, marketObservation());
  assert.equal(open.status, 'proposed');
  assert.equal(open.proposal.actionId, SITEMAP_OPEN_ACTION_ID);

  const visible = marketObservation({ sitemapVisible: true, targetAvailable: true });
  assert.equal(
    createPlanner().planAction(SITEMAP_OPEN_ACTION_ID, target, visible).status,
    'satisfied',
  );
  const navigate = createPlanner().planAction(MARKET_NAVIGATE_ACTION_ID, target, visible);
  assert.equal(navigate.status, 'proposed');
  assert.equal(navigate.proposal.actionId, MARKET_NAVIGATE_ACTION_ID);

  const active = marketObservation({ activeTargetId: 'market-menu-001' });
  assert.equal(createPlanner().planAction(SITEMAP_OPEN_ACTION_ID, target, active).status, 'satisfied');
  assert.equal(createPlanner().planAction(MARKET_NAVIGATE_ACTION_ID, target, active).status, 'satisfied');
  assert.equal(
    createPlanner().planAction(SITEMAP_OPEN_ACTION_ID, target,
      marketObservation({ sitemapVisible: true, targetAvailable: false })).status,
    'blocked',
  );
});

test('receipt storage is immutable and idempotent in a separate directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-receipt-'));
  const planner = createPlanner();
  const proposal = planner.plan('차트 열기', observation()).proposal;
  const value = receipt(proposal);
  const store = new ReceiptStore(root, validator.validateControlReceipt);

  assert.deepEqual(await store.record(value), { receiptId: value.id, stored: true });
  assert.deepEqual(await store.record(structuredClone(value)), { receiptId: value.id, stored: true });
  await assert.rejects(
    store.record({ ...value, completedAt: new Date(NOW + 2_000).toISOString() }),
    (error) => error.code === 'RECEIPT_ID_CONFLICT',
  );
  const stored = JSON.parse(await readFile(path.join(root, 'receipts', `${value.id}.json`), 'utf8'));
  assert.deepEqual(stored, value);
  assert.equal(Object.hasOwn(stored, 'command'), false);
});

test('host binds a receipt exactly to a proposal issued by the same process', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-binding-'));
  const planner = createPlanner();
  const handler = createRequestHandler({
    validator,
    store: new InventoryStore(root, validator.validateCapture),
    planner,
    receiptStore: new ReceiptStore(root, validator.validateControlReceipt),
    runtimeVersion: '0.7.0',
  });
  const planned = await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-plan-01',
    method: 'control.plan',
    params: { command: '차트 열기', observation: observation() },
  });
  assert.equal(planned.ok, true);
  const boundReceipt = receipt(planned.result.proposal);
  const recorded = await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-receipt-01',
    method: 'control.receipt.record',
    params: { receipt: boundReceipt },
  });
  assert.deepEqual(recorded.result, { receiptId: boundReceipt.id, stored: true });
  const retried = await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-receipt-02',
    method: 'control.receipt.record',
    params: { receipt: boundReceipt },
  });
  assert.equal(retried.ok, true);

  const changed = structuredClone(boundReceipt);
  changed.id = '44444444-4444-4444-8444-444444444444';
  changed.before.state.contextToken = 'b'.repeat(64);
  const mismatch = await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-receipt-03',
    method: 'control.receipt.record',
    params: { receipt: changed },
  });
  assert.equal(mismatch.error.code, 'RECEIPT_PROPOSAL_MISMATCH');

  const restartedPlanner = createPlanner();
  const restartedHandler = createRequestHandler({
    validator,
    store: new InventoryStore(root, validator.validateCapture),
    planner: restartedPlanner,
    receiptStore: new ReceiptStore(root, validator.validateControlReceipt),
    runtimeVersion: '0.7.0',
  });
  const afterRestart = await restartedHandler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-receipt-04',
    method: 'control.receipt.record',
    params: { receipt: boundReceipt },
  });
  assert.equal(afterRestart.error.code, 'PROPOSAL_NOT_ACTIVE');
});

test('source methods stay lazy, return direct validated results, and sanitize backend errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-source-host-'));
  const catalogVersion = `sha256:${'a'.repeat(64)}`;
  const status = {
    state: 'stopped',
    profile: 'wts-readonly-v1',
    apiVersion: null,
    catalogVersion: null,
    ownedChild: false,
  };
  let ensureCalls = 0;
  const supervisor = {
    status: () => status,
    ensure: async () => {
      ensureCalls += 1;
      return {
        state: 'ready',
        profile: 'wts-readonly-v1',
        apiVersion: 'selector-readonly-v1',
        catalogVersion,
        ownedChild: true,
      };
    },
  };
  const notice = '기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.';
  const manifest = {
    profile: 'wts-readonly-v1',
    apiVersion: 'selector-readonly-v1',
    catalogVersion,
    operationCount: 1,
  };
  const searchCard = {
    schemaVersion: 1,
    kind: 'capability-list',
    canvasId: '55555555-5555-4555-8555-555555555555',
    title: '조회 기능 찾기',
    catalogVersion,
    fetchedAt: '2026-10-19T01:02:03.000Z',
    notice,
    query: '종목 조회',
    items: [{
      operationRef: 'base:stock',
      kind: 'query',
      domain: 'stock',
      name: '종목 조회',
      groupTitle: null,
    }],
  };
  const detailCard = {
    schemaVersion: 1,
    kind: 'capability-detail',
    canvasId: '66666666-6666-4666-8666-666666666666',
    title: '종목 조회',
    catalogVersion,
    fetchedAt: '2026-10-19T01:02:03.000Z',
    notice,
    operationRef: 'base:stock',
    domain: 'stock',
    name: '종목 조회',
    executionPolicy: 'selector_query',
    requiredArguments: [],
    optionalArguments: [],
    responseFields: [],
    execution: { available: false, reason: 'FINANCIAL_QUERY_NOT_CONNECTED' },
  };
  const calls = [];
  const bridge = {
    execute: async (operation, input, options) => {
      calls.push({ operation, input, signal: options.signal });
      if (operation === 'manifest') return manifest;
      if (operation === 'search') return searchCard;
      if (operation === 'describe') return detailCard;
      throw new Error('unexpected operation');
    },
  };
  const signal = new AbortController().signal;
  const handler = createRequestHandler({
    validator,
    store: new InventoryStore(root, validator.validateCapture),
    planner: createPlanner(),
    receiptStore: new ReceiptStore(root, validator.validateControlReceipt),
    runtimeVersion: '0.8.0',
    backendSupervisor: supervisor,
    sourceBridge: bridge,
    signal,
  });

  const hello = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-hello', method: 'runtime.hello', params: {},
  });
  assert.equal(hello.result.source.configured, true);
  assert.deepEqual(hello.result.financial, {
    configured: false,
    profile: 'wts-financial-read-v1',
    apiVersion: 'selector-financial-read-v1',
    cardVersion: 'wts-financial-card-1',
    methods: [
      'source.credentials.status',
      'source.credentials.configure',
      'source.credentials.delete',
      'source.query.start',
      'source.query.status',
      'source.query.page',
      'source.query.continue',
      'source.query.cancel',
    ],
    renderKinds: ['facts', 'table', 'compound', 'chart'],
    queryOnly: true,
    credentialSetup: true,
    order: false,
    websocket: false,
    externalAi: false,
  });
  assert.deepEqual(hello.result.conversation, {
    routerId: 'deterministic-wts-conversation-v1',
    generative: false,
    routes: ['wts-control', 'source-search'],
  });
  assert.equal(ensureCalls, 0);
  assert.deepEqual((await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-conversation-chart',
    method: 'conversation.route',
    params: {
      submissionId: '77777777-7777-4777-8777-777777777777',
      text: '차트   열고 주봉으로',
    },
  })).result, {
    submissionId: '77777777-7777-4777-8777-777777777777',
    kind: 'wts-control',
    text: '차트 열고 주봉으로',
  });
  assert.deepEqual((await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-conversation-source',
    method: 'conversation.route',
    params: {
      submissionId: '88888888-8888-4888-8888-888888888888',
      text: '조회 기능 찾아줘: 종목 조회',
    },
  })).result, {
    submissionId: '88888888-8888-4888-8888-888888888888',
    kind: 'source-search',
    query: '종목 조회',
  });
  assert.equal(ensureCalls, 0);
  assert.deepEqual(calls, []);
  const invalidConversation = await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-conversation-invalid',
    method: 'conversation.route',
    params: {
      submissionId: '99999999-9999-4999-8999-999999999999',
      text: '조회 기능 찾아줘: 종목 조회',
      url: 'https://evil.example',
    },
  });
  assert.equal(invalidConversation.ok, false);
  assert.equal(invalidConversation.error.code, 'INVALID_PROTOCOL_MESSAGE');
  assert.equal(ensureCalls, 0);
  assert.deepEqual(calls, []);
  const backendStatus = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-status', method: 'backend.status', params: {},
  });
  assert.equal(backendStatus.result.state, 'stopped');
  assert.equal(ensureCalls, 0);
  const ensured = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-ensure', method: 'backend.ensure', params: {},
  });
  assert.equal(ensured.result.state, 'ready');
  assert.equal(ensureCalls, 1);
  assert.deepEqual((await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-manifest', method: 'source.manifest', params: {},
  })).result, manifest);
  assert.deepEqual((await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-source-search',
    method: 'source.search',
    params: { query: '종목 조회', limit: 5, expectedCatalogVersion: catalogVersion },
  })).result, searchCard);
  assert.deepEqual((await handler({
    protocolVersion: PROTOCOL_VERSION,
    requestId: 'request-source-describe',
    method: 'source.describe',
    params: { operationRef: 'base:stock', expectedCatalogVersion: catalogVersion },
  })).result, detailCard);
  assert.deepEqual(calls.map(({ operation }) => operation), ['manifest', 'search', 'describe']);
  assert.ok(calls.every(({ signal: callSignal }) => callSignal === signal));

  bridge.execute = async () => ({ unexpected: true });
  const invalid = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-invalid', method: 'source.manifest', params: {},
  });
  assert.deepEqual(invalid.error, {
    code: 'SOURCE_RESPONSE_INVALID',
    message: 'Local read-only source response is invalid.',
  });

  bridge.execute = async () => ({ oversized: 'x'.repeat(128 * 1024) });
  const oversized = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-oversized', method: 'source.manifest', params: {},
  });
  assert.deepEqual(oversized.error, {
    code: 'SOURCE_RESPONSE_TOO_LARGE',
    message: 'Local read-only source response is too large.',
  });

  bridge.execute = async () => manifest;
  const recovered = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-recovered', method: 'source.manifest', params: {},
  });
  assert.deepEqual(recovered.result, manifest);

  bridge.execute = async () => {
    throw Object.assign(new Error('token=secret http://127.0.0.1:43210/private'), {
      code: 'BACKEND_REQUEST_FAILED',
    });
  };
  const failed = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-source-failure', method: 'source.manifest', params: {},
  });
  assert.deepEqual(failed.error, {
    code: 'BACKEND_REQUEST_FAILED',
    message: 'Local read-only backend request failed.',
  });
  assert.doesNotMatch(JSON.stringify(failed), /secret|127\.0\.0\.1|private/u);
});

test('unconfigured source status is inert and source startup fails closed', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-source-disabled-'));
  const handler = createRequestHandler({
    validator,
    store: new InventoryStore(root, validator.validateCapture),
    planner: createPlanner(),
    receiptStore: new ReceiptStore(root, validator.validateControlReceipt),
    runtimeVersion: '0.7.0',
  });
  const status = await handler({
    protocolVersion: PROTOCOL_VERSION, requestId: 'request-disabled-status', method: 'backend.status', params: {},
  });
  assert.deepEqual(status.result, {
    configured: false,
    state: 'unconfigured',
    profile: 'wts-readonly-v1',
    apiVersion: null,
    catalogVersion: null,
    ownedChild: false,
  });
  for (const [requestId, method] of [
    ['request-disabled-ensure', 'backend.ensure'],
    ['request-disabled-manifest', 'source.manifest'],
  ]) {
    const response = await handler({
      protocolVersion: PROTOCOL_VERSION, requestId, method, params: {},
    });
    assert.equal(response.error.code, 'SOURCE_NOT_CONFIGURED');
  }
});


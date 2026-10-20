import assert from 'node:assert/strict';
import test from 'node:test';

import { BackendSupervisorError } from '../src/backend-supervisor.mjs';
import { SourceBridge } from '../src/source-bridge.mjs';

const CATALOG = `sha256:${'b'.repeat(64)}`;
const CAPABILITIES = {
  profile: 'wts-readonly-v1',
  apiVersion: 'selector-readonly-v1',
  catalog: true,
  search: true,
  describe: true,
  financialQuery: false,
  credentials: false,
  externalAi: false,
  jobs: false,
  order: false,
  websocket: false,
  canvasKinds: ['capability-list.v1', 'capability-detail.v1'],
};
const HIT = {
  operation_ref: 'detail:ka10001:current_trading',
  kind: 'query',
  domain: 'stockinfo',
  name: '주식기본정보요청',
  group_title: '현재 시세 및 거래량',
  score: 524,
  confidence: 'low',
  contributions: [{ reason_code: 'QUERY_COVERAGE', points: 300 }],
  generic_callable: true,
  discovery_only: false,
  suggested_detail_group: null,
  suggested_operation_ref: null,
};

function fakeSupervisor(overrides = {}) {
  const responses = {
    health: { status: 'ok', profile: 'wts-readonly-v1' },
    capabilities: CAPABILITIES,
    manifest: {
      profile: 'wts-readonly-v1',
      apiVersion: 'selector-readonly-v1',
      catalogVersion: CATALOG,
      operations: [HIT],
    },
    search: {
      catalog_version: CATALOG,
      normalized_query: '삼성전자 현재가',
      results: [HIT],
      suggested_intent: null,
      semantic_ranking: { internal: true },
    },
    describe: {
      catalog_version: CATALOG,
      operation_ref: HIT.operation_ref,
      kind: 'query',
      domain: 'stockinfo',
      name: '주식기본정보요청',
      group_id: 'current_trading',
      group_title_ko: '현재 시세 및 거래량',
      group_title_en: 'Current price and trading activity',
      layout: 'facts',
      required_arguments: [{
        alias: 'stk_cd', description: '종목코드', required: true,
        json_schema: { description: 'Stock code', title: 'Stk Cd', type: 'string' },
      }],
      optional_arguments: [{
        alias: 'base_dt', description: '기준일자', required: false,
        json_schema: {
          anyOf: [{ type: 'null' }, { type: 'string' }],
          default: null,
          description: 'Optional base date',
          title: 'Base Dt',
        },
      }],
      response_fields: [{
        alias: 'acctNo', description: '계좌번호', required: false,
        json_schema: { title: 'Cur Prc', type: 'string' },
      }],
      detail_groups: [],
      execution_policy: 'selector_detail',
      policy_reasons: [],
    },
    ...overrides,
  };
  const calls = [];
  return {
    calls,
    status: () => ({ state: 'ready' }),
    ensure: async () => ({ state: 'ready' }),
    request: async (operation, payload) => {
      calls.push({ operation, payload });
      return structuredClone(responses[operation]);
    },
  };
}

test('bridge exposes only five fixed operations and sanitized capability canvases', async () => {
  const supervisor = fakeSupervisor();
  let id = 1;
  const bridge = new SourceBridge(supervisor, {
    now: () => Date.parse('2026-10-19T01:00:00.000Z'),
    createId: () => `10000000-0000-4000-8000-${String(id++).padStart(12, '0')}`,
  });
  assert.deepEqual(await bridge.execute('health'), { status: 'ok', profile: 'wts-readonly-v1' });
  assert.deepEqual(await bridge.execute('capabilities'), CAPABILITIES);

  const manifest = await bridge.execute('manifest');
  assert.deepEqual(manifest, {
    profile: 'wts-readonly-v1', apiVersion: 'selector-readonly-v1',
    catalogVersion: CATALOG, operationCount: 1,
  });

  const search = await bridge.execute('search', {
    query: '삼성전자 현재가', limit: 3, expectedCatalogVersion: CATALOG,
  });
  assert.deepEqual(search, {
    schemaVersion: 1,
    kind: 'capability-list',
    canvasId: '10000000-0000-4000-8000-000000000001',
    title: '조회 기능 찾기',
    catalogVersion: CATALOG,
    fetchedAt: '2026-10-19T01:00:00.000Z',
    notice: '기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.',
    query: '삼성전자 현재가',
    items: [{
      operationRef: HIT.operation_ref,
      kind: 'query',
      domain: 'stockinfo',
      name: '주식기본정보요청',
      groupTitle: '현재 시세 및 거래량',
    }],
  });
  assert.deepEqual(Object.keys(search).sort(), [
    'canvasId', 'catalogVersion', 'fetchedAt', 'items', 'kind', 'notice',
    'query', 'schemaVersion', 'title',
  ]);
  assert.deepEqual(Object.keys(search.items[0]).sort(), [
    'domain', 'groupTitle', 'kind', 'name', 'operationRef',
  ]);
  assert.equal(Buffer.byteLength(JSON.stringify(search), 'utf8') < 128 * 1024, true);
  assert.doesNotMatch(JSON.stringify(search), /score|confidence|contributions|semantic_ranking|generic_callable/u);
  assert.deepEqual(supervisor.calls.at(-1), {
    operation: 'search', payload: { query: '삼성전자 현재가', limit: 3 },
  });

  const detail = await bridge.execute('describe', {
    operationRef: HIT.operation_ref,
    expectedCatalogVersion: CATALOG,
  });
  assert.equal(detail.kind, 'capability-detail');
  assert.equal(detail.operationRef, HIT.operation_ref);
  assert.equal(detail.executionPolicy, 'selector_detail');
  assert.deepEqual(detail.execution, {
    available: false, reason: 'FINANCIAL_QUERY_NOT_CONNECTED',
  });
  assert.deepEqual(detail.requiredArguments, [{
    alias: 'stk_cd', description: '종목코드', required: true,
    jsonSchema: { type: 'string' },
  }]);
  assert.deepEqual(detail.optionalArguments, [{
    alias: 'base_dt', description: '기준일자', required: false,
    jsonSchema: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
      default: null,
    },
  }]);
  assert.deepEqual(detail.responseFields, [{
    alias: 'acctNo', description: '계좌번호', required: false,
  }]);
  assert.deepEqual(Object.keys(detail).sort(), [
    'canvasId', 'catalogVersion', 'domain', 'execution', 'executionPolicy',
    'fetchedAt', 'kind', 'name', 'notice', 'operationRef', 'optionalArguments',
    'requiredArguments', 'responseFields', 'schemaVersion', 'title',
  ]);
  assert.deepEqual(Object.keys(detail.requiredArguments[0]).sort(), [
    'alias', 'description', 'jsonSchema', 'required',
  ]);
  assert.equal(Buffer.byteLength(JSON.stringify(detail), 'utf8') < 128 * 1024, true);
  assert.doesNotMatch(JSON.stringify(detail), /json_schema|execution_policy|policy_reasons/u);
});

test('bridge accepts only canonical string argument schemas and required-array polarity', async () => {
  const invalidSchemas = [
    undefined,
    {},
    { type: 'number' },
    { type: 'string', minLength: 1 },
    { type: 'string', unknown: true },
    { anyOf: [{ type: 'string' }, { type: 'null' }] },
    { anyOf: [{ type: 'string' }, { type: 'null' }], default: '' },
    { anyOf: [{ type: 'string' }, { type: 'string' }], default: null },
    { anyOf: [{ type: 'string' }, { type: 'null' }, { type: 'number' }], default: null },
    { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }], default: null },
    { anyOf: [{ type: 'string' }, { type: 'number' }], default: null },
    { anyOf: [{ type: 'string' }, { type: 'null' }], default: null, pattern: '.*' },
  ];

  for (const jsonSchema of invalidSchemas) {
    const supervisor = fakeSupervisor();
    const request = supervisor.request;
    supervisor.request = async (operation, payload) => {
      const value = await request(operation, payload);
      if (operation === 'describe') {
        if (jsonSchema === undefined) delete value.required_arguments[0].json_schema;
        else value.required_arguments[0].json_schema = jsonSchema;
      }
      return value;
    };
    await assert.rejects(new SourceBridge(supervisor).execute('describe', {
      operationRef: HIT.operation_ref,
      expectedCatalogVersion: CATALOG,
    }), { code: 'SOURCE_RESPONSE_INVALID' });
  }

  for (const [collection, required] of [
    ['required_arguments', false],
    ['optional_arguments', true],
  ]) {
    const supervisor = fakeSupervisor();
    const request = supervisor.request;
    supervisor.request = async (operation, payload) => {
      const value = await request(operation, payload);
      if (operation === 'describe') value[collection][0].required = required;
      return value;
    };
    await assert.rejects(new SourceBridge(supervisor).execute('describe', {
      operationRef: HIT.operation_ref,
      expectedCatalogVersion: CATALOG,
    }), { code: 'SOURCE_RESPONSE_INVALID' });
  }

  const extraFieldSupervisor = fakeSupervisor();
  const extraRequest = extraFieldSupervisor.request;
  extraFieldSupervisor.request = async (operation, payload) => {
    const value = await extraRequest(operation, payload);
    if (operation === 'describe') value.required_arguments[0].constraint = 'forbidden';
    return value;
  };
  await assert.rejects(new SourceBridge(extraFieldSupervisor).execute('describe', {
    operationRef: HIT.operation_ref,
    expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_RESPONSE_INVALID' });
});

test('bridge accepts catalog response aliases while rejecting unsafe identifiers', async () => {
  const accepted = await new SourceBridge(fakeSupervisor()).execute('describe', {
    operationRef: HIT.operation_ref,
    expectedCatalogVersion: CATALOG,
  });
  assert.equal(accepted.responseFields[0].alias, 'acctNo');

  for (const alias of ['-bad', 'bad-name', 'bad.name', 'bad name', '_bad', 'Bad', '한글']) {
    const supervisor = fakeSupervisor();
    const request = supervisor.request;
    supervisor.request = async (operation, payload) => {
      const value = await request(operation, payload);
      if (operation === 'describe') value.response_fields[0].alias = alias;
      return value;
    };
    await assert.rejects(new SourceBridge(supervisor).execute('describe', {
      operationRef: HIT.operation_ref,
      expectedCatalogVersion: CATALOG,
    }), { code: 'SOURCE_RESPONSE_INVALID' });
  }
});

test('bridge rejects transport shaping, arbitrary operations, and wider search limits before HTTP', async () => {
  const supervisor = fakeSupervisor();
  const bridge = new SourceBridge(supervisor);
  for (const [operation, input] of [
    ['search', { query: '현재가', limit: 6, expectedCatalogVersion: CATALOG }],
    ['search', {
      query: '현재가', limit: 2, expectedCatalogVersion: CATALOG,
      intent: 'order',
    }],
    ['search', {
      query: '현재가', limit: 2, expectedCatalogVersion: CATALOG,
      url: 'http://example.com',
    }],
    ['describe', {
      operationRef: 'base:../orders', expectedCatalogVersion: CATALOG,
    }],
    ['describe', {
      operationRef: HIT.operation_ref, expectedCatalogVersion: 'latest',
    }],
    ['call', { operationRef: HIT.operation_ref }],
  ]) {
    await assert.rejects(bridge.execute(operation, input), (error) => {
      assert.match(error.code, /^SOURCE_(?:REQUEST_INVALID|OPERATION_NOT_ALLOWED)$/u);
      return true;
    });
  }
  assert.equal(supervisor.calls.length, 0);
});

test('bridge validates catalog identity and rejects every non-query hit', async () => {
  const changed = `sha256:${'c'.repeat(64)}`;
  const catalogBridge = new SourceBridge(fakeSupervisor({
    search: { catalog_version: changed, results: [], semantic_ranking: null },
  }));
  await assert.rejects(catalogBridge.execute('search', {
    query: '현재가', limit: 2, expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_CATALOG_CHANGED' });

  const nonQuery = structuredClone(HIT);
  nonQuery.kind = 'order';
  const queryOnlyBridge = new SourceBridge(fakeSupervisor({
    search: { catalog_version: CATALOG, results: [nonQuery], semantic_ranking: null },
  }));
  await assert.rejects(queryOnlyBridge.execute('search', {
    query: '현재가', limit: 2, expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_NON_QUERY_RESULT' });
});

test('bridge rejects oversized source metadata instead of silently truncating it', async () => {
  const tooManyFields = Array.from({ length: 129 }, (_, index) => ({
    alias: `field_${index}`,
    description: null,
    required: false,
  }));
  const supervisor = fakeSupervisor({
    describe: {
      catalog_version: CATALOG,
      operation_ref: HIT.operation_ref,
      kind: 'query',
      domain: 'stockinfo',
      name: '주식기본정보요청',
      group_id: null,
      group_title_ko: null,
      group_title_en: null,
      layout: 'facts',
      execution_policy: 'selector_detail',
      required_arguments: [],
      optional_arguments: [],
      response_fields: tooManyFields,
    },
  });
  const bridge = new SourceBridge(supervisor);
  await assert.rejects(bridge.execute('describe', {
    operationRef: HIT.operation_ref,
    expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_RESPONSE_INVALID' });
});

test('bridge forwards cancellation and maps backend errors without sensitive diagnostics', async () => {
  const supervisor = fakeSupervisor();
  const controller = new AbortController();
  const bridge = new SourceBridge({
    ...supervisor,
    request: async () => {
      throw new BackendSupervisorError('BACKEND_CANCELLED', 'Backend operation was cancelled.');
    },
  });
  controller.abort();
  await assert.rejects(
    bridge.execute('health', {}, { signal: controller.signal }),
    (error) => {
      assert.equal(error.code, 'BACKEND_CANCELLED');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(`${error.message}${error.stack}`, /https?:\/\/|Bearer|token|stderr/iu);
      return true;
    },
  );
});

test('bridge rejects invalid clocks and source arrays beyond the canonical bounds', async () => {
  const invalidClock = new SourceBridge(fakeSupervisor(), { now: () => Number.NaN });
  await assert.rejects(invalidClock.execute('search', {
    query: '현재가', limit: 1, expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_CLOCK_INVALID' });

  const requiredArguments = Array.from({ length: 65 }, (_, index) => ({
    alias: `arg_${index}`, description: null, required: true,
  }));
  const supervisor = fakeSupervisor();
  const originalRequest = supervisor.request;
  supervisor.request = async (operation, payload) => {
    const value = await originalRequest(operation, payload);
    if (operation === 'describe') value.required_arguments = requiredArguments;
    return value;
  };
  const bridge = new SourceBridge(supervisor);
  await assert.rejects(bridge.execute('describe', {
    operationRef: HIT.operation_ref,
    expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_RESPONSE_INVALID' });
});

test('bridge preserves source text while rejecting sparse arrays and oversized serialized cards', async () => {
  const spacedHit = structuredClone(HIT);
  spacedHit.name = ` ${spacedHit.name} `;
  const spacedBridge = new SourceBridge(fakeSupervisor({
    search: { catalog_version: CATALOG, results: [spacedHit] },
  }));
  const spacedCard = await spacedBridge.execute('search', {
    query: '현재가', limit: 1, expectedCatalogVersion: CATALOG,
  });
  assert.equal(spacedCard.items[0].name, spacedHit.name);

  const sparseResults = [];
  sparseResults.length = 1;
  const sparseBridge = new SourceBridge(fakeSupervisor({
    search: { catalog_version: CATALOG, results: sparseResults },
  }));
  await assert.rejects(sparseBridge.execute('search', {
    query: '현재가', limit: 1, expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_RESPONSE_INVALID' });

  const responseFields = Array.from({ length: 128 }, (_, index) => ({
    alias: `field_${index}`,
    description: 'x'.repeat(1_000),
    required: false,
  }));
  const supervisor = fakeSupervisor();
  const originalRequest = supervisor.request;
  supervisor.request = async (operation, payload) => {
    const value = await originalRequest(operation, payload);
    if (operation === 'describe') value.response_fields = responseFields;
    return value;
  };
  const oversizedBridge = new SourceBridge(supervisor);
  await assert.rejects(oversizedBridge.execute('describe', {
    operationRef: HIT.operation_ref,
    expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_RESPONSE_TOO_LARGE' });

  const nonNumericClock = new SourceBridge(fakeSupervisor(), {
    now: () => '2026-02-30T00:00:00.000Z',
  });
  await assert.rejects(nonNumericClock.execute('search', {
    query: '현재가', limit: 1, expectedCatalogVersion: CATALOG,
  }), { code: 'SOURCE_CLOCK_INVALID' });
});

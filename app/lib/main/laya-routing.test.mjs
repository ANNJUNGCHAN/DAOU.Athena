import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLayaRouting, isLayaEnabled } = require('./laya-routing');
const candidates = [{ id: 'candidate_1', label: '시세' }, { id: 'candidate_2', label: '일봉' }];
const input = { text: '종목 차트', candidates };

test('explicit activation is required; disabled means no selection callback', () => {
  for (const value of [undefined, '', '0', 'false', 'off', 'no', 'enabled']) assert.equal(isLayaEnabled({ ATHENA_LAYA_ENABLED: value }), false);
  for (const value of ['1', 'true', 'on', 'yes', ' TRUE ']) assert.equal(isLayaEnabled({ ATHENA_LAYA_ENABLED: value }), true);
});

function client(fetchImpl, options = {}) {
  return createLayaRouting({ getBackendUrl: () => 'http://127.0.0.1:9000',
    getBearerToken: () => 'synthetic-test-token', fetchImpl, ...options });
}
const accepted = (task = 'operation_selection', choice = 'candidate_2') => ({ status: 'accepted', task, choice, confidence: 0.95, reason: 'not forwarded' });

test('authenticated loopback request accepts only the requested finite decision', async () => {
  const api = client(async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:9000/api/v1/laya/decide');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test-token');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { task: 'operation_selection', ...input });
    return { ok: true, json: async () => accepted() };
  });
  assert.deepEqual(await api.operation_selection(input), { task: 'operation_selection', choice: 'candidate_2', confidence: 0.95 });
});

test('fallback, malformed and out-of-task/out-of-choice responses preserve the CLI path', async () => {
  for (const result of [null, { ...accepted(), status: 'fallback' }, accepted('card_display'), accepted('operation_selection', 'place_order'), { ...accepted(), confidence: NaN }]) {
    assert.equal(await client(async () => ({ ok: true, json: async () => result })).operation_selection(input), null);
  }
});

test('candidate contract and loopback credential boundary reject before fetch', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error('unexpected request'); };
  assert.equal(await client(fetchImpl).operation_selection({ ...input, candidates: [candidates[0]] }), null);
  assert.equal(await client(fetchImpl).operation_selection({ ...input, candidates: [candidates[0], candidates[0]] }), null);
  assert.equal(await client(fetchImpl, { getBackendUrl: () => 'https://example.test' }).operation_selection(input), null);
  assert.equal(calls, 0);
});

test('candidate labels and descriptions conform to the backend length limits', async () => {
  const api = client(async (_url, init) => {
    const sent = JSON.parse(init.body).candidates;
    assert.equal(sent[0].label.length, 160);
    assert.equal(sent[0].description.length, 500);
    return { ok: true, json: async () => accepted() };
  });
  await api.operation_selection({ ...input, candidates: [{ ...candidates[0], label: 'x'.repeat(200), description: 'y'.repeat(700) }, candidates[1]] });
});

test('timeout bounds even a fetch that ignores its AbortSignal', async () => {
  assert.equal(await client(() => new Promise(() => {}), { timeoutMs: 5 }).operation_selection(input), null);
});

test('user cancellation and stale responses cannot become accepted fallback work', async () => {
  const controller = new AbortController();
  const api = client(() => new Promise(() => {}));
  const pending = api.operation_selection({ ...input, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  let current = true;
  const late = client(async () => { current = false; return { ok: true, json: async () => accepted() }; });
  await assert.rejects(late.operation_selection({ ...input, isCurrent: () => current }), { name: 'AbortError' });
});

function acceptedCatalog() {
  const symbol = { type: 'string', pattern: '^\\d{6}$' };
  return { status: 'accepted', task: 'operation_selection', choice: 'base:ka10046', confidence: 0.96,
    catalog_version: 'all-operations-v1', considered_count: 266, evaluated_count: 266, question_count: 306,
    candidate: { operation_ref: 'base:ka10046', kind: 'query', name: '체결강도 시간별 조회', detail_group: null,
      required_arguments: [{ alias: 'symbol', required: true, json_schema: symbol }],
      argument_contracts: { type: 'object', properties: { symbol, limit: { type: 'integer' } },
        required: ['symbol'], additionalProperties: false } }, reason: 'not forwarded' };
}
const catalogInput = { text: '시간별 체결강도', catalog_version: 'all-operations-v1' };

test('full-catalog request sends only text and version; backend supplies an operation and complete contract', async () => {
  const response = acceptedCatalog();
  const api = client(async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:9000/api/v1/laya/select-operation');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-test-token');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), catalogInput);
    return { ok: true, json: async () => response };
  });
  const selected = await api.select_catalog_operation({ ...catalogInput, candidates });
  assert.equal(selected.choice, 'base:ka10046');
  assert.deepEqual(selected.candidate.argument_contracts.properties.limit, { type: 'integer' });
  assert.equal(Object.hasOwn(selected, 'reason'), false);
});

test('full-catalog selection requires complete coverage, matching version, and a read-only contract', async () => {
  const changes = [
    (r) => { r.status = 'fallback'; },
    (r) => { r.task = 'card_display'; },
    (r) => { r.catalog_version = 'older-version'; },
    (r) => { r.evaluated_count = 265; },
    (r) => { r.considered_count = r.evaluated_count = 0; },
    (r) => { r.question_count = 0; },
    (r) => { r.choice = 'base:ka10003'; },
    (r) => { r.confidence = NaN; },
    (r) => { r.candidate = null; },
    (r) => { delete r.candidate.argument_contracts; },
    (r) => { r.candidate.argument_contracts.additionalProperties = true; },
    (r) => { r.candidate.argument_contracts.required = ['missing']; },
    (r) => { r.candidate.required_arguments = []; },
    (r) => { r.choice = r.candidate.operation_ref = 'base:kt10000'; r.candidate.kind = 'order'; },
    (r) => { r.choice = r.candidate.operation_ref = 'base:ka10173'; r.candidate.kind = 'websocket'; },
    (r) => { r.choice = r.candidate.operation_ref = 'websocket:0B'; },
    (r) => { r.choice = r.candidate.operation_ref = 'detail:ka10007:prices'; r.candidate.detail_group = 'volume'; },
  ];
  for (const change of changes) {
    const response = acceptedCatalog();
    change(response);
    const api = client(async () => ({ ok: true, json: async () => response }));
    assert.equal(await api.select_catalog_operation(catalogInput), null, change.toString());
  }
});

test('only the two read-only condition websocket references are eligible', async () => {
  for (const ref of ['base:ka10171', 'base:ka10172']) {
    const response = acceptedCatalog();
    response.choice = response.candidate.operation_ref = ref;
    response.candidate.kind = 'websocket';
    const api = client(async () => ({ ok: true, json: async () => response }));
    assert.equal((await api.select_catalog_operation(catalogInput)).choice, ref);
  }
});

test('full-catalog timeout bounds stalled fetch and stalled JSON response', async () => {
  for (const fetchImpl of [() => new Promise(() => {}), async () => ({ ok: true, json: () => new Promise(() => {}) })]) {
    const api = client(fetchImpl, { fullCatalogTimeoutMs: 5 });
    assert.equal(await api.select_catalog_operation(catalogInput), null);
  }
});

test('full-catalog response cannot survive cancellation or a replaced turn', async () => {
  const controller = new AbortController();
  const pending = client(() => new Promise(() => {})).select_catalog_operation({ ...catalogInput, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  let current = true;
  const api = client(async () => { current = false; return { ok: true, json: async () => acceptedCatalog() }; });
  await assert.rejects(api.select_catalog_operation({ ...catalogInput, isCurrent: () => current }), { name: 'AbortError' });
});

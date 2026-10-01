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

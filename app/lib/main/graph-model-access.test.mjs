import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import access from './graph-model-access.js';

function deps(enabled = true, backendEnabled = true) {
  return { readPreferences: () => ({ exposeToModel: enabled }),
    getBackendUrl: () => 'http://127.0.0.1:1', getBearerToken: () => 'synthetic-test-token',
    fetchImpl: async () => ({ ok: true, json: async () => ({ enabled: backendEnabled }) }),
  };
}

test('disabled preference blocks without network; non-graph modes remain available', async () => {
  const d = deps(false);
  d.fetchImpl = () => assert.fail('disabled exposure cannot contact backend');
  assert.equal((await access.checkGraphModelAccess('graph', d)).code, 'GRAPH_MODEL_EXPOSURE_DISABLED');
  for (const mode of ['summary', 'agent', 'backtest', 'plugin']) {
    assert.equal(await access.checkGraphModelAccess(mode, d), null);
  }
});

test('effective backend denial or failure is not mislabeled as a user preference', async () => {
  for (const response of [
    { ok: true, json: async () => ({ enabled: false }) },
    { ok: false },
    { ok: true, json: async () => ({}) },
  ]) {
    assert.equal((await access.checkGraphModelAccess('graph', { ...deps(), fetchImpl: async () => response })).code,
      'GRAPH_MODEL_EXPOSURE_UNAVAILABLE');
  }
  const d = deps();
  d.fetchImpl = async () => { throw new Error('synthetic failure'); };
  assert.equal((await access.checkGraphModelAccess('graph', d)).code, 'GRAPH_MODEL_EXPOSURE_UNAVAILABLE');
});

test('read-only authenticated check permits only both enabled states and catches a preference change', async () => {
  let enabled = true;
  const d = deps();
  d.readPreferences = () => ({ exposeToModel: enabled });
  d.fetchImpl = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:1/api/v1/settings/expose-to-model');
    assert.equal(options.method, undefined);
    assert.equal(options.headers.Authorization, 'Bearer synthetic-test-token');
    assert.equal(options.body, undefined);
    return { ok: true, json: async () => ({ enabled: true }) };
  };
  assert.equal(await access.checkGraphModelAccess('graph', d), null);
  d.fetchImpl = async () => { enabled = false; return { ok: true, json: async () => ({ enabled: true }) }; };
  assert.equal((await access.checkGraphModelAccess('graph', d)).code, 'GRAPH_MODEL_EXPOSURE_DISABLED');
});

test('main stops a denied graph turn before runtime, prompt construction or model access', async () => {
  const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function runLiveQueryInnerBody(');
  const end = source.indexOf('  const runtime = liveRuntimes.get(turnConversationId);', start);
  const body = source.slice(start, end) + '\n throw new Error("reached model path");\n}';
  const blocked = { code: 'GRAPH_MODEL_EXPOSURE_DISABLED' };
  const ctx = vm.createContext({ performance: { now: () => 0 },
    liveSubmitContexts: new Map([['test', { canvasMode: 'graph', graphContext: { selected: { name: 'PRIVATE_SYNTHETIC' } } }]]),
    prefs: { get: () => ({ exposeToModel: false }) }, historySink: {},
    require: () => ({ checkGraphModelAccess: async () => blocked }),
  });
  vm.runInContext(body, ctx);
  assert.equal(await ctx.runLiveQueryInnerBody('question', false, 'shell', 'test', 'msg'), blocked);
});

test('backend readiness awaits exposure synchronization without requiring extraction readiness', async () => {
  const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function ensureBackendStrict(');
  const end = source.indexOf('\nlet backendRecoveryPromise', start);
  const calls = [];
  let release;
  const synced = new Promise((resolve) => { release = resolve; });
  const ctx = vm.createContext({
    backendLauncher: { ensureBackendReady: async () => ({ ok: true, ready: true, backendUrl: 'http://127.0.0.1:1' }) },
    isQuitting: false, mdlog: () => {},
    applyBackendEndpoint: () => calls.push('endpoint'),
    configureConversationGraphPipeline: () => calls.push('pipeline'),
    historySink: { pushExposeToModel: async () => { calls.push('exposure'); return synced; } },
  });
  vm.runInContext(source.slice(start, end), ctx);
  let finished = false;
  const ready = ctx.ensureBackendStrict({ update() {} }).then(() => { finished = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['endpoint', 'pipeline', 'exposure']);
  assert.equal(finished, false, 'model exposure is synchronized before backend readiness returns');
  release(true);
  await ready;
  assert.equal(finished, true);
});

function loadExposureWriter(fetchImpl, readPreferences, timeout = () => new AbortController().signal) {
  const source = fs.readFileSync(new URL('./history-sink.js', import.meta.url), 'utf8');
  const start = source.indexOf('let exposureSyncPending =');
  const end = source.indexOf('\nfunction isBrainReadyCached()', start);
  const ctx = vm.createContext({ Promise, fetch: fetchImpl,
    prefs: { get: readPreferences }, getBearerToken: () => 'synthetic-token',
    getBackendUrl: () => 'http://127.0.0.1:1', AbortSignal: { timeout },
  });
  vm.runInContext(source.slice(start, end), ctx);
  return ctx.pushExposeToModel;
}

test('saved exposure synchronization serializes startup and user off without overwriting newer choice', async () => {
  let enabled = true;
  let release;
  const firstResponse = new Promise((resolve) => { release = resolve; });
  const writes = [];
  const push = loadExposureWriter(async (_url, options) => {
    writes.push(JSON.parse(options.body).enabled);
    return writes.length === 1 ? firstResponse : { ok: true };
  }, () => ({ exposeToModel: enabled }));
  const startup = push();
  await new Promise((resolve) => setImmediate(resolve));
  enabled = false;
  const userChange = push();
  assert.deepEqual(writes, [true], 'newer setting waits for the older request');
  release({ ok: true });
  assert.equal(await startup, true);
  assert.equal(await userChange, true);
  assert.deepEqual(writes, [true, false], 'the final backend value preserves user off');
  await push();
  assert.deepEqual(writes, [true, false, false], 'later startup retries also preserve off');
});

test('exposure write is bounded and timeout leaves graph model access closed', async () => {
  let timeoutMs;
  const push = loadExposureWriter(async () => { throw new Error('synthetic timeout'); },
    () => ({ exposeToModel: true }), (ms) => { timeoutMs = ms; return new AbortController().signal; });
  assert.equal(await push(), false);
  assert.equal(timeoutMs, 5000);
  assert.equal((await access.checkGraphModelAccess('graph', deps(true, false))).code,
    'GRAPH_MODEL_EXPOSURE_UNAVAILABLE');
});

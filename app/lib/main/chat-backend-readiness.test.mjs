import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const start = source.indexOf('async function runLiveQuery(');
const end = source.indexOf('// origin —', start);
assert.ok(start >= 0 && end > start);

function harness(state = 'running') {
  const events = [];
  let endpoint = null;
  const context = {
    isQuitting: false,
    backendEndpoint: { getBackendUrl: () => endpoint },
    startupReadiness: { snapshot: () => ({ tasks: [{ id: 'backend', state }] }) },
    historySink: { saveChatMessage: () => { events.push('save'); return {}; } },
    emitHistorySaveFailed() {}, mdlog() {},
    touchConversationEntry: () => events.push('touch'),
    beginSessionTurn: () => null,
    liveRuntimes: { get: () => ({ busyDepth: 0 }) },
    liveQueryBusyDepth: 0,
    broadcastLiveQueryBusy() {},
    liveSubmitContexts: new Map(),
    activeCardQna: { deleteSubmitContextIfSame() {} },
    runLiveQueryInner: async () => { events.push('query'); return { ok: true }; },
  };
  const run = vm.runInNewContext(`${source.slice(start, end)}\nrunLiveQuery`, context);
  return { run: () => run('synthetic question', false, 'shell', 'synthetic-chat'), events, ready: () => { endpoint = 'http://127.0.0.1:32100'; } };
}

for (const state of ['pending', 'running', 'retrying', 'failed']) {
  test(`chat with backend ${state} returns guidance before starting a persisted turn`, async () => {
    const h = harness(state);
    const result = await h.run();
    assert.equal(result.ok, false);
    assert.equal(result.type, 'action-needed');
    assert.match(result.code, /^BACKEND_/);
    assert.match(result.error, state === 'failed' ? /다시 실행/ : /준비|복구/);
    assert.deepEqual(h.events, []);
  });
}

test('chat resumes through the existing path once backend is ready', async () => {
  const h = harness('failed');
  assert.equal((await h.run()).ok, false);
  h.ready();
  assert.equal((await h.run()).ok, true);
  assert.deepEqual(h.events, ['save', 'touch', 'query']);
});

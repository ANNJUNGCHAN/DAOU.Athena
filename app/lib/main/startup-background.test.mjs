import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { StartupReadiness, runStartupOrchestration } = require('./startup-readiness.js');
const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const tasksSource = source.slice(source.indexOf('const BOOT_TASKS = ['), source.indexOf('const startupFailureNotifier'));
const bootSource = source.slice(source.indexOf('async function startLiveBoot('), source.indexOf('let fixtureBootStarted'));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function harness({ backendFails = false, ingestionFails = false } = {}) {
  const tasks = vm.runInNewContext(`${tasksSource}\nBOOT_TASKS`);
  const readiness = new StartupReadiness({ tasks });
  const backend = deferred();
  const ingestion = deferred();
  const projection = deferred();
  const calls = [];
  const context = {
    startupReadiness: readiness, runStartupOrchestration,
    registerLiveBootRunners() {
      for (const task of tasks) readiness.setRunner(task.id, async () => {
        calls.push(task.id);
        if (task.id === 'backend') { await backend.promise; if (backendFails) throw new Error('backend unavailable'); }
        if (task.id === 'brain-ingestion') { await ingestion.promise; if (ingestionFails) throw new Error('ingestion unavailable'); }
        if (task.id === 'graph-projection') await projection.promise;
      });
      readiness.disable('fixture-readiness');
    },
    startHourlyConversationGraphRefresh() { calls.push('hourly'); },
    startConversationGraphObserver() { calls.push('observer'); },
    conversationGraphScheduleOwner: 'test', mdlog() {},
  };
  const start = vm.runInNewContext(`${bootSource}\nstartLiveBoot`, context);
  return { readiness, backend, ingestion, projection, calls, start };
}

test('shell readiness waits for backend/security gates but not ingestion or projection', async () => {
  const h = harness();
  let returned = false;
  const boot = h.start().then(() => { returned = true; });
  await tick();
  assert.equal(returned, false);
  assert.equal(h.readiness.snapshot().phase, 'running');
  assert.equal(h.calls.includes('mcp-env'), false);
  assert.equal(h.calls.includes('brain-ingestion'), false);
  h.backend.resolve();
  await boot;
  assert.equal(h.readiness.snapshot().phase, 'ready');
  assert.ok(h.calls.indexOf('provider-warm') > h.calls.indexOf('mcp-env'));
  assert.equal(h.readiness.snapshot().tasks.find(t => t.id === 'brain-ingestion').state, 'running');
  assert.equal(h.readiness.snapshot().tasks.find(t => t.id === 'graph-projection').state, 'pending');
  assert.equal(h.calls.includes('hourly'), false);
  h.ingestion.resolve();
  await tick();
  assert.ok(h.calls.indexOf('graph-projection') > h.calls.indexOf('chat-history-flush'));
  assert.equal(h.calls.includes('hourly'), false);
  h.projection.resolve();
  await tick();
  assert.equal(h.readiness.snapshot().tasks.find(t => t.id === 'graph-projection').state, 'succeeded');
  assert.deepEqual(h.calls.slice(-2), ['hourly', 'observer']);
});

test('backend failure disables optional work and does not start graph observers', async () => {
  const h = harness({ backendFails: true });
  const boot = h.start();
  h.backend.resolve();
  await boot;
  const snapshot = h.readiness.snapshot();
  assert.equal(snapshot.phase, 'degraded');
  for (const id of ['brain-ingestion', 'chat-history-flush', 'graph-projection']) {
    assert.equal(snapshot.tasks.find(t => t.id === id).state, 'disabled');
    assert.equal(h.calls.includes(id), false);
  }
  assert.equal(h.calls.includes('hourly'), false);
});

test('background failure remains explicit instead of claiming feature readiness', async () => {
  const h = harness({ ingestionFails: true });
  const boot = h.start();
  h.backend.resolve();
  await boot;
  h.ingestion.resolve();
  await tick();
  const snapshot = h.readiness.snapshot();
  assert.equal(snapshot.phase, 'ready');
  assert.equal(snapshot.tasks.find(t => t.id === 'brain-ingestion').state, 'failed');
  assert.equal(snapshot.tasks.find(t => t.id === 'brain-ingestion').detail, 'ingestion unavailable');
  assert.equal(snapshot.tasks.find(t => t.id === 'graph-projection').state, 'running');
  h.projection.resolve();
  await tick();
});

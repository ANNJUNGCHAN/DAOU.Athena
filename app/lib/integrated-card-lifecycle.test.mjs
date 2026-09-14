import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
function between(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

function fixture(invoke) {
  const root = { isConnected: true, realtime: {}, querySelector: () => null };
  const tasks = new Map();
  const calls = [];
  const context = vm.createContext({
    root,
    rendererRealtimeAccountGeneration: 1,
    window: { athena: { invoke: async (channel, payload) => {
      calls.push({ channel, payload });
      return invoke(channel, payload);
    } } },
    integratedRealtimePayload: () => ({ leaseId: 'card-1', target: '005930' }),
    integratedRealtimeMeta: (card) => card.realtime,
    integratedRealtimeTasks: tasks,
    integratedCardSurface: {
      normalizeIdentity: (value) => value,
      requireRealtimeSuccess: (state) => { if (!state?.ok) throw new Error('REG failed'); },
      clearPanelSessions() {},
    },
    realtimePolicies: async () => [{}],
    hasRealtimePolicy: () => true,
    surfaceContractOf: () => ({}),
    stampBoardRealtimeStatus() {},
    syncCardRealtimeFallback() {},
    showIntegratedRealtimeError: (card) => { card.hasError = true; },
    clearIntegratedRealtimeError: (card) => { card.hasError = false; },
    cardDestroyers: new Map(),
    integratedPanelDestroyers: new Map(),
    panelDestroyers: new Map(),
    settleCleanup: (pending) => Promise.resolve(pending).catch(() => {}),
  });
  vm.runInContext([
    between('function stampIntegratedRealtimeState(', '// Paper 원문에'),
    between('function syncIntegratedRealtime(', 'function clearIntegratedRealtimeError('),
    between('  cardDestroyers.set(root, () => {', '  if (transientCard)'),
  ].join('\n'), context);
  return { root, tasks, calls, context };
}

test('closing a failed integrated mount cancels the main lease before later reconnect', async () => {
  const run = fixture(async (channel) => ({ ok: channel.endsWith('unmount') }));
  run.context.syncIntegratedRealtime(run.root, {});
  await run.tasks.get(run.root);
  assert.equal(run.root.hasError, true);
  run.root.isConnected = false;
  await run.context.cardDestroyers.get(run.root)();
  assert.deepEqual(run.calls.map(({ channel }) => channel), [
    'athena:integrated-card-realtime-mount', 'athena:integrated-card-realtime-unmount',
  ]);
});

test('failed in-flight mount is unmounted when the card closes before its reply', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const run = fixture((channel) => channel.endsWith('mount') && !channel.endsWith('unmount')
    ? pending : { ok: true });
  run.context.syncIntegratedRealtime(run.root, {});
  await new Promise((resolve) => setImmediate(resolve));
  run.root.isConnected = false;
  const cleanup = run.context.cardDestroyers.get(run.root)();
  finish({ ok: false, leaseId: 'card-1', status: 'error' });
  await cleanup;
  assert.equal(run.calls.filter(({ channel }) => channel.endsWith('unmount')).length, 1);
});

test('automatic recovery clears the error and records the active lease generations', () => {
  const run = fixture(async () => ({ ok: true }));
  run.root.hasError = true;
  run.context.stampIntegratedRealtimeState(run.root, {
    status: 'active', generation: 2, connectionGeneration: 3,
    bindings: [{ operationId: '0B' }],
  });
  assert.equal(run.root.hasError, false);
  assert.equal(run.root.realtime.mounted, true);
  assert.equal(run.root.realtime.generation, 2);
  assert.equal(run.root.realtime.connectionGeneration, 3);
});

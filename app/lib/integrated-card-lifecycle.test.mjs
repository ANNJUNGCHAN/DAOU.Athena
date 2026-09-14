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
    integratedRealtimePayload: (_root, envelope = {}) => ({
      leaseId: 'card-1', cardId: '137X-2', mode: envelope.mode || 'quote',
      target: envelope.target || '005930', symbol: envelope.target || '005930',
      verifiedOperationRefs: [envelope.operationRef || 'base:ka10001'], semanticBindingIds: [], visibleTargets: [],
    }),
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
    stampBoardRealtimeStatus(card, status) {
      const normalized = String(status || 'snapshot');
      if (['registering', 'connecting', 'reconnecting', 'disconnected', 'stopped', 'error'].includes(normalized)) {
        card.__athenaBoardRealtimeReceived = false;
      } else if (normalized === 'receiving') card.__athenaBoardRealtimeReceived = true;
      card.displayedRealtimeStatus = card.__athenaBoardRealtimeReceived
        && ['live', 'active', 'connected', 'reconnected'].includes(normalized)
        ? 'receiving' : normalized;
    },
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

test('same integrated identity refresh preserves receiving after a valid tick', async () => {
  const run = fixture(async () => ({
    ok: true, status: 'active', generation: 1, connectionGeneration: 1,
    bindings: [{ operationId: '0B' }],
  }));
  run.context.syncIntegratedRealtime(run.root, {
    mode: 'chart', target: '005930', operationRef: 'base:ka10080',
  });
  await run.tasks.get(run.root);
  run.context.stampBoardRealtimeStatus(run.root, 'receiving');
  assert.equal(run.root.displayedRealtimeStatus, 'receiving');

  run.context.syncIntegratedRealtime(run.root, {
    mode: 'chart', target: '005930', operationRef: 'base:ka10081',
  });
  await run.tasks.get(run.root);
  assert.equal(run.root.__athenaBoardRealtimeReceived, true);
  assert.equal(run.root.displayedRealtimeStatus, 'receiving');
});

test('new integrated identity clears receiving until that subscription gets a tick', async () => {
  let generation = 0;
  const run = fixture(async () => ({
    ok: true, status: 'active', generation: ++generation, connectionGeneration: 1,
    bindings: [{ operationId: generation === 1 ? '0B' : '0J' }],
  }));
  run.context.syncIntegratedRealtime(run.root, { mode: 'quote', target: '005930' });
  await run.tasks.get(run.root);
  run.context.stampBoardRealtimeStatus(run.root, 'receiving');

  run.context.syncIntegratedRealtime(run.root, { mode: 'quote', target: '000660' });
  await run.tasks.get(run.root);
  assert.equal(run.root.__athenaBoardRealtimeReceived, false);
  assert.equal(run.root.displayedRealtimeStatus, 'active');
});

test('same identity after a failed state cannot restore an old receiving label', async () => {
  const run = fixture(async () => ({
    ok: true, status: 'active', generation: 2, connectionGeneration: 2,
    bindings: [{ operationId: '0B' }],
  }));
  const envelope = { mode: 'quote', target: '005930' };
  run.context.syncIntegratedRealtime(run.root, envelope);
  await run.tasks.get(run.root);
  run.context.stampBoardRealtimeStatus(run.root, 'receiving');
  run.root.realtime.status = 'reconnecting';
  run.context.stampBoardRealtimeStatus(run.root, 'reconnecting');

  run.context.syncIntegratedRealtime(run.root, envelope);
  await run.tasks.get(run.root);
  assert.equal(run.root.__athenaBoardRealtimeReceived, false);
  assert.equal(run.root.displayedRealtimeStatus, 'active');
});

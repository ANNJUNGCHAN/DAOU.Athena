import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const canvasSource = fs.readFileSync(path.join(here, '..', 'canvas.js'), 'utf8');

function functionSource(name) {
  const asyncStart = canvasSource.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : canvasSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const brace = canvasSource.indexOf('{', canvasSource.indexOf(') {', start));
  let depth = 0;
  for (let index = brace; index < canvasSource.length; index += 1) {
    if (canvasSource[index] === '{') depth += 1;
    if (canvasSource[index] === '}') depth -= 1;
    if (depth === 0) return canvasSource.slice(start, index + 1);
  }
  throw new Error(`${name} body did not close`);
}

test('first fallback registration obtains the authoritative account generation before register', async () => {
  const calls = [];
  const context = vm.createContext({
    Promise,
    window: {
      athena: {
        invoke: async (channel) => {
          calls.push(channel);
          return { ok: true, accountGeneration: 1 };
        },
      },
    },
    rendererRealtimeAccountGeneration: 0,
    rendererRealtimeGenerationRequest: null,
  });
  vm.runInContext(`${functionSource('acceptRendererRealtimeGeneration')}\n${functionSource('ensureRendererRealtimeGeneration')}`, context);
  const ensure = vm.runInContext('ensureRendererRealtimeGeneration', context);
  assert.equal(await ensure(), 1);
  assert.deepEqual(calls, ['athena:realtime-generation']);
  assert.equal(vm.runInContext('rendererRealtimeAccountGeneration', context), 1);
  assert.equal(await ensure(), 1);
  assert.equal(calls.length, 1);

  const sync = functionSource('syncCardRealtimeFallback');
  assert.ok(sync.indexOf('ensureRendererRealtimeGeneration()') < sync.indexOf("window.athena.invoke('athena:realtime-fallback-register'"));
});

test('authoritative generation bootstrap cannot overwrite a newer account reset', async () => {
  let resolveGeneration;
  const context = vm.createContext({
    Promise,
    window: {
      athena: {
        invoke: () => new Promise((resolve) => { resolveGeneration = resolve; }),
      },
    },
    rendererRealtimeAccountGeneration: 0,
    rendererRealtimeGenerationRequest: null,
  });
  vm.runInContext(`${functionSource('acceptRendererRealtimeGeneration')}\n${functionSource('ensureRendererRealtimeGeneration')}`, context);
  const pending = vm.runInContext('ensureRendererRealtimeGeneration()', context);
  vm.runInContext('acceptRendererRealtimeGeneration(2)', context);
  resolveGeneration({ ok: true, accountGeneration: 1 });
  assert.equal(await pending, 2);
  assert.equal(vm.runInContext('rendererRealtimeAccountGeneration', context), 2);
});

test('REG failure queues before fallback registration and an old relay cannot signal a new owner', async () => {
  const calls = [];
  const context = vm.createContext({
    window: { athena: { invoke: async (channel, payload) => { calls.push({ channel, payload }); return true; } } },
  });
  vm.runInContext(`${functionSource('relayCardRealtimeFallbackStatus')}\n${functionSource('installCardRealtimeStatusRelay')}`, context);
  const install = vm.runInContext('installCardRealtimeStatusRelay', context);
  const direct = vm.runInContext('relayCardRealtimeFallbackStatus', context);
  const card = {};
  const wsRelay = install(card);

  assert.equal(wsRelay('error'), false);
  assert.equal(card.__athenaPendingRealtimeFallbackState, 'error');
  card.__athenaRealtimeFallback = {
    ownerId: 'owner-old', active: true, accountGeneration: 1,
    registrationRevision: 1, sourceEpoch: 0, ownerEpoch: 0,
  };
  assert.equal(direct(card, card.__athenaPendingRealtimeFallbackState), true);
  delete card.__athenaPendingRealtimeFallbackState;
  assert.equal(wsRelay('active'), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((entry) => [entry.channel, entry.payload.ownerId, entry.payload.state]), [
    ['athena:realtime-fallback-status', 'owner-old', 'error'],
    ['athena:realtime-fallback-status', 'owner-old', 'active'],
  ]);

  card.__athenaRealtimeFallback = {
    ownerId: 'owner-new', active: true, accountGeneration: 1,
    registrationRevision: 2, sourceEpoch: 0, ownerEpoch: 0,
  };
  assert.equal(wsRelay('error'), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
});

test('fallback visibility is sent only after registration and follows the current card state', async () => {
  const calls = [];
  const context = vm.createContext({
    window: { athena: { invoke: async (channel, payload) => { calls.push({ channel, payload }); return true; } } },
  });
  vm.runInContext(functionSource('setRealtimeFallbackVisibility'), context);
  const setVisible = vm.runInContext('setRealtimeFallbackVisibility', context);
  const session = { ownerId: 'owner-1', active: true, visible: true, accountGeneration: 1, registrationRevision: null };
  assert.equal(setVisible(session, false), true);
  assert.equal(calls.length, 0);
  session.registrationRevision = 3;
  assert.equal(setVisible(session, false), false);
  assert.equal(calls.length, 0);
  assert.equal(setVisible(session, false, { force: true }), true);
  assert.equal(setVisible(session, true), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((entry) => [entry.channel, entry.payload.ownerId, entry.payload.visible]), [
    ['athena:realtime-fallback-visibility', 'owner-1', false],
    ['athena:realtime-fallback-visibility', 'owner-1', true],
  ]);
});

test('fallback events require exact owner, account generation, and registration revision', () => {
  const active = { ownerId: 'owner-1', active: true, accountGeneration: 7, registrationRevision: 3, sourceEpoch: 2, ownerEpoch: 1 };
  const context = vm.createContext({ realtimeFallbackSessions: new Map([['owner-1', active]]) });
  vm.runInContext(functionSource('realtimeFallbackSession'), context);
  const match = vm.runInContext('realtimeFallbackSession', context);
  const payload = (values = {}) => ({ ownerId: 'owner-1', accountGeneration: 7, registrationRevision: 3, sourceEpoch: 2, ownerEpoch: 1, ...values });
  assert.equal(match(payload()), active);
  assert.equal(match(payload({ accountGeneration: 6 })), null);
  assert.equal(match(payload({ registrationRevision: 2 })), null);
  assert.equal(match(payload({ sourceEpoch: 1 })), null);
  assert.equal(match(payload({ ownerEpoch: 0 })), null);
  assert.equal(match(payload({ sourceEpoch: 3 })), null);
  assert.equal(match(payload({ sourceEpoch: 3, ownerEpoch: 2 }), { advanceEpoch: true }), active);
  active.active = false;
  assert.equal(match(payload({ sourceEpoch: 3, ownerEpoch: 2 })), null);

  const next = { ownerId: 'owner-2', active: true, accountGeneration: 7, registrationRevision: 4, sourceEpoch: 0, ownerEpoch: 0 };
  context.realtimeFallbackSessions.delete('owner-1');
  context.realtimeFallbackSessions.set('owner-2', next);
  assert.equal(match(payload({ sourceEpoch: 3, ownerEpoch: 2 })), null, 'old owner event is fenced after re-registration');
  assert.equal(match({ ownerId: 'owner-2', accountGeneration: 7, registrationRevision: 4, sourceEpoch: 0, ownerEpoch: 0 }), next);
});

test('authoritative quote fallback updates the existing wrapper without replacing card identity', async () => {
  const moved = [{ value: '41,100' }];
  const wrapper = { isConnected: true, replaceChildren(...children) { this.children = children; } };
  const card = { dataset: { sessionCardId: 'card-stable' }, __athenaSessionCard: { envelope: { old: true } } };
  const nextEnvelope = { data: { fields: [{ key: 'price', value: 41100 }] } };
  const context = vm.createContext({
    window: { AthenaLib: { CardKinds: { resolve: () => () => ({ childNodes: moved }) } } },
    aitsChartPanels: {}, boardMount: {}, semanticWorkspace: {}, rendererRealtimeAccountGeneration: 7,
  });
  vm.runInContext(`${functionSource('replaceSpecializedFallbackBody')}\n${functionSource('applyRealtimeFallbackData')}`, context);
  const apply = vm.runInContext('applyRealtimeFallbackData', context);
  const session = { kind: 'quote', title: '시세', wrap: wrapper, card };
  assert.equal(await apply(session, {
    kind: 'quote', source: 'kiwoom-rest', transport: 'rest-fallback', envelope: nextEnvelope,
  }), true);
  assert.deepEqual(wrapper.children, moved);
  assert.equal(card.dataset.sessionCardId, 'card-stable');
  assert.equal(card.__athenaSessionCard.envelope, nextEnvelope);
});

test('chart fallback folds only the latest candle and preserves the mounted chart session', async () => {
  const calls = [];
  const active = { panelId: 'panel-1', generation: 9, body: { period: 'day', candles: [{ time: '2026-09-14', close: 40900 }] } };
  const aitsChartPanels = {
    snapshot: () => [active],
    async applyRealtimeTick(delta, context) { calls.push({ delta, context }); return true; },
  };
  const context = vm.createContext({
    window: { AthenaLib: { CardKinds: { resolve: () => null } } },
    aitsChartPanels, boardMount: {}, semanticWorkspace: {}, rendererRealtimeAccountGeneration: 7,
  });
  vm.runInContext(`${functionSource('replaceSpecializedFallbackBody')}\n${functionSource('applyRealtimeFallbackData')}`, context);
  const apply = vm.runInContext('applyRealtimeFallbackData', context);
  const session = { kind: 'chart', panelId: 'panel-1', symbol: '023590', interval: 1, accountGeneration: 7 };
  assert.equal(await apply(session, {
    kind: 'chart', source: 'kiwoom-rest', transport: 'rest-fallback', mode: 'replace-latest',
    panelId: 'panel-1', symbol: '023590', period: 'day', interval: 1,
    latestCandle: { time: '2026-09-14', close: 41100 },
  }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].delta.kind, 'update');
  assert.equal(calls[0].context.generation, 9);
  assert.equal(Object.hasOwn(aitsChartPanels, 'reloadPanel'), false);
});

test('integrated fallback accepts array and object slot patches only for registered slots', async () => {
  const host = {
    __athenaBoard: {
      boardId: '13BC-2', values: { price: 40900 }, valuesByBoard: new Map(),
    },
  };
  const card = { querySelector: () => host };
  const mounts = [];
  const boardMount = {
    mountBoard(_host, boardId, values) {
      mounts.push({ boardId, values: { ...values } });
      return {};
    },
  };
  const context = vm.createContext({
    window: { AthenaLib: { CardKinds: { resolve: () => null } } },
    aitsChartPanels: {}, boardMount, semanticWorkspace: {},
    boardMountOptions: () => ({}), rememberMountedBoard() {}, wireMountedBoardControls() {},
    mountBoardPrimary: async () => {}, rendererRealtimeAccountGeneration: 7,
  });
  vm.runInContext(`${functionSource('slotValuesOf')}\n${functionSource('replaceSpecializedFallbackBody')}\n${functionSource('applyRealtimeFallbackData')}`, context);
  const apply = vm.runInContext('applyRealtimeFallbackData', context);
  const session = { kind: 'integrated-board', card, slotIds: ['price', 'volume'], envelope: {} };
  const common = {
    kind: 'integrated-board', source: 'kiwoom-rest', transport: 'rest-fallback',
    mode: 'slot-patch', boardId: '13BC-2',
  };
  assert.equal(await apply(session, { ...common, slotValues: [{ slot_id: 'price', value: 41100 }] }), true);
  assert.equal(host.__athenaBoard.values.price, 41100);
  assert.equal(await apply(session, { ...common, slotValues: { volume: 321 } }), true);
  assert.equal(host.__athenaBoard.values.volume, 321);
  assert.equal(await apply(session, { ...common, slotValues: [{ slot_id: 'foreign', value: 1 }] }), false);
  assert.equal(mounts.length, 2);
});

test('integrated realtime payload keeps a dedicated verified index code alias', () => {
  const context = vm.createContext({
    integratedCardSurface: {
      targetIdentity: () => '', visibleTargetsFor: () => [], verifiedOperationRefsFor: () => ['base:ka20004'],
      realtimeEligibleFor: () => true,
    },
  });
  vm.runInContext(functionSource('integratedRealtimePayload'), context);
  const payload = vm.runInContext('integratedRealtimePayload', context)({
    dataset: { integratedInstanceKey: 'lease-1' }, __athenaSemanticRealtimeLeaseId: '',
  }, {
    card_id: '32S7', mode: 'chart', operation_args: { inds_cd: '001' },
  });
  assert.equal(payload.indexSectorId, '001');
  assert.equal(payload.sectorId, '');

  const signedCopy = vm.runInContext('integratedRealtimePayload', context)({
    dataset: { integratedInstanceKey: 'lease-2' }, __athenaSemanticRealtimeLeaseId: '',
  }, {
    card_id: '32S7', mode: 'chart', source_data: { canvas_context: { symbol: '101' } },
  });
  assert.equal(signedCopy.indexSectorId, '101');
});

test('fallback eligibility excludes actions and static semantic cards while recognizing realtime reads', () => {
  const semanticWorkspace = { isTaskCanvasEnvelope: (envelope) => envelope.task === true };
  const context = vm.createContext({ semanticWorkspace, realtimeBindingsOf: (envelope) => envelope.bindings || [] });
  vm.runInContext(`${functionSource('fallbackSurfaceKindFor')}\n${functionSource('fallbackKindFor')}`, context);
  const kind = vm.runInContext('fallbackKindFor', context);
  const card = ({ chart = false, board = false, capable = false, boundKind = '' } = {}) => ({
    dataset: { chartPanelId: chart ? 'panel-1' : '' },
    __athenaRealtimeFallbackCapable: capable,
    __athenaRealtimeFallbackKind: boundKind,
    querySelector: () => board ? {} : null,
  });
  assert.equal(kind(card(), { canvas_type: 'action', card_title: '주문' }), null);
  assert.equal(kind(card({ chart: true }), { canvas_type: 'chart' }), 'chart');
  assert.equal(kind(card({ board: true }), { canvas_type: 'facts' }), null);
  assert.equal(kind(card({ board: true, capable: true }), { canvas_type: 'facts' }), 'integrated-board');
  assert.equal(kind(card(), { canvas_type: 'facts', card_title: '시세' }), null);
  assert.equal(kind(card({ capable: true }), { canvas_type: 'facts', card_title: '시세' }), 'quote');
  assert.equal(kind(card({ capable: true }), { canvas_type: 'facts', card_title: '호가' }), 'orderbook');
  assert.equal(kind(card({ capable: true, boundKind: 'quote' }), { canvas_type: 'facts', card_title: '종목정보' }), 'quote');
  assert.equal(kind(card(), { canvas_type: 'facts', task: true }), null);
  assert.equal(kind(card(), { canvas_type: 'facts', task: true, bindings: [{ binding_id: 'rtb_123456789abc' }] }), 'semantic');
});

test('live and REST render register only cards with an installed realtime capability', () => {
  const live = canvasSource.slice(
    canvasSource.indexOf("window.athena.on('athena:add-canvas-live'"),
    canvasSource.indexOf('async function addLiveCard'),
  );
  assert.ok(live.indexOf('tagSessionCard(') < live.indexOf('reportSessionCards();'));
  assert.ok(live.indexOf('reportSessionCards();') < live.indexOf('syncCardRealtimeFallback('));
  const rest = canvasSource.slice(
    canvasSource.indexOf("window.athena.on('athena:add-rest-canvas'"),
    canvasSource.indexOf('const REST_RETRY_STATES'),
  );
  assert.match(rest, /stampRestSnapshotStatus/);
  assert.match(rest, /fallbackKindFor\(renderedCard, envelope\)[\s\S]*syncCardRealtimeFallback\(renderedCard, envelope\)/);
  assert.match(rest, /else \{[\s\S]*stampRestSnapshotStatus\(renderedCard, envelope\)/);
});

test('generic semantic task cards with bindings mount the shared WS manager and consume accepted ticks', () => {
  const task = canvasSource.slice(
    canvasSource.indexOf('async function renderTaskCanvasEnvelope'),
    canvasSource.indexOf('function createSemanticWorkspaceCard'),
  );
  assert.match(task, /realtimeBindingsOf\(envelope\)\.length/);
  assert.match(task, /__athenaSemanticRealtimeLeaseId/);
  assert.match(task, /ensureIntegratedRealtimeCleanup\(root\)/);
  assert.match(task, /syncIntegratedRealtime\(root, envelope\)/);
  const ticks = canvasSource.slice(
    canvasSource.indexOf("window.athena.on('athena:integrated-card-realtime-ticks'"),
    canvasSource.indexOf('// 정지 상태 규범'),
  );
  assert.match(ticks, /root\.dataset\.taskCanvas === 'true'[\s\S]*semanticWorkspace\.applyRealtimeTick\(root, tick\)/);
  assert.match(ticks, /__athenaIntegratedMetadata && root\.__athenaIntegratedMetadata\.cardId/);
});

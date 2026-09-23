import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import realtime from './orb-integrated-realtime.js';
import integratedMain from './main/integrated-card-realtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const obs = (char) => `obs_${char.repeat(12)}`;
const binding = (char) => `rtb_${char.repeat(12)}`;

function classList() {
  const values = new Set(['is-missing']);
  return { toggle(name, on) { on ? values.add(name) : values.delete(name); }, has: (name) => values.has(name) };
}

function cardFor(nodes) {
  return {
    isConnected: true,
    dataset: {},
    querySelectorAll(selector) {
      if (selector === '[data-kiumi-slot-id]') return Object.values(nodes);
      const match = selector.match(/data-kiumi-slot-id="([^"]+)"/);
      return match && nodes[match[1]] ? [nodes[match[1]]] : [];
    },
  };
}

function envelope({ boardId = '2R3M-1', cardId = 'CC-03', mode = 'quote', refs = ['base:0B'] } = {}) {
  return {
    card_id: cardId,
    mode,
    stk_cd: '023590',
    operation_refs: refs,
    surface_contract: {
      board_id: boardId,
      card_id: cardId,
      kiumi: {
        grammar: 'facts',
        elements: [
          { source_slot_id: 's-price', format: { kind: 'number', unit: '원' } },
          { source_slot_id: 's-flow', format: { unit: 'shares', sign: true } },
        ],
      },
      slot_values: [
        { slot_id: 's-price', observation_id: obs('a'), value: 40900, format: { kind: 'number', unit: '원' } },
        { slot_id: 's-flow', observation_id: obs('b'), value: 10, format: { unit: 'shares', sign: true } },
      ],
    },
    realtime_bindings: [
      { binding_id: binding('1'), observation_id: obs('a') },
      { binding_id: binding('2'), observation_id: obs('b') },
    ],
  };
}

test('non-quote opaque update reaches only its declared Kiumi slot', async () => {
  const price = { textContent: '40,900원', classList: classList(), dataset: { kiumiSlotId: 's-price' } };
  const flow = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const card = cardFor({ 's-price': price, 's-flow': flow });
  const calls = [];
  const session = realtime.createOrbIntegratedRealtimeSession({
    card, envelope: envelope(), leaseId: 'orb:card-1', accountGeneration: 7,
    invoke: async (channel, payload) => {
      calls.push([channel, payload]);
      return { ok: true, status: 'active', generation: 3, connectionGeneration: 9 };
    },
    excludedSlotIds: ['s-price'],
  });
  assert.equal(session.bindingCount, 1);
  await session.start();
  assert.deepEqual(calls[0][1].semanticBindingIds, [binding('2')]);
  assert.equal(session.applyTick({
    leaseId: 'orb:card-1', cardId: 'CC-03', mode: 'quote', accountGeneration: 7,
    generation: 3, connectionGeneration: 9,
    semantic_updates: [{ binding_id: binding('1'), value: 42000 }, { binding_id: binding('2'), value: 25 }],
  }), 1);
  assert.equal(price.textContent, '40,900원');
  assert.equal(flow.textContent, '+25주');
  assert.equal(card.dataset.integratedRealtimeStatus, 'receiving');
  assert.equal(card.__athenaOrbLiveSlotRevisions.get('s-flow'), 1);
});

test('industry envelope preserves 0J/0U references and sector target without stock inference', () => {
  const value = { textContent: '2,500.00', classList: classList(), dataset: { kiumiSlotId: 's-price' } };
  const industry = envelope({ boardId: '32S7-0', cardId: 'CC-03', mode: 'sector', refs: ['base:0J', 'base:0U'] });
  delete industry.stk_cd;
  industry.operation_args = { sect_code: '001' };
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-price': value, 's-flow': value }), envelope: industry,
    leaseId: 'orb:index', invoke: async () => ({ ok: true }),
  });
  assert.deepEqual(session.payload.verifiedOperationRefs, ['base:0J', 'base:0U']);
  assert.equal(session.payload.sectorId, '001');
  assert.equal(session.payload.symbol, '');
  assert.equal(session.payload.target, '001');
});

test('authoritative visible_targets are normalized and preserved without table rows', () => {
  const e = envelope({ cardId: 'CC-06', mode: 'ranking' });
  e.visible_targets = ['A005930', '005930', 'Q000660', 'bad'];
  delete e.data;
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({}), envelope: e, leaseId: 'orb:ranking', invoke: async () => ({ ok: true }),
  });
  assert.deepEqual(session.payload.visibleTargets, ['005930', '000660']);
});

test('binding-backed board slots hidden by the Kiumi plan are never subscribed or polled', () => {
  const e = envelope();
  e.surface_contract.slot_values.push({
    slot_id: 's-hidden', observation_id: obs('d'), value: 999, format: { kind: 'number' },
  });
  e.realtime_bindings.push({ binding_id: binding('4'), observation_id: obs('d') });
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({}), envelope: e, leaseId: 'orb:visible-only', invoke: async () => ({ ok: true }),
  });
  assert.equal(session.payload.semanticBindingIds.includes(binding('4')), false);
  assert.equal(session.slotIds.includes('s-hidden'), false);
});

test('wrong account, card, lease, or generation ticks are ignored', async () => {
  const node = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-flow': node }), envelope: envelope(), leaseId: 'orb:guard', accountGeneration: 4,
    excludedSlotIds: ['s-price'], invoke: async () => ({ ok: true, status: 'active', generation: 2, connectionGeneration: 5 }),
  });
  await session.start();
  const base = {
    leaseId: 'orb:guard', cardId: 'CC-03', mode: 'quote', accountGeneration: 4,
    generation: 2, connectionGeneration: 5, semantic_updates: [{ binding_id: binding('2'), value: 30 }],
  };
  for (const changed of [
    { accountGeneration: 3 }, { cardId: 'CC-05' }, { leaseId: 'orb:other' },
    { generation: 1 }, { connectionGeneration: 4 },
  ]) assert.equal(session.applyTick({ ...base, ...changed }), 0);
  assert.equal(node.textContent, '+10주');
});

test('mount adopts authoritative account generation before accepting ticks', async () => {
  const node = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-flow': node }), envelope: envelope(), leaseId: 'orb:generation', accountGeneration: 0,
    excludedSlotIds: ['s-price'],
    invoke: async () => ({ ok: true, status: 'active', accountGeneration: 7, generation: 2, connectionGeneration: 5 }),
  });
  await session.start();
  const tick = {
    leaseId: 'orb:generation', cardId: 'CC-03', mode: 'quote', generation: 2, connectionGeneration: 5,
    semantic_updates: [{ binding_id: binding('2'), value: 30 }],
  };
  assert.equal(session.accountGeneration(), 7);
  assert.equal(session.applyTick({ ...tick, accountGeneration: 0 }), 0);
  assert.equal(session.applyTick({ ...tick, accountGeneration: 7 }), 1);
  assert.equal(node.textContent, '+30주');
});

test('live slot update also advances the hydrated current envelope', async () => {
  const source = envelope();
  const current = structuredClone(source);
  const node = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const card = cardFor({ 's-flow': node });
  card.__athenaOrbCurrentEnvelope = current;
  const session = realtime.createOrbIntegratedRealtimeSession({
    card, envelope: source, leaseId: 'orb:hydrated-current', accountGeneration: 7,
    excludedSlotIds: ['s-price'],
    invoke: async () => ({ ok: true, status: 'active', generation: 2, connectionGeneration: 5 }),
  });
  await session.start();

  assert.equal(session.applyTick({
    leaseId: 'orb:hydrated-current', cardId: 'CC-03', mode: 'quote', accountGeneration: 7,
    generation: 2, connectionGeneration: 5,
    semantic_updates: [{ binding_id: binding('2'), value: 30 }],
  }), 1);
  assert.equal(node.textContent, '+30주');
  assert.equal(current.surface_contract.slot_values.find((entry) => entry.slot_id === 's-flow').value, 30);
});

test('late older active state cannot roll generations back and admit an old tick', async () => {
  const node = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-flow': node }), envelope: envelope(), leaseId: 'orb:state-fence', accountGeneration: 7,
    excludedSlotIds: ['s-price'],
    invoke: async () => ({ ok: true, status: 'active', generation: 2, connectionGeneration: 5 }),
  });
  await session.start();
  const state = {
    leaseId: 'orb:state-fence', cardId: 'CC-03', mode: 'quote', accountGeneration: 7,
  };
  assert.equal(session.applyState({ ...state, status: 'reconnecting', generation: 3, connectionGeneration: 6 }), true);
  assert.equal(session.applyState({ ...state, status: 'active', generation: 2, connectionGeneration: 5 }), false);
  assert.equal(session.applyTick({
    ...state, generation: 2, connectionGeneration: 5,
    semantic_updates: [{ binding_id: binding('2'), value: 30 }],
  }), 0);
  assert.equal(node.textContent, '+10주');
});

test('a new account session starts a fresh monotonic generation scope', async () => {
  const oldNode = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const oldSession = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-flow': oldNode }), envelope: envelope(), leaseId: 'orb:old-account', accountGeneration: 7,
    excludedSlotIds: ['s-price'],
    invoke: async () => ({ ok: true, status: 'active', generation: 9, connectionGeneration: 12 }),
  });
  await oldSession.start();
  assert.equal(oldSession.applyState({
    leaseId: 'orb:old-account', cardId: 'CC-03', mode: 'quote', accountGeneration: 8,
    status: 'active', generation: 1, connectionGeneration: 1,
  }), false);

  const newNode = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const newSession = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-flow': newNode }), envelope: envelope(), leaseId: 'orb:new-account', accountGeneration: 8,
    excludedSlotIds: ['s-price'],
    invoke: async () => ({ ok: true, status: 'active', generation: 1, connectionGeneration: 1 }),
  });
  await newSession.start();
  assert.equal(newSession.applyTick({
    leaseId: 'orb:new-account', cardId: 'CC-03', mode: 'quote', accountGeneration: 8,
    generation: 1, connectionGeneration: 1,
    semantic_updates: [{ binding_id: binding('2'), value: 30 }],
  }), 1);
  assert.equal(newNode.textContent, '+30주');
});

test('composite slot updates only the matching observation and preserves its peer', async () => {
  const node = { textContent: '+10 · +1.00%', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const e = envelope();
  e.surface_contract.kiumi.elements[1].format = { kind: 'text' };
  e.surface_contract.slot_values[1].value = {
    composite: {
      separator: ' · ',
      parts: [
        { observation_id: obs('b'), mapping_id: 'detail:test:flow', f: 'flow', value: 10, format: { kind: 'number', sign: true } },
        { observation_id: obs('c'), mapping_id: 'detail:test:rate', f: 'rate', value: 1, format: { kind: 'percent', sign: true } },
      ],
    },
  };
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({ 's-flow': node }), envelope: e, leaseId: 'orb:composite',
    excludedSlotIds: ['s-price'], invoke: async () => ({ ok: true, status: 'active', generation: 1, connectionGeneration: 1 }),
  });
  await session.start();
  assert.equal(session.applyTick({
    leaseId: 'orb:composite', cardId: 'CC-03', mode: 'quote', generation: 1, connectionGeneration: 1,
    semantic_updates: [{ binding_id: binding('2'), value: 20 }],
  }), 1);
  assert.equal(node.textContent, '+20 · +1.00%');
});

test('detached card closes once and late mount completion cannot reactivate it', async () => {
  let resolveMount;
  const channels = [];
  const card = cardFor({});
  const session = realtime.createOrbIntegratedRealtimeSession({
    card, envelope: envelope(), leaseId: 'orb:late',
    invoke: (channel) => {
      channels.push(channel);
      if (channel.endsWith('-mount')) return new Promise((resolve) => { resolveMount = resolve; });
      return Promise.resolve({ ok: true });
    },
  });
  const pending = session.start();
  card.isConnected = false;
  assert.equal(session.close(), true);
  assert.equal(session.close(), false);
  resolveMount({ ok: true, status: 'active', generation: 1, connectionGeneration: 1 });
  assert.equal(await pending, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(channels.filter((channel) => channel.endsWith('-unmount')).length, 1);
  assert.equal(session.status(), 'stopped');
});

test('failed and rejected unmounts retry the same lease until success', async () => {
  const releases = [];
  const retries = [];
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({}), envelope: envelope(), leaseId: 'orb:release-retry',
    releaseRetryBaseMs: 1, releaseRetryMaxMs: 1,
    setTimer(callback, delay) {
      const timer = { callback, delay };
      retries.push(timer);
      return timer;
    },
    invoke: async (channel, payload) => {
      if (channel.endsWith('-mount')) return { ok: true, status: 'active', generation: 1, connectionGeneration: 1 };
      releases.push(payload.leaseId);
      if (releases.length === 1) return { ok: false, status: 'remove-pending' };
      if (releases.length === 2) throw new Error('transport closed');
      return { ok: true, status: 'unmounted' };
    },
  });
  await session.start();
  session.close();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 1);
  for (const expectedAttempts of [2, 3]) {
    assert.equal(retries.length, 1);
    const timer = retries.shift();
    assert.equal(timer.delay, 1);
    timer.callback();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releases.length, expectedAttempts);
  }
  assert.deepEqual(releases, ['orb:release-retry', 'orb:release-retry', 'orb:release-retry']);
  assert.equal(retries.length, 0);
});

test('integrated fallback registers standby, fences epochs, and stops data after WS recovery', async () => {
  const calls = [];
  const data = [];
  const fallback = realtime.createOrbIntegratedFallbackSession({
    ownerId: 'orb-integrated:fallback', kind: 'integrated-board', accountGeneration: 7,
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 1 }, target: '023590',
    slotIds: ['s-flow', 's-flow'], onData: (event) => data.push(event),
    invoke: async (channel, payload) => {
      calls.push([channel, payload]);
      if (channel.endsWith('-register')) {
        return { ok: true, registrationRevision: 4, sourceEpoch: 2, ownerEpoch: 0 };
      }
      return true;
    },
  });
  await fallback.start();
  assert.deepEqual(calls[0], ['athena:realtime-fallback-register', {
    ownerId: 'orb-integrated:fallback', kind: 'integrated-board', accountGeneration: 7,
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 1 }, target: '023590',
    slotIds: ['s-flow'], visible: true,
  }]);
  await fallback.handleRealtimeState('error');
  const event = {
    ownerId: 'orb-integrated:fallback', kind: 'integrated-board', accountGeneration: 7,
    registrationRevision: 4, sourceEpoch: 3, ownerEpoch: 1,
    source: 'kiwoom-rest', transport: 'rest-fallback', slotValues: { 's-flow': 40 },
  };
  assert.equal(fallback.applyData({ ...event, ownerEpoch: -1 }), false);
  assert.equal(fallback.applyData({ ...event, registrationRevision: 3 }), false);
  assert.equal(fallback.applyState({ ...event, status: 'refreshing' }), true);
  assert.equal(fallback.applyData(event), true);
  assert.equal(data.length, 1);
  await fallback.handleRealtimeState('active');
  assert.equal(fallback.applyData({ ...event, sourceEpoch: 4, ownerEpoch: 2 }), false);
});

test('fallback can refresh the card while integrated WS mount remains unresolved', async () => {
  const node = { textContent: '+10주', classList: classList(), dataset: { kiumiSlotId: 's-flow' } };
  const card = cardFor({ 's-flow': node });
  const ws = realtime.createOrbIntegratedRealtimeSession({
    card, envelope: envelope(), leaseId: 'orb:hanging-ws', accountGeneration: 7,
    excludedSlotIds: ['s-price'],
    invoke: () => new Promise(() => {}),
  });
  const fallback = realtime.createOrbIntegratedFallbackSession({
    ownerId: 'orb-integrated:hanging-ws', accountGeneration: 7,
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 1 }, target: '023590',
    slotIds: ws.slotIds, onData: (event) => ws.applyFallbackData(event),
    invoke: async (channel) => channel.endsWith('-register')
      ? { ok: true, status: 'api-fallback', registrationRevision: 8, sourceEpoch: 2, ownerEpoch: 1 }
      : true,
  });
  await fallback.start();
  void ws.start();
  const identity = {
    ownerId: 'orb-integrated:hanging-ws', accountGeneration: 7, registrationRevision: 8,
    sourceEpoch: 2, ownerEpoch: 1, source: 'kiwoom-rest', transport: 'rest-fallback',
  };
  assert.equal(fallback.applyState({ ...identity, status: 'refreshing' }), true);
  assert.equal(fallback.applyData({
    ...identity, kind: 'integrated-board', mode: 'slot-patch', slotValues: { 's-flow': 55 },
  }), true);
  assert.equal(node.textContent, '+55주');
});

test('fallback preserves the first state and data emitted before register resolves', async () => {
  let finishRegister;
  const states = [];
  const data = [];
  const fallback = realtime.createOrbIntegratedFallbackSession({
    ownerId: 'orb-integrated:early', accountGeneration: 7,
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 1 }, target: '023590',
    slotIds: ['s-flow'], onState: (event) => states.push(event.status),
    onData: (event) => data.push(event.slotValues['s-flow']),
    invoke: (channel) => channel.endsWith('-register')
      ? new Promise((resolve) => { finishRegister = resolve; }) : Promise.resolve(true),
  });
  const registering = fallback.start();
  const identity = {
    ownerId: 'orb-integrated:early', accountGeneration: 7, registrationRevision: 5,
    sourceEpoch: 1, ownerEpoch: 1,
  };
  assert.equal(fallback.applyState({ ...identity, status: 'refreshing' }), true);
  assert.equal(fallback.applyData({
    ...identity, kind: 'integrated-board', source: 'kiwoom-rest', transport: 'rest-fallback',
    slotValues: { 's-flow': 77 },
  }), true);
  finishRegister({
    ok: true, status: 'api-fallback', registrationRevision: 5, sourceEpoch: 1, ownerEpoch: 1,
  });
  await registering;
  assert.deepEqual(states, ['api-fallback', 'refreshing']);
  assert.deepEqual(data, [77]);
});

test('CardLeaseManager repeated unmount retries a REMOVE tombstone', async () => {
  const releases = [];
  const manager = new integratedMain.CardLeaseManager({
    transport: {
      acquire: async () => true,
      release: async () => { releases.push(true); return releases.length > 1; },
      reconnect: async () => [],
    },
    semanticBindingSourceProvider: async () => new Map([['10', binding('1')]]),
  });
  const mounted = await manager.mount({
    leaseId: 'orb:tombstone', cardId: 'CC-03', mode: 'quote', symbol: '023590',
    backendAccountAlias: 'primary', verifiedOperationRefs: ['base:0B'], semanticBindingIds: [binding('1')],
  });
  assert.equal(mounted.ok, true);
  assert.equal((await manager.unmount('orb:tombstone')).status, 'remove-pending');
  assert.deepEqual(await manager.unmount('orb:tombstone'), {
    ok: true, status: 'unmounted', leaseId: 'orb:tombstone',
  });
  assert.equal(releases.length, 2);
});

test('envelope without an observation-bound visible slot stays snapshot-only', async () => {
  const e = envelope();
  e.surface_contract.slot_values = { 's-flow': 10 };
  const calls = [];
  const session = realtime.createOrbIntegratedRealtimeSession({
    card: cardFor({}), envelope: e, leaseId: 'orb:snapshot',
    invoke: async (...args) => { calls.push(args); },
  });
  assert.equal(session.bindingCount, 0);
  assert.equal(await session.start(), false);
  assert.equal(session.status(), 'snapshot');
  assert.equal(calls.length, 0);
});

test('Orb runtime loads and wires generic sessions after direct quote ownership is known', () => {
  const html = fs.readFileSync(path.join(here, '..', 'orb.html'), 'utf8');
  const orb = fs.readFileSync(path.join(here, '..', 'orb.js'), 'utf8');
  assert.ok(html.indexOf('lib/orb-quote-realtime.js') < html.indexOf('lib/orb-integrated-realtime.js'));
  assert.ok(html.indexOf('lib/orb-integrated-realtime.js') < html.indexOf('src="orb.js"'));
  assert.match(orb, /wireOrbKiumiQuoteRealtime\(card, envelope\);\s*wireOrbIntegratedRealtime\(card, envelope\);/);
  assert.match(orb, /orbQuoteSessions\.has\(card\) \? \['s005', 's006'\] : \[\]/);
  assert.match(orb, /athena:integrated-card-realtime-state/);
  assert.match(orb, /athena:integrated-card-realtime-ticks/);
  assert.match(orb, /athena:realtime-account-reset[\s\S]*closeOrbIntegratedSessions\(\)/);
  assert.match(orb, /const fallbackReady = fallback\.start\(\);\s*void session\.start\(\);/);
  assert.match(orb, /실시간 중단 · 다시 조회 필요/);
  const kiumiBuilder = orb.slice(
    orb.indexOf('function buildOrbKiumiCard('),
    orb.indexOf('function buildOrbCanvasCard('),
  );
  const factsBuilder = orb.slice(
    orb.indexOf('function buildOrbFactsCard('),
    orb.indexOf('function buildOrbCompoundCard('),
  );
  assert.match(kiumiBuilder, /card\.appendChild\(body\);[\s\S]*dataset\.orbRealtimeFallbackStatus = 'true'/);
  assert.equal((kiumiBuilder.match(/dataset\.orbRealtimeFallbackStatus = 'true'/g) || []).length, 1);
  assert.match(factsBuilder, /isOrbLegacyQuoteFactsEnvelope\(envelope\)[\s\S]*dataset\.orbRealtimeFallbackStatus = 'true'/);
  assert.equal((factsBuilder.match(/dataset\.orbRealtimeFallbackStatus = 'true'/g) || []).length, 1);
});

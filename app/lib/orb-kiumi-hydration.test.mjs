import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const mini = require('./orb-mini-card.js');
const factsCard = require('./facts-card.js');
const cardPrimitives = require('./card-primitives.js');
const { createOrbQuoteFallbackSession } = require('./orb-quote-realtime.js');
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

function slotValuesById(raw) {
  if (!Array.isArray(raw)) return raw;
  return Object.fromEntries(raw.map((entry) => [entry.slot_id, entry.value]));
}

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} source block is present`);
  return source.slice(from, to);
}

function chartEnvelope(slotValues = []) {
  return {
    canvas_type: 'chart',
    stk_cd: '023590',
    operation_args: { stk_cd: '023590', period: 'day' },
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 0 },
    data: {
      chart: {
        candles: [
          { time: '2025-09-18', close: 30000 },
          { time: '2026-09-14', close: 40900 },
        ],
      },
    },
    surface_contract: {
      board_id: '137X-2',
      slot_values: slotValues,
      kiumi: {
        version: 1,
        width_px: 360,
        height_px: 420,
        grammar: 'chart',
        fixed: true,
        elements: [
          { source_slot_id: 's005', label: '현재가', role: 'primary', format: { unit: 'krw_ko' } },
          { source_slot_id: 's006', label: '전일대비', role: 'change', format: { unit: 'percent', sign: true, precision: 0, tone: 'change' } },
        ],
      },
    },
  };
}

test('실제 차트 봉투에서 빠진 현재가·전일대비 슬롯만 후속 조회한다', () => {
  const request = mini.kiumiChartHydrationRequest(chartEnvelope());
  assert.deepEqual(request, {
    boardId: '137X-2',
    slotIds: ['s005', 's006'],
    target: { stk_cd: '023590', period: 'day' },
    account: '',
    correlation: { dataset_id: 'd', item_id: 'i', ordinal: 0 },
  });
  assert.deepEqual(mini.kiumiChartLiveUpdates(chartEnvelope().surface_contract, {
    symbol: '023590', at: 1, price: 41100, change: 400, changeRate: 0.98,
  }).map(({ slotId, text }) => ({ slotId, text })), [
    { slotId: 's005', text: '4만 1,100' },
    { slotId: 's006', text: '+400 · +0.98%' },
  ], 'REST 하이드레이션이 없어도 WS 직접값으로 두 헤더 슬롯을 복구한다');
});

test('후속 조회의 검증된 quote 슬롯만 합치고 차트 캔들은 현재가로 쓰지 않는다', () => {
  const original = chartEnvelope();
  const unchanged = mini.withKiumiHydration(original, { ok: false, slot_values: { s005: 40900 } });
  assert.equal(unchanged, original);
  assert.equal(mini.buildKiumiPlan(unchanged.surface_contract, unchanged).elements[0].text, '미제공');

  const hydrated = mini.withKiumiHydration(original, {
    ok: true,
    slot_values: {
      s005: 40900,
      s006: { composite: { separator: ' · ', parts: [
        { mapping_id: 'detail:ka10001:current_trading', f: 'pred_pre', value: 200, format: { kind: 'number', sign: true } },
        { mapping_id: 'detail:ka10001:current_trading', f: 'flu_rt', value: 0.49, format: { kind: 'percent', sign: true, precision: 2 } },
      ] } },
    },
  });
  const plan = mini.buildKiumiPlan(hydrated.surface_contract, hydrated);
  assert.equal(plan.elements[0].text, '4만 900');
  assert.equal(plan.elements[1].text, '+200 · +0.49%');
  assert.deepEqual(hydrated.data.chart.candles, original.data.chart.candles);
  assert.equal(mini.kiumiChartHydrationRequest(hydrated), null);

  assert.deepEqual(mini.kiumiChartLiveUpdates(hydrated.surface_contract, {
    symbol: '023590', at: 1, price: 41100, change: 400, changeRate: 0.98,
  }).map(({ slotId, text }) => ({ slotId, text })), [
    { slotId: 's005', text: '4만 1,100' },
    { slotId: 's006', text: '+400 · +0.98%' },
  ]);
  assert.deepEqual(mini.kiumiChartLiveUpdates(hydrated.surface_contract, {
    symbol: '023590', at: 2, price: 41200, change: null, changeRate: 1.23,
  }).map(({ slotId }) => slotId), ['s005'], '전일대비 두 직접값이 모두 없으면 스냅샷과 섞지 않는다');
  assert.deepEqual(mini.kiumiChartLiveUpdates(hydrated.surface_contract, {
    symbol: '023590', at: 2, price: 41200, change: null, changeRate: null,
  }).map(({ slotId, text }) => ({ slotId, text })), [
    { slotId: 's005', text: '4만 1,200' },
  ], '빈 FID는 기존 전일대비를 가짜 0으로 덮지 않는다');

  const liveRaw = mini.kiumiChartLiveUpdates(hydrated.surface_contract, {
    symbol: '023590', at: 4, price: 41100, change: 400, changeRate: 0.98,
  });
  const liveEnvelope = mini.withKiumiHydration(hydrated, {
    ok: true,
    slot_values: Object.fromEntries(liveRaw.map((update) => [update.slotId, update.value])),
  });
  const liveValues = slotValuesById(liveEnvelope.surface_contract.slot_values);
  assert.equal(liveValues.s005, 41100);
  assert.equal(liveValues.s006.composite.parts.find((part) => part.f === 'pred_pre').value, 400);
  assert.equal(liveValues.s006.composite.parts.find((part) => part.f === 'flu_rt').value, 0.98);

  const priceOnly = mini.kiumiChartLiveUpdates(liveEnvelope.surface_contract, {
    symbol: '023590', at: 5, price: 41300, change: null, changeRate: null,
  });
  const priceOnlyEnvelope = mini.withKiumiHydration(liveEnvelope, {
    ok: true,
    slot_values: Object.fromEntries(priceOnly.map((update) => [update.slotId, update.value])),
  });
  const priceOnlyValues = slotValuesById(priceOnlyEnvelope.surface_contract.slot_values);
  assert.equal(priceOnlyValues.s005, 41300);
  assert.equal(priceOnlyValues.s006.composite.parts
    .find((part) => part.f === 'pred_pre').value, 400,
  'FID11/12가 없는 후속 틱은 이전 전일대비 근거를 보존한다');

  const nodes = [
    { dataset: { kiumiSlotId: 's005' }, textContent: '', classList: { toggle() {} } },
    { dataset: { kiumiSlotId: 's006' }, textContent: '', classList: { toggle() {} } },
  ];
  const applied = mini.applyKiumiChartLiveUpdates({ querySelectorAll: () => nodes },
    mini.kiumiChartLiveUpdates(hydrated.surface_contract, {
      symbol: '023590', at: 3, price: 41100, change: 400, changeRate: 0.98,
    }));
  assert.equal(applied, 2);
  assert.deepEqual(nodes.map((node) => node.textContent), ['4만 1,100', '+400 · +0.98%']);

  const revisionsAtHydrateStart = new Map();
  const liveRevisions = new Map([['s005', 1]]);
  const hydrationPlan = mini.buildKiumiPlan(hydrated.surface_contract, hydrated);
  assert.deepEqual(mini.kiumiHydrationUpdates(
    hydrationPlan.elements,
    revisionsAtHydrateStart,
    liveRevisions,
  ).map(({ slotId }) => slotId), ['s006'],
  'pending hydrate 중 WS 현재가가 오면 현재가는 보존하고 untouched 전일대비만 hydrate한다');
});

test('pending hydrate보다 늦게 적용된 REST fallback 슬롯은 리비전으로 보호한다', () => {
  const nodes = [
    { dataset: { kiumiSlotId: 's005' }, textContent: '미제공', classList: { toggle() {} } },
    { dataset: { kiumiSlotId: 's006' }, textContent: '미제공', classList: { toggle() {} } },
  ];
  const card = {
    __athenaOrbLiveSlotRevisions: new Map(),
    querySelectorAll: () => nodes,
  };
  const revisionsAtHydrateStart = new Map(card.__athenaOrbLiveSlotRevisions);
  const fallbackEnvelope = chartEnvelope({
    s005: 41100,
    s006: { composite: { separator: ' · ', parts: [
      { mapping_id: 'detail:ka10001:current_trading', f: 'pred_pre', value: 400, format: { kind: 'number', sign: true } },
      { mapping_id: 'detail:ka10001:current_trading', f: 'flu_rt', value: 0.98, format: { kind: 'percent', sign: true, precision: 2 } },
    ] } },
  });
  const fallbackPlan = mini.buildKiumiPlan(fallbackEnvelope.surface_contract, fallbackEnvelope);
  assert.deepEqual(mini.applyRevisionedKiumiUpdates(card, fallbackPlan.elements), ['s005', 's006']);
  assert.deepEqual(nodes.map((node) => node.textContent), ['4만 1,100', '+400 · +0.98%']);
  assert.deepEqual([...card.__athenaOrbLiveSlotRevisions], [['s005', 1], ['s006', 1]]);

  const olderHydration = mini.withKiumiHydration(chartEnvelope(), {
    ok: true,
    slot_values: {
      s005: 40900,
      s006: { composite: { separator: ' · ', parts: [
        { mapping_id: 'detail:ka10001:current_trading', f: 'pred_pre', value: 200, format: { kind: 'number', sign: true } },
        { mapping_id: 'detail:ka10001:current_trading', f: 'flu_rt', value: 0.49, format: { kind: 'percent', sign: true, precision: 2 } },
      ] } },
    },
  });
  const olderPlan = mini.buildKiumiPlan(olderHydration.surface_contract, olderHydration);
  assert.deepEqual(mini.kiumiHydrationUpdates(
    olderPlan.elements,
    revisionsAtHydrateStart,
    card.__athenaOrbLiveSlotRevisions,
  ), []);
  assert.deepEqual(nodes.map((node) => node.textContent), ['4만 1,100', '+400 · +0.98%'],
    '늦은 초기 hydrate는 더 최신 fallback 값을 덮지 않는다');

  const orb = fs.readFileSync(path.join(appRoot, 'orb.js'), 'utf8');
  assert.match(orb, /applyOrbQuoteFallbackData[\s\S]*applyRevisionedKiumiUpdates\(card, plan\.elements\)/);
  assert.match(orb, /card\.__athenaOrbCurrentEnvelope = mergeOrbKiumiSlots\([\s\S]*hydrationUpdates\.map/);
});

test('글로우 facts/profile 종목정보도 direct 0B와 REST fallback으로 DOM·Q&A를 함께 갱신한다', async () => {
  const orb = fs.readFileSync(path.join(appRoot, 'orb.js'), 'utf8');
  const context = vm.createContext({
    orbMiniCard: mini, factsCard, cardPrimitives,
    orbKiumiSurfaceContract: (envelope) => envelope && envelope.surface_contract,
  });
  vm.runInContext(sourceBetween(
    orb,
    '  function isOrbLegacyQuoteFactsEnvelope(',
    '  function wireOrbKiumiQuoteRealtime(',
  ), context);
  const ids = {
    price: 'obs_11111111111111111111', sign: 'obs_22222222222222222222',
    change: 'obs_33333333333333333333', rate: 'obs_44444444444444444444',
    volume: 'obs_55555555555555555555',
  };
  const profile = chartEnvelope([
    { slot_id: 's005', observation_id: ids.price, value: 249250 },
    { slot_id: 's006', value: { composite: { separator: ' · ', parts: [
      { mapping_id: 'detail:ka10001:current_trading', f: 'pred_pre', value: -10250,
        observation_id: ids.change, format: { kind: 'number', sign: true } },
      { mapping_id: 'detail:ka10001:current_trading', f: 'flu_rt', value: -3.95,
        observation_id: ids.rate, format: { kind: 'percent', sign: true, precision: 2 } },
    ] } } },
    { slot_id: 's018', observation_id: ids.volume, value: 14947673 },
  ]);
  profile.canvas_type = 'facts';
  profile.card_id = 'CC-03';
  profile.mode = 'profile';
  profile.operation_refs = ['detail:ka10001:current_trading'];
  profile.data = { fields: [
    { key: 'cur_prc', label: '현재가', value: 249250 },
    { key: 'pre_sig', label: '전일 대비 기호', value: 5 },
    { key: 'pred_pre', label: '전일대비', value: -10250 },
    { key: 'flu_rt', label: '등락율', value: -3.95 },
    { key: 'trde_qty', label: '거래량', value: 14947673 },
  ] };
  profile.semantic_observations = Object.entries(ids).map(([key, observation_id]) => ({
    observation_id,
    realtime_binding_id: `rtb_${observation_id.slice(4)}`,
    label_ko: ({ price: '현재가', sign: '전일 대비 기호', change: '전일대비', rate: '등락율', volume: '거래량' })[key],
  }));
  profile.realtime_bindings = Object.values(ids).map((observation_id) => ({
    observation_id, binding_id: `rtb_${observation_id.slice(4)}`,
  }));
  const nodes = profile.data.fields.map((field) => ({
    dataset: { orbFieldKey: field.key }, textContent: '', classList: { toggle() {} },
  }));
  const card = {
    __athenaOrbCurrentEnvelope: profile,
    __athenaOrbLiveSlotRevisions: new Map(),
    querySelectorAll: (selector) => selector === '[data-orb-field-key]' ? nodes : [],
  };
  assert.equal(context.applyOrbKiumiQuoteTick(card, profile.surface_contract, {
    symbol: '005930', at: 1, price: 250000, change: -9500, changeRate: -3.66,
    sign: 2, accVolume: 15000000,
  }), 5);
  assert.deepEqual(nodes.map((node) => node.textContent), ['250,000', '2', '-9,500', '-3.66%', '15,000,000']);
  assert.deepEqual(card.__athenaOrbCurrentEnvelope.data.fields.map((field) => field.value),
    [250000, 2, -9500, -3.66, 15000000], 'Q&A는 화면과 같은 최신 체결값을 읽는다');
  assert.deepEqual([...card.__athenaOrbLiveSlotRevisions], [['s005', 1], ['s006', 1], ['s018', 1]]);

  const fallback = structuredClone(profile);
  fallback.data.fields = fallback.data.fields.map((field) => ({
    ...field,
    value: ({ cur_prc: 251000, pre_sig: 5, pred_pre: -8500, flu_rt: -3.27, trde_qty: 15100000 })[field.key],
  }));
  assert.equal(context.applyOrbQuoteFallbackData(card, { envelope: fallback }), 5);
  assert.deepEqual(nodes.map((node) => node.textContent), ['251,000', '5', '-8,500', '-3.27%', '15,100,000']);
  assert.deepEqual(card.__athenaOrbCurrentEnvelope.data.fields.map((field) => field.value),
    [251000, 5, -8500, -3.27, 15100000], 'API fallback도 동일 DOM과 Q&A 문맥을 갱신한다');
  const blanks = structuredClone(fallback);
  blanks.data.fields = blanks.data.fields.map((field) => ({
    ...field,
    value: ({ cur_prc: 252000, pre_sig: ' ', pred_pre: '', flu_rt: null, trde_qty: undefined })[field.key],
  }));
  assert.equal(context.applyOrbQuoteFallbackData(card, { envelope: blanks }), 1);
  assert.deepEqual(card.__athenaOrbCurrentEnvelope.data.fields.map((field) => field.value),
    [252000, 5, -8500, -3.27, 15100000], '미제공 REST 필드는 0으로 만들지 않고 기존값을 보존한다');
  assert.equal(context.applyOrbKiumiQuoteTick(card, profile.surface_contract, {
    symbol: '005930', at: 2, price: null, change: null, changeRate: null, sign: 9, accVolume: null,
  }), 0, '검증 가능한 필드가 없는 틱은 적용하지 않는다');

  const fallbackSession = createOrbQuoteFallbackSession({
    ownerId: 'orb:legacy-facts', accountGeneration: 4, correlation: profile.correlation,
    target: '005930',
    invoke: async (channel) => channel === 'athena:realtime-fallback-register'
      ? { ok: true, ownerId: 'orb:legacy-facts', accountGeneration: 4,
        registrationRevision: 7, sourceEpoch: 0, ownerEpoch: 0 }
      : true,
    onData: (event) => context.applyOrbQuoteFallbackData(card, event),
  });
  await fallbackSession.start();
  const identity = {
    ownerId: 'orb:legacy-facts', accountGeneration: 4, registrationRevision: 7,
    sourceEpoch: 1, ownerEpoch: 1,
  };
  const lateEnvelope = structuredClone(fallback);
  lateEnvelope.data.fields = lateEnvelope.data.fields.map((field) => (
    field.key === 'cur_prc' ? { ...field, value: 999999 } : field
  ));
  assert.equal(fallbackSession.applyState({ ...identity, status: 'refreshing' }), true);
  assert.equal(fallbackSession.applyData({ ...identity, envelope: fallback }), true);
  assert.equal(await fallbackSession.handleQuoteState('receiving'), true);
  assert.equal(fallbackSession.applyData({ ...identity, envelope: lateEnvelope }), false,
    'WS가 회복된 뒤 도착한 이전 REST 값은 같은 카드 DOM을 덮지 않는다');
  assert.equal(card.__athenaOrbCurrentEnvelope.data.fields[0].value, 251000);
  fallbackSession.close();
});

test('legacy facts 카드도 실시간 상태와 개별 지표 Q&A 경로를 렌더한다', () => {
  const orb = fs.readFileSync(path.join(appRoot, 'orb.js'), 'utf8');
  assert.match(orb, /path: `data\.fields\.\$\{index\}\.value`/);
  assert.match(orb, /valueEl\.dataset\.cardComponentLabel[\s\S]*cardComponentObservation = 'true'/);
  assert.match(orb, /buildOrbFactsCard[\s\S]*isOrbLegacyQuoteFactsEnvelope\(envelope\)[\s\S]*orbRealtimeFallbackStatus = 'true'/);
});

test('글로우 실시간 상태는 연결 대기와 첫 체결 수신을 숨기지 않는다', () => {
  const orb = fs.readFileSync(path.join(appRoot, 'orb.js'), 'utf8');
  const context = vm.createContext({ Date, Intl, Number });
  vm.runInContext(sourceBetween(
    orb,
    '  function orbFallbackTime(',
    '  function orbKiumiSlotPatch(',
  ), context);
  const node = { hidden: true, textContent: '', dataset: {} };
  const card = { querySelector: () => node };
  context.showOrbQuoteFallbackState(card, { status: 'ws-active', phase: 'active' });
  assert.equal(node.hidden, false);
  assert.equal(node.textContent, '실시간 연결됨 · 첫 체결 대기');
  context.showOrbQuoteFallbackState(card, { status: 'receiving' });
  assert.equal(node.hidden, false);
  assert.equal(node.textContent, '실시간 수신 중');
  context.showOrbQuoteFallbackState(card, { status: 'ws-active' });
  assert.equal(node.textContent, '실시간 수신 중', 'fallback의 늦은 ws-active가 첫 체결 수신을 덮지 않는다');
  context.showOrbQuoteFallbackState(card, { status: 'ws-active', phase: 'active' });
  assert.equal(node.textContent, '실시간 연결됨 · 첫 체결 대기', '재연결 active는 새 첫 체결을 기다린다');
});

test('오브 런타임은 하이드레이션 완료를 기다리고 계좌 세대로 늦은 응답을 폐기한다', () => {
  const orb = fs.readFileSync(path.join(appRoot, 'orb.js'), 'utf8');
  const quoteRealtime = fs.readFileSync(path.join(appRoot, 'lib', 'orb-quote-realtime.js'), 'utf8');
  const html = fs.readFileSync(path.join(appRoot, 'orb.html'), 'utf8');
  const main = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
  assert.ok(html.indexOf('lib/orb-mini-card.js') < html.indexOf('lib/orb-quote-realtime.js'));
  assert.ok(html.indexOf('lib/orb-quote-realtime.js') < html.indexOf('src="orb.js"'));
  assert.match(orb, /await window\.athena\.invoke\('athena:canvas-board-hydrate', request\)/);
  assert.match(orb, /athena:realtime-account-reset[\s\S]*orbCanvasRenderGeneration \+= 1/);
  assert.match(orb, /generation !== orbCanvasRenderGeneration[\s\S]*return null/);
  assert.match(orb, /const el = buildOrbCanvasCard\(r\)[\s\S]*answer\.line\.appendChild\(el\)[\s\S]*activateOrbCanvasCard\(el\)[\s\S]*hydrateMountedOrbCanvasCard\(el, r, canvasRenderGeneration\)/);
  assert.match(orb, /void hydrateMountedOrbCanvasCard\(el, r, canvasRenderGeneration\)/);
  assert.doesNotMatch(orb, /Promise\.allSettled\(canvasRenderJobs\)/);
  assert.match(orb, /generation !== orbCanvasRenderGeneration \|\| !card\.isConnected/);
  assert.match(orb, /const revisionsAtStart = new Map\(card\.__athenaOrbLiveSlotRevisions \|\| \[\]\)/);
  assert.match(orb, /kiumiHydrationUpdates\([\s\S]*revisionsAtStart[\s\S]*card\.__athenaOrbLiveSlotRevisions/);
  assert.doesNotMatch(orb, /pendingCanvasCards/);
  assert.match(main, /const isOrbSender = Boolean\(typeof orbWin !== 'undefined'[\s\S]*event\.sender === orbWin\.webContents\)/);
  assert.match(main, /orbWin\.webContents\.send\('athena:realtime-account-reset', \{ generation: realtimeAccountGeneration \}\)/);
  assert.match(main, /orbWin\.webContents\.send\('athena:chart-ticks', ticks\)/);
  assert.match(main, /acquireRendererRealtimeLease\('quote', payload\.symbol, senderId\)/);
  assert.match(main, /releaseRendererRealtimeLease\('quote', payload\.leaseToken, senderId\)/);
  assert.match(main, /rendererRealtimeLeases\.set\(leaseToken, \{ kind, symbol: trimmed, registrar, generation, ownerId \}\)/);
  assert.match(main, /ownerId !== null && lease\.ownerId !== ownerId/);
  assert.match(quoteRealtime, /function createOrbQuoteFallbackSession[\s\S]*kind: 'orb-quote'/);
  assert.match(quoteRealtime, /ownerId, kind, accountGeneration, correlation, target,[\s\S]*slotIds:[\s\S]*visible: true/);
  assert.match(orb, /API 대체 조회[^\n]*마지막 확인/);
  assert.match(orb, /athena:realtime-fallback-state/);
  assert.match(orb, /athena:realtime-fallback-data/);
  assert.match(orb, /athena:renderer-realtime-state[\s\S]*session\.applyState\(state\)/);
  assert.match(orb, /invoke\('athena:realtime-generation'\)[\s\S]*ensureFallback\(\)\.start\(\)[\s\S]*session\.start\(\)/,
    'authoritative generation으로 fallback standby를 등록한 뒤 quote acquire를 시작한다');
});

test('업종 지수 Kiumi 차트는 주식 0B 틱으로 갱신하지 않는다', () => {
  const envelope = chartEnvelope();
  envelope.surface_contract.board_id = '32S7-0';
  envelope.surface_contract.kiumi.title = '차트 — 업종 지수';
  assert.deepEqual(mini.kiumiChartLiveUpdates(envelope.surface_contract, {
    symbol: '001', at: 1, price: 41100, change: 400, changeRate: 0.98,
  }), []);
  const orb = fs.readFileSync(path.join(appRoot, 'orb.js'), 'utf8');
  assert.match(orb, /surfaceContract\.board_id \|\| ''\) !== '137X-2'/);
});

'use strict';

// Public synthetic renderer audit. The default invocation is preparation-only.
// A reviewed Electron slot must pass --execute-reviewed explicitly.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const repoRoot = path.resolve(__dirname, '../../../../..');
const appRoot = path.join(repoRoot, 'app');
const appRootReal = fs.realpathSync(appRoot);
const historicalPath = path.join(repoRoot, 'backend/ref/card-ui-handoff-20261003/CURRENT-94-HISTORICAL.json');
const outBase = path.join(repoRoot, '.omc/artifacts/card-ui-goal-20261004/public-matrix');
const runNameIndex = process.argv.indexOf('--run-name');
const runName = runNameIndex >= 0 ? String(process.argv[runNameIndex + 1] || '') : '';
const captureIndex = process.argv.indexOf('--capture-board');
const captureBoardIds = captureIndex >= 0
  ? [...new Set(String(process.argv[captureIndex + 1] || '').split(',').map((value) => value.trim()).filter(Boolean))]
  : [];
if (runName && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(runName)) {
  throw new Error('--run-name must be a lowercase slug (letters, digits, hyphens; max 64 chars)');
}
const outRoot = runName ? path.join(outBase, runName) : outBase;
const registry = require(path.join(appRoot, 'lib/board-template-registry'));
const displayPolicy = require(path.join(appRoot, 'lib/board-display-policy-data'));
const canvasSource = fs.readFileSync(path.join(appRoot, 'canvas.js'), 'utf8');
const watchSourceMatch = canvasSource.match(/^const WATCH_SOURCE_SLOTS = (.+);$/m);
assert.ok(watchSourceMatch, 'current canvas watch-source slot contract must be readable');
const watchSourceSlots = JSON.parse(watchSourceMatch[1]);
const historical = JSON.parse(fs.readFileSync(historicalPath, 'utf8'));
const rows = historical.rows;
const ids = rows.map((row) => String(row.template_id));
const LIVE_ORDER_IDS = Object.freeze([
  '135M-2', '1JZW-0', '2T63-1', '2TAG-1', '2TET-1', '2TJ6-1', '2TNJ-1',
]);
const OVERLAY_STATE_IDS = Object.freeze(['4A9H-1', '4AGN-1', '4ANS-1', '4AUX-1']);
const PRIMARY_EXPECTED = Object.freeze({
  '137X-2': 'athena-chart',
  '13BC-2': 'orderbook-ladder',
  '1JPU-0': 'orderbook-ladder',
  '2RJ7-1': 'athena-chart',
  '32S7-0': 'athena-chart',
});
const STAGES = Object.freeze([
  { id: 'max', width: 2560, height: 1392 },
  { id: 'narrow', width: 1411, height: 1166 },
  { id: 'remax', width: 2560, height: 1392 },
]);

function shellResourceFiles() {
  const shell = fs.readFileSync(path.join(appRoot, 'shell.html'), 'utf8');
  const resources = [...shell.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)]
    .map((match) => match[1])
    .filter((value) => /\.(?:css|js|mjs)$/i.test(value));
  return [...new Set([
    'shell.html', ...resources,
    'lib/lightweight-charts-axis.mjs',
    'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.mjs',
    ...registry.cardIds().map((cardId) => `lib/board-templates.${cardId}.generated.js`),
  ])].sort();
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function validateMatrix() {
  assert.equal(rows.length, 94, 'historical public scope must contain 94 rows');
  assert.equal(new Set(ids).size, 94, 'historical public template ids must be unique');
  assert.deepEqual(ids.filter((id) => !registry.hasBoard(id)), [], 'all 94 ids must exist in the current registry');
  assert.deepEqual(ids.filter((id) => registry.cardIdFor(id) === 'CC-02'), [], 'live order surfaces are excluded');
  assert.deepEqual(ids.filter((id) => LIVE_ORDER_IDS.includes(id)), [], 'all seven live-order ids are blocked');
  assert.deepEqual(
    Object.fromEntries(ids.map((id) => [id, registry.primaryRendererFor(id)]).filter(([, value]) => value)),
    PRIMARY_EXPECTED,
    'the five primary-renderer surfaces must remain explicit',
  );
  assert.deepEqual(ids.filter((id) => !displayPolicy[id]), [], 'every public state needs generated display policy');
}

validateMatrix();
assert.ok(captureBoardIds.length <= 3, '--capture-board accepts at most three comma-separated board IDs');
assert.deepEqual(captureBoardIds.filter((id) => !ids.includes(id)), [], '--capture-board IDs must belong to the public 94-state set');
assert.deepEqual(captureBoardIds.filter((id) => OVERLAY_STATE_IDS.includes(id)), [],
  '--capture-board does not accept overlay-only IDs because they do not mount standalone roots');
const sourceFiles = [...new Set(['preload.js', ...shellResourceFiles()])];
assert.deepEqual(
  sourceFiles.filter((file) => !fs.existsSync(path.join(appRoot, file))), [],
  'every executed renderer JS/CSS resource must exist before launch',
);
const sourcePins = Object.fromEntries(sourceFiles.map((file) => [file, sha256(path.join(appRoot, file))]));

if (!process.argv.includes('--execute-reviewed')) {
  console.log(JSON.stringify({
    status: 'PREPARED_ONLY_NO_EXECUTION',
    states: ids.length,
    stages: STAGES.map((stage) => stage.id),
    primaryRenderers: PRIMARY_EXPECTED,
    captureBoards: captureBoardIds,
    pinnedRendererResources: sourceFiles.length,
    output: path.relative(repoRoot, runName ? outRoot : path.join(outBase, '<run-name>')).replaceAll('\\', '/'),
  }));
  process.exit(0);
}

assert.ok(runName, '--execute-reviewed requires --run-name so earlier evidence is never overwritten');

const { app, BrowserWindow, ipcMain, session } = require('electron');

// This affects only the isolated audit process. Keep CSS pixels and Chromium's
// reported viewport on the exact stage dimensions so a one-pixel mismatch is
// evidence, not a platform scale-factor artefact.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

if (fs.existsSync(outRoot)) throw new Error(`Refusing to overwrite an existing audit: ${outRoot}`);
fs.mkdirSync(outRoot, { recursive: true });
app.setName('AthenaPublicCardMatrix');
app.setPath('userData', path.join(outRoot, 'isolated-user-data'));
app.setPath('sessionData', path.join(outRoot, 'isolated-session-data'));
app.disableHardwareAcceleration();

const networkAttempts = [];
const rendererErrors = [];
const invokedChannels = [];
const reports = [];
const missing = [];
const captures = [];
let win;
let timeout;

function isAllowedLocalUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') return true;
  if (parsed.protocol !== 'file:') return false;
  try {
    const candidate = fs.realpathSync(fileURLToPath(parsed));
    const relative = path.relative(appRootReal, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`)
      && relative !== '..' && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

function syntheticValue(role, boardId, slotId, ordinal) {
  const seed = ordinal % 3 === 0 ? 0 : ordinal % 2 === 0 ? -12345 - ordinal : 12345 + ordinal;
  if (role === 'bound-name' || role === 'bound-label') return `공개 합성 ${boardId}`;
  if (role === 'bound-identifier') return `QA${String(ordinal).padStart(4, '0')}`;
  if (role === 'bound-time' || role === 'time') return '20260101101500';
  if (role === 'status') return '공개 합성 상태';
  if (role === 'caption') return '공개 합성 기준';
  if (role === 'unavailable') return '공개 합성 확인 불가';
  if (role === 'price-composite') return { value: seed, text: `${seed >= 0 ? '+' : ''}${seed}원 · +1.23%` };
  if (role === 'direction') return seed >= 0 ? '상승' : '하락';
  if (role === 'price' || role === 'quote-magnitude' || role === 'bound-format') return seed;
  return `공개 합성 ${slotId}`;
}

function slotValuesFor(boardId) {
  return Object.fromEntries(Object.entries(displayPolicy[boardId]).map(([slotId, rule], index) => (
    [slotId, syntheticValue(rule[1], boardId, slotId, index + 1)]
  )));
}

function surfaceSlotValuesFor(boardId) {
  const values = slotValuesFor(boardId);
  // Product watch reconcilers consume observation entries so they can fail
  // closed when membership metadata is absent. Other boards accept the
  // ordinary slot-id map. This fixture follows those current input contracts.
  if (!['2U5L-1', '2UBO-1', '3D4I-0', '3EWN-0'].includes(boardId)) return values;
  return Object.entries(values).map(([slot_id, value], index) => ({
    slot_id, value, observation_id: `public-${boardId}-${index + 1}`, row_index: index,
  }));
}

function watchSourceContext(boardId, operationRef, slotValues) {
  if (!['2UBO-1', '3D4I-0', '3EWN-0'].includes(boardId)) return null;
  const requested = boardId === '2UBO-1' ? 'PUBLIC-THEME' : '000000';
  const managed = new Set(watchSourceSlots[boardId] || []);
  const slots = slotValues.filter((entry) => managed.has(entry.slot_id)).map((entry) => ({
    slot_id: entry.slot_id,
    mapping_id: operationRef,
    identity: requested,
    row_state: 'present',
  }));
  return {
    kind: boardId === '2UBO-1' ? 'theme' : 'detail',
    requested_code: requested,
    ...(boardId === '2UBO-1'
      ? { detail_requested_code: requested, list_period: 'public', detail_period: 'public' }
      : { source_requested_code: requested }),
    slots,
    presence: slots.map((entry) => ({ slot_id: entry.slot_id, empty: false })),
  };
}

function authoredLayoutExpectation(boardId) {
  const html = registry.boardHtml(boardId) || '';
  const countClass = (name) => [...html.matchAll(/class=["']([^"']+)["']/g)]
    .filter((match) => match[1].split(/\s+/).includes(name)).length;
  return { footerCount: countClass('bs-footer'), tableCount: countClass('bs-table') };
}

function controlExpectation(boardId) {
  const all = registry.stateLinksFor(boardId).map((link) => ({
    control: String(link.control || ''),
    target: String(link.board_id || ''),
    navigation: link.navigation || null,
    acceptedLabels: [...new Set([
      String(link.control || ''), ...registry.controlLabels(link.control),
      ...registry.additionalControlLabels(link.control),
    ].filter(Boolean))],
  }));
  const directKeys = new Set(registry.directStateLinksFor(boardId)
    .map((link) => `${link.board_id}|${link.control}`));
  const gated = boardId === '2U5L-1'
    ? new Set(all.filter((link) => link.target === '3EWN-0')
      .map((link) => `${link.target}|${link.control}`)) : new Set();
  const requiredDirect = all.filter((link) => directKeys.has(`${link.target}|${link.control}`)
    && !gated.has(`${link.target}|${link.control}`));
  const requiredNavigation = boardId === '2U5L-1' ? [] : all.filter((link) => link.navigation);
  const requiredKeys = new Set([...requiredDirect, ...requiredNavigation]
    .map((link) => `${link.target}|${link.control}`));
  const inherited = all.filter((link) => !requiredKeys.has(`${link.target}|${link.control}`));
  return {
    all, requiredDirect, requiredNavigation, inherited,
    notExercised: [...gated].map((key) => ({ key, reason: 'product fixture gate' })),
  };
}

function chartData(target, period, trId) {
  const candles = Array.from({ length: 28 }, (_, index) => {
    const close = 10000 + index * 17;
    return {
      time: period === 'min'
        ? Math.floor(Date.UTC(2026, 7, 3, 1, 15) / 1000) + index * 60
        : `2026-08-${String(index + 1).padStart(2, '0')}`,
      open: close - 9, high: close + 18, low: close - 21, close, volume: 1000 + index * 13,
    };
  });
  return {
    symbol: 'QA0001',
    name: '공개 합성 차트',
    chart: { period, target, trId, candles },
  };
}

function orderbookFields() {
  const fields = [
    { key: 'stk_nm', value: '공개 합성 종목' },
    { key: 'stk_cd', value: '000000' },
  ];
  for (let level = 1; level <= 10; level += 1) {
    fields.push({ key: `sel_${level}bid`, value: 10100 + level * 10 });
    fields.push({ key: `buy_${level}bid`, value: 10100 - level * 10 });
    fields.push({ key: `sel_${level}bid_req`, value: 1000 + level });
    fields.push({ key: `buy_${level}bid_req`, value: 2000 + level });
  }
  return fields;
}

function envelopeFor(row) {
  const boardId = row.template_id;
  const primary = registry.primaryRendererFor(boardId);
  const chartContract = boardId === '137X-2' ? { operationRef: 'base:ka10081', target: 'stock', period: 'day', trId: 'ka10081' }
    : boardId === '2RJ7-1' ? { operationRef: 'base:ka50092', target: 'gold', period: 'min', trId: 'ka50092' }
      : boardId === '32S7-0' ? { operationRef: 'base:ka20006', target: 'sector', period: 'day', trId: 'ka20006' }
        : null;
  const operationRef = chartContract?.operationRef
    || (boardId === '2U5L-1' || boardId === '3D4I-0' || boardId === '3EWN-0') && 'base:ka10095'
    || boardId === '2UBO-1' && 'base:ka90001'
    || primary === 'orderbook-ladder' && 'base:ka10007'
    || 'base:ka10099';
  const surfaceSlotValues = surfaceSlotValuesFor(boardId);
  const envelope = {
    canvas_type: primary === 'athena-chart' ? 'chart' : 'facts',
    card_id: registry.cardIdFor(boardId),
    card_kind: row.card_kind,
    card_title: `공개 합성 ${row.prompt}`,
    mode: 'overview',
    operation_ref: operationRef,
    operation_refs: boardId === '2UBO-1'
      ? ['base:ka90001', 'base:ka90002'] : [operationRef],
    renderer_id: primary === 'athena-chart' ? 'aits-chart-v1' : undefined,
    stk_cd: '000000',
    symbol: '000000',
    source_data: { canvas_context: { symbol: '000000', synthetic: true } },
    view_instance_id: `public-matrix-${boardId}`,
    surface_contract: {
      board_id: boardId,
      slot_values: surfaceSlotValues,
      hydration_slot_ids: [],
      unbound_slots: [],
      empty_rows: [],
      empty_columns: [],
      empty_value_slots: [],
    },
  };
  const watchContext = watchSourceContext(boardId, operationRef, surfaceSlotValues);
  if (watchContext) envelope.surface_contract.watch_source_context = watchContext;
  if (primary === 'athena-chart') envelope.data = chartData(
    chartContract.target, chartContract.period, chartContract.trId,
  );
  else if (primary === 'orderbook-ladder') envelope.data = { fields: orderbookFields() };
  else envelope.data = { synthetic: true };
  return envelope;
}

function safeHandle(channel, reply) {
  ipcMain.handle(channel, async (_event, payload) => {
    invokedChannels.push({ channel, payloadPresent: payload !== undefined });
    return typeof reply === 'function' ? reply(payload) : reply;
  });
}

safeHandle('athena:realtime-generation', 1);
safeHandle('athena:settings:prefs:get', {});
safeHandle('athena:brain-cluster-map', { clusters: [] });
safeHandle('athena:brain-suggested-questions', { questions: [] });
safeHandle('athena:brain-profile-summary', { rows: [] });
safeHandle('athena:integrated-card-realtime-policy', [{ rules: [] }]);
safeHandle('athena:integrated-card-realtime-unmount', { ok: true, status: 'stopped' });
safeHandle('athena:integrated-card-realtime-release-all', { ok: true });
safeHandle('athena:orderbook-realtime-acquire', { ok: true, status: 'fixture-disabled' });
safeHandle('athena:orderbook-realtime-release', true);
safeHandle('athena:realtime-acquire', { ok: true, status: 'fixture-disabled' });
safeHandle('athena:realtime-release', true);
safeHandle('athena:realtime-fallback-status', { ok: true, status: 'snapshot' });
safeHandle('athena:realtime-fallback-register', { ok: false, status: 'fixture-disabled' });
safeHandle('athena:realtime-fallback-unregister', true);
// shell.html starts these read-only views before the matrix paints a card. Keep
// the fixture explicit and empty: it supplies no financial values, profiles,
// provider state, or persisted user data and cannot trigger a mutation.
safeHandle('athena:conversations-list', {
  activeId: null, activeMode: 'summary', currentProjectId: null, projects: [], conversations: [],
});
safeHandle('athena:account-list', { accounts: [] });
safeHandle('athena:routines-list', { ok: true, data: { routines: [] } });
safeHandle('athena:mcp-list', { servers: [], revision: 0 });
safeHandle('athena:backtest-indicators', { ok: true, data: { indicators: [] } });
safeHandle('athena:backtest-presets', { ok: true, data: { presets: [] } });
safeHandle('athena:backtest-user-strategies', { ok: true, data: { strategies: [] } });
safeHandle('athena:boot-readiness:get', {
  runId: 'public-matrix-fixture', revision: 1, phase: 'ready', tasks: [],
});
safeHandle('athena:model-get', {
  claude: { model: null, effort: null },
  grok: { model: null, effort: null },
  codex: { model: null, effort: null, modelCatalog: [] },
  active: { provider: null, model: null, effort: null },
});
safeHandle('athena:cli-list', {
  providers: [
    { id: 'claude', name: 'Claude', connected: false, accounts: [] },
    { id: 'grok', name: 'Grok', connected: false, accounts: [] },
    { id: 'codex', name: 'Codex', connected: false, accounts: [] },
  ],
});
safeHandle('athena:onboarding-state', { needed: false, step: 3 });

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settleFrame() {
  await win.webContents.executeJavaScript(`new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
  })`);
  await pause(80);
}

async function awaitShellReady() {
  return win.webContents.executeJavaScript(`(async () => {
    const deadline = performance.now() + 10000;
    let observation = null;
    while (performance.now() < deadline) {
      const boot = document.querySelector('#boot');
      const shell = document.querySelector('#shell');
      const appRoot = document.querySelector('#app');
      const grid = document.querySelector('#grid');
      const gridRect = grid?.getBoundingClientRect();
      observation = {
        bootHidden: !!boot?.hidden,
        bootPhase: boot?.dataset.phase || null,
        shellHidden: !!shell?.hidden,
        appHidden: !!appRoot?.hidden,
        gridWidth: gridRect?.width || 0,
        gridHeight: gridRect?.height || 0,
        devicePixelRatio,
        visualViewport: window.visualViewport ? {
          width: window.visualViewport.width,
          height: window.visualViewport.height,
          scale: window.visualViewport.scale,
        } : null,
      };
      if (observation.bootHidden && !observation.shellHidden && !observation.appHidden
          && observation.gridWidth > 0 && observation.gridHeight > 0) return observation;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('product shell did not become measurable: ' + JSON.stringify(observation));
  })()`);
}

async function setExactStage(stage) {
  win.setContentSize(stage.width, stage.height);
  win.webContents.setZoomFactor(1);
  const started = Date.now();
  let observation = null;
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const actualContentSize = win.getContentSize();
    const renderer = await win.webContents.executeJavaScript(`(() => ({
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
      visualViewport: window.visualViewport ? {
        width: window.visualViewport.width,
        height: window.visualViewport.height,
        scale: window.visualViewport.scale,
      } : null,
    }))()`);
    observation = {
      exact: actualContentSize[0] === stage.width && actualContentSize[1] === stage.height
        && renderer.width === stage.width && renderer.height === stage.height,
      attempts: attempt,
      elapsedMs: Date.now() - started,
      actualContentSize,
      zoomFactor: win.webContents.getZoomFactor(),
      renderer,
    };
    if (observation.exact) break;
    await pause(25);
  }
  await settleFrame();
  return observation;
}

async function awaitBoard(boardId, nonce) {
  return win.webContents.executeJavaScript(`(async () => {
    const deadline = performance.now() + 10000;
    let card;
    while (performance.now() < deadline) {
      card = [...document.querySelectorAll('.card[data-board-surface="true"]')]
        .find((item) => item.dataset.sessionCardId === ${JSON.stringify(nonce)});
      if (card) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!card) throw new Error('new product board card did not appear: ' + ${JSON.stringify(boardId)});
    const activeCards = [...document.querySelectorAll('#grid .card')];
    if (activeCards.length !== 1 || activeCards[0] !== card) {
      throw new Error('expected exactly one active product card, found ' + activeCards.length);
    }
    window.__athenaPublicMatrixCard = card;
    card.dataset.publicMatrixNonce = ${JSON.stringify(nonce)};
    let loadError = null;
    try { await card.__athenaBoardLoadSettled; }
    catch (error) { loadError = String(error && error.message || error); }
    await document.fonts.ready;
    const host = card.querySelector('.board-surface-host');
    const ownerPanel = card.closest('.canvas-tab-panel');
    const actualBoardId = host?.__athenaBoard?.boardId || null;
    return {
      expectedBoardId: ${JSON.stringify(boardId)},
      actualBoardId,
      expectedMatched: actualBoardId === ${JSON.stringify(boardId)},
      actualCardId: card.dataset.cardId || null,
      actualCardKind: card.dataset.cardKind || null,
      ownerTabKey: ownerPanel?.dataset.tabKey || null,
      renderState: card.dataset.renderState || null,
      primaryError: host?.dataset.bsPrimaryError || null,
      loadError,
      strictReferenceInstalled: window.__athenaPublicMatrixCard === card,
      activeCards: activeCards.length,
    };
  })()`);
}

async function measure(boardId, nonce, controlsPlan, expectedPrimary, layoutExpectation) {
  return win.webContents.executeJavaScript(`(() => {
    const card = [...document.querySelectorAll('.card[data-board-surface="true"]')]
      .find((item) => item.dataset.publicMatrixNonce === ${JSON.stringify(nonce)});
    if (!card) return { missing: 'same card DOM is no longer connected' };
    const host = card.querySelector('.board-surface-host');
    const surface = host?.querySelector('.board-surface');
    if (!surface) return { missing: 'product board surface is absent' };
    const visible = (node) => !!node && node.checkVisibility({ checkVisibilityCSS: true });
    const round = (value) => Math.round(value * 1000) / 1000;
    const rect = (node) => { const box = node.getBoundingClientRect(); return {
      x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height),
      right: round(box.right), bottom: round(box.bottom),
    }; };
    const surfaceBeforeEndpointScroll = rect(surface);
    let surfaceBox = surfaceBeforeEndpointScroll;
    const cardBox = rect(card);
    const measurable = (node) => {
      if (!visible(node)) return false;
      const box = rect(node);
      return box.width > 0 && box.height > 0;
    };
    const nodes = [...surface.querySelectorAll('[data-node]')].filter(measurable);
    const footers = [...surface.querySelectorAll('.bs-footer')].filter(visible);
    const tables = [...surface.querySelectorAll('.bs-table')].filter(visible);
    const nodeIdentity = (node) => node.dataset.node
      || (typeof node.className === 'string' && node.className) || node.tagName;
    const scrollables = [...new Set([host, surface, ...surface.querySelectorAll('*')])].filter((node) => {
      const overflow = getComputedStyle(node).overflowX;
      return visible(node) && /^(auto|scroll)$/.test(overflow)
        && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1;
    });
    for (const node of scrollables) node.scrollLeft = node.scrollWidth;
    const horizontalScrollerEntries = scrollables.map((node) => ({
      node: nodeIdentity(node), overflow: getComputedStyle(node).overflowX,
      clientSize: node.clientWidth, scrollSize: node.scrollWidth, finalOffset: node.scrollLeft,
      reachedEnd: Math.abs(node.scrollLeft + node.clientWidth - node.scrollWidth) <= 2,
    }));
    const verticalScrollables = [card, ...card.querySelectorAll('*')].filter((node) => {
      const overflow = getComputedStyle(node).overflowY;
      return visible(node) && /^(auto|scroll)$/.test(overflow)
        && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1;
    });
    for (const node of verticalScrollables) {
      if (visible(node) && node.clientHeight > 0 && node.scrollHeight > node.clientHeight + 1) node.scrollTop = node.scrollHeight;
    }
    const verticalScrollerEntries = verticalScrollables.map((node) => ({
      node: nodeIdentity(node), overflow: getComputedStyle(node).overflowY,
      clientSize: node.clientHeight, scrollSize: node.scrollHeight, finalOffset: node.scrollTop,
      reachedEnd: Math.abs(node.scrollTop + node.clientHeight - node.scrollHeight) <= 2,
    }));
    const surfaceAtEndpoints = rect(surface);
    const controlsPlan = ${JSON.stringify(controlsPlan)};
    const controlNodes = [...surface.querySelectorAll('[data-state-board]')];
    const normalizeLabel = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const actualControls = controlNodes.map((node) => {
      const target = String(node.dataset.stateBoard || '');
      const stateLink = String(node.dataset.stateLink || '');
      const stateLinkControl = stateLink.startsWith(target + '|') ? stateLink.slice(target.length + 1) : '';
      const labels = [...new Set([
        node.dataset.stateControl, stateLinkControl, node.getAttribute('aria-label'),
        node.getAttribute('title'), node.textContent,
      ].map(normalizeLabel).filter(Boolean))];
      const matched = controlsPlan.all.find((link) => link.target === target
        && link.acceptedLabels.some((label) => labels.includes(normalizeLabel(label)))) || null;
      const box = rect(node);
      const cssVisible = visible(node);
      return {
        target,
        labels,
        visible: cssVisible,
        rendered: cssVisible && box.width > 0 && box.height > 0,
        rect: box,
        authored: !node.dataset.stateLink,
        exactPair: matched ? { control: matched.control, target: matched.target } : null,
      };
    });
    const required = [...controlsPlan.requiredDirect, ...controlsPlan.requiredNavigation];
    const matchesControl = (actual, link) => actual.target === link.target
      && link.acceptedLabels.some((label) => actual.labels.includes(normalizeLabel(label)));
    const requiredMissing = required.filter((link) => !actualControls.some((actual) => (
      actual.rendered && matchesControl(actual, link)
    )));
    const invalidActual = actualControls.filter((actual) => actual.rendered && !actual.exactPair);
    const rightmost = nodes.reduce((best, node) => !best || rect(node).right > rect(best).right ? node : best, null);
    const bottommost = nodes.reduce((best, node) => !best || rect(node).bottom > rect(best).bottom ? node : best, null);
    const finalRight = rightmost ? rect(rightmost).right : null;
    const finalBottom = bottommost ? rect(bottommost).bottom : null;
    const primary = ${JSON.stringify(expectedPrimary)};
    const layout = ${JSON.stringify(layoutExpectation)};
    const tableEndpoints = tables.map((table) => {
      const cells = [...table.querySelectorAll('[data-node]')].filter(measurable);
      const endpoint = cells.reduce((best, node) => !best || rect(node).right > rect(best).right ? node : best, null);
      const box = rect(table);
      const endpointBox = endpoint ? rect(endpoint) : null;
      return {
        node: endpoint?.dataset.node || null,
        rect: endpointBox,
        right: endpointBox?.right ?? null,
        ownerRight: box.right,
        contained: !!endpointBox && endpointBox.width > 0 && endpointBox.height > 0
          && endpointBox.right <= box.right + 2,
      };
    });
    const horizontalReachedEnds = horizontalScrollerEntries.length
      ? horizontalScrollerEntries.every((entry) => entry.reachedEnd)
      : null;
    const primaryMount = primary ? surface.querySelector('[data-bs-primary-mounted="' + primary + '"]') : null;
    const primaryErrorNode = primary ? surface.querySelector('[data-bs-primary-error]') : null;
    const primaryNode = primary === 'athena-chart' ? primaryMount?.querySelector('canvas')
      : primary === 'orderbook-ladder' ? primaryMount?.querySelector('.card-kit-hoga-live') : null;
    const primaryNodeBox = primaryNode ? rect(primaryNode) : null;
    const primaryError = primaryErrorNode?.dataset.bsPrimaryError
      || primaryMount?.dataset.bsPrimaryError || host.dataset.bsPrimaryError
      || card.dataset.renderState === 'error'
      || !!primaryMount?.querySelector('[role="alert"]');
    // Horizontal endpoint evidence is captured at the real scroll end. Restore
    // the scrollers before footer geometry so a full-surface scroller cannot
    // translate its own footer and create a systematic false containment error.
    for (const node of scrollables) node.scrollLeft = 0;
    surfaceBox = rect(surface);
    const horizontalClipOwner = (node) => {
      for (let parent = node.parentElement; parent && parent !== card; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX) && parent.clientWidth > 0) return parent;
      }
      return card;
    };
    const footerEntries = footers.map((node) => {
      const box = rect(node);
      const owner = horizontalClipOwner(node);
      const ownerBox = rect(owner);
      return {
        node: node.dataset.node || null,
        rect: box,
        owner: owner === card ? 'card' : owner.dataset.node || owner.className || owner.tagName,
        ownerRect: ownerBox,
        nonzero: box.width > 0 && box.height > 0,
        horizontalContained: box.x >= ownerBox.x - 2 && box.right <= ownerBox.right + 2
          && box.x >= cardBox.x - 2 && box.right <= cardBox.right + 2,
        bottomContained: box.bottom <= surfaceBox.bottom + 2 && box.bottom <= cardBox.bottom + 2,
      };
    });
    const footerBottom = footerEntries.length
      ? Math.max(...footerEntries.map((entry) => entry.rect.bottom)) : null;
    return {
      boardId: host.__athenaBoard?.boardId || null,
      sameDom: card === window.__athenaPublicMatrixCard,
      cardConnected: card.isConnected,
      activeCards: document.querySelectorAll('#grid .card').length,
      viewport: { width: innerWidth, height: innerHeight },
      card: cardBox, surface: surfaceBox, surfaceBeforeEndpointScroll,
      surfaceAtEndpoints,
      outerOverflowX: Math.max(0, surface.scrollWidth - surface.clientWidth),
      finalColumn: {
        applicable: layout.tableCount > 0,
        expectedTables: layout.tableCount,
        actualTables: tables.length,
        scrollableCount: scrollables.length,
        scrollers: horizontalScrollerEntries,
        reachedEnds: horizontalReachedEnds,
        endpoints: tableEndpoints,
        complete: layout.tableCount > 0
          ? tables.length >= layout.tableCount && tableEndpoints.length > 0
            && tableEndpoints.every((endpoint) => endpoint.contained)
          : null,
        visibleNodeRight: finalRight,
        withinSurface: finalRight === null || finalRight <= surfaceAtEndpoints.right + 2,
        withinCard: finalRight === null || finalRight <= cardBox.right + 2,
        surfaceWithinCard: surfaceAtEndpoints.x >= cardBox.x - 2
          && surfaceAtEndpoints.right <= cardBox.right + 2,
      },
      footer: {
        applicable: layout.footerCount > 0,
        expected: layout.footerCount,
        actual: footers.length,
        visibleBottom: footerBottom,
        entries: footerEntries,
        withinHorizontalOwner: footers.length
          ? footerEntries.every((entry) => entry.horizontalContained) : null,
        withinBottom: footers.length ? footerEntries.every((entry) => entry.bottomContained) : null,
        complete: layout.footerCount > 0
          ? footers.length >= layout.footerCount && footerEntries.every((entry) => (
            entry.nonzero && entry.horizontalContained && entry.bottomContained
          ))
          : null,
      },
      verticalEndpoint: {
        node: bottommost?.dataset.node || null,
        rect: bottommost ? rect(bottommost) : null,
        visibleNodeBottom: finalBottom,
        scrollableCount: verticalScrollables.length,
        scrollers: verticalScrollerEntries,
        reachedEnds: verticalScrollerEntries.length
          ? verticalScrollerEntries.every((entry) => entry.reachedEnd)
          : null,
        bottomContained: !!bottommost && finalBottom <= surfaceBox.bottom + 2 && finalBottom <= cardBox.bottom + 2,
        evidenced: !!bottommost && Number.isFinite(finalBottom),
      },
      controls: {
        requiredDirect: controlsPlan.requiredDirect,
        requiredNavigation: controlsPlan.requiredNavigation,
        inherited: controlsPlan.inherited,
        actualWired: actualControls,
        requiredMissing,
        invalidActual,
        notExercised: controlsPlan.notExercised,
        interactionVerified: false,
      },
      primary: {
        expected: primary || null,
        markerMounted: primary ? !!primaryMount && primaryMount.isConnected && visible(primaryMount) : null,
        rendererNodeMounted: primary ? !!primaryNode && primaryNode.isConnected && visible(primaryNode)
          && primaryNodeBox.width > 0 && primaryNodeBox.height > 0 : null,
        rendererNodeRect: primaryNodeBox,
        error: primary ? Boolean(primaryError) : null,
        errorDetail: primary ? String(
          typeof primaryError === 'string' ? primaryError
            : primaryErrorNode?.querySelector('[role="alert"]')?.textContent
              || primaryMount?.querySelector('[role="alert"]')?.textContent
              || (card.dataset.renderState === 'error' ? 'card renderState=error' : ''),
        ).trim() || null : null,
      },
    };
  })()`);
}

async function closeBoard(nonce) {
  return win.webContents.executeJavaScript(`(async () => {
    const card = [...document.querySelectorAll('.card')]
      .find((item) => item.dataset.publicMatrixNonce === ${JSON.stringify(nonce)});
    if (!card) {
      const activeCards = document.querySelectorAll('#grid .card').length;
      return { removed: activeCards === 0, activeCards };
    }
    if (card !== window.__athenaPublicMatrixCard) return { removed: false, activeCards: -1 };
    const panel = card.closest('.canvas-tab-panel');
    const tabKey = panel?.dataset.tabKey || null;
    const tab = tabKey ? [...document.querySelectorAll('.canvas-tab')]
      .find((item) => item.dataset.tabKey === tabKey) : null;
    // Board surfaces are owned by the product tab deck. Its close control calls
    // canvasTabDeck.close -> onClose -> destroyCard and releases renderer leases.
    // A non-tab product card may use only its own direct card-head close button.
    const close = tab?.querySelector('.canvas-tab-close')
      || card.querySelector(':scope > .card-head .uk-card-close');
    const closeContract = tab ? 'canvas-tab-close' : (close ? 'direct-card-close' : null);
    if (!close) return {
      removed: false, activeCards: document.querySelectorAll('#grid .card').length,
      closeContract, tabKey,
    };
    close.click();
    const deadline = performance.now() + 3000;
    while (card.isConnected && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const activeCards = document.querySelectorAll('#grid .card').length;
    const removed = !card.isConnected && activeCards === 0;
    if (removed) delete window.__athenaPublicMatrixCard;
    return { removed, activeCards, closeContract, tabKey };
  })()`);
}

function sourceUnchanged() {
  return Object.entries(sourcePins).every(([file, pin]) => sha256(path.join(appRoot, file)) === pin);
}

app.whenReady().then(async () => {
  timeout = setTimeout(() => app.exit(2), 8 * 60 * 1000);
  const isolated = session.fromPartition(`athena-public-matrix-${process.pid}`);
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolated.webRequest.onBeforeRequest(
    { urls: ['<all_urls>'] },
    (details, callback) => {
      const scheme = details.url.split(':', 1)[0].toLowerCase();
      const allowed = isAllowedLocalUrl(details.url);
      if (!allowed) networkAttempts.push({ scheme, outsideAppRoot: scheme === 'file' });
      callback({ cancel: !allowed });
    },
  );
  win = new BrowserWindow({
    show: false, width: STAGES[0].width, height: STAGES[0].height, useContentSize: true,
    webPreferences: {
      preload: path.join(appRoot, 'preload.js'), session: isolated, offscreen: true,
      sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
    },
  });
  win.webContents.setZoomFactor(1);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedLocalUrl(url)) {
      const scheme = String(url).split(':', 1)[0].toLowerCase();
      networkAttempts.push({ scheme, navigation: true, outsideAppRoot: scheme === 'file' });
      event.preventDefault();
    }
  });
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') rendererErrors.push(String(event.message).slice(0, 300));
  });
  await win.loadFile(path.join(appRoot, 'shell.html'));
  win.webContents.send('athena:init', { conversationId: 'public-matrix', publicSynthetic: true });
  const shellReady = await awaitShellReady();
  await settleFrame();

  for (const row of rows) {
    const boardId = row.template_id;
    if (OVERLAY_STATE_IDS.includes(boardId)) {
      missing.push({
        boardId,
        reason: 'NOT_EXERCISED_OVERLAY',
        observed: {
          expectedProductRoot: '13K0-2',
          nativeValidation: false,
          detail: 'This ID is a product control popover over the ranking parent, not a standalone board root.',
        },
      });
      continue;
    }
    const nonce = `public-${boardId}-${crypto.randomBytes(4).toString('hex')}`;
    const controlsPlan = controlExpectation(boardId);
    const expectedPrimary = registry.primaryRendererFor(boardId);
    const layoutExpectation = authoredLayoutExpectation(boardId);
    try {
      win.webContents.send('athena:add-canvas-live', {
        status: 'success', conversationId: 'public-matrix', sessionCardId: nonce,
        envelope: envelopeFor(row),
      });
      const mounted = await awaitBoard(boardId, nonce);
      if (!mounted.expectedMatched) {
        missing.push({
          boardId,
          reason: 'new product card did not reach the expected board',
          observed: mounted,
        });
        continue;
      }
      const stages = [];
      for (const stage of STAGES) {
        const viewportCalibration = await setExactStage(stage);
        const measured = await measure(
          boardId, nonce, controlsPlan, expectedPrimary, layoutExpectation,
        );
        const stageResult = {
          ...stage,
          actualContentSize: viewportCalibration.actualContentSize,
          viewportCalibration,
          ...measured,
        };
        stages.push(stageResult);
        if (captureBoardIds.includes(boardId)) {
          win.webContents.invalidate();
          await settleFrame();
          const png = (await win.webContents.capturePage()).toPNG();
          const relativePath = `captures/${boardId}-${stage.id}.png`;
          const target = path.join(outRoot, relativePath);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, png);
          captures.push({ boardId, stage: stage.id, path: relativePath, sha256: sha256Buffer(png) });
        }
      }
      reports.push({ boardId, cardId: registry.cardIdFor(boardId), variant: row.variant, mounted, stages });
    } catch (error) {
      missing.push({ boardId, reason: String(error && error.message || error).slice(0, 300) });
    } finally {
      const teardown = await closeBoard(nonce);
      if (!teardown.removed || teardown.activeCards !== 0) {
        throw new Error(`card teardown failed for ${boardId}: ${JSON.stringify(teardown)}`);
      }
      await settleFrame();
    }
  }

  const stageContractFailures = reports.filter((report) => report.stages.some((stage) => (
    stage.missing
      || stage.boardId !== report.boardId
      || stage.cardConnected !== true
      || stage.activeCards !== 1
      || stage.viewportCalibration?.exact !== true
      || stage.viewportCalibration?.zoomFactor !== 1
      || stage.viewportCalibration?.renderer?.devicePixelRatio !== 1
      || !Array.isArray(stage.actualContentSize)
      || stage.actualContentSize[0] !== stage.width
      || stage.actualContentSize[1] !== stage.height
      || stage.viewport?.width !== stage.width
      || stage.viewport?.height !== stage.height
  )));
  const sameDomFailures = reports.filter((report) => report.stages.some((stage) => stage.sameDom !== true));
  const primaryFailures = reports.filter((report) => (
    PRIMARY_EXPECTED[report.boardId] && report.stages.some((stage) => (
      stage.primary?.markerMounted !== true
        || stage.primary?.rendererNodeMounted !== true
        || stage.primary?.error !== false
    ))
  ));
  const controlFailures = reports.filter((report) => report.stages.some((stage) => (
    stage.controls?.requiredMissing.length || stage.controls?.invalidActual.length
  )));
  const controlNotExercised = reports.flatMap((report) => report.stages.flatMap((stage) => (
    stage.controls?.notExercised?.length ? [{ boardId: report.boardId, stage: stage.id,
      entries: stage.controls.notExercised, interactionVerified: false }] : []
  )));
  const geometryFailures = reports.filter((report) => report.stages.some((stage) => (
    stage.outerOverflowX > 2
      || stage.verticalEndpoint?.evidenced !== true
      || stage.verticalEndpoint?.bottomContained !== true
      || (stage.verticalEndpoint?.scrollableCount > 0 && stage.verticalEndpoint.reachedEnds !== true)
      || stage.finalColumn?.withinSurface !== true
      || stage.finalColumn?.withinCard !== true
      || stage.finalColumn?.surfaceWithinCard !== true
      || (stage.finalColumn?.scrollableCount > 0 && stage.finalColumn.reachedEnds !== true)
      || (stage.finalColumn?.applicable && stage.finalColumn.complete !== true)
      || (stage.footer?.applicable && (
        stage.footer.complete !== true || stage.footer.withinBottom !== true
      ))
  )));
  const sourcesStillPinned = sourceUnchanged();
  const hasIssues = missing.length || reports.length !== 94 || stageContractFailures.length
    || sameDomFailures.length
    || primaryFailures.length || controlFailures.length || geometryFailures.length
    || networkAttempts.length || rendererErrors.length || !sourcesStillPinned;
  const result = {
    status: hasIssues ? 'PUBLIC_SYNTHETIC_MATRIX_ISSUES' : 'PUBLIC_SYNTHETIC_MATRIX_PASS',
    evidenceLevel: 'PUBLIC_SYNTHETIC_PRODUCT_RENDERER_ONLY',
    nativeValidation: false,
    nativeCompletedStates: 0,
    providerCalls: 0,
    privateProfileReads: 0,
    productWrites: 0,
    liveOrderIdsBlocked: LIVE_ORDER_IDS,
    expectedStates: 94,
    mountedStates: reports.length,
    stages: STAGES,
    primaryExpected: PRIMARY_EXPECTED,
    shellReady,
    captureBoards: captureBoardIds,
    captures,
    stageContractFailures: stageContractFailures.map((report) => report.boardId),
    sameDomFailures: sameDomFailures.map((report) => report.boardId),
    primaryFailures: primaryFailures.map((report) => report.boardId),
    controlFailures: controlFailures.map((report) => report.boardId),
    controlNotExercised,
    geometryFailures: geometryFailures.map((report) => report.boardId),
    missing,
    reports,
    sourcePins,
    sourceUnchanged: sourcesStillPinned,
    pinnedRendererResources: sourceFiles,
    networkAttempts,
    rendererErrors,
    invokedChannels,
  };
  fs.writeFileSync(path.join(outRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    status: result.status,
    mountedStates: result.mountedStates,
    missing: result.missing.length,
    stageContractFailures: result.stageContractFailures.length,
    sameDomFailures: result.sameDomFailures.length,
    primaryFailures: result.primaryFailures.length,
    controlFailures: result.controlFailures.length,
    geometryFailures: result.geometryFailures.length,
    sourceUnchanged: result.sourceUnchanged,
    networkAttempts: result.networkAttempts.length,
    rendererErrors: result.rendererErrors.length,
    nativeValidation: false,
    nativeCompletedStates: 0,
  }));
  clearTimeout(timeout);
  win.destroy();
  app.exit(hasIssues ? 1 : 0);
}).catch((error) => {
  const failure = {
    status: 'PUBLIC_MATRIX_HARNESS_FAILED',
    evidenceLevel: 'PUBLIC_SYNTHETIC_PRODUCT_RENDERER_ONLY',
    nativeValidation: false,
    nativeCompletedStates: 0,
    providerCalls: 0,
    privateProfileReads: 0,
    productWrites: 0,
    runName,
    expectedStates: 94,
    mountedStates: reports.length,
    partialStateResults: reports,
    captureBoards: captureBoardIds,
    captures,
    missing,
    invokedChannels,
    error: String(error && error.stack || error),
    sourceUnchanged: sourceUnchanged(),
    sourcePins,
    pinnedRendererResources: sourceFiles,
    networkAttempts,
    rendererErrors,
  };
  fs.writeFileSync(path.join(outRoot, 'run-error.json'), `${JSON.stringify(failure, null, 2)}\n`);
  console.error(error);
  if (timeout) clearTimeout(timeout);
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(1);
});

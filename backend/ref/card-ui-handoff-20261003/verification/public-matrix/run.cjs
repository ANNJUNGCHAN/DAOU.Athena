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
const rankingControls = require(path.join(appRoot, 'lib/ranking-board-controls'));
const popoverLayout = require(path.join(appRoot, 'lib/board-popover-layout'));
const canvasSource = fs.readFileSync(path.join(appRoot, 'canvas.js'), 'utf8');
const watchSourceMatch = canvasSource.match(/^const WATCH_SOURCE_SLOTS = (.+);$/m);
assert.ok(watchSourceMatch, 'current canvas watch-source slot contract must be readable');
const watchSourceSlots = JSON.parse(watchSourceMatch[1]);
const watchlistGroupsMatch = canvasSource.match(/^const WATCHLIST_SLOT_GROUPS = (.+);$/m);
assert.ok(watchlistGroupsMatch, 'current canvas watchlist row contract must be readable');
const watchlistSlotGroups = JSON.parse(watchlistGroupsMatch[1]);
const historical = JSON.parse(fs.readFileSync(historicalPath, 'utf8'));
const rows = historical.rows;
const ids = rows.map((row) => String(row.template_id));
const LIVE_ORDER_IDS = Object.freeze([
  '135M-2', '1JZW-0', '2T63-1', '2TAG-1', '2TET-1', '2TJ6-1', '2TNJ-1',
]);
const OVERLAY_STATE_IDS = Object.freeze(['4A9H-1', '4AGN-1', '4ANS-1', '4AUX-1']);
const RANKING_PARENT_ID = '13K0-2';
const RANKING_PARENT_ROW = rows.find((row) => row.template_id === RANKING_PARENT_ID);
assert.ok(RANKING_PARENT_ROW, 'the ranking parent must remain in the public matrix');
const PUBLIC_RANKING_FIELDS = Object.freeze(['_position', 'stk_cd', 'stk_nm', 'cur_prc', 'flu_rt']);
const PUBLIC_RANKING_ROW_COUNT = 2;
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

function identityAssessment(entries) {
  const hardFailures = [];
  const notExercised = [];
  for (const entry of entries || []) {
    if (!entry.present) hardFailures.push({ identity: entry.identity, reason: 'EXPECTED_OWNER_MISSING' });
    else if (!entry.visible) notExercised.push({ identity: entry.identity, reason: entry.reason || 'CSS_HIDDEN' });
    else if (!entry.endpointPresent) {
      if (entry.reason) notExercised.push({ identity: entry.identity, reason: entry.reason });
      else hardFailures.push({ identity: entry.identity, reason: 'VISIBLE_ENDPOINT_MISSING' });
    } else if (!entry.contained) hardFailures.push({ identity: entry.identity, reason: 'VISIBLE_ENDPOINT_OVERFLOW' });
  }
  return {
    hardFailures,
    notExercised,
    complete: hardFailures.length === 0 && notExercised.length === 0,
  };
}

function controlAssessment(plan, actualControls) {
  const required = [...plan.requiredDirect, ...plan.requiredNavigation];
  const matches = (actual, link) => actual.target === link.target
    && link.acceptedLabels.some((label) => actual.labels.includes(String(label).trim().replace(/\s+/g, ' ')));
  return {
    requiredMissing: required.filter((link) => !(actualControls || []).some((actual) => (
      actual.wired && actual.rendered && matches(actual, link)
    ))),
    invalidActual: (actualControls || []).filter((actual) => actual.wired && actual.rendered
      && !plan.all.some((link) => matches(actual, link))),
  };
}

function overlayOptionContract(filterBoardId, operationRef = 'base:ka10032') {
  const management = filterBoardId === '4AUX-1'
    && ['base:ka10032', 'base:ka10030'].includes(operationRef);
  return {
    ariaLabel: management ? '관리종목 포함 조건' : {
      '4A9H-1': 'KOSPI', '4AGN-1': '등락 전체',
      '4ANS-1': '시가총액 전체', '4AUX-1': '유동성 정상',
    }[filterBoardId],
    options: rankingControls.selectionLabels(filterBoardId).flatMap((label) => {
      if (management && label === '관리·경고 제외') return [];
      const selection = rankingControls.selectionFor(filterBoardId, label);
      return [{
        label: management
          ? (label === '전체 포함' ? '관리종목 포함' : '관리종목 제외') : label,
        disabled: Boolean(selection?.unavailable),
      }];
    }),
  };
}

function overlayContractAssessment(expected, actual) {
  return Boolean(actual && actual.ariaLabel === expected.ariaLabel
    && JSON.stringify(actual.options) === JSON.stringify(expected.options));
}

function rankingTableAssessment(expectedFields, expectedRows, actual) {
  return Boolean(actual?.present
    && JSON.stringify(actual.headerFields) === JSON.stringify(expectedFields)
    && actual.rowCount === expectedRows
    && actual.rowFields.every((fields) => JSON.stringify(fields) === JSON.stringify(expectedFields)));
}

function watchlistRowsContractValid(metadata) {
  const code = (value) => typeof value === 'string'
    && /^[0-9A-Z]{6}(?:_(?:AL|NX))?$/.test(value) && value !== '000000';
  return Boolean(metadata && metadata.membership_received === true
    && typeof metadata.group === 'string' && metadata.group
    && Array.isArray(metadata.rows) && metadata.rows.length === watchlistSlotGroups.length
    && metadata.rows.every((row, index) => row.row === index && code(row.code)
      && row.quote_state === 'received'
      && ['slot_ids', 'quote_slot_ids', 'member_slot_ids'].every((key) => (
        Array.isArray(row[key])
          && JSON.stringify(row[key]) === JSON.stringify(watchlistSlotGroups[index][key])
      ))
      && ['present_slots', 'empty_slots'].every((key) => Array.isArray(row[key])
        && row[key].every((slotId) => watchlistSlotGroups[index].slot_ids.includes(slotId)))));
}

function syntheticHasIssues(result) {
  return Boolean(result.missing.length || result.reports.length !== 94
    || result.stageContractFailures.length || result.sameDomFailures.length
    || result.primaryFailures.length || result.controlFailures.length
    || result.controlNotExercised.length || result.geometryFailures.length
    || result.geometryNotExercised.length || result.overlayFailures.length
    || result.networkAttempts.length || result.rendererErrors.length || !result.sourcesStillPinned);
}

function selfTest() {
  assert.deepEqual(identityAssessment([{ identity: 'gone', present: false }]).hardFailures,
    [{ identity: 'gone', reason: 'EXPECTED_OWNER_MISSING' }]);
  assert.deepEqual(identityAssessment([{
    identity: 'overflow', present: true, visible: true, endpointPresent: true, contained: false,
  }]).hardFailures, [{ identity: 'overflow', reason: 'VISIBLE_ENDPOINT_OVERFLOW' }]);
  const hidden = identityAssessment([{
    identity: 'hidden', present: true, visible: false, endpointPresent: false, contained: false,
    reason: 'CSS_HIDDEN',
  }]);
  assert.equal(hidden.complete, false);
  assert.equal(hidden.notExercised.length, 1);
  const plan = {
    all: [{ target: 'known', acceptedLabels: ['Known'] }],
    requiredDirect: [{ target: 'known', acceptedLabels: ['Known'] }],
    requiredNavigation: [],
  };
  assert.equal(controlAssessment(plan, [{
    target: 'unknown', labels: ['Unknown'], wired: true, rendered: true,
  }]).invalidActual.length, 1);
  assert.equal(controlAssessment(plan, [{
    target: 'known', labels: ['Known'], wired: true, rendered: true,
  }]).requiredMissing.length, 0);
  const marketCap = overlayOptionContract('4ANS-1');
  assert.deepEqual(marketCap.options.map((entry) => entry.disabled), [false, true, true]);
  const management = overlayOptionContract('4AUX-1');
  assert.deepEqual(management.options.map((entry) => entry.label), ['관리종목 제외', '관리종목 포함']);
  assert.equal(overlayContractAssessment(management, {
    ariaLabel: management.ariaLabel,
    options: [management.options[1], management.options[0]],
  }), false);
  assert.equal(overlayContractAssessment(marketCap, {
    ariaLabel: marketCap.ariaLabel,
    options: marketCap.options.map((entry) => ({ ...entry, disabled: false })),
  }), false);
  assert.equal(rankingTableAssessment(PUBLIC_RANKING_FIELDS, PUBLIC_RANKING_ROW_COUNT, {
    present: true, headerFields: [...PUBLIC_RANKING_FIELDS].reverse(), rowCount: 2,
    rowFields: [PUBLIC_RANKING_FIELDS, PUBLIC_RANKING_FIELDS],
  }), false);
  assert.equal(rankingTableAssessment(PUBLIC_RANKING_FIELDS, PUBLIC_RANKING_ROW_COUNT, {
    present: true, headerFields: PUBLIC_RANKING_FIELDS, rowCount: 1,
    rowFields: [PUBLIC_RANKING_FIELDS],
  }), false);
  assert.ok(controlExpectation('2U5L-1').requiredDirect.some((link) => (
    link.target === '3EWN-0' && link.control === 'ELW 행 펼침'
  )));
  const managementPlan = controlExpectation(RANKING_PARENT_ID, 'base:ka10032', {
    mang_stk_incls: '0',
  });
  const managementLink = managementPlan.all.find((link) => link.target === '4AUX-1');
  assert.ok(managementLink.acceptedLabels.includes('관리종목 제외'));
  assert.equal(controlExpectation(RANKING_PARENT_ID, 'base:ka10032', {
    mang_stk_incls: '1',
  }).all.find((link) => link.target === '4AUX-1').acceptedLabels.includes('관리종목 제외'), false);
  assert.equal(controlAssessment(managementPlan, [{
    target: '4ANS-1', labels: ['관리종목 제외'], wired: true, rendered: true,
  }]).invalidActual.length, 1);
  assert.equal(controlAssessment(managementPlan, [{
    target: '4AUX-1', labels: ['관리종목 포함'], wired: true, rendered: true,
  }]).invalidActual.length, 1);
  const watchlist = watchlistRowsContract(surfaceSlotValuesFor('2U5L-1'));
  assert.equal(watchlistRowsContractValid(watchlist), true);
  assert.equal(watchlistRowsContractValid({
    ...watchlist, rows: watchlist.rows.slice(0, -1),
  }), false);
  assert.equal(syntheticHasIssues({
    missing: [], reports: Array.from({ length: 94 }), stageContractFailures: [], sameDomFailures: [],
    primaryFailures: [], controlFailures: [], controlNotExercised: [], geometryFailures: [],
    geometryNotExercised: [{ boardId: 'hidden' }], overlayFailures: [], networkAttempts: [],
    rendererErrors: [], sourcesStillPinned: true,
  }), true);
  return 20;
}

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

if (process.argv.includes('--self-test')) {
  console.log(JSON.stringify({ status: 'SELF_TEST_PASS', assertions: selfTest() }));
  process.exit(0);
}

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

function watchlistRowsContract(slotValues) {
  const entries = new Map(slotValues.map((entry) => [entry.slot_id, entry]));
  const metadata = {
    group: 'PUBLIC-SYNTHETIC',
    membership_received: true,
    rows: watchlistSlotGroups.map((group, row) => {
      const codeEntry = group.member_slot_ids.map((slotId) => entries.get(slotId))
        .find((entry) => /^[0-9A-Z]{6}(?:_(?:AL|NX))?$/.test(String(entry?.value || ''))
          && String(entry.value) !== '000000');
      return {
        row,
        code: codeEntry ? String(codeEntry.value) : null,
        slot_ids: [...group.slot_ids],
        present_slots: group.slot_ids.filter((slotId) => entries.has(slotId)),
        quote_slot_ids: [...group.quote_slot_ids],
        member_slot_ids: [...group.member_slot_ids],
        empty_slots: [],
        quote_row_index: row,
        quote_state: 'received',
      };
    }),
  };
  assert.ok(watchlistRowsContractValid(metadata), 'public watchlist fixture must match the live row contract');
  return metadata;
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

function authoredClassIdentities(html, className) {
  return [...html.matchAll(/<[^>]+>/g)].flatMap((match) => {
    const tag = match[0];
    const classes = tag.match(/class=["']([^"']+)["']/)?.[1]?.split(/\s+/) || [];
    if (!classes.includes(className)) return [];
    const node = tag.match(/data-node=["']([^"']+)["']/)?.[1] || null;
    return node ? [{ identity: node, selector: `[data-node="${node}"]` }] : [];
  });
}

function authoredLayoutExpectation(boardId) {
  const html = registry.boardHtml(boardId) || '';
  return {
    footers: authoredClassIdentities(html, 'bs-footer'),
    tables: [
      ...authoredClassIdentities(html, 'bs-table'),
      ...(boardId === '4B22-1'
        ? [{ identity: 'runtime:expanded-ranking-table', selector: '.bs-ranking-table' }] : []),
    ],
  };
}

function controlExpectation(boardId, operationRef = '', target = {}) {
  const productLinks = rankingControls.linksFor(boardId, registry.stateLinksFor(boardId));
  const all = productLinks.map((link) => ({
    control: String(link.control || ''),
    target: String(link.board_id || ''),
    navigation: link.navigation || null,
    acceptedLabels: [...new Set([
      String(link.control || ''), ...registry.controlLabels(link.control),
      ...registry.additionalControlLabels(link.control),
      ...(boardId === RANKING_PARENT_ID
        && operationRef === 'base:ka10032'
        && String(target.mang_stk_incls) === '0'
        && link.board_id === '4AUX-1'
        && link.control === '유동성 정상' ? ['관리종목 제외'] : []),
    ].filter(Boolean))],
  }));
  const directKeys = new Set(registry.directStateLinksFor(boardId)
    .map((link) => `${link.board_id}|${link.control}`));
  const requiredDirect = all.filter((link) => directKeys.has(`${link.target}|${link.control}`));
  const requiredNavigation = boardId === '2U5L-1' ? [] : all.filter((link) => link.navigation);
  const requiredKeys = new Set([...requiredDirect, ...requiredNavigation]
    .map((link) => `${link.target}|${link.control}`));
  const inherited = all.filter((link) => !requiredKeys.has(`${link.target}|${link.control}`));
  return {
    all, requiredDirect, requiredNavigation, inherited,
    notExercised: [],
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

function publicRankingResult(operationRef) {
  const columns = [
    { key: '_position', label: '순위', role: 'identifier', format: { literal: true } },
    { key: 'stk_cd', label: '종목코드', role: 'identifier', format: { literal: true } },
    { key: 'stk_nm', label: '종목명', role: 'bound-name', format: { literal: true } },
    { key: 'cur_prc', label: '현재가', role: 'price', format: { kind: 'number', suffix: '원' } },
    { key: 'flu_rt', label: '등락률', format: { kind: 'percent', digits: 2 } },
  ];
  return {
    board_id: '4B22-1', operation_ref: operationRef, columns,
    rows: [
      { _position: '1', stk_cd: 'QA0001', stk_nm: '공개 합성 첫 종목', cur_prc: 10100, flu_rt: 1.25 },
      { _position: '2', stk_cd: 'QA0002', stk_nm: '공개 합성 둘째 종목', cur_prc: 9900, flu_rt: -0.75 },
    ],
    received_count: PUBLIC_RANKING_ROW_COUNT, truncated: false,
  };
}

function envelopeFor(row) {
  const boardId = row.template_id;
  const primary = registry.primaryRendererFor(boardId);
  const chartContract = boardId === '137X-2' ? { operationRef: 'base:ka10081', target: 'stock', period: 'day', trId: 'ka10081' }
    : boardId === '2RJ7-1' ? { operationRef: 'base:ka50092', target: 'gold', period: 'min', trId: 'ka50092' }
      : boardId === '32S7-0' ? { operationRef: 'base:ka20006', target: 'sector', period: 'day', trId: 'ka20006' }
        : null;
  const operationRef = chartContract?.operationRef
    || boardId === RANKING_PARENT_ID && 'base:ka10032'
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
    operation_args: boardId === RANKING_PARENT_ID ? { mang_stk_incls: '0' } : undefined,
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
  if (boardId === '2U5L-1') {
    envelope.surface_contract.watchlist_rows = watchlistRowsContract(surfaceSlotValues);
  }
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
// The public chart fixture has no earlier page. Match the product response
// shape while keeping this explicit empty result out of native-history proof.
safeHandle('athena:chart-history-page', { ok: true, candles: [] });
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
safeHandle('athena:canvas-board-hydrate', (payload = {}) => {
  if (String(payload.boardId || '') !== '4B22-1') return { ok: false, status: 'unavailable' };
  const operationRef = String(payload.rankingOperationRef || '');
  if (!['base:ka10032', 'base:ka10030', 'base:ka00198'].includes(operationRef)) {
    return { ok: false, status: 'error', error: 'unsupported public ranking operation' };
  }
  return {
    ok: true, slot_values: {}, operations: [],
    surface_contract: {
      board_id: '4B22-1', slot_values: [], hydration_slot_ids: [], unbound_slots: [],
      empty_rows: [], empty_columns: [], empty_value_slots: [],
    },
    ranking_result: publicRankingResult(operationRef),
  };
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

async function activateProductControl(nonce, targetBoardId, control, acceptedLabels) {
  return win.webContents.executeJavaScript(`(() => {
    const card = [...document.querySelectorAll('.card[data-board-surface="true"]')]
      .find((item) => item.dataset.publicMatrixNonce === ${JSON.stringify(nonce)});
    const surface = card?.querySelector('.board-surface');
    if (!surface) throw new Error('product surface missing before control activation');
    const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const wanted = ${JSON.stringify(acceptedLabels)}.map(normalize);
    const candidates = [...surface.querySelectorAll('[data-state-board="${targetBoardId}"]')]
      .filter((node) => node.__athenaStateWired === true && node.checkVisibility({ checkVisibilityCSS: true }));
    const node = candidates.find((candidate) => [
      candidate.dataset.stateControl, candidate.getAttribute('aria-label'), candidate.getAttribute('title'),
      candidate.textContent,
    ].map(normalize).some((label) => wanted.includes(label)));
    if (!node) throw new Error('real wired product control missing: ' + wanted.join(' | ') + ' -> ${targetBoardId}');
    node.click();
    return { clicked: true, target: node.dataset.stateBoard, control: normalize(node.textContent),
      node: node.dataset.node || null, role: node.getAttribute('role') || node.tagName.toLowerCase() };
  })()`);
}

async function awaitOverlay(filterBoardId, nonce) {
  const menuNode = popoverLayout.MENUS[filterBoardId]?.[0];
  assert.ok(menuNode, `overlay ${filterBoardId} must have a canonical authored menu`);
  return win.webContents.executeJavaScript(`(async () => {
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      const card = [...document.querySelectorAll('.card[data-board-surface="true"]')]
        .find((item) => item.dataset.publicMatrixNonce === ${JSON.stringify(nonce)});
      const host = card?.querySelector('.board-surface-host');
      const menu = host?.querySelector('.bs-parent-ranking-menu[role="menu"][data-node="${menuNode}"]');
      if (menu && menu.checkVisibility({ checkVisibilityCSS: true })) return {
        productRoot: host.__athenaBoard?.boardId || null,
        menuNode: menu.dataset.node || null,
        activeCards: document.querySelectorAll('#grid .card').length,
      };
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('product ranking overlay did not open: ${filterBoardId}');
  })()`);
}

async function measureOverlay(filterBoardId, nonce) {
  const menuNode = popoverLayout.MENUS[filterBoardId][0];
  const expected = overlayOptionContract(filterBoardId);
  return win.webContents.executeJavaScript(`(() => {
    const card = [...document.querySelectorAll('.card[data-board-surface="true"]')]
      .find((item) => item.dataset.publicMatrixNonce === ${JSON.stringify(nonce)});
    const surface = card?.querySelector('.board-surface');
    const menu = surface?.querySelector('.bs-parent-ranking-menu[role="menu"][data-node="${menuNode}"]');
    if (!card || !surface || !menu) return { present: false, complete: false };
    for (const node of [card, ...card.querySelectorAll('*')]) {
      if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) node.scrollTop = 0;
      if (/^(auto|scroll)$/.test(getComputedStyle(node).overflowX)) node.scrollLeft = 0;
    }
    menu.repositionParentRankingMenu?.();
    const box = menu.getBoundingClientRect(), surfaceBox = surface.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const options = [...menu.querySelectorAll('[role="menuitem"]')]
      .filter((node) => node.checkVisibility({ checkVisibilityCSS: true }))
      .map((node) => {
        const leaves = [...node.querySelectorAll('*')].filter((leaf) => !leaf.children.length)
          .map((leaf) => leaf.textContent.trim()).filter((text) => text && text !== '선택됨');
        return {
          label: node.getAttribute('aria-label') || leaves[0] || '',
          disabled: node.getAttribute('aria-disabled') === 'true',
        };
      });
    const contained = box.width > 0 && box.height > 0
      && box.x >= surfaceBox.x - 2 && box.right <= surfaceBox.right + 2
      && box.y >= surfaceBox.y - 2 && box.bottom <= surfaceBox.bottom + 2
      && box.x >= cardBox.x - 2 && box.right <= cardBox.right + 2
      && box.y >= cardBox.y - 2 && box.bottom <= cardBox.bottom + 2;
    return {
      present: true, productRoot: card.querySelector('.board-surface-host')?.__athenaBoard?.boardId || null,
      menuNode: menu.dataset.node || null, role: menu.getAttribute('role'), ariaLabel: menu.getAttribute('aria-label'),
      options, expected: ${JSON.stringify(expected)}, contained,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom },
      complete: contained
        && menu.getAttribute('aria-label') === ${JSON.stringify(expected.ariaLabel)}
        && JSON.stringify(options) === ${JSON.stringify(JSON.stringify(expected.options))},
    };
  })()`);
}

async function closeOverlay(filterBoardId, nonce) {
  return win.webContents.executeJavaScript(`(async () => {
    const card = [...document.querySelectorAll('.card[data-board-surface="true"]')]
      .find((item) => item.dataset.publicMatrixNonce === ${JSON.stringify(nonce)});
    const menu = card?.querySelector('.bs-parent-ranking-menu[role="menu"]');
    if (!menu) return { closed: false, reason: 'menu missing before close' };
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const deadline = performance.now() + 1000;
    while (menu.isConnected && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { closed: !menu.isConnected, filterBoardId: ${JSON.stringify(filterBoardId)} };
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
    const nodes = [...surface.querySelectorAll('[data-node], .bs-ranking-table :is(th,td)')].filter(measurable);
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
        wired: node.__athenaStateWired === true,
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
      actual.wired && actual.rendered && matchesControl(actual, link)
    )));
    const invalidActual = actualControls.filter((actual) => actual.wired
      && actual.rendered && !actual.exactPair);
    const rightmost = nodes.reduce((best, node) => !best || rect(node).right > rect(best).right ? node : best, null);
    const bottommost = nodes.reduce((best, node) => !best || rect(node).bottom > rect(best).bottom ? node : best, null);
    const finalRight = rightmost ? rect(rightmost).right : null;
    const finalBottom = bottommost ? rect(bottommost).bottom : null;
    const primary = ${JSON.stringify(expectedPrimary)};
    const layout = ${JSON.stringify(layoutExpectation)};
    const unavailableReason = (owner, cssVisible) => {
      if (!owner) return null;
      if (!cssVisible) {
        if (owner.hidden || owner.closest('[hidden]')) return 'PRODUCT_HIDDEN_ATTRIBUTE';
        if (owner.style.display === 'none') return 'PRODUCT_HIDDEN_INLINE';
        return 'PRODUCT_HIDDEN_COMPUTED';
      }
      if (primary && owner.querySelector('[data-bs-primary-mounted="' + primary + '"]')) {
        return 'SPECIALIZED_PRIMARY_RENDERER';
      }
      if (owner.matches('[class*="unavailable"], [class*="empty"], [class*="compact"]')
          || owner.querySelector('[role="status"], [data-missing="true"], [class*="unavailable"], [class*="empty"]')) {
        return 'PRODUCT_UNAVAILABLE_OR_COMPACT';
      }
      return null;
    };
    const assessIdentities = (entries) => {
      const hardFailures = [], notExercised = [];
      for (const entry of entries) {
        if (!entry.present) hardFailures.push({ identity: entry.identity, reason: 'EXPECTED_OWNER_MISSING' });
        else if (!entry.visible) notExercised.push({ identity: entry.identity, reason: entry.reason || 'CSS_HIDDEN' });
        else if (!entry.endpointPresent) {
          if (entry.reason) notExercised.push({ identity: entry.identity, reason: entry.reason });
          else hardFailures.push({ identity: entry.identity, reason: 'VISIBLE_ENDPOINT_MISSING' });
        } else if (!entry.contained) hardFailures.push({ identity: entry.identity, reason: 'VISIBLE_ENDPOINT_OVERFLOW' });
      }
      return { hardFailures, notExercised,
        complete: hardFailures.length === 0 && notExercised.length === 0 };
    };
    const tableEntries = layout.tables.map((expected) => {
      const table = surface.querySelector(expected.selector);
      const cssVisible = visible(table);
      const cells = table ? [...table.querySelectorAll('[data-node], th, td')].filter(measurable) : [];
      const endpoint = cells.reduce((best, node) => !best || rect(node).right > rect(best).right ? node : best, null);
      const box = table ? rect(table) : null;
      const endpointBox = endpoint ? rect(endpoint) : null;
      return {
        identity: expected.identity,
        present: !!table,
        visible: cssVisible,
        reason: unavailableReason(table, cssVisible),
        endpointPresent: !!endpointBox && endpointBox.width > 0 && endpointBox.height > 0,
        node: endpoint?.dataset.node || null,
        rect: endpointBox,
        right: endpointBox?.right ?? null,
        ownerRight: box?.right ?? null,
        contained: !!endpointBox && endpointBox.width > 0 && endpointBox.height > 0
          && endpointBox.right <= box.right + 2,
      };
    });
    const tableAssessment = assessIdentities(tableEntries);
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
    const footerEntries = layout.footers.map((expected) => {
      const node = surface.querySelector(expected.selector);
      const cssVisible = visible(node);
      const box = node ? rect(node) : null;
      const owner = node ? horizontalClipOwner(node) : null;
      const ownerBox = owner ? rect(owner) : null;
      const nonzero = !!box && box.width > 0 && box.height > 0;
      const horizontalContained = nonzero && box.x >= ownerBox.x - 2 && box.right <= ownerBox.right + 2
        && box.x >= cardBox.x - 2 && box.right <= cardBox.right + 2;
      const bottomContained = nonzero && box.bottom <= surfaceBox.bottom + 2 && box.bottom <= cardBox.bottom + 2;
      return {
        identity: expected.identity,
        present: !!node,
        visible: cssVisible,
        reason: unavailableReason(node, cssVisible),
        endpointPresent: nonzero,
        contained: horizontalContained && bottomContained,
        node: node?.dataset.node || null,
        rect: box,
        owner: owner === card ? 'card' : owner?.dataset.node || owner?.className || owner?.tagName || null,
        ownerRect: ownerBox,
        nonzero,
        horizontalContained,
        bottomContained,
      };
    });
    const footerAssessment = assessIdentities(footerEntries);
    const visibleFooters = footerEntries.filter((entry) => entry.visible && entry.rect);
    const footerBottom = visibleFooters.length
      ? Math.max(...visibleFooters.map((entry) => entry.rect.bottom)) : null;
    const rankingTableNode = surface.querySelector('.bs-ranking-table');
    const rankingHeaderFields = rankingTableNode
      ? [...rankingTableNode.querySelectorAll('thead th[data-field]')].map((node) => node.dataset.field) : [];
    const rankingRows = rankingTableNode ? [...rankingTableNode.querySelectorAll('tbody > tr')] : [];
    const rankingRowFields = rankingRows.map((row) => (
      [...row.querySelectorAll('td[data-field]')].map((node) => node.dataset.field)
    ));
    const rankingTable = {
      applicable: ${JSON.stringify(boardId === '4B22-1')},
      present: !!rankingTableNode,
      headerFields: rankingHeaderFields,
      rowCount: rankingRows.length,
      rowFields: rankingRowFields,
      expectedFields: ${JSON.stringify(PUBLIC_RANKING_FIELDS)},
      expectedRows: ${PUBLIC_RANKING_ROW_COUNT},
      complete: ${JSON.stringify(boardId === '4B22-1')}
        ? !!rankingTableNode
          && JSON.stringify(rankingHeaderFields) === ${JSON.stringify(JSON.stringify(PUBLIC_RANKING_FIELDS))}
          && rankingRows.length === ${PUBLIC_RANKING_ROW_COUNT}
          && rankingRowFields.every((fields) => (
            JSON.stringify(fields) === ${JSON.stringify(JSON.stringify(PUBLIC_RANKING_FIELDS))}
          ))
        : null,
    };
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
        applicable: layout.tables.length > 0,
        expectedTables: layout.tables.length,
        actualTables: tableEntries.filter((entry) => entry.present).length,
        scrollableCount: scrollables.length,
        scrollers: horizontalScrollerEntries,
        reachedEnds: horizontalReachedEnds,
        endpoints: tableEntries,
        hardFailures: tableAssessment.hardFailures,
        notExercised: tableAssessment.notExercised,
        complete: layout.tables.length > 0 ? tableAssessment.complete : null,
        visibleNodeRight: finalRight,
        withinSurface: finalRight === null || finalRight <= surfaceAtEndpoints.right + 2,
        withinCard: finalRight === null || finalRight <= cardBox.right + 2,
        surfaceWithinCard: surfaceAtEndpoints.x >= cardBox.x - 2
          && surfaceAtEndpoints.right <= cardBox.right + 2,
      },
      footer: {
        applicable: layout.footers.length > 0,
        expected: layout.footers.length,
        actual: footerEntries.filter((entry) => entry.present).length,
        visibleBottom: footerBottom,
        entries: footerEntries,
        withinHorizontalOwner: visibleFooters.length
          ? visibleFooters.every((entry) => entry.horizontalContained) : null,
        withinBottom: visibleFooters.length ? visibleFooters.every((entry) => entry.bottomContained) : null,
        hardFailures: footerAssessment.hardFailures,
        notExercised: footerAssessment.notExercised,
        complete: layout.footers.length > 0 ? footerAssessment.complete : null,
      },
      rankingTable,
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
    const overlayState = OVERLAY_STATE_IDS.includes(boardId);
    const parentFlow = overlayState || boardId === '4B22-1';
    const mountedBoardId = parentFlow ? RANKING_PARENT_ID : boardId;
    const measuredBoardId = overlayState ? RANKING_PARENT_ID : boardId;
    const mountRow = parentFlow ? RANKING_PARENT_ROW : row;
    const mountEnvelope = envelopeFor(mountRow);
    const nonce = `public-${boardId}-${crypto.randomBytes(4).toString('hex')}`;
    const controlsPlan = controlExpectation(
      measuredBoardId, mountEnvelope.operation_ref, mountEnvelope.operation_args,
    );
    const expectedPrimary = registry.primaryRendererFor(measuredBoardId);
    const layoutExpectation = authoredLayoutExpectation(measuredBoardId);
    try {
      win.webContents.send('athena:add-canvas-live', {
        status: 'success', conversationId: 'public-matrix', sessionCardId: nonce,
        envelope: mountEnvelope,
      });
      const parentMounted = await awaitBoard(mountedBoardId, nonce);
      let mounted = parentMounted;
      let activation = null;
      let overlayOpened = null;
      if (parentFlow) {
        const control = overlayState
          ? rankingControls.linksFor(RANKING_PARENT_ID, []).find((link) => link.board_id === boardId)?.control
          : '더보기';
        assert.ok(control, `parent-flow control missing for ${boardId}`);
        const activationLink = controlsPlan.all.find((link) => link.target === boardId
          && link.control === control);
        assert.ok(activationLink, `parent-flow control contract missing for ${boardId}`);
        activation = await activateProductControl(nonce, boardId, control, activationLink.acceptedLabels);
        if (overlayState) overlayOpened = await awaitOverlay(boardId, nonce);
        else mounted = await awaitBoard(boardId, nonce);
      }
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
        const overlay = overlayState ? await measureOverlay(boardId, nonce) : null;
        const measured = await measure(
          measuredBoardId, nonce, controlsPlan, expectedPrimary, layoutExpectation,
        );
        const stageResult = {
          ...stage,
          actualContentSize: viewportCalibration.actualContentSize,
          viewportCalibration,
          ...measured,
          ...(overlayState ? { overlay } : {}),
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
      const overlayClose = overlayState ? await closeOverlay(boardId, nonce) : null;
      reports.push({
        boardId, cardId: registry.cardIdFor(boardId), variant: row.variant,
        expectedProductRoot: measuredBoardId, parentFlow, parentMounted, mounted,
        activation, overlayOpened, overlayClose, stages,
      });
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
      || stage.boardId !== report.expectedProductRoot
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
      || (report.boardId === '4B22-1' && stage.rankingTable?.complete !== true)
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
      || (stage.finalColumn?.hardFailures?.length > 0)
      || (stage.footer?.hardFailures?.length > 0)
  )));
  const geometryNotExercised = reports.flatMap((report) => report.stages.flatMap((stage) => {
    const entries = [
      ...(stage.finalColumn?.notExercised || []).map((entry) => ({ ...entry, kind: 'table' })),
      ...(stage.footer?.notExercised || []).map((entry) => ({ ...entry, kind: 'footer' })),
    ];
    return entries.length ? [{ boardId: report.boardId, stage: stage.id, entries }] : [];
  }));
  const overlayFailures = reports.filter((report) => OVERLAY_STATE_IDS.includes(report.boardId)
    && (report.expectedProductRoot !== RANKING_PARENT_ID
      || report.activation?.clicked !== true
      || report.overlayOpened?.productRoot !== RANKING_PARENT_ID
      || report.overlayOpened?.activeCards !== 1
      || report.overlayClose?.closed !== true
      || report.stages.some((stage) => stage.overlay?.complete !== true
        || stage.overlay?.productRoot !== RANKING_PARENT_ID
        || stage.overlay?.menuNode !== popoverLayout.MENUS[report.boardId]?.[0])));
  const sourcesStillPinned = sourceUnchanged();
  const result = {
    status: null,
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
    geometryNotExercised,
    overlayFailures: overlayFailures.map((report) => report.boardId),
    missing,
    reports,
    sourcePins,
    sourceUnchanged: sourcesStillPinned,
    pinnedRendererResources: sourceFiles,
    networkAttempts,
    rendererErrors,
    invokedChannels,
  };
  const hasIssues = syntheticHasIssues({
    ...result, stageContractFailures, sameDomFailures, primaryFailures, controlFailures,
    geometryFailures, overlayFailures, sourcesStillPinned,
  });
  result.status = hasIssues ? 'PUBLIC_SYNTHETIC_MATRIX_ISSUES' : 'PUBLIC_SYNTHETIC_MATRIX_PASS';
  fs.writeFileSync(path.join(outRoot, 'report.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({
    status: result.status,
    mountedStates: result.mountedStates,
    missing: result.missing.length,
    stageContractFailures: result.stageContractFailures.length,
    sameDomFailures: result.sameDomFailures.length,
    primaryFailures: result.primaryFailures.length,
    controlFailures: result.controlFailures.length,
    controlNotExercised: result.controlNotExercised.length,
    geometryFailures: result.geometryFailures.length,
    geometryNotExercised: result.geometryNotExercised.length,
    overlayFailures: result.overlayFailures.length,
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

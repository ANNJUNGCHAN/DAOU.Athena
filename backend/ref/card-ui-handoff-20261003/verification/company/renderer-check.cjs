// Execute only after root approval: isolated, hidden, offline public BoardMount check.
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { pathToFileURL } = require('url');
const root = path.resolve(__dirname, '../../../../..');
const previous = __dirname;
const sourceRoot = path.join(previous, 'public-source');
const historicalPins = JSON.parse(fs.readFileSync(path.join(previous, 'historical-public-source-pins.json'))).sourcePins;
const out = path.join(__dirname, 'renderer-output');
assert.equal(fs.existsSync(out), false, 'do not replace previous output');
const snapshot = path.join(out, 'public-source');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const patch = JSON.parse(fs.readFileSync(path.join(__dirname, 'patch.json')));
assert.equal(sha(fs.readFileSync(path.join(sourceRoot, 'styles/board-surface.css'))), patch.originalSha256);
assert.equal(sha(fs.readFileSync(path.join(__dirname, patch.source))), patch.candidateSha256);
for (const [name, expected] of Object.entries({
  'app/lib/board-display-policy.js': '5b29d0939673cbd81dac1f2c1ecc3c7fac9ab1c9ecce780218a651a3294bd770',
  'app/lib/board-display-policy-data.js': 'bd7a74b6cc10d1b0fa7ca580dfac805774145ea5c441f2e4dd7e34a0a0eead28',
  'app/lib/build-board-display-policy.mjs': '5d5aa699fa90410f66e7c05fd59b4c592ac8e41ca668541a504bf738f659f2fc'
})) assert.equal(sha(fs.readFileSync(path.join(root, name))), expected);
fs.mkdirSync(snapshot, { recursive: true });
app.setPath('userData', path.join(out, 'empty-isolated-runtime'));
app.setPath('sessionData', path.join(out, 'empty-isolated-cache'));
app.disableHardwareAcceleration();
const css = ['styles/tokens.css','styles/ui-kit.css','canvas.css','styles/integrated-cards.css','styles/board-surface.css','styles/card-component-target.css','styles/canvas-tabs.css','shell.css'];
const publicRegistry = require(path.join(sourceRoot, 'lib/board-template-registry'));
const chunks = [...new Set(['2RBO-1', '2ROJ-1'].map(board => publicRegistry.chunkFileName(publicRegistry.cardIdFor(board)).replace(/\.js$/, '')))];
const scripts = ['facts-card','board-templates.index.generated','board-template-registry',...chunks,'board-format','board-display-policy-data','board-display-policy','board-static-graphics-data','board-etf-period','board-flow-layout','board-ranking-result','board-popover-layout','board-gold-quote','board-mount'];
const sourcePins = {};
for (const name of [...css, ...scripts.map(s => 'lib/' + s + '.js')]) {
  const bytes = fs.readFileSync(path.join(sourceRoot, name));
  assert.equal(sha(bytes), historicalPins['app/' + name], 'v1 public snapshot source pin');
  sourcePins['app/' + name] = sha(bytes);
  const destination = path.join(snapshot, name); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes);
}
const candidateCss = fs.readFileSync(path.join(__dirname, patch.source), 'utf8');
const baselineCss = fs.readFileSync(path.join(sourceRoot, 'styles/board-surface.css'), 'utf8');
fs.writeFileSync(path.join(out, 'fixture.html'), '<!doctype html><html lang="ko"><meta charset="utf-8"><base href="' + pathToFileURL(snapshot + path.sep).href + '">' +
  css.map(s => s === 'styles/board-surface.css' ? '<style id="boardPolicy"></style>' : '<link rel="stylesheet" href="' + s + '">').join('') +
  '<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:auto}#canvasRegion{position:absolute;inset:0}</style>' +
  '<div id="canvasRegion"><div class="mosaic"><div class="grid"><div class="canvas-tab-deck"><div class="canvas-tab-viewport"><div class="canvas-tab-panel"><section class="card integrated-card" data-board-surface="true"><div class="card-body integrated-card-content"><div class="integrated-card-panels"><div class="integrated-card-panel"><div id="host" class="board-surface-host"></div></div></div></div></section></div></div></div></div></div></div>' +
  scripts.map(s => '<script src="lib/' + s + '.js"></script>').join('') + '</html>');
let timeout;
let win;
let blockedExternalRequests = 0;
let rendererErrors = 0;
const records = [];
const issues = [];
const check = (label, condition) => { if (!condition) issues.push(label); };
const stageRows = [];
let stageOrdinal = 0;
let caseOrdinal = 0;
let phaseOrdinal = 0;
function observe(stage) {
  stageRows.push({ stage, ordinal: ++stageOrdinal, caseOrdinal, phaseOrdinal });
  assert.ok(stageRows.length <= 256, 'finite stage metadata');
  fs.writeFileSync(path.join(out, 'stage-metadata.json'), JSON.stringify({ status: 'PUBLIC_STAGE_METADATA', rows: stageRows }, null, 2) + '\n');
}
function publicFailure(error) {
  const name = Object.getOwnPropertyDescriptor(error ?? {}, 'name')?.value;
  const kinds = ['TypeError','ReferenceError','SyntaxError','RangeError','Error'];
  const kind = typeof name === 'string' && kinds.includes(name) ? name
    : error instanceof TypeError ? 'TypeError' : error instanceof ReferenceError ? 'ReferenceError'
    : error instanceof SyntaxError ? 'SyntaxError' : error instanceof RangeError ? 'RangeError'
    : error instanceof Error ? 'Error' : 'unknown';
  const stack = Object.getOwnPropertyDescriptor(error ?? {}, 'stack')?.value;
  const position = typeof stack === 'string' ? stack.match(/renderer-check\.cjs:(\d+):(\d+)/) : null;
  return { kind, publicEntryLine: position ? Number(position[1]) : null, publicEntryColumn: position ? Number(position[2]) : null };
}
observe('fixture_prepared');
async function renderProbe({ board, mode }) {
  const R = AthenaLib.BoardTemplateRegistry, M = AthenaLib.BoardMount, host = document.getElementById('host');
  host.__bsSurface?.__bsWidthWatch?.disconnect(); host.replaceChildren(); delete host.__bsSurface; delete host.__bsBoardId;
  window.__companyPublicStage = { stage: 'board_source_load' };
  await R.loadBoard(board);
  window.__companyPublicStage = { stage: 'board_source_loaded' };
  const values = board === '2RBO-1' && mode !== 'empty' ? {
    s005: 123456, s006: -1200, s021: 10.2, s024: 1.12, s041: 10.2, s044: 1.12,
    s099: mode === 'long' ? '12345678901234' : mode === 'zero' ? 0 : mode === 'negative' ? -12345 : 12345,
    s100: mode === 'long' ? '12345678901234 (2026/09/30)' : '123456 (2026/09/30)',
    s103: '20261001'
  } : {};
  window.__companyPublicStage = { stage: 'mount' };
  const mounted = M.mountBoard(host, board, values, { contract: R.contractFor(board) });
  window.__companyPublicStage = { stage: 'mounted' };
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  M.relaxOverflowHeights(mounted.surface); M.relaxOverflowRows(mounted.surface);
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__companyPublicStage = { stage: 'state_measurement' };
  const surface = mounted.surface;
  const round = n => Math.round(n * 1000) / 1000;
  const box = node => { const r = node.getBoundingClientRect(); return { x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height), right: round(r.right), bottom: round(r.bottom) }; };
  const node = id => [...surface.querySelectorAll('[data-node="' + id + '"]')].find(n => !n.closest('.bs-paired'));
  const geometry = [...surface.querySelectorAll('[data-node]')].map(n => ({ id: n.dataset.node, rect: box(n), fontSize: getComputedStyle(n).fontSize, lineHeight: getComputedStyle(n).lineHeight }));
  const valueState = [...surface.querySelectorAll('[data-slot-id]')].map(n => ({ slot: n.dataset.slotId, text: n.textContent, missing: n.dataset.missing ?? null, display: getComputedStyle(n).display, fontSize: getComputedStyle(n).fontSize, color: getComputedStyle(n).color }));
  const row = node('2RCJ-1'), low = node('2RCL-1'), high = node('2RCK-1');
  const glyphs = n => { if (!n) return []; const range = document.createRange(); range.selectNodeContents(n); return [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => ({ x: round(r.x), y: round(r.y), right: round(r.right), bottom: round(r.bottom) })); };
  return { surface: box(surface), surfaceOverflow: surface.scrollWidth - surface.clientWidth,
    row: row && box(row), low: low && box(low), high: high && box(high), lowGlyphs: glyphs(low), highGlyphs: glyphs(high),
    gap: row && { column: getComputedStyle(row).columnGap, row: getComputedStyle(row).rowGap },
    geometry, valueState };
}
app.whenReady().then(async () => {
  observe('app_ready');
  timeout = setTimeout(() => app.exit(2), 90000);
  const isolated = session.fromPartition('athena-public-company-history-980');
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const allowed = /^(file:|data:|about:)/.test(details.url);
    if (!allowed) blockedExternalRequests++;
    callback({ cancel: !allowed });
  });
  win = new BrowserWindow({ show: false, width: 1360, height: 1000, webPreferences: { session: isolated, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  observe('window_created');
  win.webContents.on('console-message', event => { if (event.level === 'error') rendererErrors++; });
  observe('file_load');
  await win.loadFile(path.join(out, 'fixture.html'));
  observe('file_loaded');
  for (const width of [1360,1120,928,624,380]) {
    win.setContentSize(width, 1000);
    for (const board of ['2RBO-1','2ROJ-1']) for (const mode of board === '2RBO-1' ? ['normal','long','zero','negative','empty'] : ['empty']) {
      caseOrdinal++;
      phaseOrdinal = 0;
      const pair = [];
      for (const cssText of [baselineCss, candidateCss]) {
        phaseOrdinal++;
        observe('css_apply');
        await win.webContents.executeJavaScript('document.getElementById("boardPolicy").textContent=' + JSON.stringify(cssText) + ';true;');
        observe('probe');
        pair.push(await win.webContents.executeJavaScript('(' + renderProbe.toString() + ')(' + JSON.stringify({ board, mode }) + ')'));
        observe('probe_complete');
      }
      const [before, after] = pair;
      check(board + '/' + width + '/' + mode + '/all value state preserved', JSON.stringify(before.valueState) === JSON.stringify(after.valueState));
      if (board !== '2RBO-1' || width >= 1280) check(board + '/' + width + '/' + mode + '/geometry unchanged', JSON.stringify(before.geometry) === JSON.stringify(after.geometry));
      if (board === '2RBO-1' && width < 1280) {
        check(board + '/' + width + '/' + mode + '/gap', after.gap?.column === '12px' && after.gap?.row === '8px');
        const sameLine = Math.abs(after.low.y - after.high.y) < 1;
        check(board + '/' + width + '/' + mode + '/separation', sameLine ? after.high.x >= after.low.right + 11 : after.high.y >= after.low.bottom + 7);
        for (const rect of [...after.lowGlyphs, ...after.highGlyphs]) check(board + '/' + width + '/' + mode + '/glyph contained', rect.x >= after.row.x - 1 && rect.right <= after.row.right + 1);
      }
      check(board + '/' + width + '/' + mode + '/no additional surface overflow', after.surfaceOverflow <= Math.max(2, before.surfaceOverflow));
      // Persist only hashes of synthetic text/state, plus geometry and booleans.
      records.push({ board, width, mode, before: { row: before.row, low: before.low, high: before.high, gap: before.gap }, after: { row: after.row, low: after.low, high: after.high, gap: after.gap },
        valuesPreserved: JSON.stringify(before.valueState) === JSON.stringify(after.valueState), syntheticStateSha256: sha(Buffer.from(JSON.stringify(after.valueState))),
        unrelatedGeometryPreserved: board === '2RBO-1' && width < 1280 ? null : JSON.stringify(before.geometry) === JSON.stringify(after.geometry) });
    }
  }
  check('no external request attempted', blockedExternalRequests === 0); check('no renderer errors', rendererErrors === 0);
  check('public source snapshot unchanged', Object.entries(sourcePins).every(([name, pin]) => sha(fs.readFileSync(path.join(sourceRoot, name.replace(/^app\//, '')))) === pin));
  const result = { status: issues.length ? 'PUBLIC_MOUNT_CHECK_FAILED' : 'PUBLIC_MOUNT_CHECK_PASS', cases: records.length, sourcePins, candidateCssSha256: patch.candidateSha256,
    records, issues, blockedExternalRequests, rendererErrors, productWrites: 0, liveAppInteraction: false, nativeValidation: false, existingProfileReads: false };
  observe('result_publish');
  result.sourceBasis = 'Immutable v1 public snapshot23; historical producer pin24 preserved separately. Not live product hash equality.';
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  observe('result_published');
  console.log(JSON.stringify({ status: result.status, cases: result.cases, issues, blockedExternalRequests, rendererErrors }));
  clearTimeout(timeout); win.destroy(); app.exit(issues.length ? 1 : 0);
}).catch(async error => {
  let rendererStage = 'unknown';
  if (win && !win.isDestroyed()) {
    try {
      const allowed = ['board_source_load','board_source_loaded','mount','mounted','state_measurement'];
      const value = await win.webContents.executeJavaScript('Object.getOwnPropertyDescriptor(window.__companyPublicStage || {}, "stage")?.value');
      if (typeof value === 'string' && allowed.includes(value)) rendererStage = value;
    } catch {}
  }
  fs.writeFileSync(path.join(out, 'failure-metadata.json'), JSON.stringify({ status: 'PUBLIC_MOUNT_HARNESS_FAILED', rendererStage, stageOrdinal, caseOrdinal, phaseOrdinal, exception: publicFailure(error), rawMessageExported: false, rawStackExported: false }, null, 2) + '\n');
  observe('failed');
  if (timeout) clearTimeout(timeout);
  if (win && !win.isDestroyed()) win.destroy();
  console.log(JSON.stringify({ status: 'PUBLIC_MOUNT_HARNESS_FAILED', rendererStage, caseOrdinal, phaseOrdinal, exception: publicFailure(error), detailExported: false }));
  app.exit(1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import canvas from './backtest-canvas.js';

const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
function declaration(name, async = false) {
  const start = source.indexOf(`  ${async ? 'async ' : ''}function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function writtenHarness(overrides = {}) {
  const ctx = vm.createContext({
    projectIde: { currentProject: () => ({ id: 'qa-project' }), currentRootPath: () => 'qa',
      hasDirtyFile: () => false, activeFile: () => ({ path: 'qa/strategy.py', dirty: false }),
      adoptExternalWrite: () => true, refreshTree: async () => {} },
    workspaceGeneration: 1, codeSource: 'old code', userStrategyId: null, state: {},
    technique: { path: 'qa/strategy.py' }, userStrategies: [], TECHNIQUE_STRATEGY_PATH: 'strategy.py',
    loadProjectFiles: async () => {}, scheduleTechniqueCheck() {}, loadMap: async () => {},
    render() {}, bumpMapVersion: () => ({ from: 1, to: 2 }),
    makeReceipt: (kind, extra) => ({ kind, applied: false, ...extra }), remember: x => x,
    codeRow: (before, after) => ({ label: '코드', before, after }),
    ...overrides,
  });
  Object.assign(ctx, { techniqueState: () => ctx.technique,
    setTechnique: x => Object.assign(ctx.technique, x), setState: x => Object.assign(ctx.state, x) });
  vm.runInContext(declaration('adoptWrittenFile', true) + '\n' + declaration('openStep'), ctx);
  return ctx;
}
const envelope = { kind: 'file_written', status: 'written', project_id: 'qa-project',
  root_path: 'qa', path: 'qa/strategy.py', source: 'new code' };

test('written strategy returns an explicit saved receipt with real before/after and matching diff', async () => {
  const ctx = writtenHarness();
  const receipt = await ctx.adoptWrittenFile(envelope);
  assert.equal(receipt.kind, 'file_written');
  assert.equal(receipt.saved, true);
  assert.equal(receipt.applied, true);
  assert.equal(receipt.path, envelope.path);
  assert.equal(receipt.rows[0].before, 'old code');
  assert.equal(receipt.rows[0].after, 'new code');
  assert.equal(ctx.openStep(receipt.action), true);
  ctx.technique.lastDiff.after = 'later code';
  assert.equal(ctx.openStep(receipt.action), false);
});

test('unrelated or stale written files do not produce an empty success card', async () => {
  for (const patch of [{ project_id: 'other' }, { root_path: 'other' },
    { path: 'qa/../escape.py' }, { source: null }]) {
    assert.equal(await writtenHarness().adoptWrittenFile({ ...envelope, ...patch }), null);
  }
  const ctx = writtenHarness();
  ctx.loadProjectFiles = async () => { ctx.workspaceGeneration++; };
  assert.equal(await ctx.adoptWrittenFile(envelope), null);
});

test('dirty editor is preserved and the saved file is clearly distinguished from editor adoption', async () => {
  const ctx = writtenHarness();
  ctx.projectIde.hasDirtyFile = () => true;
  const receipt = await ctx.adoptWrittenFile(envelope);
  assert.equal(receipt.saved, true);
  assert.equal(receipt.applied, false);
  assert.match(receipt.errors[0], /편집은 보존/);
  assert.equal(ctx.codeSource, 'old code');
  assert.equal(ctx.technique.lastDiff, undefined);
});

test('folder draft navigation uses the actual history and optimization surfaces', async () => {
  const constants = source.slice(source.indexOf('const TECHNIQUE_DRAFT_TABS ='), source.indexOf('// 기법 하나의 화면(보드 20) 헤더'));
  const ctx = vm.createContext({ techniqueDraft: true, state: { tab: 'design', designTab: 'code' },
    MODE_TABS: canvas.MODE_TABS, isBusyView: () => false, envelopeNote: () => null,
    listFirst: () => false, remember: x => x, makeReceipt: (kind, x) => ({ kind, ...x }),
    loadVersions: async () => {}, deps: { runs: async () => [{ run_id: 'qa-run' }] } });
  ctx.setState = x => Object.assign(ctx.state, x);
  vm.runInContext(constants + '\n' + ['workspaceTabs', 'workspaceTabKey', 'navigateAction'].map(x => declaration(x)).join('\n')
    + '\n' + declaration('loadHistory', true), ctx);
  for (const tab of ['history', 'optimize']) {
    const receipt = ctx.navigateAction({ tab });
    await Promise.resolve();
    assert.equal(receipt.applied, true);
    assert.equal(ctx.workspaceTabKey(ctx.workspaceTabs()), tab);
    assert.match(receipt.note, /화면을 열었습니다/);
  }
});

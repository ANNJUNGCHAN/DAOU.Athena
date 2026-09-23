import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = source.indexOf(`  async function ${name}(`);
  assert.notEqual(start, -1);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(deps = {}) {
  const effects = [];
  const ctx = vm.createContext({
    workspaceGeneration: 1, codeSource: 'saved source', techniqueCheckRequest: 0,
    techniqueLastCardPassed: false, techniqueNodesSource: null, techniqueNodesShown: false,
    state: { designTab: 'code', technique: { checks: [], nodes: [] } },
    deps: { techniqueCheck: async () => ({ passed: true, checks: [{ id: 'syntax', ok: true }], log: [] }),
      techniqueNodes: async () => ({ nodes: [{ id: 'signals' }] }), ...deps },
    techniqueCheckTarget: () => ({ symbol: '005930' }),
    techniqueState: () => ctx.state.technique,
    setTechnique: patch => { ctx.state.technique = { ...ctx.state.technique, ...patch }; },
    setState: patch => { ctx.state = { ...ctx.state, ...patch }; },
    projectIde: { recordTerminalResult() { effects.push('terminal'); } },
    emitTechniqueStep() { effects.push('card'); }, maybeAutoRunTechnique() { effects.push('run'); },
    failTechniqueNodes() { effects.push('node failure'); },
    techniqueStepCheckTitle: () => '', techniqueStatsLine: () => '',
    techniqueCheckCounts: () => ({ warnOpen: 0 }),
  });
  vm.runInContext(declaration('runTechniqueCheck') + '\n' + declaration('loadTechniqueNodes'), ctx);
  return { ctx, effects };
}

test('restoration refreshes checks and nodes without executing, emitting action cards, or changing the selected tab', async () => {
  const { ctx, effects } = fixture();
  await ctx.runTechniqueCheck({ auto: false });
  assert.equal(ctx.state.technique.checks.length, 1);
  assert.equal(ctx.state.technique.nodes.length, 1);
  assert.equal(ctx.state.designTab, 'code');
  assert.deepEqual(effects, ['terminal']);
});

test('restoration check completion cannot overwrite another workspace or edited source', async () => {
  for (const change of ['workspaceGeneration', 'codeSource']) {
    const pending = deferred();
    const { ctx, effects } = fixture({ techniqueCheck: () => pending.promise });
    const task = ctx.runTechniqueCheck({ auto: false });
    ctx[change] = change === 'workspaceGeneration' ? 2 : 'edited';
    pending.resolve({ passed: true, checks: [{ ok: true }] });
    await task;
    assert.equal(ctx.state.technique.checks.length, 0);
    assert.deepEqual(effects, []);
  }
});

test('late restored nodes cannot overwrite newer checks for the same source', async () => {
  const pendingNodes = deferred();
  const { ctx } = fixture({ techniqueNodes: () => pendingNodes.promise });
  const task = ctx.runTechniqueCheck({ auto: false });
  await new Promise(resolve => setImmediate(resolve));
  ctx.deps.techniqueCheck = async () => ({ passed: false, checks: [{ ok: false, detail_ko: 'new failure' }] });
  await ctx.runTechniqueCheck({ auto: false });
  pendingNodes.resolve({ nodes: [{ id: 'stale' }] });
  await task;
  assert.equal(ctx.state.technique.passed, false);
  assert.equal(ctx.state.technique.nodes.length, 0);
});

test('restore schedules passive checking only after its own project and saved result have loaded', () => {
  const restore = declaration('restoreWorkspace');
  assert.match(restore, /generation === workspaceGeneration && techniqueDraft && runPath === 'code'[\s\S]*applied\.technique && codeSource/);
  assert.ok(restore.indexOf('runTechniqueCheck({ auto: false })') > restore.indexOf('await restoreRunResult('));
});

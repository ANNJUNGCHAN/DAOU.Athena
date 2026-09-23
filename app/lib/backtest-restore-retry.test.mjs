import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SessionRestore = require('./session-restore.js');
const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function retryRestore(');
const retry = source.slice(start, source.indexOf('\n  }', start) + 4);
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture({ registered = false, tree, open, result } = {}) {
  const calls = [];
  const binding = { projectId: 'project', rootPath: 'technique', path: 'technique/strategy.py', name: 'QA', userStrategyId: registered ? 'strategy' : null };
  const ctx = vm.createContext({
    workspaceGeneration: 1,
    restoreSealed: { technique: binding, code: { source: 'saved code' }, run: { runId: 'run' } },
    restoreApplied: { code: true, technique: false, result: false },
    codeSource: 'saved code', userStrategies: [], userStrategyId: null,
    ideOwnsCode: false, techniqueDraft: true, runPath: 'code',
    state: { designTab: 'nodes', form: 'edited form' },
    deps: { userStrategies: async () => [{ id: 'strategy', project_id: 'project', path: binding.path }] },
    ensureProjectIde: () => ({ openAt: async (...args) => { calls.push(['open', ...args]); return open ? open() : true; } }),
    activeProjectFile: () => ({ text: 'saved code' }),
    loadProjectFiles: async (...args) => { calls.push(['tree', ...args]); return tree ? tree() : true; },
    restoreRunResult: async (...args) => { calls.push(['result', ...args]); return result ? result() : true; },
    runTechniqueCheck: (options) => { calls.push(['check', options.auto]); },
    setState: patch => { ctx.state = { ...ctx.state, ...patch }; },
    SessionRestore,
  });
  vm.runInContext(retry, ctx);
  return { ctx, calls };
}

test('retry restores missing project editor and result without replacing restored code or edited form/tab', async () => {
  const { ctx, calls } = fixture({ registered: true });
  await ctx.retryRestore();
  assert.equal(ctx.restoreApplied.technique, true);
  assert.equal(ctx.restoreApplied.result, true);
  assert.equal(ctx.userStrategyId, 'strategy');
  assert.equal(ctx.state.restore.partial, false);
  assert.equal(ctx.codeSource, 'saved code');
  assert.equal(ctx.state.form, 'edited form');
  assert.equal(ctx.state.designTab, 'nodes');
  assert.deepEqual(calls.map(c => c[0]), ['tree', 'open', 'result', 'check']);
  assert.equal(calls.at(-1)[1], false);
});

test('retry leaves a still missing strategy registration partial and does not open an unrelated folder', async () => {
  const { ctx, calls } = fixture({ registered: true });
  ctx.deps.userStrategies = async () => [];
  await ctx.retryRestore();
  assert.equal(ctx.restoreApplied.technique, false);
  assert.equal(ctx.state.restore.partial, true);
  assert.deepEqual(calls.map(c => c[0]), ['result']);
});

test('retry does not replace a locally edited standalone code buffer with the disk editor', async () => {
  const { ctx, calls } = fixture({ registered: true });
  ctx.codeSource = 'unsaved user edits';
  await ctx.retryRestore();
  assert.equal(ctx.codeSource, 'unsaved user edits');
  assert.equal(ctx.restoreApplied.technique, false);
  assert.equal(ctx.userStrategyId, null);
  assert.deepEqual(calls.map(c => c[0]), ['result']);
});

test('retry respects code edits and conversation changes during tree loading', async () => {
  for (const kind of ['edit', 'switch', 'clear']) {
    const pending = deferred();
    const { ctx, calls } = fixture({ tree: () => pending.promise });
    const task = ctx.retryRestore();
    await new Promise(resolve => setImmediate(resolve));
    if (kind === 'edit') ctx.codeSource = 'new edit';
    if (kind === 'switch') ctx.workspaceGeneration++;
    if (kind === 'clear') ctx.restoreSealed = null;
    pending.resolve(true);
    await task;
    assert.equal(calls.some(c => c[0] === 'open'), false);
    assert.equal(ctx.restoreApplied.technique, false);
    assert.equal(calls.some(c => c[0] === 'check'), false);
  }
});

test('late retry completion cannot publish an old restore report after conversation switch', async () => {
  for (const phase of ['open', 'result']) {
    const pending = deferred();
    const { ctx } = fixture({ [phase]: () => pending.promise });
    const task = ctx.retryRestore();
    await new Promise(resolve => setImmediate(resolve));
    ctx.workspaceGeneration++;
    ctx.state = { restore: 'new conversation' };
    pending.resolve(true);
    assert.equal(await task, false);
    assert.equal(ctx.state.restore, 'new conversation');
  }
});

test('successful editor recovery checks the current disk source', async () => {
  const { ctx } = fixture();
  ctx.activeProjectFile = () => ({ text: 'new disk source' });
  await ctx.retryRestore();
  assert.equal(ctx.codeSource, 'new disk source');
});

test('retry supplies a live guard that cancels editor adoption after edits or a conversation switch', async () => {
  for (const change of ['edit', 'switch']) {
    const pending = deferred();
    const { ctx, calls } = fixture({ open: () => pending.promise });
    const task = ctx.retryRestore();
    await new Promise(resolve => setImmediate(resolve));
    const options = calls.find(c => c[0] === 'open')[3];
    assert.equal(options.shouldContinue(), true);
    if (change === 'edit') ctx.codeSource = 'edited during open';
    else ctx.workspaceGeneration++;
    assert.equal(options.shouldContinue(), false);
    pending.resolve(false);
    await task;
    assert.equal(ctx.restoreApplied.technique, false);
    assert.equal(calls.some(c => c[0] === 'check'), false);
  }
});

const ideSource = fs.readFileSync(new URL('./project-ide.js', import.meta.url), 'utf8');
function ideDeclaration(name) {
  const index = ideSource.indexOf(`  async function ${name}(`);
  assert.notEqual(index, -1);
  return ideSource.slice(index, ideSource.indexOf('\n  }', index) + 4);
}
test('production IDE aborts guarded opens before project callbacks or file adoption', async () => {
  for (const phase of ['list', 'tree', 'file']) {
    const pending = deferred();
    const effects = [];
    let allowed = true;
    const ctx = vm.createContext({
      projects: [], project: null, rootPath: '', tabs: [], activePath: null, closing: null,
      entries: [], truncated: false,
      suspended: true, workspaceGeneration: 0, folderRequestGeneration: 0, fileRequestGeneration: 0,
      deps: {
        listProjects: async () => { if (phase === 'list') await pending.promise; return { projects: [{ id: 'project' }] }; },
        tree: async () => { if (phase === 'tree') await pending.promise; return { entries: [] }; },
        readFile: async () => { if (phase === 'file') await pending.promise; return { text: 'disk' }; },
        onProjectChange: () => effects.push('project'),
      },
      paint() {}, say() {}, fail() {}, findTab: () => null,
      saveAllDirty: async () => true,
      resumeWorkspace() { effects.push('resume'); },
    });
    vm.runInContext(['loadProjects', 'loadTree', 'selectProject', 'openFolder', 'openFile', 'openAt'].map(ideDeclaration).join('\n'), ctx);
    const task = ctx.openAt('project', 'strategy.py', { shouldContinue: () => allowed });
    await new Promise(resolve => setImmediate(resolve));
    allowed = false;
    pending.resolve();
    assert.equal(await task, false);
    assert.equal(ctx.activePath, null);
    assert.equal(ctx.tabs.length, 0);
    if (phase !== 'file') assert.deepEqual(effects, []);
    else assert.deepEqual(effects, ['project']);
    if (phase === 'tree') {
      assert.equal(ctx.project, null);
      allowed = true;
      assert.equal(await ctx.openAt('project', 'strategy.py', { shouldContinue: () => allowed }), true);
      assert.equal(ctx.activePath, 'strategy.py');
      assert.deepEqual(effects, ['project', 'resume']);
    }
  }
});

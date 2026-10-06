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
function element(tag, className, text = '') {
  return { tag, className, textContent: text, children: [], appendChild(child) { this.children.push(child); } };
}

test('invalid run does not call execution and renders its reason above the long project editor', async () => {
  let runCalls = 0;
  let rendered;
  const ide = { element: element('div', 'long-editor'), currentProject: () => ({ id: 'p' }),
    isDirty: () => false, refreshSide() {} };
  const ctx = vm.createContext({
    state: {}, openedVersion: null, runPath: 'code', projectIde: ide, ideOwnsCode: true,
    currentWorkspaceProject: () => ({ id: 'p' }), workspaceActive: () => true,
    ensureProjectIde: () => ide, runErrors: () => ['종목을 하나 이상 고르세요'],
    el: element, startRun: async () => { runCalls++; },
    setState(patch) { ctx.state = { ...ctx.state, ...patch }; rendered = ctx.renderCodeTab(); },
  });
  vm.runInContext([declaration('versionPreviewActive'), declaration('handleRun', true), declaration('renderCodeTab'), declaration('renderCodeErrors')].join('\n'), ctx);
  await ctx.handleRun(false);
  assert.equal(runCalls, 0);
  assert.equal(rendered.children[0].className, 'backtest-design-error');
  assert.equal(rendered.children[0].children[0].textContent, '종목을 하나 이상 고르세요');
  assert.equal(rendered.children[1], ide.element);
});

test('output navigation scrolls the freshly painted terminal, including an already open terminal', () => {
  const ideSource = fs.readFileSync(new URL('./project-ide.js', import.meta.url), 'utf8');
  const start = ideSource.indexOf('    openTerminal() {');
  const end = ideSource.indexOf('\n    terminalEntries()', start);
  assert.ok(start >= 0 && end > start);
  for (const initiallyOpen of [false, true]) {
    const events = [];
    let panel;
    const ctx = vm.createContext({ terminalOpen: initiallyOpen,
      paint() { events.push('paint'); panel = { scrollIntoView(options) { events.push(options.block); } }; },
      root: { querySelector(selector) { assert.equal(selector, '.project-ide-terminal'); return panel; } },
    });
    vm.runInContext(`({${ideSource.slice(start, end)}}).openTerminal()`, ctx);
    assert.equal(ctx.terminalOpen, true);
    assert.deepEqual(events, ['paint', 'nearest']);
  }
});

test('strategy tabs retain analysis surfaces and reject retired deployment navigation', () => {
  assert.deepEqual(canvas.MODE_TABS.map(([key]) => key), ['design', 'result', 'history', 'optimize']);
  const constants = source.slice(source.indexOf('const TECHNIQUE_DRAFT_TABS ='), source.indexOf('// 기법 하나의 화면(보드 20) 헤더'));
  const ctx = vm.createContext({ state: { result: { metrics: {} } }, techniqueDraft: false,
    MODE_TABS: canvas.MODE_TABS });
  vm.runInContext(constants + '\n' + declaration('workspaceTabs') + '\n' + declaration('navigateAction'), ctx);
  assert.deepEqual(Array.from(ctx.workspaceTabs(), ([key]) => key), ['code', 'nodes', 'form', 'result', 'history', 'optimize']);
  assert.equal(ctx.navigateAction({ tab: 'deploy' }), null);
  ctx.techniqueDraft = true;
  assert.deepEqual(Array.from(ctx.workspaceTabs(), ([key]) => key), ['code', 'nodes', 'result', 'history', 'optimize']);
});

test('an old deployment workspace restores its code and falls back to the strategy editor', async () => {
  const ctx = vm.createContext({
    state: {}, workspaceGeneration: 0, workspaceCleared: true, userStrategies: [], deps: {},
    SessionRestore: { sealTechniqueBinding: () => null, restoreReport: () => ({ partial: false }) },
    techniqueDraft: false, runPath: 'form', codeSource: '', MODE_TABS: canvas.MODE_TABS,
    workspaceTabs: () => [['code', '코드'], ['form', '폼']],
    clearWorkspace() { ctx.workspaceGeneration++; ctx.state = {}; },
    setState(patch) { ctx.state = { ...ctx.state, ...patch }; },
  });
  vm.runInContext(declaration('restoreWorkspace', true), ctx);
  assert.equal(await ctx.restoreWorkspace({ tab: 'deploy', designTab: 'deploy',
    code: { source: 'saved strategy', runPath: 'code', strategyId: 's', versionId: 'v' } }), true);
  assert.equal(ctx.state.view, 'design');
  assert.equal(ctx.state.tab, 'design');
  assert.equal(ctx.state.designTab, 'code');
  assert.equal(ctx.codeSource, 'saved strategy');
  assert.equal(ctx.activeVersionId, 'v');
});

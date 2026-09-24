import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./backtest-canvas.js', import.meta.url), 'utf8');
const editorSource = fs.readFileSync(new URL('./backtest-code-editor.js', import.meta.url), 'utf8');
function declaration(name, async = false) {
  const start = source.indexOf(`  ${async ? 'async ' : ''}function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function harness() {
  const nodes = [];
  const el = (tag, className, text = '') => {
    const node = { tag, className, textContent: text, children: [], events: {}, attributes: {},
      get firstChild() { return this.children[0]; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      addEventListener(event, fn) { this.events[event] = fn; },
      setAttribute(key, value) { this.attributes[key] = value; } };
    nodes.push(node);
    return node;
  };
  const document = { createElement: tag => el(tag), createTextNode: text => el('text', '', text) };
  const editor = vm.createContext({ document, module: { exports: {} } });
  vm.runInContext(editorSource, editor);
  const ide = { element: el('div', 'live-ide'), currentProject: () => ({ id: 'project' }), refreshSide() {} };
  const spec = { params: { fast: { default: 20 } } };
  let runCalls = 0;
  const context = vm.createContext({ state: {}, workspaceGeneration: 1, versionReadRequest: 0,
    strategyId: 'strategy', openedVersion: null, codeSource: 'CURRENT FILE', spec,
    deps: { versionDetail: async () => ({ source: 'HISTORICAL SOURCE', version: 1,
      spec_yaml: 'historical yaml must not replace current form' }) },
    el, button: (cls, text, click) => { const node = el('button', cls, text); node.events.click = click; return node; },
    CodeEditor: editor.module.exports, workspaceActive: () => true, ensureProjectIde: () => ide,
    runPath: 'code', ideOwnsCode: true, projectIde: ide,
    runErrors: () => [], startRun: async () => { runCalls++; },
    currentWorkspaceProject: () => null,
    setState(patch) { context.state = { ...context.state, ...patch }; },
  });
  vm.runInContext([
    declaration('openVersion', true), declaration('closeVersionPreview'),
    declaration('versionPreviewActive'), declaration('renderRunButton'),
    declaration('renderCodeTab'), declaration('renderCodeErrors'), declaration('handleRun', true),
  ].join('\n'), context);
  return { context, nodes, ide, spec, runs: () => runCalls };
}

test('opening a saved version shows its immutable source ahead of the workspace IDE and returns without changing current code or parameters', async () => {
  const h = harness();
  await h.context.openVersion({ id: 'v1', version: 1 });
  const view = h.context.renderCodeTab();
  assert.ok(!view.children.includes(h.ide.element));
  const input = h.nodes.find(n => n.tag === 'textarea');
  assert.equal(input.value, 'HISTORICAL SOURCE');
  assert.equal(input.readOnly, true);
  input.events.keydown({ key: 'Tab', preventDefault() { throw new Error('read-only Tab was intercepted'); } });
  assert.equal(input.value, 'HISTORICAL SOURCE');
  assert.ok(h.nodes.some(n => String(n.textContent).includes('v1 · 읽기 전용')));
  assert.equal(h.context.codeSource, 'CURRENT FILE');
  assert.equal(h.context.spec, h.spec);
  assert.equal(h.context.spec.params.fast.default, 20);
  assert.equal(h.context.renderRunButton().disabled, true);
  await h.context.handleRun(false);
  assert.equal(h.runs(), 0);
  h.nodes.find(n => n.className === 'backtest-version-close').events.click();
  assert.equal(h.context.openedVersion, null);
  assert.ok(h.context.renderCodeTab().children.includes(h.ide.element));
  assert.equal(h.context.renderRunButton().disabled, false);
  assert.equal(h.context.codeSource, 'CURRENT FILE');
  const host = { appendChild() {} };
  h.context.CodeEditor.createCodeEditor({ container: host, value: 'x', readOnly: false });
  const editable = h.nodes.filter(n => n.tag === 'textarea').at(-1);
  editable.selectionStart = editable.selectionEnd = 1;
  editable.events.keydown({ key: 'Tab', preventDefault() {} });
  assert.equal(editable.value, 'x    ');
});

test('a late version response cannot replace a newer selection or another strategy workspace', async () => {
  const h = harness();
  const resolve = new Map();
  h.context.deps.versionDetail = (_strategy, id) => new Promise(done => resolve.set(id, done));
  const first = h.context.openVersion({ id: 'v1', version: 1 });
  const second = h.context.openVersion({ id: 'v2', version: 2 });
  resolve.get('v2')({ source: 'SECOND', version: 2 });
  await second;
  resolve.get('v1')({ source: 'FIRST', version: 1 });
  await first;
  assert.equal(h.context.openedVersion.source, 'SECOND');
  const third = h.context.openVersion({ id: 'v3', version: 3 });
  h.context.strategyId = 'another-strategy';
  resolve.get('v3')({ source: 'THIRD', version: 3 });
  assert.equal(await third, null);
  assert.equal(h.context.openedVersion.source, 'SECOND');
});

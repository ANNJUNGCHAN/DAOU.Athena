import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import agentCanvas from './agent-canvas.js';
import { fakeNode } from './graph-mode/fake-dom.js';

function setup(t, deps = {}) {
  const previous = globalThis.document;
  const node = (tag) => Object.assign(fakeNode(tag), { style: {} });
  globalThis.document = { createElement: node, createElementNS: (_, tag) => node(tag) };
  const container = node('div');
  const canvas = agentCanvas.createAgentCanvas({
    container,
    fetchRoutines: async () => [{ id: 'draft-1', status: 'draft', note: 'Saved draft' }],
    ...deps,
  });
  canvas.mount();
  t.after(() => { canvas.destroy(); globalThis.document = previous; });
  return { canvas, container, search: container.querySelector('.agent-search-input') };
}

test('explicit routine navigation reveals a draft hidden by status and search filters', async (t) => {
  const { canvas, container, search } = setup(t);
  await canvas.refresh();
  canvas.setActiveTab('active');
  search.value = 'different routine';
  search.dispatchEvent({ type: 'input' });
  assert.equal(canvas.getContext().selectedRoutineId, null);
  canvas.selectRow('draft-1', { reveal: true });
  assert.equal(canvas.getContext().tab, 'all');
  assert.equal(canvas.getContext().selectedRoutineId, 'draft-1');
  assert.equal(search.value, '');
  assert.equal(container.querySelector('.agent-detail-title').textContent, 'Saved draft');
});

test('saved draft detail offers an explicit resume button and reports retryable failures', async (t) => {
  const calls = [];
  const { canvas, container } = setup(t, { onOpenDraft: async (id) => {
    calls.push(id);
    return { ok: false, error: 'Backend unavailable' };
  } });
  await canvas.refresh();
  canvas.selectRow('draft-1', { reveal: true });
  const button = container.querySelector('.agent-pause-btn');
  assert.equal(button.textContent, '초안 카드 열기');
  await button._listeners.click[0]();
  assert.deepEqual(calls, ['draft-1']);
  assert.equal(button.disabled, false);
  assert.equal(container.querySelector('.agent-detail-desc').textContent, 'Backend unavailable');
});

test('ordinary refresh preserves status and search filters', async (t) => {
  const { canvas, container, search } = setup(t);
  await canvas.refresh();
  canvas.setActiveTab('active');
  search.value = 'different routine';
  search.dispatchEvent({ type: 'input' });
  await canvas.refresh();
  assert.equal(canvas.getContext().tab, 'active');
  assert.equal(search.value, 'different routine');
  assert.equal(canvas.getContext().selectedRoutineId, null);
  canvas.setActiveTab('all');
  assert.equal(container.querySelector('.agent-detail-title'), null);
});

test('global sidebar row click opens its saved routine and clears hiding filters', async (t) => {
  const { canvas, container, search } = setup(t);
  await canvas.refresh();
  canvas.setActiveTab('active');
  search.value = 'different routine';
  search.dispatchEvent({ type: 'input' });
  const source = readFileSync(new URL('./sidebar.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('  function selectRoutineItem('), source.indexOf('  function renderList('))
    + source.slice(source.indexOf('  async function openRoutineInAgent('), source.indexOf('  async function openRoutineMainCard('));
  const views = [];
  const context = vm.createContext({
    window: {
      AthenaAgentCanvas: canvas,
      AthenaCanvasMode: { setView: (view) => views.push(view) },
      AthenaModeNav: { setActive: (view) => views.push(view) },
    },
    selectNotifyRoom() {},
    agentSidebarList: null,
    el: (tag, className) => Object.assign(fakeNode(tag), { className, style: {} }),
  });
  vm.runInContext(functions, context);
  const row = context.makeRoutineItem({ id: 'draft-1', title: 'Saved draft', icon: { glyph: '◌', colorVar: '--muted' } });
  await row._listeners.click[0]();
  assert.deepEqual(views, ['agent', 'agent']);
  assert.equal(canvas.getContext().selectedRoutineId, 'draft-1');
  assert.equal(canvas.getContext().tab, 'all');
  assert.equal(search.value, '');
  assert.equal(container.querySelector('.agent-detail-title').textContent, 'Saved draft');
});

test('revealing the already selected routine synchronizes the cleared search UI', async (t) => {
  const { canvas, search } = setup(t);
  await canvas.refresh();
  search.value = 'Saved';
  search.dispatchEvent({ type: 'input' });
  canvas.selectRow('draft-1', { reveal: true });
  assert.equal(search.value, '');
  assert.equal(canvas.getContext().selectedRoutineId, 'draft-1');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fakeNode } = require('./graph-mode/fake-dom');
const scripts = ['ui-kit.js', 'settings-cards.js'].map(name => fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
const settle = () => new Promise(resolve => setImmediate(resolve));
const all = node => [node, ...node.children.flatMap(all)];
const failureMessage = /모델 설정을 저장하지 못했습니다/;

async function harness() {
  const pending = [];
  const scrolls = [];
  const calls = [];
  const listeners = new Map();
  const state = {
    claude: { model: 'sonnet', effort: null },
    grok: { model: null, effort: null },
    codex: { model: 'codex-old', effort: null, modelCatalog: { models: ['codex-old', 'codex-new'] } },
  };
  function createElement(name) {
    const node = fakeNode(name);
    node.replaceChildren = (...children) => { node.children = []; children.forEach(child => node.appendChild(child)); };
    node.remove = () => node.parentNode?.removeChild(node);
    node.insertBefore = (child, reference) => {
      const index = node.children.indexOf(reference);
      if (index < 0) return node.appendChild(child);
      node.children.splice(index, 0, child);
      child.parentNode = node;
      return child;
    };
    node.blur = () => node.dispatchEvent({ type: 'blur' });
    node.scrollIntoView = options => scrolls.push({ node, options });
    return node;
  }
  const window = { athena: {
    invoke(channel, payload) {
      calls.push(channel);
      if (channel === 'athena:model-get') return Promise.resolve(structuredClone(state));
      if (channel === 'athena:cli-list') return Promise.resolve({ providers: [
        { id: 'codex', accounts: [{ id: 'fixture', label: 'Test account', active: true }] },
      ] });
      if (channel === 'athena:model-set') return new Promise((resolve, reject) => pending.push({ payload, resolve, reject }));
      throw new Error(`Unexpected channel: ${channel}`);
    },
    on(channel, listener) { listeners.set(channel, listener); return () => listeners.delete(channel); },
  } };
  const context = vm.createContext({ window, document: { createElement, createElementNS: (_ns, name) => createElement(name) } });
  for (const script of scripts) vm.runInContext(script, context);
  const grid = createElement('div');
  await window.AthenaLib.SettingsCards.renderModel(grid);
  const claude = () => all(grid).find(node => node.classList.contains('uk-model-section'));
  const chip = label => all(claude()).find(node => node.nodeName === 'button' && node.textContent === label);
  const input = () => all(claude()).find(node => node.nodeName === 'input');
  const select = () => all(grid).find(node => node.nodeName === 'select');
  const click = node => node.dispatchEvent({ type: 'click' });
  return { grid, pending, scrolls, calls, state, listeners, chip, input, select, click };
}

for (const mode of ['rejected', 'resolved failure', 'malformed response']) {
  test(`${mode} model save retains the selected chip, shows a safe visible error, and permits retry`, async () => {
    const h = await harness();
    h.click(h.chip('opus'));
    assert.equal(h.pending.length, 1);
    if (mode === 'rejected') h.pending[0].reject(new Error('EACCES private-path-do-not-display'));
    else h.pending[0].resolve(mode === 'resolved failure' ? { ok: false, error: 'EACCES private-path-do-not-display' } : {});
    await settle();
    assert.equal(h.chip('sonnet').attrs['aria-pressed'], 'true');
    assert.equal(h.chip('opus').attrs['aria-pressed'], 'false');
    assert.match(h.grid.textContent, failureMessage);
    assert.doesNotMatch(h.grid.textContent, /private-path|EACCES|핸들러 없음/);
    assert.equal(h.scrolls.length, 1);
    assert.match(h.scrolls[0].node.textContent, failureMessage);
    assert.equal(h.scrolls[0].options.block, 'nearest');
    h.click(h.chip('opus'));
    assert.equal(h.pending.length, 2);
    h.state.claude.model = 'opus';
    h.pending[1].resolve({ ok: true, state: structuredClone(h.state) });
    await settle();
    assert.doesNotMatch(h.grid.textContent, failureMessage);
    assert.equal(h.calls.filter(channel => channel === 'athena:model-get').length, 1);
    await h.listeners.get('athena:model-changed')();
    assert.equal(h.chip('opus').attrs['aria-pressed'], 'true');
    assert.equal(h.calls.filter(channel => channel === 'athena:model-get').length, 2);
  });
}

test('Enter commits through blur once and an unchanged custom value can retry after failure', async () => {
  const h = await harness();
  const input = h.input();
  input.value = 'custom-model';
  let prevented = false;
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.pending.length, 1);
  assert.equal(h.pending[0].payload.patch.model, 'custom-model');
  h.pending[0].reject(new Error('private-path'));
  await settle();
  assert.equal(input.value, 'custom-model');
  input.blur();
  assert.equal(h.pending.length, 2);
  h.pending[1].resolve({ ok: true, state: structuredClone(h.state) });
  await settle();
  assert.doesNotMatch(h.grid.textContent, failureMessage);
});

test('persisted Codex activation failure keeps the saved selection and uses safe accurate feedback', async () => {
  const h = await harness();
  const select = h.select();
  select.value = 'codex-new';
  select.dispatchEvent({ type: 'change' });
  h.pending[0].resolve({
    ok: false, persisted: true, code: 'PROVIDER_ACTIVATION_FAILED', error: 'private-path',
    state: { ...h.state, codex: { ...h.state.codex, model: 'codex-new' } },
  });
  await settle();
  assert.equal(select.value, 'codex-new');
  assert.equal(select.disabled, false);
  assert.match(h.grid.textContent, /설정은 저장했지만 대화 모델을 활성화하지 못했습니다/);
  assert.doesNotMatch(h.grid.textContent, /private-path|설정을 저장하지 못했습니다/);
});

for (const mode of ['rejected', 'resolved failure']) {
  test(`${mode} Codex model save restores the persisted selection and allows the same selection to retry`, async () => {
    const h = await harness();
    const select = h.select();
    select.value = 'codex-new';
    select.dispatchEvent({ type: 'change' });
    assert.equal(select.disabled, true);
    if (mode === 'rejected') h.pending[0].reject(new Error('private-path'));
    else h.pending[0].resolve({ ok: false, error: 'private-path' });
    await settle();
    assert.equal(select.value, 'codex-old');
    assert.equal(select.disabled, false);
    select.value = 'codex-new';
    select.dispatchEvent({ type: 'change' });
    assert.equal(h.pending.length, 2);
    assert.equal(h.pending[1].payload.patch.model, 'codex-new');
    h.state.codex.model = 'codex-new';
    h.pending[1].resolve({ ok: true, state: structuredClone(h.state) });
    await h.listeners.get('athena:model-changed')();
    await settle();
    assert.equal(h.select().value, 'codex-new');
    assert.equal(h.select().disabled, false);
    assert.doesNotMatch(h.grid.textContent, failureMessage);
  });
}

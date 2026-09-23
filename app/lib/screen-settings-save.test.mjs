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
function createElement(name) {
  const node = fakeNode(name);
  node.replaceChildren = (...children) => { node.children = []; children.forEach(child => node.appendChild(child)); };
  node.remove = () => node.parentNode?.removeChild(node);
  return node;
}

async function harness() {
  const pending = [];
  const state = { autoExpandCanvas: true, autoGrowChat: true, fontSize: 'md' };
  const window = { matchMedia: () => ({ matches: false }), athena: {
    invoke(channel, patch) {
      if (channel.endsWith(':get')) return Promise.resolve({ ...state });
      return new Promise((resolve, reject) => pending.push({ patch, resolve, reject }));
    },
    on: () => () => {}, getZoomFactor: () => 1, send() {},
  } };
  const context = vm.createContext({ window, document: { createElement } });
  for (const script of scripts) vm.runInContext(script, context);
  const grid = fakeNode('div');
  await window.AthenaLib.SettingsCards.renderScreen(grid);
  const font = label => all(grid).find(n => n.nodeName === 'button' && n.textContent === label);
  const toggle = name => all(grid).find(n => n.attrs['aria-label'] === name);
  const click = node => { if (!node.disabled) node.dispatchEvent({ type: 'click' }); };
  return { grid, pending, state, font, toggle, click };
}

test('font save failure retains selection, blocks overlapping writes, and allows retry', async () => {
  const h = await harness();
  h.click(h.font('큼'));
  assert.equal(h.font('큼').disabled, true);
  h.click(h.font('작음'));
  assert.equal(h.pending.length, 1);
  h.pending[0].reject(new Error('private-path-do-not-display'));
  await settle();
  assert.equal(h.font('보통').classList.contains('is-pressed'), true);
  assert.equal(h.font('큼').classList.contains('is-pressed'), false);
  assert.match(h.grid.textContent, /설정을 저장하지 못했습니다/);
  assert.doesNotMatch(h.grid.textContent, /private-path/);
  assert.equal(h.font('큼').disabled, false);
  h.click(h.font('큼'));
  h.pending[1].resolve({ ...h.state, fontSize: 'lg' });
  await settle();
  assert.equal(h.font('큼').classList.contains('is-pressed'), true);
  assert.doesNotMatch(h.grid.textContent, /설정을 저장하지 못했습니다/);
});

test('screen toggle failure restores prior state and successful response is authoritative', async () => {
  const h = await harness();
  const control = h.toggle('질의하면 캔버스 창을 자동으로 연다');
  h.click(control);
  h.pending[0].reject(new Error('private failure'));
  await settle();
  assert.equal(control.attrs['aria-checked'], 'true');
  assert.equal(control.disabled, false);
  h.click(control);
  h.pending[1].resolve({ ...h.state, autoExpandCanvas: true });
  await settle();
  assert.equal(control.attrs['aria-checked'], 'true');
});

test('invalid save response keeps the previously confirmed font and exposes retryable error', async () => {
  const h = await harness();
  h.click(h.font('작음'));
  h.pending[0].resolve(undefined);
  await settle();
  assert.equal(h.font('보통').classList.contains('is-pressed'), true);
  assert.match(h.grid.textContent, /설정을 저장하지 못했습니다/);
  assert.equal(h.font('작음').disabled, false);
});

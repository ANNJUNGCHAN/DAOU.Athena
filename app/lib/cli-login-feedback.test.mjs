import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fakeNode } = require('./graph-mode/fake-dom');
const all = node => [node, ...node.children.flatMap(all)];
const settle = () => new Promise(resolve => setImmediate(resolve));

async function harness() {
  const pending = [];
  const createElement = name => {
    const node = fakeNode(name);
    node.replaceChildren = (...children) => { node.textContent = ''; children.forEach(child => node.appendChild(child)); };
    node.scrollIntoView = () => {};
    node.insertBefore = (child, reference) => {
      const index = node.children.indexOf(reference);
      if (index < 0) return node.appendChild(child);
      node.children.splice(index, 0, child);
      child.parentNode = node;
      return child;
    };
    return node;
  };
  const window = { athena: {
    invoke(channel) {
      if (channel === 'athena:model-get') return Promise.resolve({ claude: {}, grok: {}, codex: {} });
      if (channel === 'athena:cli-list') return Promise.resolve({ providers: [
        { id: 'codex', accounts: [{ id: 'fixture', label: 'Test account', active: true }] },
      ] });
      if (channel === 'athena:cli-login') return new Promise((resolve, reject) => pending.push({ resolve, reject }));
      throw new Error(`Unexpected channel: ${channel}`);
    },
    on() { return () => {}; },
  } };
  const context = vm.createContext({ window, document: { createElement, createElementNS: (_ns, name) => createElement(name) } });
  for (const name of ['ui-kit.js', 'settings-cards.js']) vm.runInContext(fs.readFileSync(new URL(name, import.meta.url), 'utf8'), context);
  const grid = createElement('div');
  await window.AthenaLib.SettingsCards.renderModel(grid);
  const section = all(grid).find(node => node.classList.contains('uk-model-section') && node.textContent.includes('Test account'));
  const click = label => all(section).find(node => node.nodeName === 'button'
    && (node.attrs['aria-label'] === label || node.textContent === label)).dispatchEvent({ type: 'click' });
  return { grid, section, pending, click };
}

test('both Codex login buttons show pending, suppress duplicate launch, and show terminal instructions', async () => {
  const h = await harness();
  h.click('재인증');
  assert.match(h.section.textContent, /로그인 창을 여는 중/);
  h.click('+ 계정 추가');
  assert.equal(h.pending.length, 1);
  h.pending[0].resolve({ ok: true, launched: true, message: '터미널에서 로그인을 완료해 주세요.' });
  await settle();
  assert.match(h.section.textContent, /터미널에서 로그인을 완료/);
  assert.doesNotMatch(h.section.textContent, /로그인 창을 여는 중/);
  assert.ok(all(h.section).some(node => node.attrs.role === 'status'));
});

test('failed login clears pending and permits another button attempt without exposing exception details', async () => {
  const h = await harness();
  h.click('+ 계정 추가');
  h.pending[0].reject(new Error('private-fixture-secret'));
  await settle();
  assert.doesNotMatch(h.section.textContent, /여는 중|private-fixture-secret/);
  assert.match(h.section.textContent, /로그인/);
  h.click('재인증');
  assert.equal(h.pending.length, 2);
  h.pending[1].resolve({ ok: false, message: '로그인 창을 열지 못했다' });
  await settle();
  assert.match(h.grid.textContent, /로그인 창을 열지 못했다/);
  assert.doesNotMatch(h.section.textContent, /여는 중/);
});

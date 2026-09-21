import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { fakeNode } = require('./graph-mode/fake-dom');
const chat = fs.readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
function declaration(name) {
  const start = chat.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return chat.slice(start, chat.indexOf('\n}', start) + 2);
}
function setup({ connected = true, model = 'gpt-6-astra', effort = 'medium', reply = { ok: true }, models = ['gpt-6-astra', 'gpt-5.6-sol'] } = {}) {
  const calls = [];
  const ctx = vm.createContext({
    document: { createElement: fakeNode },
    renderedModelPopoverKey: null,
    $modelBtn: fakeNode('button'), $effortBtn: fakeNode('button'), $modelPopover: fakeNode('div'),
    modelStateCache: { active: { provider: 'codex', model, effort }, codex: { model, effort, modelCatalog: { models } } },
    cliStateCache: { providers: [{ id: 'codex', accounts: connected ? [{}] : [] }] },
    window: { athena: { async invoke(channel, payload) { calls.push({ channel, payload }); return reply; } } },
    async refreshModelState() {},
  });
  const constants = chat.slice(chat.indexOf('const PILL_MODEL_CHIPS ='), chat.indexOf('let modelStateCache'));
  vm.runInContext(constants + '\n' + ['providerConnected', 'composerChoiceLabel', 'renderComposerModel',
    'popoverSection', 'renderModelPopover'].map(declaration).join('\n'), ctx);
  return { ctx, calls };
}

test('active Codex label preserves configured model and supports default/minimal effort', () => {
  const { ctx } = setup();
  ctx.renderComposerModel();
  assert.equal(ctx.$modelBtn.textContent, 'gpt-6-astra');
  assert.equal(ctx.$effortBtn.textContent, 'Medium');
  ctx.modelStateCache.active = { provider: 'codex', model: null, effort: 'minimal' };
  ctx.renderComposerModel();
  assert.equal(ctx.$modelBtn.textContent, 'Codex');
  assert.equal(ctx.$effortBtn.textContent, 'Minimal');
});

test('Codex menu preserves model until edited and sends only Codex updates', async () => {
  const { ctx, calls } = setup();
  ctx.renderModelPopover();
  const input = ctx.$modelPopover.children.find((node) => node.nodeName === 'select');
  assert.equal(input.value, 'gpt-6-astra');
  assert.equal(input.disabled, false);
  await input._listeners.change[0]();
  assert.equal(calls.length, 0);
  input.value = 'gpt-5.6-sol';
  await input._listeners.change[0]();
  assert.equal(calls[0].channel, 'athena:model-set');
  assert.equal(calls[0].payload.provider, 'codex');
  assert.equal(calls[0].payload.patch.model, 'gpt-5.6-sol');
  const effortRow = ctx.$modelPopover.children.at(-1);
  assert.deepEqual(effortRow.children.map((node) => node.textContent), ['기본', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  await effortRow.children.find((node) => node.textContent === 'minimal')._listeners.click[0]();
  assert.equal(calls[1].payload.provider, 'codex');
  assert.equal(calls[1].payload.patch.effort, 'minimal');
});

test('unconnected Codex model and effort controls are disabled without changing settings', async () => {
  const { ctx, calls } = setup({ connected: false });
  ctx.renderModelPopover();
  const input = ctx.$modelPopover.children.find((node) => node.nodeName === 'select');
  assert.equal(input.disabled, true);
  assert.ok(ctx.$modelPopover.children.at(-1).children.every((node) => node.disabled));
  input.value = 'changed';
  await input._listeners.change[0]();
  assert.equal(calls.length, 0);
});

test('rejected model change is visible and retains the attempted input for correction', async () => {
  const { ctx } = setup({ reply: { ok: false } });
  ctx.renderModelPopover();
  const input = ctx.$modelPopover.children.find((node) => node.nodeName === 'select');
  input.value = 'gpt-5.6-sol';
  await input._listeners.change[0]();
  assert.ok(ctx.$modelPopover.textContent.includes('저장하지 못했습니다'));
  assert.equal(input.value, 'gpt-5.6-sol');
  assert.equal(ctx.modelStateCache.codex.model, 'gpt-6-astra');
});

test('missing CLI catalog preserves the saved model without accepting arbitrary input', async () => {
  const { ctx, calls } = setup({ model: 'saved-model', models: [] });
  ctx.renderModelPopover();
  const select = ctx.$modelPopover.children.find(node => node.nodeName === 'select');
  assert.equal(select.value, 'saved-model');
  assert.equal(select.disabled, true);
  assert.ok(ctx.$modelPopover.textContent.includes('목록 갱신 필요'));
  select.value = 'invented-model';
  await select._listeners.change[0]();
  assert.equal(calls.length, 0);
});

test('identical background refresh preserves the open select and its uncommitted selection', () => {
  const { ctx } = setup();
  ctx.renderModelPopover();
  const select = ctx.$modelPopover.children.find(node => node.nodeName === 'select');
  const effortRow = ctx.$modelPopover.children.at(-1);
  select.value = 'gpt-5.6-sol';
  // Repeated CLI updates carry new object instances even when displayed values are unchanged.
  ctx.modelStateCache = JSON.parse(JSON.stringify(ctx.modelStateCache));
  ctx.cliStateCache = { providers: [{ id: 'codex', accounts: [{ active: true }], diagnostics: { checkedAt: 42 } }] };
  ctx.renderModelPopover();
  assert.equal(ctx.$modelPopover.children.find(node => node.nodeName === 'select'), select);
  assert.equal(ctx.$modelPopover.children.at(-1), effortRow);
  assert.equal(select.value, 'gpt-5.6-sol');
});

test('real model or account availability changes still refresh the controls', () => {
  const { ctx } = setup();
  ctx.renderModelPopover();
  const before = ctx.$modelPopover.children.find(node => node.nodeName === 'select');
  ctx.modelStateCache.codex.model = 'gpt-5.6-sol';
  ctx.renderModelPopover();
  const after = ctx.$modelPopover.children.find(node => node.nodeName === 'select');
  assert.notEqual(after, before);
  assert.equal(after.value, 'gpt-5.6-sol');
  ctx.cliStateCache = { providers: [{ id: 'codex', accounts: [] }] };
  ctx.renderModelPopover();
  assert.equal(ctx.$modelPopover.children.find(node => node.nodeName === 'select').disabled, true);
});

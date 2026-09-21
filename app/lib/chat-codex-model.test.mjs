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
function setup({ connected = true, model = 'gpt-6-astra', effort = 'medium', reply = { ok: true } } = {}) {
  const calls = [];
  const ctx = vm.createContext({
    document: { createElement: fakeNode },
    $modelBtn: fakeNode('button'), $effortBtn: fakeNode('button'), $modelPopover: fakeNode('div'),
    modelStateCache: { active: { provider: 'codex', model, effort }, codex: { model, effort } },
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
  const input = ctx.$modelPopover.children.find((node) => node.nodeName === 'input');
  assert.equal(input.value, 'gpt-6-astra');
  assert.equal(input.disabled, false);
  await input._listeners.blur[0]();
  assert.equal(calls.length, 0);
  input.value = 'gpt-6-astra-custom';
  await input._listeners.blur[0]();
  assert.equal(calls[0].channel, 'athena:model-set');
  assert.equal(calls[0].payload.provider, 'codex');
  assert.equal(calls[0].payload.patch.model, 'gpt-6-astra-custom');
  const effortRow = ctx.$modelPopover.children.at(-1);
  assert.deepEqual(effortRow.children.map((node) => node.textContent), ['기본', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  await effortRow.children.find((node) => node.textContent === 'minimal')._listeners.click[0]();
  assert.equal(calls[1].payload.provider, 'codex');
  assert.equal(calls[1].payload.patch.effort, 'minimal');
});

test('unconnected Codex model and effort controls are disabled without changing settings', async () => {
  const { ctx, calls } = setup({ connected: false });
  ctx.renderModelPopover();
  const input = ctx.$modelPopover.children.find((node) => node.nodeName === 'input');
  assert.equal(input.disabled, true);
  assert.ok(ctx.$modelPopover.children.at(-1).children.every((node) => node.disabled));
  input.value = 'changed';
  await input._listeners.blur[0]();
  assert.equal(calls.length, 0);
});

test('rejected model change is visible and retains the attempted input for correction', async () => {
  const { ctx } = setup({ reply: { ok: false } });
  ctx.renderModelPopover();
  const input = ctx.$modelPopover.children.find((node) => node.nodeName === 'input');
  input.value = 'invalid model';
  await input._listeners.blur[0]();
  assert.ok(ctx.$modelPopover.textContent.includes('저장하지 못했습니다'));
  assert.equal(input.value, 'invalid model');
  assert.equal(ctx.modelStateCache.codex.model, 'gpt-6-astra');
});

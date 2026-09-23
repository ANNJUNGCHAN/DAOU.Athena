import test from 'node:test';
import assert from 'node:assert/strict';
import agentCanvas from './agent-canvas.js';

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.listeners = {}; this.textContent = ''; }
  get firstChild() { return this.children[0]; }
  appendChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
  setAttribute() {}
  addEventListener(event, listener) { this.listeners[event] = listener; }
  find(className) {
    if (this.className === className) return this;
    for (const child of this.children) { const found = child.find(className); if (found) return found; }
    return null;
  }
}

const settings = {
  max_daily_nudges: 3, quiet_hours: { start: '22:00', end: '08:00' },
  show_rationale: true, learn_from_dismissals: true,
};

function setup(t, fetchNudgeGuard) {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  const container = new Element('div');
  const canvas = agentCanvas.createAgentCanvas({ container, fetchNudgeGuard, fetchRoutines: async () => [] });
  canvas.mount();
  t.after(() => { canvas.destroy(); globalThis.document = originalDocument; });
  return { canvas, tags: container.find('agent-nudge-guard-tags') };
}

test('failed guard fetch ends loading and retry recovers the displayed settings', async (t) => {
  let resolveRetry;
  let calls = 0;
  const { canvas, tags } = setup(t, () => {
    calls += 1;
    if (calls === 1) return Promise.reject(new Error('backend offline'));
    return new Promise((resolve) => { resolveRetry = resolve; });
  });
  assert.match(tags.firstChild.textContent, /불러오는 중/);
  await canvas.refresh();
  assert.match(tags.firstChild.textContent, /불러오지 못했습니다/);
  const retry = tags.children.find((node) => node.tagName === 'button');
  assert.equal(retry.textContent, '다시 시도');
  const pending = retry.listeners.click();
  assert.match(tags.firstChild.textContent, /불러오는 중/);
  assert.equal(tags.children.some((node) => node.tagName === 'button'), false);
  resolveRetry(settings);
  await pending;
  assert.equal(tags.firstChild.textContent, '하루 최대 3회');
  assert.equal(tags.children.length, 4);
});

test('null IPC response ends loading instead of pretending a request is still pending', async (t) => {
  const { canvas, tags } = setup(t, async () => null);
  await canvas.refresh();
  assert.match(tags.firstChild.textContent, /불러오지 못했습니다/);
});

test('stale failure cannot overwrite a newer successful guard fetch', async (t) => {
  let rejectOld;
  let calls = 0;
  const { canvas, tags } = setup(t, () => ++calls === 1
    ? new Promise((_, reject) => { rejectOld = reject; }) : Promise.resolve(settings));
  const oldRefresh = canvas.refresh();
  await canvas.refresh();
  rejectOld(new Error('late failure'));
  await oldRefresh;
  assert.equal(tags.firstChild.textContent, '하루 최대 3회');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createTechniqueCreateDialog } = require('./technique-create-dialog.js');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function documentFixture() {
  const listeners = new Map();
  const doc = {
    activeElement: null,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
    dispatch(type, event) { for (const handler of listeners.get(type) || []) handler(event); },
    listenerCount(type) { return listeners.get(type)?.size || 0; },
    createElement(tag) {
      const events = new Map();
      return {
        tagName: tag, children: [], parentNode: null, disabled: false, value: '',
        setAttribute() {},
        appendChild(child) { child.parentNode = this; this.children.push(child); },
        removeChild(child) {
          this.children.splice(this.children.indexOf(child), 1);
          child.parentNode = null;
        },
        get firstChild() { return this.children[0]; },
        get isConnected() { return this === doc.body || !!this.parentNode?.isConnected; },
        contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
        focus() {
          if (this.disabled) return;
          doc.activeElement = this;
          doc.dispatch('focusin', { target: this });
        },
        addEventListener(type, handler) { events.set(type, handler); },
        fire(type) { return events.get(type)?.({ target: this }); },
      };
    },
  };
  doc.body = doc.createElement('body');
  return doc;
}

function descendants(node) {
  return [node, ...node.children.flatMap(descendants)];
}

function harness(overrides = {}) {
  const doc = documentFixture();
  const launch = doc.createElement('button');
  doc.body.appendChild(launch);
  launch.focus();
  const loading = deferred();
  const result = createTechniqueCreateDialog({
    document: doc,
    listProjects: () => loading.promise,
    createTechnique: async () => ({}),
    registerUserStrategy: async () => ({ id: 'strategy' }),
    startTechniqueConversation: async () => ({ id: 'conversation' }),
    ...overrides,
  });
  const find = (className) => descendants(doc.body).find((node) => node.className === className);
  const key = (keyName, shiftKey = false) => {
    const event = {
      key: keyName, shiftKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    doc.dispatch('keydown', event);
    return event;
  };
  return { doc, launch, loading, result, find, key };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('Escape dismisses during project loading, restores focus, and ignores a late response', async () => {
  const h = harness();
  assert.notEqual(h.doc.activeElement, h.launch);
  assert.equal(h.find('technique-create-cancel').disabled, false);
  const event = h.key('Escape');
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(await h.result, null);
  assert.equal(h.doc.activeElement, h.launch);
  assert.equal(h.doc.listenerCount('keydown'), 0);
  assert.equal(h.doc.listenerCount('focusin'), 0);
  h.loading.resolve([{ id: 'project' }]);
  await settle();
  assert.equal(h.find('technique-create-overlay'), undefined);
  assert.equal(h.doc.activeElement, h.launch);
});

test('Tab and Shift+Tab stay within the dialog before and after loading', async () => {
  const h = harness();
  h.key('Tab');
  const cancel = h.find('technique-create-cancel');
  assert.equal(h.doc.activeElement, cancel);
  h.key('Tab', true);
  assert.equal(h.doc.activeElement, cancel);
  h.loading.resolve([{ id: 'project' }]);
  await settle();
  const first = h.find('technique-create-select');
  const last = h.find('technique-create-submit');
  last.focus();
  h.key('Tab');
  assert.equal(h.doc.activeElement, first);
  h.key('Tab', true);
  assert.equal(h.doc.activeElement, last);
  h.launch.focus();
  assert.equal(h.doc.activeElement, first);
  h.key('Escape');
  await h.result;
});

test('Escape does not cancel an in-flight folder creation or escape to the background', async () => {
  const creating = deferred();
  const h = harness({ createTechnique: () => creating.promise });
  h.loading.resolve([{ id: 'project' }]);
  await settle();
  const inputs = descendants(h.doc.body).filter((node) => node.tagName === 'input');
  inputs[1].value = '새 기법';
  h.find('technique-create-submit').focus();
  const submission = h.find('technique-create-submit').fire('click');
  const event = h.key('Escape');
  assert.equal(event.stopped, true);
  assert.ok(h.find('technique-create-overlay'));
  assert.equal(h.doc.activeElement, h.find('technique-create-dialog'));
  creating.reject(new Error('폴더 생성 실패'));
  await submission;
  h.key('Escape');
  assert.equal(await h.result, null);
});

test('Cancel remains usable while projects are loading and a late failure is ignored', async () => {
  const h = harness();
  h.find('technique-create-cancel').fire('click');
  assert.equal(await h.result, null);
  h.loading.reject(new Error('backend unavailable'));
  await settle();
  assert.equal(h.doc.activeElement, h.launch);
  assert.equal(h.find('technique-create-overlay'), undefined);
});

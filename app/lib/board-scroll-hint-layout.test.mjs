import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readableHintScroll, ensureAccountTableHint } = require('./board-mount.js');

function classes(...names) {
  const values = new Set(names);
  return { contains: (name) => values.has(name) };
}

test('an account-table hint measures its parent scroll owner after a narrow-width pass', () => {
  const owner = { classList: classes('bs-primary', 'bs-r-scroll-table') };
  const staleSibling = { clientWidth: 164, scrollWidth: 164 };
  const hint = {
    classList: classes('bs-readable-hint'),
    parentElement: owner,
    previousElementSibling: staleSibling,
  };

  assert.equal(readableHintScroll(hint), owner);
});

test('the account-table hint stays inside the scroll owner instead of becoming a workspace flex item', () => {
  const created = [];
  const owner = {
    classList: classes('bs-primary', 'bs-r-scroll-table'),
    getAttribute: (name) => name === 'data-node' ? '14UQ-2' : null,
    querySelector: () => null,
    append(hint) {
      hint.parentElement = this;
      created.push(hint);
    },
  };
  const surface = {
    dataset: { bsBoardId: '133H-2' },
    ownerDocument: {
      createElement: () => ({ className: '', textContent: '', parentElement: null }),
    },
  };

  const hint = ensureAccountTableHint(surface, owner);

  assert.equal(created.length, 1);
  assert.equal(created[0], hint);
  assert.equal(hint.parentElement, owner);
  assert.equal(hint.className, 'bs-readable-hint');
});

test('existing sibling hints keep their established scroll-owner direction', () => {
  const previous = {};
  const next = {};
  const readable = {
    classList: classes('bs-readable-hint'),
    parentElement: { classList: classes() },
    previousElementSibling: previous,
  };
  const ranking = {
    classList: classes('bs-ranking-scroll-hint'),
    parentElement: { classList: classes() },
    nextElementSibling: next,
  };

  assert.equal(readableHintScroll(readable), previous);
  assert.equal(readableHintScroll(ranking), next);
});

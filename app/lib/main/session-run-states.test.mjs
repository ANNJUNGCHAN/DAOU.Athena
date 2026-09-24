import test from 'node:test';
import assert from 'node:assert/strict';
import storeLib from './session-store.js';

function fixture(t) {
  const store = storeLib.createSessionStore({ dbPath: ':memory:' });
  t.after(() => store.close());
  store.createSession({ id: 'chat' });
  return store;
}
function attach(store, id, status, second, kind = 'chat.turn') {
  return store.attachJob('chat', { id, kind, status,
    attachedAt: `2026-09-24T10:00:${String(second).padStart(2, '0')}.000Z`,
    error: status === 'failed' ? 'synthetic previous error' : null });
}

test('successful later chat turn replaces failed sidebar state without erasing failure history', (t) => {
  const store = fixture(t);
  attach(store, 'failed', 'failed', 0);
  assert.equal(store.runStates().chat, 'failed');
  attach(store, 'successful', 'done', 1);
  assert.equal(store.runStates().chat, 'done');
  assert.equal(store.getJob('failed').status, 'failed');
  assert.equal(store.getJob('failed').error, 'synthetic previous error');
  assert.equal(store.listJobs('chat').length, 2);
  attach(store, 'later-failure', 'interrupted', 2);
  assert.equal(store.runStates().chat, 'failed');
});

test('older active chat jobs retain priority over a newer terminal chat turn', (t) => {
  const store = fixture(t);
  attach(store, 'running', 'running', 0);
  attach(store, 'queued', 'queued', 1);
  attach(store, 'done', 'done', 2);
  assert.equal(store.runStates().chat, 'running');
  store.updateJob('running', { status: 'failed' });
  assert.equal(store.runStates().chat, 'waiting');
  store.updateJob('queued', { status: 'completed' });
  assert.equal(store.runStates().chat, 'done');
});

test('non-chat failures still outrank a successful chat or newer non-chat completion', (t) => {
  const store = fixture(t);
  attach(store, 'backtest-failed', 'failed', 0, 'backtest');
  attach(store, 'successful', 'done', 1);
  attach(store, 'backtest-done', 'done', 2, 'backtest');
  assert.equal(store.runStates().chat, 'failed');
  attach(store, 'backtest-running', 'running', 3, 'backtest');
  assert.equal(store.runStates().chat, 'running');
});

test('same timestamp terminal turns follow insertion order rather than random job IDs', (t) => {
  const store = fixture(t);
  attach(store, 'zzz-old', 'error', 0);
  attach(store, 'aaa-new', 'completed', 0);
  assert.equal(store.runStates().chat, 'done');
  store.createSession({ id: 'empty' });
  assert.equal(store.runStates().empty, undefined);
});

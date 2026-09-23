import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import storeLib from './session-store.js';
import snapshotLib from '../session-snapshot.js';

const { messagePath, normalizeSnapshot } = snapshotLib;
function append(store, id, index, parent = undefined) {
  store.appendMessage(id, { id: `m${index}`, role: index % 2 ? 'assistant' : 'user',
    text: `synthetic ${index}`, done: true, ...(parent === undefined ? {} : { parentId: parent }) });
}
function legacy(store, id) {
  store.createSession({ id });
  store.db.prepare('UPDATE sessions SET schema_version=1 WHERE id=?').run(id);
  for (let i = 0; i < 4; i++) append(store, id, i, null);
}
function ids(snapshot) { return messagePath(snapshot.messages, snapshot.currentId).map((row) => row.id); }

test('four messages survive a physical store close/reopen with automatic parent linkage', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'athena-session-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'sessions.sqlite3');
  let store = storeLib.createSessionStore({ dbPath });
  store.createSession({ id: 'session' });
  for (let i = 0; i < 4; i++) append(store, 'session', i);
  store.close();
  store = storeLib.createSessionStore({ dbPath });
  try {
    const snapshot = store.getSession('session');
    assert.equal(snapshot.schemaVersion, 2);
    assert.deepEqual(ids(snapshot), ['m0', 'm1', 'm2', 'm3']);
    assert.equal(normalizeSnapshot(snapshot).schemaVersion, 2);
  } finally { store.close(); }
});

test('legacy flat history restores in memory and remains complete after a new turn without rewriting old rows', () => {
  const store = storeLib.createSessionStore({ dbPath: ':memory:' });
  try {
    legacy(store, 'legacy');
    assert.deepEqual(ids(store.getSession('legacy')), ['m0', 'm1', 'm2', 'm3']);
    assert.equal(store.getSession('legacy').schemaVersion, 1);
    append(store, 'legacy', 4);
    append(store, 'legacy', 5);
    assert.deepEqual(ids(store.getSession('legacy')), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM session_messages WHERE parent_id IS NULL').get().n, 4);
  } finally { store.close(); }
});

test('explicit linked branches and new explicit null roots are preserved', () => {
  const store = storeLib.createSessionStore({ dbPath: ':memory:' });
  try {
    store.createSession({ id: 'branch' });
    append(store, 'branch', 0);
    append(store, 'branch', 1);
    append(store, 'branch', 2, 'm0');
    assert.deepEqual(ids(store.getSession('branch')), ['m0', 'm2']);
    append(store, 'branch', 3, null);
    assert.deepEqual(ids(store.getSession('branch')), ['m3']);
    store.db.prepare('UPDATE sessions SET schema_version=1 WHERE id=?').run('branch');
    assert.deepEqual(ids(store.getSession('branch')), ['m3']);
    store.createSession({ id: 'roots' });
    for (let i = 0; i < 4; i++) append(store, 'roots', i, null);
    assert.deepEqual(ids(store.getSession('roots')), ['m3']);
  } finally { store.close(); }
});

test('legacy nonalternating or unfinished roots are not guessed into a linear transcript', () => {
  const rows = [
    { id: 'one', role: 'user', parentId: null, done: true },
    { id: 'two', role: 'user', parentId: null, done: true },
  ];
  assert.equal(snapshotLib.restoreLegacyMessageLinks(rows, 'two'), rows);
  rows[1] = { ...rows[1], role: 'assistant', done: false };
  assert.equal(snapshotLib.restoreLegacyMessageLinks(rows, 'two'), rows);
});

test('snapshot append follows the same explicit-root and default-parent contract', () => {
  let snapshot = snapshotLib.createSnapshot({ id: 'memory' });
  snapshot = snapshotLib.appendMessage(snapshot, { id: 'u', role: 'user' });
  snapshot = snapshotLib.appendMessage(snapshot, { id: 'a', role: 'assistant' });
  assert.deepEqual(ids(snapshot), ['u', 'a']);
  snapshot = snapshotLib.appendMessage(snapshot, { id: 'root', role: 'user', parentId: null });
  assert.deepEqual(ids(snapshot), ['root']);
  assert.equal(normalizeSnapshot({ ...snapshot, schemaVersion: 1 }).schemaVersion, 1);
});

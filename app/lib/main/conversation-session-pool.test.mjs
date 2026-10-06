import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { createConversationSessionPool } = createRequire(import.meta.url)('./conversation-session-pool');
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness(t) {
  const sessions = [];
  const pool = createConversationSessionPool({ desiredSize: 1, createSession() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const session = { warm: () => promise, run() {}, stop() {},
      resolve: () => resolve({ warm: true }), reject: () => reject(new Error('fixture warm failure')) };
    sessions.push(session);
    return session;
  } });
  t.after(() => pool.stop());
  pool.start();
  return { pool, sessions };
}
test('claiming an initializing session defers replacement until its warmup settles', async t => {
  const { pool, sessions } = harness(t);
  assert.equal(pool.claim(), sessions[0]);
  await settle();
  assert.equal(sessions.length, 1);
  sessions[0].resolve();
  await settle();
  assert.equal(sessions.length, 2);
});
test('claiming a ready session refills immediately', async t => {
  const { pool, sessions } = harness(t);
  sessions[0].resolve(); await settle();
  pool.claim(); await settle();
  assert.equal(sessions.length, 2);
});
test('claimed warmup failure also permits a replacement', async t => {
  const { pool, sessions } = harness(t);
  pool.claim(); await settle();
  assert.equal(sessions.length, 1);
  sessions[0].reject(); await settle();
  assert.equal(sessions.length, 2);
});
test('stopped or reconfigured pools ignore old claimed warmup completion', async t => {
  for (const change of ['stop', 'configure']) {
    const { pool, sessions } = harness(t);
    pool.claim(); await settle();
    if (change === 'stop') pool.stop();
    else {
      pool.configure({ model: 'fixture-new' });
      pool.claim();
      await settle();
    }
    const count = sessions.length;
    sessions[0].resolve(); await settle();
    assert.equal(sessions.length, count);
  }
});

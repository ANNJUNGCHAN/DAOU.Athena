import test from 'node:test';
import assert from 'node:assert/strict';
import agentCanvas from './agent-canvas.js';
const { recordedFireTime } = agentCanvas;

test('active future reservation and suppressed history never imply an arrived alert', () => {
  const item = { kind: 'schedule', status: 'active', raw: {
    next_fire_at: '2030-09-22T17:07:00+09:00',
    last_fired_at: null,
    last_run: { verdict: 'suppressed', ts: '2030-09-21T17:07:00+09:00' },
  } };
  assert.equal(recordedFireTime(item), null);
  assert.equal(recordedFireTime({ ...item, raw: {} }), null);
  assert.equal(recordedFireTime({ ...item, raw: { last_fired_at: 'invalid' } }), null);
});

test('a real prior firing stays accessible after pause or completion', () => {
  const fired = '2026-09-22T17:07:11+09:00';
  for (const status of ['active', 'paused', 'completed', 'cancelled']) {
    assert.equal(recordedFireTime({ status, raw: { last_fired_at: fired } }), fired);
  }
});

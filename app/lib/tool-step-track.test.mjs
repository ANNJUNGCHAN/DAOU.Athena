import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { applyToolStep } = require('./tool-step-track.js');
const { createTextReleaseLadder } = require('./text-release-ladder.js');

test('successful render completion replaces the ongoing label in the row and summary state', () => {
  const steps = new Map();
  const started = { id: 'canvas', label: '카드 그리는 중', done: false };
  assert.equal(applyToolStep(steps, started).label, '카드 그리는 중');
  const result = applyToolStep(steps, { ...started, done: true, elapsedMs: 1234 });
  assert.equal(result.label, '카드 표시 완료');
  assert.equal(result.rawLabel, started.label);
  assert.equal(result.timeText, '1.2s');
  assert.equal(steps.get('canvas').label, '카드 표시 완료');
  assert.equal(steps.size, 1);
  assert.equal(started.label, '카드 그리는 중');
});

test('failed and retrying canvas calls are not labelled as successful completion', () => {
  const steps = new Map();
  const completed = { id: 'canvas', label: '카드 그리는 중', done: true };
  assert.equal(applyToolStep(steps, { ...completed, error: true }).label, '카드 그리는 중 실패');
  assert.equal(applyToolStep(steps, { ...completed, retrying: true }).label,
    '카드 그리는 중 — 서버 연결 대기');
  assert.equal(applyToolStep(steps, { id: 'lookup', label: '현재가 조회', done: true }).label,
    '현재가 조회');
});

test('a completed canvas event still holds text until the card arrives, even without a start event', () => {
  let released = 0;
  const timers = new Set();
  const ladder = createTextReleaseLadder({
    onRelease: () => { released += 1; },
    setTimeoutFn: (callback) => { timers.add(callback); return callback; },
    clearTimeoutFn: (callback) => timers.delete(callback),
  });
  ladder.onToolStep(applyToolStep(new Map(), {
    id: 'canvas', label: '카드 그리는 중', done: true,
  }));
  for (const callback of timers) callback();
  assert.equal(released, 0);
  assert.equal(timers.size, 0);
  ladder.onCanvasLanded();
  assert.equal(released, 1);
  ladder.dispose();
});

test('non-canvas completion still releases text after the quiet interval', () => {
  let released = 0;
  let quiet;
  const ladder = createTextReleaseLadder({
    onRelease: () => { released += 1; },
    setTimeoutFn: (callback) => { quiet = callback; return callback; },
    clearTimeoutFn() {},
  });
  ladder.onToolStep(applyToolStep(new Map(), { id: 'search', label: '검색', done: true }));
  quiet();
  assert.equal(released, 1);
  ladder.dispose();
});

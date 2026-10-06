import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { syncOrbVisibility, buildOrbWindowOptions } = require('./orb-window');

function fixture({ shellVisible = false, minimized = false, orbVisible = false, topmost = false } = {}) {
  const calls = [];
  const shell = { isDestroyed: () => false, isVisible: () => shellVisible, isMinimized: () => minimized };
  const orb = {
    isDestroyed: () => false, isVisible: () => orbVisible, isAlwaysOnTop: () => topmost,
    showInactive() { calls.push('showInactive'); orbVisible = true; },
    setAlwaysOnTop(value) { calls.push(['setAlwaysOnTop', value]); topmost = value; },
    hide() { calls.push('hide'); orbVisible = false; },
  };
  return { shell, orb, calls };
}

test('show restores the orb topmost policy after an inactive show without changing the shell', () => {
  const { shell, orb, calls } = fixture();
  assert.equal(syncOrbVisibility(shell, orb), true);
  assert.deepEqual(calls, ['showInactive', ['setAlwaysOnTop', true]]);
  assert.equal(orb.isAlwaysOnTop(), true);
  assert.equal(shell.isVisible(), false);
  syncOrbVisibility(shell, orb);
  assert.equal(calls.length, 2, 'already-correct state does not repeatedly reorder');
});

test('an already visible orb repairs a lost flag without another show or focus', () => {
  const { shell, orb, calls } = fixture({ orbVisible: true, shellVisible: true, minimized: true });
  assert.equal(syncOrbVisibility(shell, orb), true);
  assert.deepEqual(calls, [['setAlwaysOnTop', true]]);
});

test('visible shell hides the orb without promoting any window', () => {
  const { shell, orb, calls } = fixture({ shellVisible: true, orbVisible: true });
  assert.equal(syncOrbVisibility(shell, orb), false);
  assert.deepEqual(calls, ['hide']);
  assert.equal(syncOrbVisibility(shell, null), false);
  assert.equal(syncOrbVisibility(shell, { isDestroyed: () => true }), false);
});

test('production orb options keep the existing unfocused transparent notification window', () => {
  const options = buildOrbWindowOptions({ x: 24, y: 24, width: 76, height: 76 }, 'preload.js');
  assert.equal(options.alwaysOnTop, true);
  assert.equal(options.show, false);
  assert.equal(options.transparent, true);
  assert.equal(options.skipTaskbar, true);
  assert.equal(options.webPreferences.contextIsolation, true);
  assert.equal(options.webPreferences.sandbox, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
const start = source.indexOf('function applyUiZoom(');
const end = source.indexOf("ipcMain.on('athena:zoom'", start);
assert.ok(start >= 0 && end > start);

function harness(restoredZoom) {
  let actualZoom = restoredZoom;
  const events = [];
  const context = vm.createContext({
    uiZoom: 1,
    shellWin: { isDestroyed: () => false, webContents: {
      getZoomFactor: () => actualZoom,
      setZoomFactor(value) { actualZoom = value; },
      send(channel, payload) { events.push({ channel, zoom: payload.zoom }); },
    } },
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, events, zoom: () => actualZoom };
}

test('zoom out starts from Chromium-restored zoom after process restart', () => {
  const run = harness(1.1);
  run.context.applyUiZoom('out');
  assert.equal(run.zoom(), 1);
  assert.deepEqual(run.events, [{ channel: 'athena:zoom-changed', zoom: 1 }]);
});

test('zoom uses the current window value when it changes outside the controller', () => {
  const run = harness(1);
  run.context.applyUiZoom('in');
  run.context.shellWin.webContents.setZoomFactor(1.5);
  run.context.applyUiZoom('in');
  assert.equal(run.zoom(), 1.65);
});

test('zoom bounds and reset still use the displayed window value', () => {
  const high = harness(2);
  high.context.applyUiZoom('in');
  assert.equal(high.zoom(), 2);
  const low = harness(0.5);
  low.context.applyUiZoom('out');
  assert.equal(low.zoom(), 0.5);
  low.context.applyUiZoom('reset');
  assert.equal(low.zoom(), 1);
});

test('zoom request with no live window has no effect', () => {
  const run = harness(1.1);
  run.context.shellWin = null;
  assert.doesNotThrow(() => run.context.applyUiZoom('out'));
  run.context.shellWin = { isDestroyed: () => true };
  assert.doesNotThrow(() => run.context.applyUiZoom('out'));
  assert.equal(run.zoom(), 1.1);
  assert.deepEqual(run.events, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const renderer = fs.readFileSync(new URL('../../canvas.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
function listener(channel) {
  const start = renderer.indexOf(`window.athena.on('${channel}',`);
  return renderer.slice(start, renderer.indexOf('\n});', start) + 4);
}
for (const channel of ['athena:add-canvas-live', 'athena:add-rest-canvas']) {
  test(`${channel}: late async A paint cannot report into B or a later A viewport`, async () => {
    for (const destination of ['B', 'A']) {
      let handle;
      let finish;
      const removed = [];
      const reports = [];
      const node = { classList: {} };
      const ctx = vm.createContext({
        canvasConversationId: 'A', canvasPaintRevision: 1,
        performance: { now: () => 0 }, isValidCorrelation: () => true,
        window: { athena: { on: (_, fn) => { handle = fn; } } },
        addLiveCard: () => new Promise((resolve) => { finish = resolve; }),
        destroyCard: (card) => removed.push(card),
        reportSessionCards: () => reports.push(ctx.canvasConversationId),
      });
      vm.runInContext(listener(channel), ctx);
      const pending = handle({ status: 'success', conversationId: 'A',
        envelope: { canvas_type: 'table', correlation: { dataset_id: 'test' } } });
      ctx.canvasConversationId = destination;
      ctx.canvasPaintRevision += destination === 'B' ? 1 : 2;
      finish(node);
      await pending;
      assert.deepEqual(removed, [node]);
      assert.deepEqual(reports, []);
    }
  });
}

test('pending authoritative card survives empty renderer reports until first mount and then respects removal', () => {
  const start = main.indexOf('const pendingCanvasCards = new Map();');
  const code = main.slice(start, main.indexOf('function sendLiveCanvasResult(', start));
  const ctx = vm.createContext({});
  vm.runInContext(code, ctx);
  ctx.rememberPendingCanvasCard('A', { envelope: { canvas_type: 'table' } }, 'a-card');
  assert.equal(ctx.mergePendingCanvasCards('B', []).length, 0);
  assert.equal(ctx.mergePendingCanvasCards('A', [])[0].cardId, 'a-card');
  assert.equal(ctx.mergePendingCanvasCards('A', [])[0].cardId, 'a-card');
  assert.equal(ctx.mergePendingCanvasCards('A', [{ cardId: 'a-card' }]).length, 1);
  assert.equal(ctx.mergePendingCanvasCards('A', []).length, 0);
  ctx.rememberPendingCanvasCard('A', { envelope: { canvas_type: 'chart' } }, 'pending-clear');
  assert.equal(ctx.mergePendingCanvasCards('A', [], true).length, 0);
  assert.equal(ctx.mergePendingCanvasCards('A', []).length, 0);
});

test('new-conversation clear changes viewport without deleting the prior session', () => {
  const sidebar = fs.readFileSync(new URL('../sidebar.js', import.meta.url), 'utf8');
  const start = sidebar.indexOf('  function clearConversationUi() {');
  const body = sidebar.slice(start, sidebar.indexOf('\n  }', start) + 4);
  const clears = [];
  const ctx = vm.createContext({
    window: { dispatchEvent() {}, AthenaShell: { clearCanvases: (options) => clears.push(options) } },
    Event: class {}, $history: { firstChild: null }, $roomBanner: {}, $input: null,
    renderList() {},
  });
  vm.runInContext(`${body}; clearConversationUi();`, ctx);
  assert.equal(clears.length, 1);
  assert.equal(clears[0].persist, false);
});

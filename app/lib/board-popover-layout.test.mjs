import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { menuPosition, update } = createRequire(import.meta.url)('./board-popover-layout.js');

test('a wrapped filter menu starts below its trigger, relative to the card', () => {
  assert.deepEqual(menuPosition({left:20,top:100,width:1120},{left:321,bottom:381}),{width:236,left:301,top:287});
  assert.deepEqual(menuPosition({left:20,top:100,width:360},{left:290,bottom:600}),{width:236,left:116,top:506});
});

test('a narrow card keeps the entire menu inside its horizontal margins', () => {
  assert.deepEqual(menuPosition({left:80,top:10,width:220},{left:85,bottom:210}),{width:204,left:8,top:206});
});

test('parent menu is repositioned after width relaxation and ignored after removal', () => {
  let placements = 0;
  let menu = { repositionParentRankingMenu() { placements++; } };
  const surface = { dataset: { bsBoardId: '13K0-2' },
    querySelector(selector) { return selector === '.bs-parent-ranking-menu' ? menu : null; } };
  update(surface);
  assert.equal(placements, 1);
  menu = null;
  update(surface);
  assert.equal(placements, 1);
});

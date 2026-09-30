import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('./board-template-registry');
const { STATE_GRAPH } = require('./board-templates.index.generated');

test('every account surface keeps all seven authored read-only header destinations', () => {
  const account = registry.boardIds().filter(id => registry.cardIdFor(id) === 'CC-01');
  assert.equal(account.length, 14);
  for (const id of account) {
    const links = registry.stateLinksFor(id);
    for (const destination of registry.ACCOUNT_NAVIGATION) {
      assert.ok(links.some(link => link.control === destination.control && link.board_id === destination.board_id), `${id}: ${destination.control}`);
      assert.equal(registry.cardIdFor(destination.board_id), 'CC-01');
    }
  }
});

test('nested expansions retain root siblings and the authored detail controls without duplicates', () => {
  let nested = 0;
  for (const [id, entry] of Object.entries(STATE_GRAPH)) {
    if (!entry.parent || !STATE_GRAPH[entry.parent]?.parent) continue;
    nested += 1;
    const links = registry.stateLinksFor(id);
    for (const expected of STATE_GRAPH[STATE_GRAPH[entry.parent].parent].links || []) {
      assert.ok(links.some(link => link.control === expected.control && link.board_id === expected.board_id), `${id}: ${expected.control}`);
    }
    assert.equal(new Set(links.map(link => `${link.board_id} ${link.control}`)).size, links.length);
  }
  assert.equal(nested, 40);
  assert.ok(registry.stateLinksFor('3MTJ-0').some(link => link.control === '거래내역 상세' && link.board_id === '3LGC-0'));
  assert.deepEqual(registry.stateLinksFor('3MTJ-0').filter(link => link.navigation), [
    { control: '상위 화면으로', board_id: '2SKU-1', navigation: 'parent' },
    { control: '기본 화면으로', board_id: '133H-2', navigation: 'root' },
  ]);
  assert.ok(registry.stateLinksFor('3ODO-0').some(link => link.control === '금현물 주문·체결' && link.board_id === '3OIM-0'));
  assert.deepEqual(registry.stateLinksFor('unknown-board'), []);
});

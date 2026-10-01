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
    const rootId = STATE_GRAPH[entry.parent].parent;
    const authored = new Set(STATE_GRAPH[rootId].links.map(link => (
      link.control === '순위' && link.board_id === '32XM-0' ? '신주인수권 전체' : link.control
    )));
    for (const expected of registry.stateLinksFor(rootId).filter(link => !link.navigation && authored.has(link.control))) {
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

test('instrument chart tabs return to their own chart instead of the industry specimen', () => {
  for (const id of ['137X-2', '2R3M-1', '2RBO-1', '3DI2-0', '3FR6-0']) {
    assert.deepEqual(registry.stateLinksFor(id).filter(link => link.control === '차트'), [
      { control: '차트', board_id: '137X-2' },
    ]);
  }
  for (const id of ['2RJ7-1', '32S7-0']) {
    assert.deepEqual(registry.stateLinksFor(id).filter(link => link.control === '차트'), [
      { control: '차트', board_id: id },
    ]);
  }
});

test('a stock context cannot hydrate gold, sector, ETF or ELW details', () => {
  const stock = { surface_contract: { board_id: '137X-2' }, symbol: '005930' };
  assert.equal(registry.navigationTargetRequirement('2RBO-1', stock), '');
  for (const [id, text] of [
    ['2RJ7-1', '금현물 종목'], ['32S7-0', '업종'], ['15N5-2', 'ETF 종목'], ['3DZ1-0', 'ELW 종목'],
  ]) {
    assert.ok(registry.navigationTargetRequirement(id, stock).startsWith(text));
    assert.equal(registry.navigationTargetRequirement(id, { surface_contract: { board_id: id } }), '');
  }
  assert.ok(registry.navigationTargetRequirement('137X-2', { surface_contract: { board_id: '2RJ7-1' } }));
  assert.equal(registry.navigationTargetRequirement('3MTJ-0', stock), '');
});

test('visible ranking actions have exact destinations and ELW lists require a selected instrument', () => {
  for (const id of ['2VO0-0', '2XA5-0', '2XY6-0', '2Y47-0', '2ZN9-0']) {
    assert.ok(registry.directStateLinksFor(id).some(link => link.control === 'ELW 상세 열기' && link.board_id === '15P5-2'));
    assert.match(registry.navigationTargetRequirement('15P5-2', { surface_contract: { board_id: id } }), /^ELW 종목/);
    assert.equal(registry.navigationTargetRequirement('15P5-2', {
      surface_contract: { board_id: id }, operation_args: { stk_cd: '58H215' },
    }), '');
  }
  assert.deepEqual(registry.additionalControlLabels('신용비율 높은 순'), ['신용비율 상위']);
  assert.deepEqual(registry.additionalControlLabels('대차잔고 많은 순'), ['대차 상위']);
  assert.deepEqual(registry.additionalControlLabels('ELW 거래원별 10창구 전체'), ['창구 상세 열기']);
  assert.ok(registry.directStateLinksFor('2VIN-0').some(link => link.control === '기간 수익률' && link.board_id === '2WZK-0'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildPolicy, hasBinding, staticDisplayRole } from './build-board-display-policy.mjs';

const require = createRequire(import.meta.url);
const policy = require('./board-display-policy-data');
const { prepareDisplayInput, correctBoardIdentity } = require('./board-display-policy');
const registry = require('./board-template-registry');
const { mountPlan } = require('./board-mount');
const source = (id) => JSON.parse(fs.readFileSync(new URL(`../../backend/ref/card-surface-templates/${id}/slots.json`, import.meta.url)));
const plan = (id, values = {}, options = {}) => {
  const prepared = prepareDisplayInput(registry.contractFor(id), values);
  return mountPlan(prepared.contract, prepared.values, options);
};
const text = (result, id) => result.assignments.find((entry) => entry.slotId === id)?.text;

test('generated policy exactly follows the 94 public read-only source contracts', () => {
  assert.deepEqual(policy, buildPolicy());
  assert.equal(Object.keys(policy).length, 94);
  for (const [id, rules] of Object.entries(policy)) {
    const contract = source(id);
    assert.notEqual(contract.card_id, 'CC-02');
    assert.notEqual(id, '1JZW-0');
    for (const [slotId, [authored, role]] of Object.entries(rules)) {
      const slot = contract.slots.find((item) => item.slot_id === slotId);
      assert.equal(authored, slot.paper_text);
      if (role !== 'caption') assert.equal(hasBinding(slot), ['price', 'price-composite', 'direction', 'bound-time', 'bound-label', 'bound-name', 'bound-format', 'bound-identifier'].includes(role), `${id}/${slotId}`);
    }
  }
});

test('unbound example statistics, timestamps and status cannot masquerade as observations', () => {
  const ranking = plan('2VDA-0');
  for (const id of ['s003', 's004', 's017', 's018', 's020', 's021', 's023', 's284', 's304']) {
    assert.equal(text(ranking, id), '—', id);
  }
  const company = plan('2RBO-1');
  assert.equal(text(company, 's003'), '상태 미확인');
  assert.equal(text(company, 's007'), '시각 미제공');
  assert.equal(text(company, 's112'), '시각 미제공');
  assert.equal(text(plan('2SKU-1'), 's143'), '시각 미제공');
  assert.equal(text(plan('2SCE-1'), 's168'), '—');
});

test('fixed headings, controls, product descriptions and numeric labels remain authored', () => {
  for (const id of Object.keys(policy)) {
    const original = registry.contractFor(id);
    const prepared = prepareDisplayInput(original, {}).contract;
    for (let i = 0; i < original.slots.length; i++) {
      if (!policy[id][original.slots[i].slot_id]) assert.equal(prepared.slots[i], original.slots[i]);
    }
  }
  assert.equal(text(plan('137X-2'), 's077'), '기관 12주체');
  for (const slot of source('1JPU-0').slots.filter((s) => /52주 (최저|최고)/.test(s.paper_text) && s.kind === 'label')) {
    assert.equal(text(plan('1JPU-0'), slot.slot_id), slot.paper_text);
  }
  assert.equal(text(plan('2SKU-1'), 's069'), '▸');
  for (const slot of source('2SKU-1').slots.filter((s) => s.slot_id >= 's040' && s.slot_id <= 's046')) {
    assert.equal(text(plan('2SKU-1'), slot.slot_id), slot.paper_text);
  }
  assert.equal(staticDisplayRole({ static: true, paper_text: '12주체', static_reason: '주체 수 라벨' }), null);
});

test('mapped row labels never restore specimen holdings after a short response', () => {
  // Public schema plus invented values only: three observed rows in an eight-row design.
  const observed = { s035: '테스트 종목 하나', s050: '테스트 종목 둘', s065: '테스트 종목 셋' };
  const result = plan('2SCE-1', observed);
  for (const [id, value] of Object.entries(observed)) assert.equal(text(result, id), value);
  for (const id of ['s080', 's095', 's110', 's125', 's140']) assert.equal(text(result, id), '미제공');
  assert.equal(text(plan('2SCE-1', observed, { emptyValueSlots: ['s080'] }), 's080'), '');
  assert.equal(text(plan('2SCE-1', observed, { deferredValueSlots: ['s080'] }), 's080'), '');
});

test('new observed statistics and real zero quantities remain visible', () => {
  assert.equal(text(plan('2VDA-0', { s017: 0 }), 's017'), '0');
  assert.equal(text(plan('2VDA-0', { s017: 7 }), 's017'), '7');
  assert.equal(text(plan('2SCE-1', { s038: 0 }), 's038'), '0');
  assert.equal(text(plan('137X-2', { s018: 0 }), 's018'), '0주');
});

test('bound prices use monetary units and zero-price sentinels without changing quantities', () => {
  assert.equal(text(plan('2RBO-1', { s099: -78600 }), 's099'), '78,600원');
  for (const value of [0, '000000', '+0', '-0.00', { value: '000000', text: '0' }]) {
    assert.equal(text(plan('137X-2', { s005: value }), 's005'), '—');
  }
  assert.equal(text(plan('137X-2', { s005: 12345 }), 's005'), '12,345원');
});

test('OHLC composite retains real prices and refuses unavailable zero parts', () => {
  const slot = source('137X-2').slots.find((s) => s.slot_id === 's016');
  const values = (prices) => ({ s016: { composite: { ...slot.composite,
    parts: slot.composite.parts.map((part, index) => ({ ...part, value: prices[index] })) } } });
  assert.equal(text(plan('137X-2', values([100, 110, 90])), 's016'), '100 · 110 · 90');
  assert.equal(text(plan('137X-2', values([0, 0, 0])), 's016'), '—');
  assert.equal(text(plan('137X-2', values([100, '000000', 90])), 's016'), '—');
});

test('time sentinel is unavailable while a received time is formatted', () => {
  assert.equal(text(plan('137X-2', { s007: '000000' }), 's007'), '시각 미제공');
  assert.equal(text(plan('137X-2', { s007: '091234' }), 's007'), '09:12:34');
});

test('verified industry fields use their own units and the caption describes that single field', () => {
  const result = plan('2TZN-1', { s148: 4321.25, s150: 1234, s152: 777, s154: 4100.5, s156: 2100.25, s157: '20260317' });
  assert.equal(text(result, 's145'), '선택 업종');
  assert.equal(text(result, 's148'), '4,321.25');
  assert.equal(text(result, 's150'), '12억 3,400만원');
  assert.equal(text(result, 's152'), '777개');
  assert.equal(text(result, 's154'), '4,100.50');
  assert.equal(text(result, 's156'), '2,100.25');
  assert.equal(text(result, 's157'), '52주 최고가일 2026-03-17');
  for (const id of ['s213', 's215', 's217']) assert.equal(text(result, id), '—');
  const settlement = plan('2SKU-1', {}, { emptyValueSlots: ['s047', 's054', 's061'] });
  // The day labels stay meaningful independently of a missing settlement date.
  assert.equal(text(settlement, 's047'), '오늘');
  assert.equal(text(settlement, 's054'), 'D+1');
  assert.equal(text(settlement, 's061'), 'D+2');
});

test('identity accepts a real Samsung response and never promotes stock codes or titles to names', () => {
  const envelope = { stk_cd: '005930', surface_contract: { board_id: '137X-2' } };
  assert.deepEqual(correctBoardIdentity(envelope, { s001: '삼성전자', s002: '005930' }, { name: '005930', code: '005930' }), { name: '삼성전자', code: '005930' });
  assert.equal(correctBoardIdentity(envelope, { s001: '005930' }, { name: '005930', code: '005930' }).name, '');
  assert.equal(correctBoardIdentity({ surface_contract: { board_id: '2VDA-0' } }, { s001: '주식순위' }, {}).name, '');
  assert.equal(correctBoardIdentity({ stk_nm: '조회한 종목' }, {}, { code: '123456' }).name, '조회한 종목');
});

test('settlement axes and unavailable gold-account as-of dates do not reuse specimen dates', () => {
  const settlement = plan('3MTJ-0', {});
  assert.deepEqual(['s035', 's043', 's052'].map(id => text(settlement, id)), ['오늘', 'D+1', 'D+2']);
  assert.deepEqual(['s036', 's044', 's053'].map(id => text(settlement, id)), ['', '', '']);
  assert.equal(text(settlement, 's064'), 'D+2 자산');
  assert.equal(text(settlement, 's067'), 'D+2 금액');
  assert.equal(text(plan('3ODO-0', {}), 's088'), '시각 미제공');
});

test('account generated display metadata agrees with the canonical slots', () => {
  const ids = registry.boardIds().filter(id => registry.cardIdFor(id) === 'CC-01');
  assert.equal(ids.length, 14);
  for (const id of ids) {
    const generated = new Map(registry.contractFor(id).slots.map(slot => [slot.slot_id, slot]));
    for (const slot of source(id).slots) {
      assert.equal(generated.get(slot.slot_id)?.kind, slot.kind, `${id}/${slot.slot_id}`);
      assert.deepEqual(generated.get(slot.slot_id)?.format ?? null, slot.format ?? null, `${id}/${slot.slot_id}`);
    }
  }
});

test('condition query preserves the mode control and does not claim monitoring or invent detection history', () => {
  const result = plan('2UN6-1', { s020: '합성 저장조건', s022: '7' });
  assert.equal(text(result, 's014'), '1회 조회');
  assert.equal(text(result, 's020'), '합성 저장조건');
  for (const id of ['s015', 's018', 's024', 's025', 's029', 's030', 's034', 's035']) {
    assert.equal(text(result, id), '상태 미확인');
  }
  for (const id of ['s047', 's058', 's069', 's125', 's126', 's128', 's129', 's131', 's132']) {
    assert.equal(text(result, id), '—');
  }
});

test('preparation is immutable and requires exact source text provenance', () => {
  const contract = registry.contractFor('137X-2');
  const values = { s005: { value: '000000' }, s018: 0 };
  const before = JSON.stringify({ contract, values });
  prepareDisplayInput(contract, values);
  assert.equal(JSON.stringify({ contract, values }), before);
  const changed = { board_id: '137X-2', slots: [{ slot_id: 's003', paper_text: '새 고정 라벨', kind: 'label', static: true }] };
  assert.equal(prepareDisplayInput(changed, {}).contract.slots[0], changed.slots[0]);
});

test('regular depth navigation keeps fixed captions without replacing the observed session', () => {
  for (const id of ['13BC-2', '2TRW-1']) {
    for (const values of [{}, { s004: '3' }]) {
      const result = plan(id, values);
      assert.equal(text(result, 's007'), '5단');
      assert.equal(text(result, 's008'), '10단');
      if (values.s004) assert.equal(text(result, 's004'), '3');
    }
  }
});

test('the investor KPI caption describes its received accumulated trading amount', () => {
  const value = { value: 1234, text: '1,234백만원', display_unit: '백만원' };
  const result = plan('3DI2-0', { s019: value });
  assert.equal(text(result, 's017'), '누적 거래대금');
  assert.equal(text(result, 's018'), '—');
  assert.equal(text(result, 's019'), value.text);
  assert.equal(source('3DI2-0').slots.find(s => s.slot_id === 's019').f, 'acc_trde_prica');
});

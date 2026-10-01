// Gold quote responses contain best prices and time rows, not a five-level ladder.
(function () {
'use strict';

const HISTORY = Array.from({ length: 8 }, (_, i) => [89, 90, 91, 92, 94].map(n => `s${String(n + i * 6).padStart(3, '0')}`));
const METRICS = [['s010','현재가'],['s011','등락률'],['s020','누적 거래량'],['s021','누적 거래대금'],
  ['s023','전일 거래량 대비'],['s024','거래회전율'],['s027','체결강도'],['s145','LP 회원사']];

function instrumentTitle(options = {}) {
  const code = String(options.operationArgs?.stk_cd || options.identity?.code || '');
  return { M04020000: '금 99.99_1kg', M04020100: '미니금 99.99_100g' }[code] || '금현물 호가';
}

function received(item) {
  return Boolean(item && !item.missing && !item.designText && String(item.text).trim());
}

function prepare(surface, contract) {
  if (contract.board_id !== '2QX1-1' || surface.querySelector('.bs-gold-section')) return;
  surface.classList.add('bs-gold-card');
  const doc = surface.ownerDocument;
  const add = (parent, tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  const section = doc.createElement('section');
  section.className = 'bs-gold-section';
  section.dataset.bsKeepEmptyRows = 'true';
  surface.insertBefore(section, surface.querySelector('.bs-kpi, .bs-workspace'));
  const leaves = new Map(contract.slots.map(slot => [slot.slot_id,
    [...surface.querySelectorAll(`[data-node="${slot.node || slot.node_id}"]`)]
      .find(node => !node.classList.contains('bs-paired') && node.childElementCount === 0)]));
  const move = (parent, id) => {
    const leaf = leaves.get(id);
    if (!leaf) return;
    leaf.classList.remove('bs-col');
    leaf.removeAttribute('data-col-priority');
    leaf.classList.add('bs-gold-value');
    parent.appendChild(leaf);
  };
  const context = add(section, 'div', 'bs-gold-context');
  add(context, 'span', 'bs-gold-clock-label', '조회 시각');
  move(context, 's012');
  const quotes = add(section, 'div', 'bs-gold-quotes');
  for (const [slot, caption] of [['s014','최우선 매도호가'],['s017','최우선 매수호가']]) {
    const cell = add(quotes, 'div', 'bs-gold-quote');
    add(cell, 'div', 'bs-gold-label', caption);
    move(cell, slot);
    add(cell, 'div', 'bs-gold-label', '원');
  }
  const metrics = add(section, 'div', 'bs-gold-metrics');
  for (const [slot, caption] of METRICS) {
    const cell = add(metrics, 'div', 'bs-gold-metric');
    cell.dataset.goldMetric = slot;
    add(cell, 'div', 'bs-gold-label', caption);
    move(cell, slot);
  }
  add(section, 'h3', 'bs-gold-title', '시간별 내역');
  add(section, 'div', 'bs-gold-hint bs-ranking-scroll-hint', '표를 좌우로 이동해 나머지 항목을 확인하세요.');
  const viewport = add(section, 'div', 'bs-gold-scroll');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', '금현물 시간별 내역, 가로 스크롤 가능');
  const table = add(viewport, 'div', 'bs-gold-table');
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', '금현물 시간별 내역');
  const head = add(table, 'div', 'bs-gold-row bs-gold-head');
  head.setAttribute('role', 'row');
  for (const text of ['시각', '체결가 (원)', '전일 대비 (원)', '체결량', '체결강도']) {
    add(head, 'div', 'bs-gold-cell', text).setAttribute('role', 'columnheader');
  }
  HISTORY.forEach((slots, index) => {
    const row = add(table, 'div', 'bs-gold-row');
    row.dataset.goldRow = String(index);
    row.setAttribute('role', 'row');
    for (const slot of slots) {
      const cell = add(row, 'div', 'bs-gold-cell');
      cell.setAttribute('role', 'cell');
      move(cell, slot);
    }
  });
  add(section, 'div', 'bs-gold-empty').setAttribute('role', 'status');
  for (const source of surface.querySelectorAll('.bs-kpi, .bs-workspace')) source.classList.add('bs-gold-original');
}

function update(surface, contract, plan, options = {}) {
  if (contract.board_id !== '2QX1-1') return;
  surface.__bsGoldOptions = options;
  const bySlot = new Map(plan.assignments.map(item => [item.slotId, item]));
  const pending = new Set([...(options.deferredValueSlots || []), ...(options.hydrationSlotIds || [])]);
  const heading = surface.querySelector('[data-slot-id="s001"]');
  if (heading) heading.textContent = instrumentTitle(options);
  const clockLabel = surface.querySelector('.bs-gold-clock-label');
  if (clockLabel) clockLabel.hidden = !received(bySlot.get('s012'));
  for (const leaf of surface.querySelectorAll('.bs-gold-value')) {
    const item = bySlot.get(leaf.dataset.slotId);
    if (item?.missing || !['up', 'down'].includes(item?.tone)) leaf.style.color = 'var(--color-k-text)';
  }
  for (const [slot] of METRICS) {
    const cell = surface.querySelector(`[data-gold-metric="${slot}"]`);
    if (cell) cell.hidden = !received(bySlot.get(slot)) && !pending.has(slot);
  }
  let visible = 0;
  let waiting = false;
  HISTORY.forEach((slots, index) => {
    const hasData = slots.some(id => received(bySlot.get(id)));
    const row = surface.querySelector(`[data-gold-row="${index}"]`);
    if (row) row.hidden = !hasData;
    visible += Number(hasData);
    waiting = waiting || slots.some(id => pending.has(id));
  });
  const status = surface.querySelector('.bs-gold-empty');
  const viewport = surface.querySelector('.bs-gold-scroll');
  if (viewport) viewport.hidden = visible === 0;
  const hint = surface.querySelector('.bs-gold-hint');
  if (hint) hint.hidden = visible === 0;
  if (status) {
    status.hidden = visible > 0;
    status.textContent = waiting ? '금현물 조회 자료를 기다리고 있습니다' : '표시할 시간별 내역이 없습니다';
  }
}

const api = { HISTORY, METRICS, instrumentTitle, received, prepare, update };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardGoldQuote = api; }
})();

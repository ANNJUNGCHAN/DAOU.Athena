// A query returns one investor measure or independent buy/sell broker lists.
(function () {
'use strict';

const INVESTORS = [['s034','s038'],['s042','s045'],['s049','s052'],['s056','s059'],['s063','s066'],['s070','s073'],['s077','s080'],['s084','s087'],['s091','s094'],['s098','s101'],['s105','s109'],['s113','s116'],['s120','s124']];
const BROKERS = {
  buy: [['s036','s037','s042'],['s048','s049','s054'],['s060','s061','s066'],['s072','s073','s077'],['s083','s084','s088']],
  sell: [['s039','s040','s043'],['s051','s052','s055'],['s063','s064','s067'],['s074','s075','s078'],['s085','s086','s089']],
};

const FLOW_TITLES = {
  '2QFO-2':'투자자별 매매', '2QM7-2':'거래원별 매매', '2ROJ-1':'프로그램 매매',
  '2RWK-1':'신용·대차·공매도', '2S4E-1':'종목 동향',
};
function receivedText(raw) {
  if (raw && typeof raw === 'object') {
    if (raw.missing || raw.pending || raw.empty) return '';
    raw = raw.value;
  }
  return typeof raw === 'string' ? raw.trim() : '';
}
function stockCode(raw) {
  const code = receivedText(raw).replace(/_(?:AL|NX)$/, '');
  return /^\d{6}$/.test(code) && code !== '000000' ? code : '';
}
function identityFor(boardId, envelope, values, fallback) {
  if (!FLOW_TITLES[boardId]) return fallback;
  const code = stockCode(fallback && fallback.code);
  const args = envelope.operation_args || envelope.arguments || {};
  const data = envelope.data || {};
  const fields = Array.isArray(data.fields) ? data.fields : [];
  const field = key => (fields.find(item => item && item.key === key) || {}).value;
  const topCode = envelope.stk_cd || envelope.symbol || args.stk_cd || args.symbol;
  const candidates = [
    [envelope.stk_nm, topCode],
    [args.stk_nm, args.stk_cd || args.symbol],
    [data.stk_nm, data.stk_cd || topCode],
    [field('stk_nm'), field('stk_cd')],
    [values && values.s001, values && values.s003],
  ];
  const pair = code && candidates.find(([name, symbol]) => receivedText(name) && stockCode(symbol) === code);
  return { name: pair ? receivedText(pair[0]) : FLOW_TITLES[boardId], code };
}
function queryContextFor(contract, targetCode, requestedOperation) {
  const context = contract && contract.board_id === '2QFO-2' && contract.flow_query_context;
  if (!context || !['base:ka10059','base:ka10061'].includes(context.operation_ref)) return null;
  if (['base:ka10059','base:ka10061'].includes(requestedOperation) && context.operation_ref !== requestedOperation) return null;
  const args = context.operation_args;
  const code = stockCode(targetCode);
  if (!args || typeof args !== 'object' || Array.isArray(args) || !code || stockCode(args.stk_cd) !== code) return null;
  const clean = { stk_cd: code };
  for (const key of ['dt','strt_dt','end_dt','trde_tp','amt_qty_tp','unit_tp']) {
    if (typeof args[key] === 'string') clean[key] = args[key];
  }
  return { operation_ref: context.operation_ref, operation_args: clean };
}

function investorSnapshotValues(current, incoming, contract, targetCode, operation) {
  if (!['base:ka10059', 'base:ka10061'].includes(operation)) return { ...current, ...incoming };
  if (!queryContextFor(contract, targetCode, operation)) return current;
  const next = { ...current };
  for (const id of ['s027', ...INVESTORS.map(row => row[1])]) delete next[id];
  return { ...next, ...incoming };
}

function dateText(raw) {
  const value = String(raw || '');
  return /^\d{8}$/.test(value) ? `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6)}` : '';
}

function investorCaption(plan, options) {
  const context = options.flowQueryContext;
  // Explicitly ambiguous or rejected metadata cannot borrow an older request.
  if (context === null) return '조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공';
  const args = context ? context.operation_args : options.operationArgs || {};
  const operation = context ? context.operation_ref : options.operationRef;
  const date = plan.assignments.find(item => item.slotId === 's027');
  const period = operation === 'base:ka10061'
    ? [dateText(args.strt_dt), dateText(args.end_dt)].filter(Boolean).join(' ~ ')
    : date && !date.missing && date.text.trim() ? date.text : dateText(args.dt);
  const trade = { '0':'순매수', '1':'매수', '2':'매도' }[args.trde_tp] || '매매구분 미제공';
  const unit = args.amt_qty_tp === '1' ? '금액'
    : args.amt_qty_tp === '2' ? '수량' : '금액·수량 구분 미제공';
  return `${period || '조회 기간 미제공'} · ${trade} · ${unit}`;
}

function prepare(surface, contract) {
  if (!['2QFO-2','2QM7-2'].includes(contract.board_id) || surface.querySelector('.bs-flow-section')) return;
  surface.classList.add('bs-flow-card');
  const doc = surface.ownerDocument;
  const add = (parent, tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  const section = doc.createElement('section');
  section.className = 'bs-flow-section';
  surface.insertBefore(section, surface.querySelector('.bs-workspace'));
  add(section, 'div', 'bs-flow-context');
  const panels = add(section, 'div', 'bs-flow-panels');
  const leaves = new Map(contract.slots.map(slot => [slot.slot_id,
    surface.querySelector(`[data-node="${slot.node || slot.node_id}"]`)]));
  const heading = leaves.get('s001');
  if (heading) {
    heading.style.removeProperty('font-size');
    heading.style.removeProperty('line-height');
  }
  const move = (parent, slotId, className) => {
    const node = leaves.get(slotId);
    if (!node) return;
    node.classList.add(className);
    for (const property of ['color','font-family','font-weight','font-size','line-height','text-align','white-space']) node.style.removeProperty(property);
    parent.appendChild(node);
  };
  const table = (key, title, rows, broker) => {
    const panel = add(panels, 'div', 'bs-flow-panel');
    add(panel, 'h3', 'bs-flow-title', title);
    const body = add(panel, 'div', 'bs-table bs-flow-table');
    body.dataset.node = `flow-${key}`;
    body.setAttribute('role', 'table');
    body.setAttribute('aria-label', title);
    const head = add(body, 'div', 'bs-flow-row');
    head.dataset.row = 'head';
    head.setAttribute('role', 'row');
    for (const label of [broker ? '순위 · 거래원' : '투자자', broker ? '거래량' : '요청한 매매값']) {
      add(head, 'div', 'bs-flow-cell', label).setAttribute('role', 'columnheader');
    }
    rows.forEach((slots, index) => {
      const row = add(body, 'div', 'bs-flow-row');
      row.dataset.row = `${key}-${index}`;
      row.setAttribute('role', 'row');
      const identity = add(row, 'div', 'bs-flow-cell bs-flow-identity');
      identity.dataset.col = '0';
      identity.setAttribute('role', 'cell');
      if (broker) add(identity, 'span', 'bs-flow-rank', String(index + 1));
      const name = add(identity, 'div', 'bs-flow-name');
      move(name, slots[0], 'bs-flow-name-text');
      if (broker) move(name, slots[1], 'bs-flow-code');
      const quantity = add(row, 'div', 'bs-flow-cell bs-flow-value');
      quantity.dataset.col = '1';
      quantity.setAttribute('role', 'cell');
      move(quantity, slots[broker ? 2 : 1], 'bs-flow-value-text');
    });
  };
  if (contract.board_id === '2QFO-2') table('investors', '투자자별 매매', INVESTORS, false);
  else {
    table('buy', '매수 상위 5개 거래원', BROKERS.buy, true);
    table('sell', '매도 상위 5개 거래원', BROKERS.sell, true);
  }
  for (const source of surface.querySelectorAll('.bs-kpi, .bs-workspace')) source.classList.add('bs-flow-original');
}

function update(surface, contract, plan, options = {}) {
  const context = surface.querySelector('.bs-flow-context');
  if (!context) return;
  surface.__bsFlowOptions = options;
  context.textContent = contract.board_id === '2QFO-2' ? investorCaption(plan, options)
    : '매수와 매도는 각각의 거래원 순위입니다. 같은 순위가 같은 거래원을 뜻하지 않습니다.';
  const assignments = new Map(plan.assignments.map(item => [item.slotId, item]));
  const pending = new Set([...(options.deferredValueSlots || []), ...(options.hydrationSlotIds || [])]);
  const tables = contract.board_id === '2QFO-2'
    ? { investors: INVESTORS.map(row => [row[1]]) } : BROKERS;
  for (const [key, rows] of Object.entries(tables)) {
    let visible = 0;
    let waiting = false;
    rows.forEach((slots, index) => {
    const row = surface.querySelector(`[data-row="${key}-${index}"]`);
    const hasData = slots.some(id => {
      const item = assignments.get(id);
      return item && !item.missing && !item.designText && item.text.trim();
    });
    const isWaiting = !hasData && slots.some(id => pending.has(id));
    visible += Number(Boolean(hasData));
    waiting = waiting || isWaiting;
    row.hidden = !hasData;
    row.style.display = hasData ? '' : 'none';
    if (!hasData && !isWaiting) row.dataset.bsRowCollapsed = 'true';
    else delete row.dataset.bsRowCollapsed;
    });
    const table = surface.querySelector(`[data-node="flow-${key}"]`);
    let status = table.querySelector('.bs-flow-waiting');
    if (!status) {
      status = surface.ownerDocument.createElement('div');
      status.className = 'bs-empty-table-message bs-flow-waiting';
      status.setAttribute('role', 'status');
      status.textContent = '조회 자료를 기다리고 있습니다';
      table.appendChild(status);
    }
    status.hidden = visible > 0 || !waiting;
  }
}

const api = { INVESTORS, BROKERS, investorCaption, identityFor, queryContextFor, investorSnapshotValues, prepare, update };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardFlowLayout = api; }
})();

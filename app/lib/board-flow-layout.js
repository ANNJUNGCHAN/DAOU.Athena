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
function identityFor(boardId, envelope, values, fallback, displayContext) {
  if (!FLOW_TITLES[boardId]) return fallback;
  const code = stockCode(fallback && fallback.code);
  const args = envelope.operation_args || envelope.arguments || {};
  const data = envelope.data || {};
  const fields = Array.isArray(data.fields) ? data.fields : [];
  const field = key => (fields.find(item => item && item.key === key) || {}).value;
  const topCode = envelope.stk_cd || envelope.symbol || args.stk_cd || args.symbol;
  const candidates = [
    [displayContext?.identity?.name, displayContext?.identity?.code],
    [envelope.stk_nm, topCode],
    [args.stk_nm, args.stk_cd || args.symbol],
    [data.stk_nm, data.stk_cd || topCode],
    [field('stk_nm'), field('stk_cd')],
    [values && values.s001, values && values.s003],
  ];
  const pair = code && candidates.find(([name, symbol]) => receivedText(name) && stockCode(symbol) === code);
  return { name: pair ? receivedText(pair[0]) : FLOW_TITLES[boardId], code };
}
const DISPLAY_SOURCES = {
  '2QFO-2': ['base:ka10059','base:ka10061'],
  '2ROJ-1': ['base:ka10059','base:ka10061','base:ka10037','base:ka90005','base:ka90006','base:ka90007','base:ka90008','base:ka90010','base:ka90013'],
};
function displayContextFor(boardId, value, targetCode) {
  const code = stockCode(targetCode);
  if (!DISPLAY_SOURCES[boardId] || !value || value.board_id !== boardId || !code || stockCode(value.stk_cd) !== code) return null;
  const identity = value.identity;
  const clean = { board_id: boardId, stk_cd: code, identity: null, queries: [] };
  if (identity?.source === 'base:ka10099' && stockCode(identity.code) === code && receivedText(identity.name)) clean.identity = { code, name: receivedText(identity.name), source: identity.source };
  for (const query of Array.isArray(value.queries) ? value.queries : []) {
    if (!DISPLAY_SOURCES[boardId].includes(query?.operation_ref)) continue;
    const args = query.operation_args;
    if (!args || typeof args !== 'object' || Array.isArray(args) || ('stk_cd' in args && stockCode(args.stk_cd) !== code)) continue;
    const safe = {};
    for (const key of ['stk_cd','dt','date','strt_dt','end_dt','trde_tp','amt_qty_tp','unit_tp','mrkt_tp','min_tic_tp','stex_tp']) if (typeof args[key] === 'string') safe[key] = args[key];
    clean.queries.push({ operation_ref: query.operation_ref, operation_args: safe });
  }
  return clean;
}
function sourceCaption(query) {
  const op = query.operation_ref, args = query.operation_args;
  const names = { 'base:ka10059':'투자자 별도 조회', 'base:ka10061':'투자자 기간 합계 별도 조회', 'base:ka10037':'외국계 매매 별도 조회', 'base:ka90005':'프로그램 시간대별', 'base:ka90006':'프로그램 차익잔고', 'base:ka90007':'프로그램 누적', 'base:ka90008':'종목 시간별 프로그램', 'base:ka90010':'프로그램 일자별', 'base:ka90013':'종목 일별 프로그램' };
  const period = op === 'base:ka10061' ? (dateText(args.strt_dt) && dateText(args.end_dt) ? [dateText(args.strt_dt), dateText(args.end_dt)].join(' ~ ') : '') : dateText(args.dt || args.date);
  const parts = [names[op], period ? '조회 기준 '+period : '조회 기간 미제공'];
  if (['base:ka10059','base:ka10061'].includes(op)) parts.push({'0':'순매수','1':'매수','2':'매도'}[args.trde_tp] || '매매구분 미제공');
  if (args.amt_qty_tp) parts.push({'1':'금액','2':'수량'}[args.amt_qty_tp] || '금액·수량 구분 미제공');
  if (['base:ka90005','base:ka90010'].includes(op) && ['0','1'].includes(args.min_tic_tp)) parts.push(args.min_tic_tp === '0' ? '틱' : '분');
  return parts.join(' · ');
}
function updateDisplayContext(surface, contract, plan, options) {
  if (!DISPLAY_SOURCES[contract.board_id]) return;
  // No upstream timing flag was supplied. This changes wording, not status.
  for (const assignment of plan.assignments) {
    if (!assignment.missing || assignment.text !== '상태 미확인') continue;
    const slot = contract.slots.find(item => item.slot_id === assignment.slotId);
    const node = slot && surface.querySelector(`[data-node="${slot.node || slot.node_id}"]`);
    if (node) node.textContent = '실시간 상태 미제공';
  }
  if (contract.board_id !== '2ROJ-1') return;
  let block = surface.querySelector('.bs-flow-source-context');
  if (!block) {
    block = surface.ownerDocument.createElement('div');
    block.className = 'bs-flow-source-context';
    block.setAttribute('aria-label', '수신 원천별 조회 조건');
    block.style.cssText = 'padding:8px 30px;font-size:13px;line-height:1.65;white-space:normal;overflow-wrap:anywhere';
    surface.insertBefore(block, surface.querySelector('.bs-kpi') || surface.querySelector('.bs-workspace'));
  }
  const queries = options.flowDisplayContext?.queries || [];
  const timeQuery = queries.find(query => query.operation_ref === 'base:ka90005');
  const interval = {'0':'틱','1':'분'}[timeQuery?.operation_args.min_tic_tp];
  const intervalSlot = contract.slots.find(item => item.slot_id === 's029');
  const intervalNode = intervalSlot && surface.querySelector(`[data-node="${intervalSlot.node || intervalSlot.node_id}"]`);
  if (intervalNode) intervalNode.textContent = interval ? '차익·비차익 · '+interval : '집계 주기 미제공';
  block.replaceChildren();
  if (!queries.length) block.textContent = '원천별 조회 조건 미제공';
  if (!queries.length) return;
  const investor = queries.find(query => ['base:ka10059','base:ka10061'].includes(query.operation_ref));
  if (investor) {
    const line = surface.ownerDocument.createElement('div');
    line.dataset.flowSource = investor.operation_ref;
    line.textContent = sourceCaption(investor);
    block.appendChild(line);
  }
  const program = queries.filter(query => query.operation_ref.startsWith('base:ka900'));
  const dates = [...new Set(program.map(query => dateText(query.operation_args.date)))];
  const details = surface.ownerDocument.createElement('details');
  const summary = surface.ownerDocument.createElement('summary');
  summary.textContent = program.length && dates.length === 1 && dates[0]
    ? '프로그램 조회 기준 '+dates[0]+' · 원천별 조건 보기'
    : '프로그램 조회 기간은 원천별 조건에서 확인';
  details.appendChild(summary);
  block.appendChild(details);
  for (const query of queries.filter(query => query !== investor)) {
    const line = surface.ownerDocument.createElement('div');
    line.dataset.flowSource = query.operation_ref;
    line.textContent = sourceCaption(query);
    details.appendChild(line);
  }
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
  updateDisplayContext(surface, contract, plan, options);
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

const api = { displayContextFor, sourceCaption, INVESTORS, BROKERS, investorCaption, identityFor, queryContextFor, investorSnapshotValues, prepare, update };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardFlowLayout = api; }
})();

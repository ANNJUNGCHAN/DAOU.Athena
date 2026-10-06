// The expanded ranking uses the current query's bounded projection, not seven sample rows.
(function () {
'use strict';

const formatter = typeof module !== 'undefined' && module.exports
  ? require('./board-format') : window.AthenaLib.BoardFormat;
const SORT_SLOTS = {
  'base:ka10032': 's011', 'base:ka10030': 's012', 'base:ka10031': 's013',
  'base:ka10027': 's014', 'base:ka10029': 's015', 'base:ka10020': 's016',
  'base:ka10021': 's017', 'base:ka10022': 's018', 'base:ka10023': 's019',
};
const QUERY_LABELS = {
  'base:ka10098': '시간외 단일가 등락률',
  'base:ka00198': '실시간 종목 조회 순위',
};

function cellText(column, raw) {
  if (raw === null || raw === undefined || raw === '') return { text: '—', missing: true };
  if (column.role === 'identifier' || column.format?.literal) return { text: String(raw), missing: false };
  const kind = formatter.kindOf(column.format || {});
  const numeric = formatter.toNumber(raw);
  if (column.role === 'price' && numeric === 0) return { text: '—', missing: true };
  // Numeric zero is a received value even when the wire pads it with zeroes.
  const value = ['number', 'percent', 'korean'].includes(kind) && numeric !== null ? numeric : raw;
  let result = formatter.formatSlot(column.format, value);
  // A ranking's volume growth can exceed 10,000%; it is not a portfolio weight.
  if (kind === 'percent' && !result.missing && result.text === '' && numeric !== null) {
    result = formatter.formatSlot({ ...column.format, kind: 'number', suffix: '%' }, numeric);
  }
  return result.missing ? { ...result, text: '—' } : result;
}

function modelFor(result) {
  if (!result || result.board_id !== '4B22-1' || !Array.isArray(result.rows) || !Array.isArray(result.columns)) return null;
  const columns = result.columns;
  const rows = result.rows.slice(0, 100).map(row => columns.map(column => cellText(column, row[column.key])));
  const received = Number.isInteger(result.received_count) ? result.received_count : rows.length;
  return { columns, rows, received, truncated: result.truncated === true || received > rows.length };
}

function mount(surface, contract, _plan, options = {}) {
  if (contract.board_id !== '4B22-1') return;
  const doc = surface.ownerDocument;
  const model = modelFor(options.rankingResult);
  const operation = options.rankingResult?.operation_ref || options.rankingOperationRef || '';
  for (const slotId of Object.values(SORT_SLOTS)) {
    const label = surface.querySelector(`[data-slot-id="${slotId}"]`);
    if (!label) continue;
    const chip = label.parentElement;
    chip.classList.add('bs-ranking-sort');
    chip.classList.toggle('bs-ranking-sort-current', SORT_SLOTS[operation] === slotId);
  }
  for (const original of surface.querySelectorAll('.bs-kpi, .bs-workspace, [data-node="4B8S-1"], [data-node="4B7Q-1"]')) {
    original.classList.add('bs-expanded-ranking-original');
  }
  let section = surface.querySelector('.bs-expanded-ranking');
  if (!section) {
    section = doc.createElement('section');
    section.className = 'bs-expanded-ranking';
    section.setAttribute('aria-label', '전체 조회 목록');
    surface.insertBefore(section, surface.querySelector('.bs-workspace'));
  }
  section.replaceChildren();
  const add = (parent, tag, className, text) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  add(section, 'h3', 'bs-ranking-title', QUERY_LABELS[operation] ? `전체 조회 목록 · ${QUERY_LABELS[operation]}` : '전체 조회 목록');
  const count = add(section, 'div', 'bs-ranking-count', model
    ? `${model.received.toLocaleString('ko-KR')}개 수신 · ${model.rows.length.toLocaleString('ko-KR')}개 표시`
    : '전체 목록 데이터를 기다리고 있습니다');
  count.setAttribute('role', 'status');
  if (!model) return;
  if (!model.rows.length) {
    add(section, 'div', 'bs-ranking-empty', '조회된 종목이 없습니다');
    return;
  }
  const scroll = add(section, 'div', 'bs-ranking-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', '전체 조회 목록 표, 좌우 방향키로 이동');
  const table = add(scroll, 'table', 'bs-ranking-table');
  table.setAttribute('aria-label', '현재 조회의 전체 결과');
  const head = add(add(table, 'thead', ''), 'tr', '');
  const configure = (cell, column) => {
    cell.dataset.field = column.key;
    cell.dataset.kind = formatter.kindOf(column.format || {});
    if (column.role) cell.dataset.role = column.role;
  };
  for (const column of model.columns) {
    const cell = add(head, 'th', '', column.label);
    cell.scope = 'col';
    configure(cell, column);
  }
  const body = add(table, 'tbody', '');
  for (const row of model.rows) {
    const tr = add(body, 'tr', '');
    row.forEach((value, index) => {
      const cell = add(tr, 'td', '', value.text);
      configure(cell, model.columns[index]);
      if (value.missing) { cell.title = '미제공'; cell.setAttribute('aria-label', '미제공'); }
      if (value.tone === 'up' || value.tone === 'down') cell.dataset.tone = value.tone;
    });
  }
  const hint = add(section, 'div', 'bs-ranking-note bs-ranking-scroll-hint', '표를 좌우로 이동해 모든 열을 확인하세요.');
  scroll.before(hint);
  add(section, 'div', 'bs-ranking-note', '번호는 응답 순서입니다.');
  if (model.truncated) add(section, 'div', 'bs-ranking-note', '수신 결과 중 앞 100개까지 표시합니다.');
}

const api = { SORT_SLOTS, cellText, modelFor, mount };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardRankingResult = api; }
})();

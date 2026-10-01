(function () {
  'use strict';

  // Only the allowlisted, typed one-shot records delivered by the local backend.
  function viewModel(envelope) {
    const operation = String(envelope?.operation_ref || '').trim();
    const isList = operation === 'base:ka10171';
    if (!isList && operation !== 'base:ka10172') return null;
    const data = envelope?.data;
    if (data?.lifecycle !== 'completed' || !Array.isArray(data.records)) return null;
    const columns = isList
      ? [['seq', '조건 번호'], ['name', '저장 조건식']]
      : [['9001', '종목코드'], ['302', '종목명'], ['10', '현재가 (원)'], ['13', '거래량 (주)']];
    const rows = data.records.filter(row => row && typeof row === 'object' && !Array.isArray(row))
      .map(row => columns.map(([key]) => {
        const value = row[key];
        if (!isList && key === '10') {
          const raw = String(value ?? '').trim().replace(/,/g, '');
          const price = /^[+-]?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
          return Number.isFinite(price) && price !== 0
            ? Math.abs(price).toLocaleString('ko-KR', { maximumFractionDigits: 6 }) : '—';
        }
        return typeof value === 'string' || typeof value === 'number'
          ? String(value).trim() || '—' : '—';
      }));
    return { columns: columns.map(([, name]) => name), rows,
      title: isList ? '저장 조건식 전체 목록' : '일회 검색 전체 결과',
      hasMore: !isList && data.has_more === true };
  }

  function render(host, envelope) {
    if (!host?.ownerDocument) return null;
    for (const child of Array.from(host.children)) {
      if (child.classList.contains('condition-query-list')) child.remove();
    }
    const model = viewModel(envelope);
    if (!model) return null;
    const doc = host.ownerDocument;
    const details = doc.createElement('details');
    details.className = 'condition-query-list';
    details.style.cssText = 'margin-top:12px;padding:12px 16px;border:1px solid var(--color-k-line-soft);border-radius:12px;color:var(--color-k-text);background:var(--color-k-panel);min-width:0';
    const summary = doc.createElement('summary');
    summary.textContent = `${model.title} · ${model.rows.length}개 수신`;
    summary.style.cssText = 'cursor:pointer;overflow-wrap:anywhere;font-size:13px';
    details.appendChild(summary);
    const note = doc.createElement('p');
    note.textContent = model.rows.length
      ? (model.hasMore ? '수신한 결과를 모두 표시합니다. 추가 결과는 이번 응답에 포함되지 않았습니다.' : '이번 조회에서 수신한 결과를 모두 표시합니다.')
      : '이번 조회에서 수신한 항목이 없습니다.';
    note.style.cssText = 'margin:12px 0;color:var(--color-k-dim);font-size:12px;overflow-wrap:anywhere';
    details.appendChild(note);
    if (model.rows.length) {
      const scroll = doc.createElement('div');
      scroll.style.cssText = 'max-height:360px;overflow:auto;min-width:0';
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', model.title);
      const table = doc.createElement('table');
      table.style.cssText = 'border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px';
      const head = table.createTHead().insertRow();
      for (const label of model.columns) {
        const th = doc.createElement('th');
        th.textContent = label; th.scope = 'col';
        th.style.cssText = 'text-align:left;padding:8px;border-bottom:1px solid var(--color-k-line-soft);overflow-wrap:anywhere';
        head.appendChild(th);
      }
      const body = table.createTBody();
      for (const values of model.rows) {
        const row = body.insertRow();
        for (const value of values) {
          const cell = row.insertCell(); cell.textContent = value;
          cell.style.cssText = 'padding:8px;border-bottom:1px solid var(--color-k-line-soft);vertical-align:top;overflow-wrap:anywhere';
        }
      }
      scroll.appendChild(table); details.appendChild(scroll);
    }
    host.appendChild(details);
    return details;
  }

  const api = { viewModel, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.ConditionQueryList = api; }
})();

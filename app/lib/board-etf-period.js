// ka40001 answers one ETF and one requested period, not a market-wide ranking.
(function () {
'use strict';

const PERIODS = Object.freeze({ '0': '1주', '1': '1개월', '2': '6개월', '3': '1년' });
const METRICS = [
  ['s017', 'ETF 수익률', true], ['s020', '체결 수익률', true],
  ['s023', '외국인 순매수', false], ['s026', '기관 순매수', false],
];

function modelFor(plan, options = {}) {
  const assignments = new Map((plan.assignments || []).map(item => [item.slotId, item]));
  const pending = new Set(options.deferredValueSlots || []);
  const period = String(options.operationArgs?.dt ?? '');
  const name = assignments.get('s004');
  const code = options.operationArgs?.stk_cd || options.identity?.code || '';
  return {
    period: Object.hasOwn(PERIODS, period) ? period : '',
    target: [name && !name.missing ? name.text : options.identity?.name, code].filter(Boolean).join(' · ') || '조회 대상 미확인',
    metrics: METRICS.map(([slot, label, prominent]) => {
      const item = assignments.get(slot);
      return { slot, label, prominent, text: pending.has(slot) ? '조회 중' : item?.text || '미제공', tone: item?.tone };
    }),
  };
}

function mount(surface, contract, plan, options = {}) {
  if (contract.board_id !== '2WZK-0') return;
  const doc = surface.ownerDocument;
  const model = modelFor(plan, options);
  for (const original of surface.querySelectorAll('.bs-kpi, .bs-workspace')) {
    original.classList.add('bs-etf-period-original');
  }
  let section = surface.querySelector('.bs-etf-period');
  if (!section) {
    section = doc.createElement('section');
    section.className = 'bs-etf-period';
    section.setAttribute('aria-label', '선택 ETF 기간 수익률');
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
  add(section, 'div', 'bs-etf-target', model.target);
  const controls = add(section, 'div', 'bs-etf-period-controls');
  add(controls, 'span', 'bs-etf-period-label', '조회 기간');
  const buttons = [];
  const note = doc.createElement('div');
  note.className = 'bs-etf-period-note';
  note.setAttribute('role', 'status');
  const description = model.period
    ? '선택한 ETF의 조회 기간에 대한 응답입니다. 기간을 바꾸면 다시 조회합니다.'
    : '조회 기간이 제공되지 않았습니다. 기간을 선택해 다시 조회할 수 있습니다.';
  note.textContent = description;
  for (const [period, label] of Object.entries(PERIODS)) {
    const button = add(controls, 'button', 'bs-etf-period-button', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(period === model.period));
    button.disabled = typeof options.onEtfPeriodChange !== 'function';
    button.addEventListener('click', async () => {
      if (period === model.period) return;
      buttons.forEach(node => { node.disabled = true; });
      note.textContent = `${label} 수익률 조회 중…`;
      try {
        await options.onEtfPeriodChange(period);
        note.textContent = description;
      } catch (_) {
        note.textContent = '조회하지 못했습니다. 기간을 다시 선택해 주세요.';
      } finally {
        buttons.forEach(node => { node.disabled = false; });
      }
    });
    buttons.push(button);
  }
  const metrics = add(section, 'div', 'bs-etf-metrics');
  for (const metric of model.metrics) {
    const item = add(metrics, 'div', 'bs-etf-metric');
    add(item, 'div', 'bs-etf-metric-label', metric.label);
    const value = add(item, 'div', `bs-etf-metric-value${metric.prominent ? ' is-prominent' : ''}`, metric.text);
    if (metric.tone === 'up' || metric.tone === 'down') value.dataset.tone = metric.tone;
  }
  section.appendChild(note);
}

const api = { PERIODS, modelFor, mount };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardEtfPeriod = api; }
})();

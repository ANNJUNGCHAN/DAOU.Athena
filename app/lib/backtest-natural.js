(function () {
'use strict';
const NaturalChart = typeof module !== 'undefined' && module.exports
  ? require('./backtest-natural-chart') : window.AthenaLib.BacktestNaturalChart;

const DEFAULT_STRATEGY = '종가가 5일 이동평균보다 높고 직전 봉보다 상승하면 진입한다. 보유 중 종가가 5일 이동평균보다 낮으면 청산한다. 그 외에는 보유하거나 관망한다.';
const STATUS = { paused: '일시 정지', running: '모의 감시 중', done: '완료', failed: '실패' };
const ACTION = { enter: '진입', hold: '보유', exit: '청산', wait: '관망' };
const OBSERVATION_LABELS = { open: '시가', high: '고가', low: '저가', close: '종가', volume: '거래량',
  previous_close: '직전 봉 종가', sma_5: '5일 평균 종가', sma_20: '20일 평균 종가',
  volume_ma_5: '5일 평균 거래량', cash: '현재 모의 현금', qty: '현재 보유 수량',
  entry_price: '실제 모의 진입 가격', unrealized_return_pct: '진입 가격 대비 미실현 수익률(%)' };
function readableReferences(text) {
  return String(text || '').replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (original, key) => OBSERVATION_LABELS[key] || original);
}
const FALLBACK = {
  server_unavailable_or_invalid_json: 'LAYA 서버 연결 또는 응답 오류',
  provider_error: '판단 서버 오류', illegal_or_missing_action: '허용되지 않거나 누락된 행동',
  probability_below_policy_floor: '판단 점수가 보류 기준에 해당함',
  ambiguous_choice: '후보 행동 간 점수 차이가 작음',
  malformed_response: 'LAYA 응답 형식 오류', malformed_choice: '후보 판단 형식 오류',
  malformed_usage: '모델 입력 처리 정보 오류', unexpected_model: '예상 모델과 다른 응답',
  truncated_input_or_options: '모델 입력 또는 선택지가 잘림',
};
function fallbackText(reason) {
  if (!reason) return '—';
  if (reason.includes('input_budget_exceeded')) return '조건과 관측값이 모델 입력 한도를 초과함';
  return FALLBACK[reason] || reason;
}

// 한 화면에서 한 세션만 제어한다. 결과 조회와 일시 정지가 겹쳐도 오래된 조회가
// 정지 응답을 덮지 않으며, 숨겨진 화면에서는 다음 조회 때 정지를 요청한다.
function createMonitor({ invoke, onChange = () => {}, isVisible = () => true,
  setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
  let snapshot = null;
  let preparation = null;
  let busy = false;
  let busyOperation = null;
  let error = '';
  let timer = null;
  let serial = 0;
  let applied = 0;
  let pauseRequested = false;
  let pendingMutation = null;
  const state = () => ({ snapshot, preparation, busy, busyOperation, error, pauseRequested });
  const notify = () => onChange(state());
  function stopTimer() {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  }
  function schedule() {
    stopTimer();
    if (snapshot && snapshot.status === 'running') {
      timer = setTimeoutImpl(() => {
        timer = null;
        if (!isVisible() && !pauseRequested) void pause();
        else void request('result');
      }, 1000);
    }
  }
  async function request(operation, payload) {
    const mutation = operation !== 'result';
    if (mutation && busy) return null;
    if (!['create', 'prepare'].includes(operation) && !snapshot) return null;
    stopTimer();
    const ticket = ++serial;
    if (mutation) { busy = true; busyOperation = operation; }
    error = '';
    notify();
    try {
      let response = await invoke('athena:backtest-run', {
        ...(['create', 'prepare'].includes(operation) ? payload : { session_id: snapshot.session_id }),
        decision_mode: 'natural', operation,
      });
      if (operation === 'create' && payload.replace_session_id && response && response.status === 404) {
        // 백엔드 재시작으로 이전 세션이 사라졌을 때만 새 세션으로 한 번 재시도한다.
        const { replace_session_id, ...fresh } = payload;
        response = await invoke('athena:backtest-run', { ...fresh, decision_mode: 'natural', operation });
      }
      if (!response || !response.ok) throw new Error(response && response.error || '모의 감시 응답을 받지 못했습니다.');
      if (operation === 'prepare') {
        const data = response.data;
        if (!data || (data.status !== 'needs_clarification' &&
          (!data.decision_schema || !data.decision_schema.schema_hash || data.decision_schema.source_text !== payload.strategy))) {
          throw new Error('LAYA 판단 설계 응답이 입력한 조건과 일치하지 않습니다.');
        }
      } else if (!response.data || !response.data.session_id) throw new Error('모의 감시 세션 응답이 올바르지 않습니다.');
      if (ticket >= applied) {
        applied = ticket;
        if (operation === 'prepare') preparation = response.data;
        else snapshot = response.data;
      }
      return response.data;
    } catch (err) {
      if (ticket >= applied) {
        applied = ticket;
        error = String(err && err.message || err);
      }
      return null;
    } finally {
      if (mutation) { busy = false; busyOperation = null; }
      notify();
      schedule();
    }
  }
  function mutate(operation, payload) {
    if (busy) return Promise.resolve(null);
    pendingMutation = request(operation, payload);
    return pendingMutation;
  }
  async function pause() {
    pauseRequested = true;
    if (busy && busyOperation !== 'prepare') await pendingMutation;
    if (!snapshot || snapshot.status !== 'running') { notify(); return snapshot; }
    return mutate('pause');
  }
  return {
    state,
    prepare(strategy) {
      if (busy || snapshot && snapshot.status === 'running') return Promise.resolve(null);
      return mutate('prepare', { strategy: String(strategy || '').trim() });
    },
    create(payload) {
      if (busy || snapshot && snapshot.status === 'running') return Promise.resolve(null);
      pauseRequested = false;
      return mutate('create', { ...payload, ...(snapshot ? { replace_session_id: snapshot.session_id } : {}) });
    },
    step() {
      if (!snapshot || snapshot.status !== 'paused') return Promise.resolve(null);
      pauseRequested = false;
      return mutate('step');
    },
    run() {
      if (!snapshot || snapshot.status !== 'paused') return Promise.resolve(null);
      pauseRequested = false;
      return mutate('run');
    },
    pause,
    refresh() { return snapshot ? request('result') : Promise.resolve(null); },
    exportJSON() { return snapshot ? JSON.stringify(snapshot, null, 2) : null; },
  };
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—';
}
function el(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}
function createPanel({ document, invoke, onClose, isVisible, setTimeoutImpl, clearTimeoutImpl }) {
  const root = el(document, 'section', 'backtest-natural');
  const head = el(document, 'div', 'backtest-natural-head');
  const title = el(document, 'div');
  title.appendChild(el(document, 'h2', '', '자연어 전략 · LAYA 모의 감시'));
  title.appendChild(el(document, 'p', '', '조건을 적으면 현재 선택한 모델이 LAYA 판단 입력을 설계합니다. 해석을 검토한 뒤 한 봉씩 모의 실행하세요.'));
  head.appendChild(title);
  root.appendChild(head);
  const makeButton = (parent, text, fn) => {
    const node = el(document, 'button', 'backtest-natural-button', text);
    node.type = 'button';
    node.addEventListener('click', fn);
    parent.appendChild(node);
    return node;
  };
  makeButton(head, '팔라스 홈', async () => {
    await monitor.pause();
    if (monitor.state().error) return;
    onClose();
  });
  root.appendChild(el(document, 'p', 'backtest-natural-notice',
    '실험 기능 · LAYA의 금융 판단 정확도와 복합 조건 준수는 검증되지 않았습니다. 실제 주문 없이 과거 봉을 순서대로 재생합니다. 수익과 조건 준수를 보장하지 않습니다.'));
  const form = el(document, 'form', 'backtest-natural-form');
  const fields = {};
  function field(label, key, type, value, props = {}) {
    const wrap = el(document, 'label', `backtest-natural-field${type === 'textarea' ? ' is-wide' : ''}`);
    wrap.appendChild(el(document, 'span', '', label));
    const input = el(document, type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') input.type = type;
    input.name = key;
    input.value = value;
    Object.assign(input, props);
    wrap.appendChild(input);
    form.appendChild(wrap);
    fields[key] = input;
    return input;
  }
  field('전략 조건 · 최대 2,000자', 'strategy', 'textarea', DEFAULT_STRATEGY, { rows: 4, required: true, maxLength: 2000 });
  const sourceLabel = el(document, 'label', 'backtest-natural-field');
  sourceLabel.appendChild(el(document, 'span', '', '데이터 출처'));
  const source = el(document, 'select');
  [['demo', '합성 데모 · 실제 시장 데이터 아님'], ['cache', '저장된 단일 종목 일봉']].forEach(([value, label]) => {
    const option = el(document, 'option', '', label);
    option.value = value;
    source.appendChild(option);
  });
  source.value = 'demo';
  fields.data_source = source;
  sourceLabel.appendChild(source);
  form.appendChild(sourceLabel);
  field('종목코드', 'symbol', 'text', '005930', { pattern: '[0-9]{6}', required: true });
  field('시작일 · 캐시 조회', 'from_dt', 'date', '2026-01-01', { required: true });
  field('종료일 · 캐시 조회', 'to_dt', 'date', '2026-09-30', { required: true });
  field('초기 자금 (원)', 'initial_cash', 'number', '10000000', { min: 1, step: 1, required: true });
  field('매수·매도 수수료 (bp)', 'fee_bps', 'number', '1.5', { min: 0, max: 1000, step: 'any', required: true });
  field('매도 세금 (bp)', 'tax_bps', 'number', '18', { min: 0, max: 1000, step: 'any', required: true });
  field('슬리피지 (bp)', 'slippage_bps', 'number', '5', { min: 0, max: 1000, step: 'any', required: true });
  const syncSource = () => {
    fields.symbol.disabled = source.value === 'demo';
    fields.from_dt.disabled = source.value === 'demo';
    fields.to_dt.disabled = source.value === 'demo';
  };
  source.addEventListener('change', syncSource);
  syncSource();
  root.appendChild(form);
  root.appendChild(el(document, 'p', 'backtest-natural-note',
    '1bp = 0.01% · 비용은 편집 가능한 가정입니다. 종가로 판단하고 다음 봉 시가에 모의 체결합니다. 마지막 봉의 신호는 체결되지 않습니다.'));
  root.appendChild(el(document, 'p', 'backtest-natural-note',
    '관측값: OHLCV, 전일 종가, 5일·20일 평균 가격, 5일 평균 거래량. 뉴스·재무 정보는 포함하지 않습니다. 긴 조건은 모델 입력 한도로 판단이 보류될 수 있으니 봉별 사유를 확인하세요.'));
  root.appendChild(el(document, 'p', 'backtest-natural-note',
    '새로 시작하면 현재 세션을 교체합니다. 기록을 보관하려면 먼저 JSON으로 내보내세요.'));
  const prepareControls = el(document, 'div', 'backtest-natural-controls');
  root.appendChild(prepareControls);
  const prepare = makeButton(prepareControls, 'LAYA 판단 설계', () => {
    if (!fields.strategy.value.trim()) { fields.strategy.reportValidity?.(); return; }
    void monitor.prepare(fields.strategy.value);
  });
  const review = el(document, 'section', 'backtest-natural-review');
  root.appendChild(review);
  const controls = el(document, 'div', 'backtest-natural-controls');
  root.appendChild(controls);
  const start = makeButton(controls, '검토한 조건으로 모의 시작', () => {
    if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
    const prepared = monitor.state().preparation;
    if (!prepared || !prepared.decision_schema || prepared.decision_schema.source_text !== fields.strategy.value.trim()) return;
    void monitor.create({
      strategy: fields.strategy.value.trim(), data_source: source.value,
      decision_schema: prepared.decision_schema,
      symbol: fields.symbol.value,
      ...(source.value === 'cache' ? { from_dt: fields.from_dt.value.replaceAll('-', ''),
        to_dt: fields.to_dt.value.replaceAll('-', '') } : {}),
      initial_cash: Number(fields.initial_cash.value),
      costs: Object.fromEntries(['fee_bps', 'tax_bps', 'slippage_bps'].map(key => [key, Number(fields[key].value)])),
    });
  });
  const next = makeButton(controls, '다음 봉', () => { void monitor.step(); });
  const run = makeButton(controls, '남은 봉 연속 실행', () => { void monitor.run(); });
  const pause = makeButton(controls, '일시 정지', () => { void monitor.pause(); });
  const download = makeButton(controls, '기록 JSON 내보내기', () => {
    const json = monitor.exportJSON();
    if (!json) return;
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = el(document, 'a');
    link.href = url;
    link.download = `athena-natural-${monitor.state().snapshot.session_id}.json`;
    root.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  form.addEventListener('submit', event => { event.preventDefault(); prepare.click(); });
  const message = el(document, 'p', 'backtest-natural-message');
  message.setAttribute('aria-live', 'polite');
  root.appendChild(message);
  const result = el(document, 'div', 'backtest-natural-result');
  root.appendChild(result);
  function render(state) {
    const s = state.snapshot;
    const running = !!s && s.status === 'running';
    const canAdvance = !!s && s.status === 'paused' && !state.busy;
    const prepared = state.preparation;
    const sourceMatches = !!prepared && !!prepared.decision_schema
      && prepared.decision_schema.source_text === fields.strategy.value.trim();
    prepare.disabled = running || state.busy || !fields.strategy.value.trim();
    start.disabled = running || state.busy || !sourceMatches;
    next.disabled = !canAdvance;
    run.disabled = !canAdvance;
    pause.disabled = !running || state.busy;
    download.disabled = !s;
    Object.values(fields).forEach(input => { input.disabled = running || state.busy; });
    if (!running && !state.busy) syncSource();
    message.textContent = state.error ? `오류: ${state.error}${running ? ' · 서버 정지 여부를 확인할 수 없습니다.' : ''}`
      : state.busyOperation === 'prepare' ? '현재 선택한 모델이 조건을 해석하고 LAYA 판단 입력을 설계하는 중입니다…'
        : state.busy ? '처리 중…' : s ? `${STATUS[s.status] || s.status} · ${s.cursor} / ${s.total}봉${state.pauseRequested && running ? ' · 현재 봉 처리 후 정지 요청됨' : ''}`
          : sourceMatches ? '해석과 판단 조건을 검토한 뒤 모의 실행을 시작하세요. 시작 후에는 일시 정지 상태에서 한 봉씩 진행합니다.'
            : '먼저 LAYA 판단을 설계하세요. 원문을 수정하면 다시 설계해야 모의 실행을 시작할 수 있습니다.';
    while (review.firstChild) review.removeChild(review.firstChild);
    review.hidden = !prepared;
    if (prepared) renderPreparation(document, review, prepared, sourceMatches);
    while (result.firstChild) result.removeChild(result.firstChild);
    if (s) renderSnapshot(document, result, s);
  }
  const monitor = createMonitor({ invoke, onChange: render, isVisible, setTimeoutImpl, clearTimeoutImpl });
  fields.strategy.addEventListener('input', () => render(monitor.state()));
  render(monitor.state());
  return { element: root, monitor };
}

function renderPreparation(document, root, preparation, sourceMatches) {
  root.appendChild(el(document, 'h3', '', 'LAYA에 전달할 판단 설계 검토'));
  if (preparation.status === 'needs_clarification') {
    root.appendChild(el(document, 'p', 'backtest-natural-notice', preparation.question || '조건을 더 구체적으로 적어 주세요.'));
    root.appendChild(el(document, 'p', 'backtest-natural-note', '위 전략 조건에 답을 반영한 뒤 다시 설계하세요.'));
    return;
  }
  const schema = preparation.decision_schema;
  if (!schema) return;
  if (!sourceMatches) root.appendChild(el(document, 'p', 'backtest-natural-notice', '원문이 변경되었습니다. 아래는 이전 설계이므로 다시 설계한 뒤 실행하세요.'));
  root.appendChild(el(document, 'h4', '', schema.title || '전략 해석'));
  root.appendChild(el(document, 'p', 'backtest-natural-strategy', schema.explanation || ''));
  const observations = schema.required_observations || [];
  root.appendChild(el(document, 'p', 'backtest-natural-note', `필요 관측값: ${observations.map(key => OBSERVATION_LABELS[key] || key).join(' · ')}`));
  [['flat', '보유하지 않을 때', ['enter', 'wait']], ['holding', '보유 중일 때', ['exit', 'hold']]].forEach(([key, title, actions]) => {
    const question = schema[key] || {};
    const group = el(document, 'div', 'backtest-natural-question');
    group.appendChild(el(document, 'h4', '', title));
    group.appendChild(el(document, 'p', 'backtest-natural-strategy', readableReferences(question.instructions)));
    const criteria = question.criteria || {};
    const list = el(document, 'dl');
    actions.forEach(action => {
      list.appendChild(el(document, 'dt', '', ACTION[action]));
      list.appendChild(el(document, 'dd', 'backtest-natural-strategy', readableReferences(criteria[action])));
    });
    group.appendChild(list);
    root.appendChild(group);
  });
  if (schema.author) root.appendChild(el(document, 'p', 'backtest-natural-note',
    `설계 모델: ${schema.author.provider || ''} ${schema.author.model || ''} · 실행 판단: LAYA`));
  (preparation.warnings || []).forEach(warning => root.appendChild(el(document, 'p', 'backtest-natural-notice', warning)));
  root.appendChild(el(document, 'p', 'backtest-natural-note', '해석이 다르면 위 자연어 조건을 수정하고 다시 설계하세요. 숫자·조건·진입과 청산 기준을 확인한 뒤 시작하세요.'));
  const details = el(document, 'details');
  details.appendChild(el(document, 'summary', '', 'LAYA 판단 입력 JSON 보기'));
  details.appendChild(el(document, 'pre', '', JSON.stringify(schema, null, 2)));
  root.appendChild(details);
}

function renderSnapshot(document, root, snapshot) {
  const candles = snapshot.input && snapshot.input.candles || [];
  const range = candles.length ? ` · ${candles[0].dt} ~ ${candles[candles.length - 1].dt}` : '';
  root.appendChild(el(document, 'p', 'backtest-natural-note',
    `이 세션의 출처: ${snapshot.data_source === 'demo' ? '합성 데모 · 실제 시장 데이터 아님' : '저장된 수정주가 일봉'} · ${snapshot.symbol || ''}${range} · 세션 ${snapshot.session_id}`));
  root.appendChild(el(document, 'p', 'backtest-natural-strategy', `실행 조건: ${snapshot.strategy}`));
  if (snapshot.error) root.appendChild(el(document, 'p', 'backtest-natural-notice', snapshot.error));
  if (snapshot.flags && snapshot.flags.length) root.appendChild(el(document, 'p', 'backtest-natural-notice', snapshot.flags.join(' · ')));
  if (snapshot.notices && snapshot.notices.length) {
    const notices = el(document, 'ul', 'backtest-natural-notes');
    snapshot.notices.forEach(text => notices.appendChild(el(document, 'li', '', text)));
    root.appendChild(notices);
  }
  const records = snapshot.decisions || [];
  const account = snapshot.current_state || {};
  const equity = (snapshot.equity || []).slice(-1)[0];
  const value = equity ? equity.equity : snapshot.input && snapshot.input.initial_cash;
  root.appendChild(el(document, 'p', 'backtest-natural-account',
    `현금 ${number(account.cash)}원 · 보유 ${number(account.qty)}주 · 평가자산 ${number(value)}원 · 체결 ${(snapshot.trades || []).length}건 · 대기 ${account.pending_entry ? '진입' : account.pending_exit ? '청산' : '없음'}`));
  root.appendChild(NaturalChart.renderChart(document, snapshot));
  root.appendChild(el(document, 'h3', '', '봉별 판단 · 최근 100개 (전체 기록은 JSON)'));
  const scroll = el(document, 'div', 'backtest-natural-table-scroll');
  const table = el(document, 'table', 'backtest-natural-table');
  const header = el(document, 'tr');
  ['시점', '판단', '불확실·장애 대체', '예약 행동', '판단 근거·계좌 기록'].forEach(text => header.appendChild(el(document, 'th', '', text)));
  const thead = el(document, 'thead');
  thead.appendChild(header);
  table.appendChild(thead);
  const tbody = el(document, 'tbody');
  records.slice(-100).forEach(row => {
    const tr = el(document, 'tr');
    const position = row.request && row.request.state || {};
    const pending = row.action === 'enter' || position.pending_entry ? '진입 대기'
      : row.action === 'exit' || position.pending_exit ? '청산 대기' : '없음';
    [row.as_of, ACTION[row.action] || row.action || '—',
      fallbackText(row.fallback_reason),
      pending].forEach(text => tr.appendChild(el(document, 'td', '', text)));
    const detailCell = el(document, 'td');
    const detail = el(document, 'details');
    detail.appendChild(el(document, 'summary', '', '관측값·판단·비용 확인'));
    detail.appendChild(el(document, 'pre', '', JSON.stringify(row, null, 2)));
    detailCell.appendChild(detail);
    tr.appendChild(detailCell);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  scroll.appendChild(table);
  root.appendChild(scroll);
  const audit = el(document, 'details', 'backtest-natural-audit');
  audit.appendChild(el(document, 'summary', '', '모의 체결·잔고·재현성 기록'));
  audit.appendChild(el(document, 'pre', '', JSON.stringify({ ...snapshot, decisions: undefined }, null, 2)));
  root.appendChild(audit);
}

const exports = { createMonitor, createPanel, renderSnapshot, renderPreparation, DEFAULT_STRATEGY };
if (typeof module !== 'undefined' && module.exports) module.exports = exports;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BacktestNatural = exports; }
})();

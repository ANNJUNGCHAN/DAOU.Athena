(function () {
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ACTIONS = { enter: '진입', exit: '청산', hold: '보유', wait: '관망' };
const WIDTH = 960;
const HEIGHT = 430;
const LEFT = 88;
const RIGHT = 938;
const PANES = { price: [30, 218], quantity: [258, 300], equity: [340, 394] };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const format = value => finite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 2 }) : '—';

function visibleRows(snapshot) {
  const input = snapshot.input || {};
  const candles = input.candles || [];
  const cursor = Number.isInteger(snapshot.cursor) ? Math.max(0, snapshot.cursor) : 0;
  const decisions = new Map((snapshot.decisions || []).map(row => [row.as_of, row]));
  const equity = new Map((snapshot.equity || []).map(row => [row.dt, row]));
  return candles.slice(0, cursor).map((bar, index) => {
    const decision = decisions.get(bar.dt);
    const state = decision && decision.request && decision.request.state || {};
    const point = equity.get(bar.dt) || {};
    const fills = (snapshot.trades || []).filter(trade => trade.dt === bar.dt);
    return { index, bar, decision, state, equity: point, fills,
      pending: decision && decision.action === 'enter' || state.pending_entry ? '진입 대기'
        : decision && decision.action === 'exit' || state.pending_exit ? '청산 대기' : '없음' };
  });
}

function scale(values, top, bottom, includeZero = false) {
  const valid = values.filter(finite);
  if (!valid.length) return null;
  let min = Math.min(...valid, ...(includeZero ? [0] : []));
  let max = Math.max(...valid, ...(includeZero ? [0] : []));
  const pad = max === min ? Math.max(Math.abs(max) * 0.01, 1) : (max - min) * 0.08;
  min = includeZero ? Math.max(0, min - pad) : min - pad;
  max += pad;
  return { min, max, y: value => bottom - (value - min) / (max - min) * (bottom - top) };
}

function buildGeometry(snapshot) {
  const rows = visibleRows(snapshot);
  const x = index => LEFT + (index + 0.5) * (RIGHT - LEFT) / Math.max(rows.length, 1);
  const price = scale(rows.flatMap(row => [row.bar.low, row.bar.high, ...row.fills.map(fill => fill.price)]), ...PANES.price);
  const quantity = scale(rows.map(row => row.state.qty), ...PANES.quantity, true);
  const equity = scale(rows.map(row => row.equity.equity), ...PANES.equity);
  const candleWidth = Math.min(10, Math.max(1, (RIGHT - LEFT) / Math.max(rows.length, 1) * 0.6));
  const bars = price ? rows.filter(row => ['open', 'high', 'low', 'close'].every(key => finite(row.bar[key]))).map(row => ({
    index: row.index, dt: row.bar.dt, x: x(row.index), high: price.y(row.bar.high), low: price.y(row.bar.low),
    open: price.y(row.bar.open), close: price.y(row.bar.close), up: row.bar.close >= row.bar.open,
  })) : [];
  const decisions = price ? rows.filter(row => row.decision && finite(row.bar.close)).map(row => ({
    index: row.index, dt: row.bar.dt, x: x(row.index), y: price.y(row.bar.close),
    action: row.decision.action, fallback: !!row.decision.fallback_reason,
  })) : [];
  const fills = price ? rows.flatMap(row => row.fills.filter(fill => finite(fill.price)).map(fill => ({
    ...fill, index: row.index, x: x(row.index), y: price.y(fill.price),
  }))) : [];
  function path(field, axis, stepped = false) {
    if (!axis) return '';
    let connected = false;
    return rows.map(row => {
      const value = field(row);
      if (!finite(value)) { connected = false; return ''; }
      const command = connected ? (stepped ? 'step' : 'L') : 'M';
      connected = true;
      if (command === 'step') return `H${x(row.index).toFixed(2)} V${axis.y(value).toFixed(2)}`;
      return `${command}${x(row.index).toFixed(2)} ${axis.y(value).toFixed(2)}`;
    }).filter(Boolean).join(' ');
  }
  return { rows, bars, decisions, fills, price, quantity, equity, candleWidth, x,
    quantityPath: path(row => row.state.qty, quantity, true), equityPath: path(row => row.equity.equity, equity),
  };
}

function renderChart(document, snapshot) {
  const geometry = buildGeometry(snapshot);
  function html(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function svgNode(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text != null) node.textContent = text;
    return node;
  }
  const root = html('section', 'backtest-natural-chart');
  root.appendChild(html('h3', '', '시점별 판단과 모의 체결'));
  root.appendChild(html('p', 'backtest-natural-note',
    '처리한 봉만 표시합니다. 빈 원은 종가 판단, 채운 삼각형은 실제 모의 체결입니다. 진입·청산 판단과 체결은 서로 다른 봉에 나타날 수 있습니다.'));
  if (!geometry.rows.length) {
    root.appendChild(html('p', 'backtest-natural-chart-empty', '다음 봉을 진행하면 가격·판단·보유 수량·평가자산이 시간 순서대로 표시됩니다.'));
    return root;
  }
  if (!geometry.bars.length || typeof document.createElementNS !== 'function') {
    root.appendChild(html('p', 'backtest-natural-chart-empty', '차트를 그릴 가격 자료가 없습니다. 아래 판단 기록을 확인하세요.'));
    return root;
  }
  const scroll = html('div', 'backtest-natural-chart-scroll');
  const svg = svgNode('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img',
    'aria-label': '처리한 과거 봉의 OHLC 가격, 종가 판단, 모의 체결, 보유 수량과 평가자산' });
  const desc = svgNode('desc', {}, `${geometry.rows[0].bar.dt}부터 ${geometry.rows.at(-1).bar.dt}까지 ${geometry.rows.length}봉. 아래 봉 선택기로 일별 기록을 확인할 수 있습니다.`);
  svg.appendChild(desc);
  [['price', '가격 (원)'], ['quantity', '보유 (주)'], ['equity', '평가자산 (원)']].forEach(([key, label]) => {
    const [top, bottom] = PANES[key];
    svg.appendChild(svgNode('text', { x: 8, y: top - 9, class: 'natural-chart-axis-title' }, label));
    const axis = geometry[key];
    if (!axis) return;
    [axis.max, (axis.max + axis.min) / 2, axis.min].forEach(value => {
      const y = axis.y(value);
      svg.appendChild(svgNode('line', { x1: LEFT, x2: RIGHT, y1: y, y2: y, class: 'natural-chart-grid' }));
      svg.appendChild(svgNode('text', { x: LEFT - 8, y: y + 3, 'text-anchor': 'end', class: 'natural-chart-axis' }, format(value)));
    });
  });
  geometry.bars.forEach(bar => {
    const group = svgNode('g', { class: `natural-chart-candle ${bar.up ? 'is-up' : 'is-down'}` });
    group.appendChild(svgNode('line', { x1: bar.x, x2: bar.x, y1: bar.high, y2: bar.low }));
    group.appendChild(svgNode('rect', { x: bar.x - geometry.candleWidth / 2,
      y: Math.min(bar.open, bar.close), width: geometry.candleWidth, height: Math.max(1, Math.abs(bar.open - bar.close)) }));
    svg.appendChild(group);
  });
  geometry.decisions.forEach(point => {
    const mark = svgNode('circle', { cx: point.x, cy: point.y, r: point.action === 'wait' || point.action === 'hold' ? 3 : 5,
      class: `natural-chart-decision is-${point.action}${point.fallback ? ' is-fallback' : ''}` });
    mark.appendChild(svgNode('title', {}, `${point.dt} 종가 판단: ${ACTIONS[point.action] || point.action}${point.fallback ? ' · 대체 정책' : ''}`));
    svg.appendChild(mark);
  });
  geometry.fills.forEach(fill => {
    const direction = fill.side === 'buy' ? 1 : -1;
    const mark = svgNode('path', { d: `M${fill.x} ${fill.y} L${fill.x - 5} ${fill.y + direction * 9} L${fill.x + 5} ${fill.y + direction * 9} Z`,
      class: `natural-chart-fill is-${fill.side}` });
    mark.appendChild(svgNode('title', {}, `${fill.dt} 모의 ${fill.side === 'buy' ? '매수' : '매도'} 체결 · ${format(fill.price)}원 · ${format(fill.qty)}주`));
    svg.appendChild(mark);
  });
  svg.appendChild(svgNode('path', { d: geometry.quantityPath, class: 'natural-chart-quantity' }));
  svg.appendChild(svgNode('path', { d: geometry.equityPath, class: 'natural-chart-equity' }));
  [...new Set([0, Math.floor((geometry.rows.length - 1) / 2), geometry.rows.length - 1])].forEach(index => {
    svg.appendChild(svgNode('text', { x: geometry.x(index), y: HEIGHT - 10, 'text-anchor': 'middle', class: 'natural-chart-axis' }, geometry.rows[index].bar.dt));
  });
  const cursor = svgNode('line', { y1: PANES.price[0], y2: PANES.equity[1], class: 'natural-chart-cursor' });
  svg.appendChild(cursor);
  scroll.appendChild(svg);
  root.appendChild(scroll);
  root.appendChild(html('p', 'backtest-natural-chart-legend', '○ 종가 판단 · ▲/▼ 모의 매수/매도 체결 · 보유 수량: 회색 · 평가자산: 보라색'));
  const select = html('label', 'backtest-natural-bar-select');
  const label = html('span');
  const slider = html('input');
  slider.type = 'range';
  slider.min = 0;
  slider.max = geometry.rows.length - 1;
  slider.step = 1;
  slider.value = geometry.rows.length - 1;
  slider.setAttribute('aria-label', '처리한 봉 선택');
  select.appendChild(label);
  select.appendChild(slider);
  root.appendChild(select);
  const ledger = html('div', 'backtest-natural-bar-ledger');
  ledger.setAttribute('aria-live', 'polite');
  root.appendChild(ledger);
  function selectBar(index) {
    const row = geometry.rows[index];
    if (!row) return;
    slider.value = index;
    label.textContent = `${row.bar.dt} · ${index + 1} / ${geometry.rows.length}봉`;
    cursor.setAttribute('x1', geometry.x(index));
    cursor.setAttribute('x2', geometry.x(index));
    while (ledger.firstChild) ledger.removeChild(ledger.firstChild);
    ledger.appendChild(html('p', '', `종가 ${format(row.bar.close)}원 · 판단 ${row.decision ? ACTIONS[row.decision.action] || row.decision.action : '기록 없음'} · ${row.pending}`));
    ledger.appendChild(html('p', '', `보유 ${format(row.state.qty)}주 · 현금 ${format(row.equity.cash)}원 · 평가자산 ${format(row.equity.equity)}원 · 포지션 평가 ${format(row.equity.position_value)}원`));
    ledger.appendChild(html('p', '', row.fills.length ? row.fills.map(fill =>
      `${fill.side === 'buy' ? '매수' : '매도'} 체결 ${format(fill.qty)}주 × ${format(fill.price)}원 · 수수료 ${format(fill.fee)}원 · 세금 ${format(fill.tax)}원${finite(fill.pnl) ? ` · 실현손익 ${format(fill.pnl)}원` : ''}`).join(' / ')
      : '이 봉의 모의 체결 없음'));
    if (row.decision && row.decision.fallback_reason) ledger.appendChild(html('p', 'backtest-natural-note', `대체 정책 사유: ${row.decision.fallback_reason}`));
  }
  slider.addEventListener('input', () => selectBar(Number(slider.value)));
  geometry.rows.forEach(row => {
    const hit = svgNode('rect', { x: geometry.x(row.index) - (RIGHT - LEFT) / geometry.rows.length / 2,
      y: PANES.price[0], width: (RIGHT - LEFT) / geometry.rows.length, height: PANES.equity[1] - PANES.price[0],
      class: 'natural-chart-hit' });
    hit.addEventListener('click', () => selectBar(row.index));
    svg.appendChild(hit);
  });
  selectBar(geometry.rows.length - 1);
  return root;
}

const exports = { visibleRows, buildGeometry, renderChart };
if (typeof module !== 'undefined' && module.exports) module.exports = exports;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BacktestNaturalChart = exports; }
})();

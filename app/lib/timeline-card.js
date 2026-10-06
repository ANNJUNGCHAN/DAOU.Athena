(function () {
'use strict';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = (value) => String(value).padStart(2, '0');

function timestamp(value, precision) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim();
  if (precision === 'day' || /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(raw)) {
    const date = raw.slice(0, 10);
    if (!DAY.test(date)) return null;
    const [year, month, day] = date.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day) return null;
    if (precision === 'day' || DAY.test(raw)) return parsed.getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function timeLabel(value, precision) {
  const time = timestamp(value, precision);
  if (time === null) return typeof value === 'string' && value ? value : '시각 없음';
  const date = new Date(time);
  const day = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
  if (precision === 'day' || DAY.test(value.trim())) return day;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function normalizeTimeline(data = {}) {
  const rawPrices = Array.isArray(data.price_series) ? data.price_series : [];
  const prices = rawPrices.filter((row) => row && typeof row.close === 'number'
    && Number.isFinite(row.close) && timestamp(row.ts) !== null)
    .map((row) => ({ ...row, time: timestamp(row.ts) })).sort((a, b) => a.time - b.time);
  const events = (Array.isArray(data.events) ? data.events : []).filter((row) => row && typeof row === 'object')
    .map((row) => ({ ...row, time: timestamp(row.ts, row.ts_precision), url: safeUrl(row.url) }))
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
  const datedEvents = events.filter((row) => row.time !== null);
  const daily = prices.length > 0 ? prices.every((row) => DAY.test(row.ts.trim()))
    : datedEvents.length > 0 && datedEvents.every((row) => row.ts_precision === 'day' || DAY.test(row.ts.trim()));
  const axisTime = (time) => {
    if (!daily || time === null) return time;
    const date = new Date(time);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  };
  const times = [...prices, ...events].map((row) => axisTime(row.time)).filter((time) => time !== null);
  const start = times.length ? Math.min(...times) : null;
  const end = times.length ? Math.max(...times) : null;
  const x = (time) => start === end ? 50 : ((axisTime(time) - start) / (end - start)) * 100;
  return { rawPrices, prices, events, daily, start, end, x, rejectedPrices: rawPrices.length - prices.length };
}

function createTimeline(data, doc = document) {
  const model = normalizeTimeline(data && typeof data === 'object' ? data : {});
  const root = doc.createElement('div');
  root.className = 'timeline-content';
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = (value) => typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('ko-KR', { maximumFractionDigits: 8 }) : '—';
  const latest = model.prices.at(-1);
  const summary = el('div', 'timeline-summary');
  if (latest) {
    summary.append(el('span', 'timeline-muted', '최근 종가'), el('strong', 'timeline-latest', number(latest.close)),
      el('span', 'timeline-muted', timeLabel(latest.ts)));
  }
  summary.append(el('span', 'timeline-muted', model.rawPrices.length
    ? `가격 ${model.prices.length}건 · 사건 ${model.events.length}건` : `사건 ${model.events.length}건`));
  root.append(summary);
  if (!model.rawPrices.length && !model.events.length) {
    root.append(el('p', 'timeline-muted', '표시할 가격이나 사건이 없습니다. 기간이나 종목을 바꿔 다시 조회해 주세요.'));
    return root;
  }

  if (model.prices.length && model.start !== null) {
    const chart = el('div', 'timeline-chart');
    chart.setAttribute('role', 'img');
    chart.setAttribute('aria-label', `${model.daily ? '일자' : '시간'}별 ${model.prices.length ? '종가와 사건' : '사건'}. 상세 값은 아래 목록에서 확인할 수 있습니다.`);
    const plot = el('div', 'timeline-plot');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 1000 200');
    svg.setAttribute('preserveAspectRatio', 'none');
    const shape = (tag, attrs) => {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      svg.append(node);
      return node;
    };
    const values = model.prices.map((row) => row.close);
    const low = values.length ? Math.min(...values) : 0;
    const high = values.length ? Math.max(...values) : 0;
    const y = (value) => high === low ? 90 : 160 - ((value - low) / (high - low)) * 140;
    if (values.length) {
      const priceAxis = el('div', 'timeline-price-axis');
      const ticks = high === low ? [[high, 90]] : [[high, 20], [(low + high) / 2, 90], [low, 160]];
      for (const [value, top] of ticks) {
        shape('line', { x1: 0, x2: 1000, y1: top, y2: top, class: 'timeline-gridline' });
        const label = el('span', 'timeline-price-label', number(value));
        label.style.top = `${top}px`;
        priceAxis.append(label);
      }
      chart.append(priceAxis);
      shape('polyline', { points: model.prices.map((row) => `${model.x(row.time) * 10},${y(row.close)}`).join(' '), class: 'timeline-price-line' });
      for (const row of model.prices) {
        const dot = el('span', 'timeline-price-dot');
        dot.style.left = `${model.x(row.time)}%`;
        dot.style.top = `${y(row.close)}px`;
        dot.title = `${timeLabel(row.ts)} · 종가 ${number(row.close)}`;
        plot.append(dot);
      }
    }
    for (const event of model.events.filter((row) => row.time !== null)) {
      const dot = el('span', 'timeline-event-dot');
      dot.style.left = `${model.x(event.time)}%`;
      dot.title = `${timeLabel(event.ts, event.ts_precision)} · ${event.title || '(제목 없음)'}`;
      plot.append(dot);
    }
    plot.prepend(svg);
    const dates = el('div', 'timeline-axis');
    for (const [time, side] of model.start === model.end ? [[model.start, 'middle']]
      : [[model.start, 'start'], [model.end, 'end']]) {
      const label = el('span', `timeline-axis-${side}`, timeLabel(new Date(time).toISOString(), model.daily ? 'day' : 'second'));
      // Daily ticks are calendar dates in the same local zone as the plotted data.
      if (model.daily) {
        const date = new Date(time);
        label.textContent = `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
      }
      dates.append(label);
    }
    plot.append(dates);
    chart.prepend(plot);
    const legend = [model.prices.length ? '종가' : '', model.events.length ? '분홍 표시 · 사건' : ''].filter(Boolean).join(' / ');
    root.append(chart, el('div', 'timeline-muted', `${legend} · ${model.daily ? '일자' : '시간'} 기준 (정확한 시각은 아래 목록)`));
  }
  if (model.rejectedPrices) root.append(el('p', 'timeline-muted', `시각 또는 종가를 확인할 수 없는 가격 ${model.rejectedPrices}건은 차트에서 제외했습니다.`));

  if (model.prices.length) root.append(el('div', 'timeline-section-title', '함께 확인할 사건'));
  const list = el('ol', 'timeline-events');
  for (const event of model.events) {
    const row = el('li', 'timeline-event');
    row.append(el('time', 'timeline-event-time', timeLabel(event.ts, event.ts_precision)));
    const copy = el('div', 'timeline-event-copy');
    copy.append(el('div', 'timeline-event-title', event.title || '(제목 없음)'));
    if (event.source) copy.append(el('div', 'timeline-muted', event.source));
    if (event.summary) copy.append(el('div', 'timeline-event-summary', event.summary));
    row.append(copy);
    if (event.url) {
      const link = el('a', 'timeline-event-link', '원문 열기 ↗');
      link.href = event.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
    }
    list.append(row);
  }
  root.append(model.events.length ? list : el('p', 'timeline-muted', '표시할 사건이 없습니다.'));
  if (model.rawPrices.length) {
    const details = el('details', 'timeline-price-details');
    details.append(el('summary', '', `가격 원자료 ${model.rawPrices.length}건`));
    const scroll = el('div', 'common-table-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', '가격 원자료 표, 가로 스크롤 가능');
    const table = el('table', 'fin-table common-table');
    const head = el('thead');
    const headRow = el('tr');
    for (const label of ['시각', '시가', '고가', '저가', '종가', '거래량']) headRow.append(el('th', '', label));
    head.append(headRow);
    table.append(head);
    const body = el('tbody');
    for (const price of model.rawPrices) {
      const row = el('tr');
      row.append(el('td', '', timeLabel(price && price.ts)));
      for (const key of ['open', 'high', 'low', 'close', 'volume']) row.append(el('td', 'is-numeric', number(price && price[key])));
      body.append(row);
    }
    table.append(body);
    scroll.append(table);
    details.append(scroll);
    root.append(details);
  }
  return root;
}

const api = { timestamp, timeLabel, safeUrl, normalizeTimeline, createTimeline };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.TimelineCard = api; }
})();

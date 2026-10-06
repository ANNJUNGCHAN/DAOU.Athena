import test from 'node:test';
import assert from 'node:assert/strict';
import timeline from './timeline-card.js';
import layout from './canvas-layout.js';

test('timeline routes to a full-width card and participates in replacement', () => {
  assert.equal(layout.widthGradeFor('timeline'), 'full');
  assert.deepEqual(layout.dropTargetsFor(['timeline', 'table', 'timeline']), ['timeline', 'table', 'mcp-table']);
});

test('prices sort by time without coercing missing or invalid values to zero', () => {
  const model = timeline.normalizeTimeline({ price_series: [
    { ts: '2026-09-29', close: 153500 }, { ts: '2026-09-28', close: 150850 },
    { ts: '2026-09-27', close: null }, { ts: '2026-02-30', close: 100 },
    { ts: 'bad date', close: 200 }, { ts: '2026-09-26', close: Infinity },
  ] });
  assert.deepEqual(model.prices.map((row) => row.close), [150850, 153500]);
  assert.equal(model.rejectedPrices, 4);
  assert.equal(model.rawPrices.length, 6);
  assert.equal(model.x(model.prices[0].time), 0);
  assert.equal(model.x(model.prices[1].time), 100);
});

test('daily prices align events by calendar day and keep their exact timestamps', () => {
  const model = timeline.normalizeTimeline({
    price_series: [{ ts: '2026-09-28', close: 100 }, { ts: '2026-09-29', close: 110 }],
    events: [{ ts: '2026-09-29T15:04:37', ts_precision: 'second', title: '공시' }],
  });
  assert.equal(model.daily, true);
  assert.equal(model.x(model.events[0].time), model.x(model.prices[1].time));
  assert.match(timeline.timeLabel(model.events[0].ts, 'second'), /15:04:37$/);
  assert.equal(timeline.timeLabel('2026-09-29', 'day'), '2026.09.29');
});

test('impossible timestamp dates are rejected without losing their original values', () => {
  const invalid = ['2026-02-30T09:00:00', '2026-02-30T09:00:00+09:00', '2026-04-31T00:00:00Z'];
  const model = timeline.normalizeTimeline({
    price_series: invalid.map((ts) => ({ ts, close: 100 })),
    events: invalid.map((ts) => ({ ts, title: '원문 보존' })),
  });
  assert.equal(model.prices.length, 0);
  assert.equal(model.rejectedPrices, invalid.length);
  assert.deepEqual(model.rawPrices.map((row) => row.ts), invalid);
  assert.deepEqual(model.events.map((row) => row.time), [null, null, null]);
  assert.deepEqual(model.events.map((row) => timeline.timeLabel(row.ts)), invalid);
  assert.notEqual(timeline.timestamp('2024-02-29T09:00:00+09:00'), null);
});

test('intraday data uses elapsed time and a single observation stays centered', () => {
  const model = timeline.normalizeTimeline({
    price_series: [{ ts: '2026-09-29T09:00:00', close: 100 }, { ts: '2026-09-29T11:00:00', close: 110 }],
    events: [{ ts: '2026-09-29T10:00:00', ts_precision: 'second' }],
  });
  assert.equal(model.daily, false);
  assert.equal(model.x(model.events[0].time), 50);
  const single = timeline.normalizeTimeline({ price_series: [{ ts: '2026-09-29', close: 0 }] });
  assert.equal(single.x(single.prices[0].time), 50);
  assert.equal(single.prices[0].close, 0);
});

test('partial and empty timelines remain valid; invalid event dates remain visible', () => {
  const events = timeline.normalizeTimeline({ events: [{ ts: 'unknown', title: '원문 시각' }] });
  assert.equal(events.start, null);
  assert.equal(events.events.length, 1);
  assert.equal(timeline.timeLabel(events.events[0].ts), 'unknown');
  assert.equal(timeline.normalizeTimeline({ events: [] }).start, null);
  assert.equal(timeline.normalizeTimeline({ price_series: [] }).prices.length, 0);
  assert.equal(timeline.normalizeTimeline({ events: [{ ts: '2026-09-29', ts_precision: 'day' }] }).daily, true);
});

test('external event links allow only explicit web URLs', () => {
  assert.equal(timeline.safeUrl('https://example.com/report?id=1'), 'https://example.com/report?id=1');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,hi', 'file:///private', '/relative', 'not a URL', null]) {
    assert.equal(timeline.safeUrl(unsafe), null);
  }
});

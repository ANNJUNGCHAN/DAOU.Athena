import assert from 'node:assert/strict';
import test from 'node:test';
import chartCard from './chart-card.js';
import { defaultHorzScaleBehavior } from './lightweight-charts-axis.mjs';

function fixture() {
  const options = {
    localization: { locale: 'en-US', dateFormat: "dd MMM 'yy" },
    timeScale: { timeVisible: false, secondsVisible: false },
  };
  return { options, format: chartCard.createChartTimeFormatter(defaultHorzScaleBehavior, () => options) };
}

// Catches null/empty fallback and an accidental KST date shift for daily epochs.
test('daily crosshair labels preserve the library date format for every supported Time representation', () => {
  const { format } = fixture();
  const times = ['2025-07-20', { year: 2025, month: 7, day: 20 }, Date.UTC(2025, 6, 20, 23, 30) / 1000];
  for (const time of times) assert.equal(format(time), "20 Jul '25");
});

// Catches stale intraday callbacks, missing seconds, UTC display, and undefined reset.
test('the same callback returns from minute and tick KST labels to daily dates', () => {
  const { options, format } = fixture();
  const time = Date.UTC(2025, 6, 20, 0, 5, 6) / 1000;
  for (const [timeVisible, secondsVisible, want] of [
    [false, false, "20 Jul '25"],
    [true, false, '09:05'],
    [false, false, "20 Jul '25"],
    [true, true, '09:05:06'],
    [false, false, "20 Jul '25"],
  ]) {
    Object.assign(options.timeScale, { timeVisible, secondsVisible });
    assert.equal(format(time), want);
  }
});

test('daily fallback reads current date-format and locale options', () => {
  const { options, format } = fixture();
  assert.equal(format('2025-07-20'), "20 Jul '25");
  options.localization = { locale: 'en-US', dateFormat: 'yyyy/MM/dd' };
  assert.equal(format('2025-07-20'), '2025/07/20');
  options.localization = { locale: 'ko-KR', dateFormat: "dd MMM 'yy" };
  assert.equal(format('2025-07-20'), "20 7월 '25");
});

// Intraday data normally uses epochs; the public Time union also accepts dates.
test('intraday callbacks retain a nonempty string for date-form Time values', () => {
  const { options, format } = fixture();
  options.timeScale.timeVisible = true;
  for (const secondsVisible of [false, true]) {
    options.timeScale.secondsVisible = secondsVisible;
    for (const time of ['2025-07-20', { year: 2025, month: 7, day: 20 }]) {
      const label = format(time);
      assert.equal(typeof label, 'string');
      assert.ok(label.length > 0);
    }
  }
});

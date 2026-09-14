import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseRealTick } = require('./chart-realtime.js');

const base = { type: '0B', item: '005930', values: { 20: '090000', 10: '257000', 15: '1' } };

test('0B FID25 전일대비기호는 검증된 1~5 코드만 직접 전달한다', () => {
  for (const sign of ['1', '2', '3', '4', '5']) {
    const tick = parseRealTick({ ...base, values: { ...base.values, 25: sign } }, '20260825');
    assert.equal(tick.sign, Number(sign));
  }
  for (const sign of ['', '0', '6', '-1', '상승']) {
    const tick = parseRealTick({ ...base, values: { ...base.values, 25: sign } }, '20260825');
    assert.equal(tick.sign, null);
  }
});

test('FID25가 없으면 등락 부호로 기호를 추론하지 않는다', () => {
  const tick = parseRealTick({
    ...base,
    values: { ...base.values, 11: '-3500', 12: '-1.37' },
  }, '20260825');
  assert.equal(tick.sign, null);
});

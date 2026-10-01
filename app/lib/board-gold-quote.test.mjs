import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { HISTORY, instrumentTitle, received } = createRequire(import.meta.url)('./board-gold-quote.js');

test('gold history keeps each authored time row separate and excludes unbound buy/sell labels', () => {
  assert.equal(HISTORY.length, 8);
  assert.deepEqual(HISTORY[0], ['s089','s090','s091','s092','s094']);
  assert.deepEqual(HISTORY[7], ['s131','s132','s133','s134','s136']);
  assert.equal(new Set(HISTORY.flat()).size, 40);
  assert.equal(HISTORY.flat().includes('s093'), false);
});

test('received zero stays visible while missing and design specimens cannot create a row', () => {
  assert.equal(received({text:'0',missing:false}), true);
  assert.equal(received({text:'미제공',missing:true}), false);
  assert.equal(received({text:'123',designText:true}), false);
  assert.equal(received(undefined), false);
});

test('gold identity names only a known requested product', () => {
  assert.equal(instrumentTitle({operationArgs:{stk_cd:'M04020000'}}), '금 99.99_1kg');
  assert.equal(instrumentTitle({operationArgs:{stk_cd:'M04020100'}}), '미니금 99.99_100g');
  assert.equal(instrumentTitle({identity:{code:'005930'}}), '금현물 호가');
});

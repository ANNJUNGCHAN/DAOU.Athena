import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
  assert.equal(received({text:'-12.5%',missing:false}), true);
  assert.equal(received({text:'+7',missing:false}), true);
  assert.equal(received({text:'',missing:false}), false);
  assert.equal(received({text:' \t ',missing:false}), false);
  assert.equal(received({text:'미제공',missing:true}), false);
  assert.equal(received({text:'123',designText:true}), false);
  assert.equal(received(undefined), false);
});

test('gold identity names only a known requested product', () => {
  assert.equal(instrumentTitle({operationArgs:{stk_cd:'M04020000'}}), '금 99.99_1kg');
  assert.equal(instrumentTitle({operationArgs:{stk_cd:'M04020100'}}), '미니금 99.99_100g');
  assert.equal(instrumentTitle({identity:{code:'005930'}}), '금현물 호가');
});

test('all gold time-row differences preserve signed values in canonical and compiled formats', () => {
  const require = createRequire(import.meta.url);
  const canonical = JSON.parse(fs.readFileSync(new URL('../../backend/ref/card-surface-templates/2QX1-1/slots.json', import.meta.url))).slots;
  const compiled = require('./board-templates.CC-04.generated.js').BOARDS['2QX1-1'].slots;
  const { formatSlot } = require('./board-format.js');
  const differences = canonical.filter(slot => slot.f === 'pred_pre');
  assert.equal(differences.length, 8);
  for (const slot of differences) {
    const format = compiled.find(item => item.slot_id === slot.slot_id).format;
    assert.deepEqual(format, slot.format);
    assert.equal(formatSlot(format, '-1450').text, '-1,450');
    assert.equal(formatSlot(format, '+1450').text, '+1,450');
    assert.equal(formatSlot(format, '0').text, '0');
  }
});

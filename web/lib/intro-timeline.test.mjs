import test from 'node:test';
import assert from 'node:assert/strict';
import { introAt, EN_QUOTE, KO_QUOTE, INTRO_END } from './intro-timeline.ts';

test('star flight, English, deletion, Korean and clearing remain in order', () => {
  assert.equal(introAt(0).space, true);
  assert.equal(introAt(3300).space, false);
  assert.equal(introAt(6000).text, EN_QUOTE);
  assert.equal(introAt(6000).citation, true);
  assert.ok(introAt(8200).text.length < EN_QUOTE.length);
  assert.equal(introAt(8200).citation, false);
  assert.equal(introAt(8600).text, '');
  assert.equal(introAt(11100).text, KO_QUOTE);
  assert.equal(introAt(11100).citation, true);
  assert.equal(introAt(13500).clearing, true);
  assert.equal(introAt(INTRO_END).done, true);
});
test('backspace always removes from the end and typing preserves the prefix', () => {
  let length = EN_QUOTE.length;
  for (let t = 7800; t < 8600; t += 30) {
    const text = introAt(t).text;
    assert.ok(EN_QUOTE.startsWith(text));
    assert.ok(text.length <= length);
    length = text.length;
  }
  for (let t = 8900; t < 11100; t += 30) assert.ok(KO_QUOTE.startsWith(introAt(t).text));
});

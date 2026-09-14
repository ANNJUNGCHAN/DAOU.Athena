import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '..');
const source = fs.readFileSync(path.join(app, 'orb.js'), 'utf8');
const html = fs.readFileSync(path.join(app, 'orb.html'), 'utf8');
const css = fs.readFileSync(path.join(app, 'orb.css'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const brace = source.indexOf('{', source.indexOf(') {', start));
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`${name} body did not close`);
}

test('Orb loads the shared selector before its renderer and exposes accessible controls', () => {
  assert.ok(html.indexOf('<script src="lib/card-component-target.js">') < html.indexOf('<script src="orb.js">'));
  for (const id of ['orbComponentQuestion', 'orbComponentSelection', 'orbComponentSelectionLabel', 'orbComponentQuestionClear']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="orbComponentQuestion"[^>]+aria-pressed="false"/);
  assert.match(html, /id="orbComponentQuestionClear"[^>]+aria-label="선택 항목 해제"/);
  assert.match(css, /\.orb-component-question-trigger\s*\{[\s\S]*min-width:\s*44px;[\s\S]*min-height:\s*44px;/);
});

test('authoritative sessionCardId tags an Orb card and its envelope getter follows live updates', () => {
  const context = vm.createContext({ Object, String });
  vm.runInContext(functionSource('tagOrbQuestionCard'), context);
  const tag = vm.runInContext('tagOrbQuestionCard', context);
  const initial = { data: { fields: [{ value: 40900 }] } };
  const card = { dataset: {} };
  assert.equal(tag(card, { sessionCardId: 'card-orb-1', envelope: initial }), true);
  assert.equal(card.dataset.sessionCardId, 'card-orb-1');
  assert.equal(card.__athenaSessionCard.envelope, initial);
  const live = { data: { fields: [{ value: 41100 }] } };
  card.__athenaOrbCurrentEnvelope = live;
  assert.equal(card.__athenaSessionCard.envelope, live);
  assert.equal(tag({ dataset: {} }, { envelope: initial }), false, 'renderer never invents a missing main card id');
});

test('both Orb canvas render paths tag cards and submit structured cardContext', () => {
  assert.equal((source.match(/tagOrbQuestionCard\(el, r\);/g) || []).length, 2);
  assert.match(source, /cardSelector:\s*'\[data-session-card-id\]'/);
  assert.match(source, /const cardContext = orbCardComponentTarget\.getContext\(\);/);
  assert.match(source, /athena:orb-chat-submit'[\s\S]*query: text, clientSubmitId, rendererSubmittedAt, cardContext/);
  assert.match(source, /if \(cardContext\) orbCardComponentTarget\.clearSelection\(cardContext\);/);
});

test('Kiumi values expose the exact persisted slot path and product label for questions', () => {
  const context = vm.createContext({ Object, String, Array });
  vm.runInContext(functionSource('orbKiumiComponentPath'), context);
  const resolve = vm.runInContext('orbKiumiComponentPath', context);
  assert.equal(resolve({ surface_contract: { slot_values: [
    { slot_id: 's-flow', value: 80 },
  ] } }, 's-flow'), 'surface_contract.slot_values.0.value');
  assert.equal(resolve({ surface_contract: { slot_values: { 's-flow': 80 } } }, 's-flow'),
    'surface_contract.slot_values.s-flow');
  assert.match(source, /value\.dataset\.cardComponentLabel = String\(element\.label/);
  assert.match(source, /value\.dataset\.cardComponentObservation = 'true'/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validatePublicPresentationFiles,
  validateSlideOrder,
} from './publication-contract.mjs';

const manifest = JSON.parse(
  await readFile(
    new URL('../public/presentation/slides/manifest.json', import.meta.url),
    'utf8',
  ),
);

test('viewer asset order exactly matches the declared 39-slide display order', () => {
  assert.doesNotThrow(() => validateSlideOrder(manifest, 39));
});

test('publication rejects a shuffled slide array even when displayOrder stays valid', () => {
  const shuffled = structuredClone(manifest);
  [shuffled.slides[0], shuffled.slides[1]] = [
    shuffled.slides[1],
    shuffled.slides[0],
  ];
  assert.throws(
    () => validateSlideOrder(shuffled, 39),
    /slide asset order does not match display order/,
  );
});

test('publication rejects archived presentation runtimes restored under public', () => {
  const expected = manifest.displayOrder;
  assert.doesNotThrow(() =>
    validatePublicPresentationFiles([
      'slides/manifest.json',
      ...expected.map((file) => `slides/${file}`),
    ], expected),
  );
  assert.throws(
    () =>
      validatePublicPresentationFiles([
        'slides/manifest.json',
        ...expected.map((file) => `slides/${file}`),
        'paper-final.html',
        'ATHENA-최종발표.pptx',
      ], expected),
    /unexpected public presentation asset: paper-final\.html/,
  );
});

test('publication rejects extra files even inside the slide directory', () => {
  assert.throws(
    () =>
      validatePublicPresentationFiles(
        [
          'slides/manifest.json',
          ...manifest.displayOrder.map((file) => `slides/${file}`),
          'slides/old.html',
        ],
        manifest.displayOrder,
      ),
    /unexpected public presentation asset: slides\/old\.html/,
  );
});

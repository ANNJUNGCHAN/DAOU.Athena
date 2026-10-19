import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePublicPresentationFiles,
  validateSlideOrder,
} from './publication-contract.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (relative) =>
  JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const sha256 = (file) =>
  createHash('sha256').update(readFileSync(file)).digest('hex');
const fail = (message) => {
  throw new Error(`PUBLICATION_BLOCKED: ${message}`);
};
const listFiles = (directory, prefix = '') =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(prefix, entry.name);
    return entry.isDirectory()
      ? listFiles(path.join(directory, entry.name), relative)
      : [relative];
  });

const release = readJson('config/product-release.json');
if (release.presentation?.status !== 'canonical')
  fail('presentation manifest is not canonical');
if (release.presentation.slides !== 39)
  fail('canonical presentation must contain 39 slides');
if (!/^[0-9a-f]{64}$/.test(release.presentation.sha256 ?? ''))
  fail('canonical presentation source hash is missing');

const assetManifest = readJson('public/presentation/slides/manifest.json');
try {
  validatePublicPresentationFiles(
    listFiles(path.join(root, 'public', 'presentation')),
    assetManifest.displayOrder,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : 'invalid public presentation assets');
}
if (assetManifest.schemaVersion !== 1) fail('unsupported slide manifest');
if (assetManifest.source?.sha256 !== release.presentation.sha256)
  fail('slide source hash does not match the product release manifest');
if (assetManifest.source?.slideCount !== release.presentation.slides)
  fail('slide count does not match the product release manifest');
try {
  validateSlideOrder(assetManifest, release.presentation.slides);
} catch (error) {
  fail(error instanceof Error ? error.message : 'invalid slide order');
}

const slidesByFile = new Map(assetManifest.slides.map((slide) => [slide.file, slide]));
for (const [index, file] of assetManifest.displayOrder.entries()) {
  if (path.basename(file) !== file) fail(`unsafe slide file path: ${file}`);
  const slide = slidesByFile.get(file);
  if (!slide || slide.number !== index + 1)
    fail(`slide ${index + 1} is missing or out of order`);
  if (!['render', 'poster'].includes(slide.kind))
    fail(`slide ${index + 1} has an invalid preview kind`);
  if (!Number.isInteger(slide.width) || !Number.isInteger(slide.height))
    fail(`slide ${index + 1} has invalid dimensions`);
  if (slide.width <= 0 || slide.height <= 0)
    fail(`slide ${index + 1} has empty dimensions`);
  if (!/^[0-9a-f]{64}$/.test(slide.sha256 ?? ''))
    fail(`slide ${index + 1} has no SHA-256`);

  const asset = path.join(root, 'public', 'presentation', 'slides', file);
  const size = statSync(asset).size;
  if (size < 10_000) fail(`slide ${index + 1} preview is unexpectedly small`);
  if (size > 25 * 1024 * 1024)
    fail(`slide ${index + 1} exceeds the 25 MiB hosting limit`);
  if (sha256(asset) !== slide.sha256)
    fail(`slide ${index + 1} hash mismatch`);
}

console.log(
  `PUBLICATION_READY presentation=${release.presentation.sha256} slides=${assetManifest.slides.length}`,
);

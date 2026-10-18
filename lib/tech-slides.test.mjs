import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { techArticles } from './tech-articles.ts';
import { techSlides } from './tech-slides.ts';

test('historical 55-slide presentation images map to the three existing technical documents', () => {
  assert.deepEqual(Object.keys(techSlides), techArticles.map((article) => article.slug));
  assert.deepEqual(techSlides['01-tool-selection'].map((slide) => slide.page), [50, 53, 54]);
  assert.deepEqual(techSlides['02-investment-memory'].map((slide) => slide.page), [48]);
  assert.deepEqual(techSlides['03-graph-retrieval'].map((slide) => slide.page), [49]);
  const slides = Object.values(techSlides).flat();
  assert.equal(new Set(slides.map((slide) => slide.src)).size, 5);
  for (const slide of slides) {
    assert.equal(slide.src, `/tech/slides/s${slide.page}.png`);
    assert.ok(slide.title && slide.alt && slide.note, `Missing readable text: ${slide.page}`);
    assert.match(slide.alt, new RegExp(`이전 기술 자료 \\(55장\\) ${slide.page}쪽`));
    assert.doesNotMatch(slide.alt, /최종 발표/);
  }
  assert.equal(slides.find((slide) => slide.page === 53)?.kind, '참고 사례');
  assert.equal(slides.find((slide) => slide.page === 54)?.kind, '향후 계획');
  assert.match(slides.find((slide) => slide.page === 50)?.note ?? '', /선택 점수.*정확도.*수익률.*발표 대응 번들/);
  assert.match(slides.find((slide) => slide.page === 49)?.note ?? '', /기존 엣지.*새 관계/);
});

test('all five source PNGs preserve the full 1920 by 1080 slide canvas', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/tech/slides/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.source.provenance, 'historical-presentation');
  assert.equal(manifest.source.historicalOriginal, 'ATHENA-최종발표.pptx');
  assert.equal(manifest.source.filename, undefined);
  assert.equal(manifest.source.slideCount, 55);
  assert.deepEqual(manifest.slides.map((slide) => slide.page), [48, 49, 50, 53, 54]);
  for (const slide of Object.values(techSlides).flat()) {
    const receipt = manifest.slides.find((entry) => entry.page === slide.page);
    assert.equal(`/tech/slides/${receipt.filename}`, slide.src);
    const png = await readFile(new URL(`../public${slide.src}`, import.meta.url));
    assert.equal(createHash('sha256').update(png).digest('hex'), receipt.sha256, slide.src);
    assert.equal(receipt.width, 1920);
    assert.equal(receipt.height, 1080);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], slide.src);
    assert.equal(png.toString('ascii', 12, 16), 'IHDR', slide.src);
    assert.equal(png.readUInt32BE(16), 1920, slide.src);
    assert.equal(png.readUInt32BE(20), 1080, slide.src);
  }
  assert.deepEqual(
    manifest.slides.filter((slide) => [50, 53, 54].includes(slide.page)).map((slide) => slide.origin),
    ['historical-deck-render', 'historical-deck-render', 'historical-deck-render'],
  );
});

test('slide gallery exposes source zoom links and sits before the legacy article HTML', async () => {
  const component = await readFile(new URL('../components/tech-slide-gallery.tsx', import.meta.url), 'utf8');
  assert.equal((component.match(/href=\{slide\.src\}/g) ?? []).length, 2);
  assert.equal((component.match(/target="_blank"/g) ?? []).length, 2);
  assert.equal((component.match(/rel="noopener noreferrer"/g) ?? []).length, 2);
  assert.match(component, /alt=\{slide\.alt\} width=\{1920\} height=\{1080\}/);
  assert.match(component, /unoptimized/);
  assert.match(component, /<p>\{slide\.note\}<\/p>/);
  assert.match(component, /원본 크게 보기/);
  assert.match(component, /이전 기술 자료 \(55장\)/);
  assert.match(component, /href="\/presentation"/);
  assert.match(component, /현재 39장 공식 발표 보기/);
  assert.doesNotMatch(component, /Final presentation|최종 발표/);
  const page = await readFile(new URL('../app/tech/[slug]/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.indexOf('<TechSlideGallery slug={article.slug} />') < page.indexOf('dangerouslySetInnerHTML'));
});

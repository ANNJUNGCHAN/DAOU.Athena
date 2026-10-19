import test from 'node:test';
import assert from 'node:assert/strict';
import { features } from './content.ts';
import { productPageCopy } from './product-page-copy.ts';
import { techArticles } from './tech-articles.ts';
import { youtubeVideos } from './youtube-videos.ts';
import {
  PRESENTATION_DURATION,
  formatPresentationTime,
  movePresentationSlide,
  presentationSlides,
} from './presentation.ts';

const featureIds = features.map((feature) => feature.slug);
const techIds = techArticles.map((article) => article.slug);

test('the 35 slides total exactly fifteen minutes', () => {
  assert.equal(PRESENTATION_DURATION, 15 * 60);
  assert.equal(presentationSlides.length, 35);
  assert.equal(presentationSlides[0].duration, 45);
  assert.equal(presentationSlides[1].duration, 30);
  assert.deepEqual(
    presentationSlides
      .filter((slide) => slide.kind === 'feature-video')
      .map((slide) => slide.duration),
    [40, 40, 40, 40, 40, 40],
  );
  assert.deepEqual(
    presentationSlides
      .filter((slide) => slide.kind === 'technology')
      .map((slide) => slide.duration),
    [30, 30, 30, 30, 30, 30],
  );
  assert.equal(presentationSlides.at(-1)?.duration, 45);
  assert.equal(
    new Set(presentationSlides.map((slide) => slide.id)).size,
    presentationSlides.length,
  );
});

test('every major capability has one standalone slide in source order', () => {
  const capabilitySlides = presentationSlides.filter(
    (slide) => slide.kind === 'feature-capability',
  );
  const expected = featureIds.flatMap((slug) =>
    productPageCopy[slug].mainFeatures.map((capability, capabilityIndex) => ({
      slug,
      capabilityIndex,
      title: capability.title,
    })),
  );

  assert.equal(capabilitySlides.length, 17);
  assert.deepEqual(
    capabilitySlides.map((slide) => ({
      slug: slide.featureSlug,
      capabilityIndex: slide.capabilityIndex,
      title: slide.label.split(' · ').at(-1),
    })),
    expected,
  );
  assert.equal(
    new Set(capabilitySlides.map((slide) => slide.label)).size,
    capabilitySlides.length,
  );
});

test('each product keeps a sixty second capability budget', () => {
  for (const slug of featureIds) {
    const duration = presentationSlides
      .filter(
        (slide) =>
          slide.featureSlug === slug &&
          (slide.kind === 'feature-capability' ||
            slide.kind === 'feature-companions'),
      )
      .reduce((total, slide) => total + slide.duration, 0);
    assert.equal(duration, 60, slug);
  }
});

test('only products with companion features get one grouped companion slide', () => {
  const companionSlides = presentationSlides.filter(
    (slide) => slide.kind === 'feature-companions',
  );
  const expectedSlugs = featureIds.filter(
    (slug) => productPageCopy[slug].subfeatures?.length,
  );

  assert.equal(companionSlides.length, 3);
  assert.deepEqual(
    companionSlides.map((slide) => slide.featureSlug),
    expectedSlugs,
  );
  assert.equal(
    companionSlides.reduce(
      (total, slide) =>
        total + (productPageCopy[slide.featureSlug]?.subfeatures?.length ?? 0),
      0,
    ),
    6,
  );
  for (const slide of companionSlides) {
    assert.equal(productPageCopy[slide.featureSlug].subfeatures?.length, 2);
  }
});

test('every feature slide resolves to its existing homepage source', () => {
  const videoSlides = presentationSlides.filter(
    (slide) => slide.kind === 'feature-video',
  );
  assert.deepEqual(
    videoSlides.map((slide) => slide.featureSlug),
    featureIds,
  );
  assert.deepEqual(Object.keys(youtubeVideos), featureIds);
  assert.deepEqual(Object.keys(productPageCopy), featureIds);

  for (const slide of presentationSlides) {
    if (!slide.featureSlug) continue;
    const copy = productPageCopy[slide.featureSlug];
    assert.ok(copy, slide.id);
    if (slide.kind === 'feature-capability') {
      assert.ok(copy.mainFeatures[slide.capabilityIndex], slide.id);
    }
  }
});

test('all three homepage technology articles have two dedicated figure slides', () => {
  assert.deepEqual(
    presentationSlides
      .filter((slide) => slide.kind === 'technology')
      .map((slide) => slide.techSlug),
    techIds.flatMap((slug) => [slug, slug]),
  );
  assert.deepEqual(
    presentationSlides
      .filter((slide) => slide.kind === 'technology')
      .map((slide) => slide.techPageIndex),
    [0, 1, 0, 1, 0, 1],
  );
});

test('slide navigation stops at both ends', () => {
  assert.equal(movePresentationSlide(0, 'previous'), 0);
  assert.equal(movePresentationSlide(0, 'next'), 1);
  assert.equal(movePresentationSlide(4, 'first'), 0);
  assert.equal(movePresentationSlide(4, 'last'), presentationSlides.length - 1);
  assert.equal(
    movePresentationSlide(presentationSlides.length - 1, 'next'),
    presentationSlides.length - 1,
  );
});

test('elapsed time uses a stable mm:ss display', () => {
  assert.equal(formatPresentationTime(0), '00:00');
  assert.equal(formatPresentationTime(61.9), '01:01');
  assert.equal(formatPresentationTime(-3), '00:00');
  assert.equal(formatPresentationTime(PRESENTATION_DURATION), '15:00');
});

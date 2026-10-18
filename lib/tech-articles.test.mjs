import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { techArticles } from './tech-articles.ts';
import { features } from './content.ts';

test('document outlines resolve to unique sections and local figures exist', async () => {
  const featurePaths = new Set(features.map((feature) => `/features/${feature.slug}`));
  for (const article of techArticles) {
    const ids = [...article.html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, article.slug);
    assert.equal(article.outline.length, 4, article.slug);
    for (const item of article.outline) {
      assert.equal(ids.filter((id) => id === item.id).length, 1, item.id);
    }
    for (const [, src] of article.html.matchAll(/(?:src|srcset)="(\/tech\/assets\/[^"]+)"/g)) {
      await access(new URL(`../public${src}`, import.meta.url));
    }
    for (const capability of article.relatedCapabilities) {
      assert.ok(featurePaths.has(capability.href), `Unknown capability: ${capability.href}`);
    }
    assert.match(article.html, /blob\/25d971bb8717fc942fe648df1cdd405f99dbab51/);
    assert.match(article.html, /<details>/);
  }
});

test('corrected diagrams preserve evidence boundaries in both motion variants', async () => {
  for (const suffix of ['', '-static']) {
    const svg = async (number) => readFile(new URL(`../public/tech/assets/beginner-${number}${suffix}.svg`, import.meta.url), 'utf8');
    assert.match(await svg('03'), /nonce.*소비/);
    assert.doesNotMatch(await svg('03'), /첫 유효|분류기 A|Decision Cache|First.valid/i);
    assert.match(await svg('05'), /확인된 보유 입력/);
    assert.match(await svg('11'), /선택적 AI 라벨/);
    assert.match(await svg('11'), /기계적 라벨/);
    if (suffix) {
      for (const number of ['03', '05', '11']) assert.doesNotMatch(await svg(number), /@keyframes|animation:/);
    }
  }
});

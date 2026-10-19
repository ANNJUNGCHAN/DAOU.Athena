import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { techArticles } from './tech-articles.ts';
import {
  presentationTechArticles,
  presentationTechPageCountBySlug,
} from './presentation-tech.ts';

function sourceFigures(article) {
  return [...article.html.matchAll(/<figure[^>]*>[\s\S]*?<\/figure>/g)].map(
    ([figure]) => figure.match(/<img src="([^"]+)"/)?.[1],
  );
}

test('all ten source figures appear once in source order across six pages', () => {
  assert.equal(presentationTechArticles.length, 3);

  let total = 0;
  for (const article of presentationTechArticles) {
    const source = techArticles.find((item) => item.slug === article.slug);
    assert.ok(source, article.slug);
    assert.equal(article.pages.length, 2, article.slug);
    assert.equal(
      presentationTechPageCountBySlug[article.slug],
      2,
      article.slug,
    );

    const presented = article.pages.flatMap((page) =>
      page.figures.map((figure) => figure.src),
    );
    assert.deepEqual(presented, sourceFigures(source), article.slug);
    assert.equal(new Set(presented).size, presented.length, article.slug);
    total += presented.length;
  }

  assert.equal(total, 10);
});

test('every presentation figure resolves to an existing public asset', async () => {
  for (const article of presentationTechArticles) {
    for (const page of article.pages) {
      for (const figure of page.figures) {
        await access(new URL(`../public${figure.src}`, import.meta.url));
        if (figure.reducedMotionSrc) {
          await access(
            new URL(`../public${figure.reducedMotionSrc}`, import.meta.url),
          );
        }
      }
    }
  }
});

test('the ToolRerank paper figure keeps source attribution and links', () => {
  const paper = presentationTechArticles[0].pages
    .flatMap((page) => page.figures)
    .find((figure) => figure.paper);

  assert.ok(paper);
  assert.match(paper.caption ?? '', /Zheng et al., 2024, ToolRerank, Figure 2/);
  assert.match(paper.caption ?? '', /CC BY-NC 4\.0/);
  assert.deepEqual(
    paper.links?.map((link) => link.href),
    [
      'https://creativecommons.org/licenses/by-nc/4.0/',
      'https://aclanthology.org/2024.lrec-main.1413/',
    ],
  );
});

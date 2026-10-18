import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { presentationTechArticles } from './presentation-tech.ts';
import { productPageCopy } from './product-page-copy.ts';
import { techArticles } from './tech-articles.ts';

const release = JSON.parse(
  await readFile(new URL('../config/product-release.json', import.meta.url), 'utf8'),
);

test('LAYA copy distinguishes the current v018 forced-choice policy from contract capabilities', async () => {
  const article = techArticles.find(({ slug }) => slug === '01-tool-selection');
  const presentation = presentationTechArticles.find(
    ({ slug }) => slug === '01-tool-selection',
  );
  const manuscript = await readFile(
    new URL('../public/tech/manuscripts/01-tool-selection.md', import.meta.url),
    'utf8',
  );
  const copy = [
    article?.summary.join(' '),
    article?.html,
    JSON.stringify(presentation),
    manuscript,
  ].join('\n');

  assert.equal(release.capabilities.laya.policy, 'force-non-defer');
  assert.equal(release.capabilities.laya.thresholds, 'zero');
  assert.equal(release.capabilities.laya.accuracyQualified, false);
  assert.match(release.capabilities.laya.modelId, /v018/);
  assert.match(copy, /현재 v018 정책/);
  assert.match(copy, /임계값(?:을)? 0/);
  assert.match(copy, /force_non_defer/);
  assert.match(copy, /새 (?:학습이나 )?정확도/);
  assert.doesNotMatch(copy, /임계값을 충족하지 못하면 판단을 보류/);
  assert.doesNotMatch(copy, /reject_all·defer·below_threshold를 구분하며 accepted만 채택/);
});

test('product copy keeps graph ingestion and order execution inside implemented scope', () => {
  const graphCopy = JSON.stringify(productPageCopy.metis);
  const orderCopy = JSON.stringify(productPageCopy.agora);

  assert.deepEqual(release.capabilities.graph.automaticSources, [
    'conversation',
    'trade',
    'holding',
  ]);
  assert.equal(release.capabilities.graph.manualEdits, true);
  assert.equal(release.capabilities.graph.allActivityCapture, false);
  assert.match(graphCopy, /대화/);
  assert.match(graphCopy, /사용자가 확인한 수동 기록/);
  assert.match(graphCopy, /보유·체결/);
  assert.doesNotMatch(graphCopy, /모든 활동|전략 실험/);

  assert.equal(release.capabilities.orders.account, 'mock');
  assert.equal(release.capabilities.orders.confirmation, 'per-ticket');
  assert.equal(release.capabilities.orders.realAccount, false);
  assert.equal(release.capabilities.orders.automatedTrading, false);
  assert.match(orderCopy, /모의투자 주문 티켓/);
  assert.match(orderCopy, /주문마다/);
  assert.match(orderCopy, /실계좌 주문과 자동매매는 지원하지 않습니다/);
});

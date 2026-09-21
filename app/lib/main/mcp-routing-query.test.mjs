import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { stripKnownMcpMentions } = require('./mcp-routing-query');
const { StockEntityIndex } = require('./rest-dataset-runner');
const aliases = ['naver-news-search', 'dart-disclosure'];
const index = new StockEntityIndex();
index.replace([
  { code: '035420', name: 'NAVER', market: '0', aliases: ['네이버'] },
  { code: '005930', name: '삼성전자', market: '0' },
]);
const question = '@naver-news-search 최근 다우키움그룹 계열사에서 어떤 일이 있었는지 주요 뉴스를 통해 찾아줘.';
const annotation = '\n\n(사용자가 지정한 플러그인: @naver-news-search — 이 MCP 서버의 도구를 우선 사용해 답하라.)';

test('known news MCP alias no longer resolves as NAVER stock', () => {
  assert.equal(index.resolveQuery(question).code, '035420');
  const routing = stripKnownMcpMentions(question + annotation, aliases);
  assert.equal(routing, question.slice('@naver-news-search '.length));
  assert.equal(index.resolveQuery(routing), null);
});

test('actual issuers remain routable with known MCP mentions', () => {
  for (const [name, code] of [['NAVER', '035420'], ['삼성전자', '005930']]) {
    const routing = stripKnownMcpMentions(`@naver-news-search ${name} 최근 뉴스` + annotation, aliases);
    assert.equal(index.resolveQuery(routing).code, code);
    assert.equal(routing, `${name} 최근 뉴스`);
  }
  assert.equal(stripKnownMcpMentions('삼성전자 현재가', aliases), '삼성전자 현재가');
});

test('unknown aliases, emails and metadata text outside the generated suffix stay intact', () => {
  for (const text of ['@naver-news-search-extra 뉴스', 'team@naver-news-search.com', '@unknown NAVER 뉴스']) {
    assert.equal(stripKnownMcpMentions(text, aliases), text);
  }
  assert.equal(stripKnownMcpMentions(question, []), question);
  assert.equal(stripKnownMcpMentions('@dart-disclosure @naver-news-search 삼성전자 공시', aliases), '삼성전자 공시');
});

test('main routes a copy through stock lookup and preserves the model prompt', async () => {
  const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const start = main.indexOf('  let routingQuery = query;');
  const end = main.indexOf('  const queryStockEntityIndex =', start);
  assert.ok(start >= 0 && end > start);
  const routed = [];
  const ctx = vm.createContext({
    query: question + annotation, stripKnownMcpMentions,
    mcpCli: { list: () => ({ servers: aliases.map((alias) => ({ alias })) }) },
    cardRetrievalBlocked: false, runtime: {}, BACKEND_HTTP_BASE: 'http://unused',
    fetch() {}, stockMasterAbortController: { signal: undefined }, mdlog() {},
    stockMasterClient: { async resolveCurrentStockMasterQuery(text) { routed.push(text); return { ready: true }; } },
  });
  await vm.runInContext(`(async () => { ${main.slice(start, end)} })()`, ctx);
  assert.deepEqual(routed, [question.slice('@naver-news-search '.length)]);
  assert.equal(ctx.query, question + annotation);
});

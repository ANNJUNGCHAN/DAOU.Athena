import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SOURCE_CARD_NOTICE,
  normalizeSourceCard,
  renderSourceCard,
} from "../src/sidepanel/source-cards.mjs";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.type = "";
    this.listeners = new Map();
    this.attributes = new Map();
    this._text = "";
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this._text = "";
    this.children = [...children];
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  click() {
    this.listeners.get("click")?.();
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function findAll(node, tagName) {
  const expected = tagName.toUpperCase();
  const matches = node.tagName === expected ? [node] : [];
  for (const child of node.children) matches.push(...findAll(child, tagName));
  return matches;
}

const shared = {
  schemaVersion: 1,
  canvasId: "1f62b076-9ffc-44f9-a3c2-2fe4dfcf6dc6",
  title: "조회 기능 찾기",
  catalogVersion: `sha256:${"a".repeat(64)}`,
  fetchedAt: "2026-10-19T10:20:30.000Z",
  notice: SOURCE_CARD_NOTICE,
};

function listCard(items = []) {
  return {
    ...shared,
    kind: "capability-list",
    query: "삼성전자 재무 조회",
    items,
  };
}

function listItem(index) {
  return {
    operationRef: `base:finance${index}`,
    kind: "query",
    domain: "finance",
    name: `재무 조회 ${index}`,
    groupTitle: index % 2 ? "재무" : null,
  };
}

function detailCard() {
  return {
    ...shared,
    kind: "capability-detail",
    title: "재무 조회 기능",
    operationRef: "detail:finance:query_1",
    domain: "finance",
    name: "재무 조회",
    executionPolicy: "selector_detail_required",
    requiredArguments: [{
      alias: "종목코드", description: "6자리 종목 코드", required: true,
      jsonSchema: { type: "string" },
    }],
    optionalArguments: [{
      alias: "기준연도", description: null, required: false,
      jsonSchema: { anyOf: [{ type: "string" }, { type: "null" }], default: null },
    }],
    responseFields: [{ alias: "매출액", description: "공시 기준 매출액", required: true }],
    execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
  };
}

function fixture() {
  return { document: new FakeDocument(), container: new FakeElement("div") };
}

test("capability list renders exact metadata and describe callback payload", () => {
  const { document, container } = fixture();
  const calls = [];
  const result = renderSourceCard({
    document,
    container,
    state: { status: "ready", card: listCard([listItem(1), listItem(2)]) },
    onDescribe(payload) { calls.push(payload); },
  });

  assert.deepEqual(result, { status: "ready", kind: "capability-list", itemCount: 2 });
  assert.match(container.textContent, /삼성전자 재무 조회/);
  assert.match(container.textContent, /재무 조회 1/);
  assert.match(container.textContent, new RegExp(SOURCE_CARD_NOTICE.replace(".", "\\.")));
  const buttons = findAll(container, "button");
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].getAttribute("aria-label"), "재무 조회 1 (finance) 기능 상세 보기");
  assert.equal(buttons[1].getAttribute("aria-label"), "재무 조회 2 (finance) 기능 상세 보기");
  buttons[0].click();
  assert.deepEqual(calls, [{
    operationRef: "base:finance1",
    expectedCatalogVersion: shared.catalogVersion,
  }]);
});

test("detail renders bounded fields and exposes no execution button", () => {
  const { document, container } = fixture();
  const result = renderSourceCard({ document, container, state: { status: "ready", card: detailCard() } });
  assert.deepEqual(result, { status: "ready", kind: "capability-detail", itemCount: 1 });
  assert.match(container.textContent, /종목코드 \(필수\) — 6자리 종목 코드/);
  assert.match(container.textContent, /기준연도 \(선택\)/);
  assert.match(container.textContent, /매출액 \(필수\) — 공시 기준 매출액/);
  assert.match(container.textContent, /FINANCIAL_QUERY_NOT_CONNECTED/);
  assert.equal(findAll(container, "button").length, 0);
});

test("detail retains and freezes only the two canonical argument schemas", () => {
  const normalized = normalizeSourceCard(detailCard());
  assert.deepEqual(normalized.requiredArguments[0].jsonSchema, { type: "string" });
  assert.deepEqual(normalized.optionalArguments[0].jsonSchema, {
    anyOf: [{ type: "string" }, { type: "null" }], default: null,
  });
  assert.equal(Object.isFrozen(normalized.requiredArguments[0].jsonSchema), true);
  assert.equal(Object.isFrozen(normalized.optionalArguments[0].jsonSchema), true);
  assert.equal(Object.isFrozen(normalized.optionalArguments[0].jsonSchema.anyOf), true);
  for (const schema of [
    { type: "integer" },
    { type: "string", title: "extra" },
    { anyOf: [{ type: "null" }, { type: "string" }], default: null },
    { anyOf: [{ type: "string" }, { type: "null" }] },
  ]) {
    const invalid = detailCard();
    invalid.optionalArguments[0].jsonSchema = schema;
    assert.throws(() => normalizeSourceCard(invalid), /jsonSchema/);
  }
  const snakeCase = detailCard();
  delete snakeCase.requiredArguments[0].jsonSchema;
  snakeCase.requiredArguments[0].json_schema = { type: "string" };
  assert.throws(() => normalizeSourceCard(snakeCase), /unsupported properties/);
});

test("list omits the detail control when no describe callback is wired", () => {
  const { document, container } = fixture();
  const result = renderSourceCard({
    document,
    container,
    state: { status: "ready", card: listCard([listItem(1)]) },
  });
  assert.deepEqual(result, { status: "ready", kind: "capability-list", itemCount: 1 });
  assert.equal(findAll(container, "button").length, 0);
});

test("empty, no-metadata, and error states are explicit without leaking error text", () => {
  const { document, container } = fixture();
  const empty = renderSourceCard({ document, container, state: { status: "ready", card: listCard([]) } });
  assert.equal(empty.status, "empty");
  assert.match(container.textContent, /조건에 맞는 조회 기능 메타데이터가 없습니다/);
  let status = findAll(container, "p").find((node) => node.className === "source-card-state");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");

  renderSourceCard({ document, container, state: { status: "ready", card: null } });
  assert.match(container.textContent, /표시할 기능 메타데이터가 없습니다/);

  renderSourceCard({ document, container, state: { status: "error", error: { message: "Bearer secret-value" } } });
  assert.match(container.textContent, /기능 메타데이터를 불러오지 못했습니다/);
  assert.doesNotMatch(container.textContent, /secret-value|Bearer/);
});

test("loading and empty states expose bounded live and busy semantics", () => {
  const { document, container } = fixture();
  renderSourceCard({ document, container, state: { status: "loading" } });
  let article = findAll(container, "article")[0];
  let status = findAll(container, "p").find((node) => node.className === "source-card-state");
  assert.equal(article.getAttribute("aria-busy"), "true");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");

  renderSourceCard({ document, container, state: { status: "ready", card: null } });
  article = findAll(container, "article")[0];
  status = findAll(container, "p").find((node) => node.className === "source-card-state");
  assert.equal(article.getAttribute("aria-busy"), "false");
  assert.equal(status.getAttribute("role"), "status");
});

test("strict canonical shape rejects legacy, ranking, and oversized metadata", () => {
  const uuidV8Card = listCard();
  uuidV8Card.canvasId = "1f62b076-9ffc-84f9-a3c2-2fe4dfcf6dc6";
  assert.equal(normalizeSourceCard(uuidV8Card).canvasId, uuidV8Card.canvasId);
  assert.throws(
    () => normalizeSourceCard({ canvasKind: "capability-list.v1", provenance: {}, data: {} }),
    /schemaVersion/,
  );
  assert.throws(
    () => normalizeSourceCard(listCard([{ ...listItem(1), confidence: 0.99 }])),
    /unsupported properties/,
  );
  assert.throws(
    () => normalizeSourceCard(listCard(Array.from({ length: 6 }, (_, index) => listItem(index)))),
    /items is out of bounds/,
  );
  const invalidDetail = detailCard();
  invalidDetail.requiredArguments = ["종목코드"];
  assert.throws(() => normalizeSourceCard(invalidDetail), /requiredArguments\[0\] is invalid/);
  const longDetail = detailCard();
  longDetail.responseFields = Array.from({ length: 129 }, (_, index) => ({
    alias: `필드${index}`,
    description: null,
    required: false,
  }));
  assert.throws(() => normalizeSourceCard(longDetail), /responseFields is out of bounds/);
});

test("canonical text preserves raw metadata, trims only query, and validates UTC calendar dates", () => {
  const spacedItem = {
    ...listItem(1),
    operationRef: "detail:finance:query_1",
    domain: " finance ",
    name: " 재무 조회 1 ",
    groupTitle: " 재무 ",
  };
  const queryCard = listCard([spacedItem]);
  queryCard.query = "  삼성전자 현재가  ";
  queryCard.title = ` ${shared.title} `;
  queryCard.fetchedAt = "2024-02-29T23:59:59.123456789Z";
  const normalized = normalizeSourceCard(queryCard);
  assert.equal(normalized.query, "삼성전자 현재가");
  assert.equal(normalized.fetchedAt, queryCard.fetchedAt);
  assert.equal(normalized.title, queryCard.title);
  assert.equal(normalized.catalogVersion, queryCard.catalogVersion);
  assert.deepEqual(normalized.items[0], spacedItem);

  const detail = detailCard();
  detail.requiredArguments[0].description = "종목코드 입력\r\n- 국내주식: 6자리\n\t예: 005930";
  assert.equal(
    normalizeSourceCard(detail).requiredArguments[0].description,
    "종목코드 입력\r\n- 국내주식: 6자리\n\t예: 005930",
  );

  const { document, container } = fixture();
  const calls = [];
  renderSourceCard({
    document,
    container,
    state: { status: "ready", card: queryCard },
    onDescribe(payload) { calls.push(payload); },
  });
  findAll(container, "button")[0].click();
  assert.deepEqual(calls, [{
    operationRef: spacedItem.operationRef,
    expectedCatalogVersion: queryCard.catalogVersion,
  }]);

  const invalidDate = listCard();
  invalidDate.fetchedAt = "2026-02-29T10:20:30Z";
  assert.throws(() => normalizeSourceCard(invalidDate), /fetchedAt is invalid/);
});

test("catalog identity is the exact lowercase sha256 wire identity", () => {
  assert.equal(normalizeSourceCard(listCard()).catalogVersion, shared.catalogVersion);
  for (const invalidCatalog of [
    ` ${shared.catalogVersion}`,
    `sha256:${"A".repeat(64)}`,
    `sha256:${"a".repeat(63)}`,
    "selector-catalog-2026-10-19",
  ]) {
    const card = listCard();
    card.catalogVersion = invalidCatalog;
    assert.throws(() => normalizeSourceCard(card), /catalogVersion is (?:invalid|out of bounds)/);
  }
});

test("operation references use the exact bounded source grammar", () => {
  for (const invalidRef of [
    "https://example.com/query",
    "finance.query.1",
    `base:${"a".repeat(124)}`,
  ]) {
    const list = listCard([{ ...listItem(1), operationRef: invalidRef }]);
    assert.throws(() => normalizeSourceCard(list), /operationRef is (?:invalid|out of bounds)/);
    const detail = detailCard();
    detail.operationRef = invalidRef;
    assert.throws(() => normalizeSourceCard(detail), /operationRef is (?:invalid|out of bounds)/);
  }
  const exact = "detail:stockinfo:ka10001";
  const card = listCard([{ ...listItem(1), operationRef: exact }]);
  assert.equal(normalizeSourceCard(card).items[0].operationRef, exact);
});

test("sparse list and field arrays are rejected at the missing index", () => {
  const sparseItems = listCard(new Array(1));
  assert.throws(() => normalizeSourceCard(sparseItems), /items\[0\] is missing/);

  const sparseFields = detailCard();
  sparseFields.responseFields = new Array(1);
  assert.throws(() => normalizeSourceCard(sparseFields), /responseFields\[0\] is missing/);
});

test("DOM programmer errors propagate after card validation", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  let calls = 0;
  document.createElement = (tagName) => {
    calls += 1;
    if (calls === 2) throw new TypeError("DOM implementation failed");
    return new FakeElement(tagName);
  };
  assert.throws(
    () => renderSourceCard({ document, container, state: { status: "ready", card: listCard() } }),
    /DOM implementation failed/,
  );
});

test("invalid cards render a bounded format error without input metadata", () => {
  const { document, container } = fixture();
  const card = listCard([{ ...listItem(1), name: "<img src=x onerror=secret()>" }]);
  card.extra = "do-not-render";
  const result = renderSourceCard({ document, container, state: { status: "ready", card } });
  assert.equal(result.status, "error");
  assert.match(container.textContent, /형식이 올바르지 않습니다/);
  assert.doesNotMatch(container.textContent, /do-not-render|onerror|secret/);
});

test("renderer source has no network, Chrome, remote asset, or HTML injection API", async () => {
  const source = await readFile(new URL("../src/sidepanel/source-cards.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|\bchrome\.|innerHTML|outerHTML|insertAdjacentHTML|https?:\/\//);
});

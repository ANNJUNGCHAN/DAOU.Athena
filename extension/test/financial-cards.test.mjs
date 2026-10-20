import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderFinancialCard } from "../src/sidepanel/financial-cards.mjs";

const require = createRequire(import.meta.url);
const actualFactsCard = require("../../app/lib/facts-card.js");
const previousWindow = globalThis.window;

test.before(() => {
  globalThis.window = { AthenaLib: { FactsCard: actualFactsCard } };
});

test.after(() => {
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

class FakeClassList {
  constructor(owner) { this.owner = owner; }
  add(...names) {
    const values = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const name of names) values.add(name);
    this.owner.className = [...values].join(" ");
  }
  contains(name) { return this.owner.className.split(/\s+/).includes(name); }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = "";
    this.classList = new FakeClassList(this);
    this.listeners = new Map();
    this.replaceCount = 0;
    this._text = "";
  }
  set textContent(value) { this._text = String(value ?? ""); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.replaceCount += 1; this._text = ""; this.children = [...children]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({ preventDefault() {} }); }
}

class FakeDocument {
  constructor() { this.createCount = 0; }
  createElement(tagName) { this.createCount += 1; return new FakeElement(tagName); }
}

function findAll(node, tagName) {
  const matches = node.tagName === tagName.toUpperCase() ? [node] : [];
  for (const child of node.children) matches.push(...findAll(child, tagName));
  return matches;
}

function findByClass(node, className) {
  const matches = node.classList?.contains(className) ? [node] : [];
  for (const child of node.children) matches.push(...findByClass(child, className));
  return matches;
}

function base(renderKind, data, rendererId) {
  return {
    cardVersion: "wts-financial-card-1",
    jobId: "00000000-0000-4000-8000-000000000001",
    submissionId: "00000000-0000-4000-8000-000000000002",
    operationRef: "base:test",
    renderKind,
    rendererId,
    title: "테스트 카드",
    provenance: {
      provider: "kiwoom-rest", environment: "real",
      profileId: "00000000-0000-4000-8000-000000000003", trId: "ka10001",
      endpoint: "/api/dostk/stkinfo", catalogVersion: `sha256:${"a".repeat(64)}`,
      fetchedAt: "2026-10-19T00:00:00.000Z", sourceAsOf: null, sourceStatusCode: "0",
      argumentsSha256: `sha256:${"b".repeat(64)}`,
    },
    page: {
      pageIndex: 0, pageCount: 2, itemStart: 0, itemEndExclusive: 1, itemCount: 1, totalItems: 2,
      initial: true, previousPageToken: null, nextPageToken: "x".repeat(43), expiresAt: "2026-10-19T00:05:00.000Z",
    },
    continuation: { available: true, continuationToken: "y".repeat(43), expiresAt: "2026-10-19T00:05:00.000Z" },
    data,
  };
}

function factsCard(fields) {
  return base("facts", { kind: "facts", fields }, "facts-card-v1");
}

function chartCard() {
  return base("chart", {
    kind: "chart", symbol: "005930",
    chart: { period: "day", target: "stock", trId: "ka10081", candles: [{ time: "2026-10-19", open: 1, high: 2, low: 1, close: 2, volume: 3 }] },
  }, "aits-chart-v1");
}

function renderError(action) {
  assert.throws(action, (error) => {
    assert.equal(error.code, "FINANCIAL_RENDERER_UNAVAILABLE");
    assert.equal(error.message, "금융 카드 렌더러를 사용할 수 없습니다.");
    return true;
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("facts cards use the actual FactsCard facade for every canonical cell kind", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  renderFinancialCard({ document, container, card: factsCard([
    { key: "cur_prc", label: "현재가", value: "001234" },
    { key: "pred_pre", label: "전일대비", value: "+50" },
    { key: "pred_pre_sig", label: "기호", value: 5 },
    { key: "trde_qty", label: "거래량", value: 1000 },
    { key: "dt", label: "일자", value: "20261019" },
    { key: "stk_cd", label: "종목코드", value: "005930" },
    { key: "memo", label: "일반", value: true },
    { key: "empty", label: "없음", value: null },
  ]) });

  assert.deepEqual(findAll(container, "dd").slice(4).map((node) => node.textContent),
    ["1,234", "+50", "5", "1,000", "2026-10-19", "005930", "true", "—"]);
  assert.equal(findByClass(container, "tone-up").length, 1);
  assert.equal(findByClass(container, "tone-down").length, 1);
  assert.match(container.textContent, /실전 조회/);
  assert.match(container.textContent, /자료 기준제공되지 않음/);
});

test("11 facts split into two source-ordered groups through actual groupFactsFields", () => {
  const fields = Array.from({ length: 11 }, (_, index) => ({ key: `field_${index}`, label: `항목 ${index}`, value: index }));
  const document = new FakeDocument();
  const container = new FakeElement("div");
  renderFinancialCard({ document, container, card: factsCard(fields) });

  const groups = findByClass(container, "financial-fact-group");
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map((group) => findAll(group, "dt").map((node) => node.textContent)),
    [fields.slice(0, 6).map((field) => field.label), fields.slice(6).map((field) => field.label)]);
});

test("generic table preserves source columns and raw scalar strings", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const card = base("table", {
    kind: "table",
    columns: [
      { key: "dt", label: "일자" },
      { key: "cur_prc", label: "현재가" },
      { key: "stk_cd", label: "종목" },
      { key: "missing", label: "없음" },
    ],
    rows: [{ dt: "20261019", cur_prc: "001234", stk_cd: "005930", missing: null }],
  }, "table-card-v1");
  renderFinancialCard({ document, container, card });

  assert.deepEqual(findAll(container, "th").map((node) => node.textContent), ["일자", "현재가", "종목", "없음"]);
  assert.deepEqual(findAll(container, "td").map((node) => node.textContent), ["20261019", "001234", "005930", "—"]);
});

test("compound header stays one ordered band above ten fields and keeps facts formatting parity", () => {
  const header = [
    { key: "cur_prc", label: "현재가", value: "001234" },
    { key: "pred_pre", label: "전일대비", value: "+50" },
    { key: "pred_pre_sig", label: "기호", value: 5 },
    { key: "trde_qty", label: "거래량", value: 1000 },
    { key: "dt", label: "일자", value: "20261019" },
    { key: "stk_cd", label: "종목코드", value: "005930" },
    { key: "empty", label: "없음", value: null },
    ...Array.from({ length: 4 }, (_, index) => ({ key: `field_${index}`, label: `헤더 ${index}`, value: index })),
  ];
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const card = base("compound", {
    kind: "compound", header,
    columns: [{ key: "cur_prc", label: "현재가" }, { key: "empty", label: "없음" }],
    rows: [{ cur_prc: "001234", empty: undefined }],
  }, "compound-card-v1");
  renderFinancialCard({ document, container, card });

  const band = findByClass(container, "financial-compound-header")[0];
  assert.equal(findByClass(band, "financial-fact-group").length, 1);
  assert.deepEqual(findAll(band, "dt").map((node) => node.textContent), header.map((field) => field.label));
  assert.deepEqual(findAll(band, "dd").map((node) => node.textContent).slice(0, 7),
    ["1,234", "+50", "5", "1,000", "2026-10-19", "005930", "—"]);
  assert.equal(findByClass(band, "tone-up").length, 1);
  assert.equal(findByClass(band, "tone-down").length, 1);
  assert.deepEqual(findAll(container, "td").map((node) => node.textContent), ["001234", "—"]);
});

test("paging and broker continuation happen only after their explicit buttons", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const pages = [];
  const continuations = [];
  const card = factsCard([{ key: "memo", label: "값", value: true }]);
  renderFinancialCard({
    document, container, card,
    onPage: (value) => pages.push(value),
    onContinue: (value) => continuations.push(value),
  });
  assert.equal(pages.length, 0);
  assert.equal(continuations.length, 0);
  const buttons = findAll(container, "button");
  buttons.find((button) => button.textContent === "다음 페이지").click();
  buttons.find((button) => button.textContent === "브로커 다음 조회").click();
  assert.deepEqual(pages, [{ jobId: card.jobId, pageToken: card.page.nextPageToken, direction: "next" }]);
  assert.deepEqual(continuations, [{ parentJobId: card.jobId, continuationToken: card.continuation.continuationToken }]);
});

test("chart card mounts the injected canonical chart facade after destroying the prior chart", async () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const calls = [];
  const chartRenderer = {
    destroy() { calls.push("destroy"); },
    async mount(host, card) { calls.push({ host, card }); },
  };
  const card = chartCard();
  renderFinancialCard({ document, container, card, chartRenderer });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0], "destroy");
  assert.equal(calls[1].card, card);
  assert.equal(calls[1].host.className, "financial-chart-host");
});

test("rejected chart mount shows no false success without destroying a later global session", async () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const calls = [];
  const chartRenderer = {
    destroy() { calls.push("destroy"); },
    async mount(host) {
      calls.push("mount");
      host.append(new FakeElement("canvas"));
      throw new Error("partial chart setup failed");
    },
  };

  renderFinancialCard({ document, container, card: chartCard(), chartRenderer });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(calls, ["destroy", "mount"]);
  assert.equal(findAll(container, "canvas").length, 0);
  const errors = findByClass(container, "financial-card-error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].textContent, "차트를 표시하지 못했습니다.");
});

test("late rejection from an old chart mount cannot destroy the newer chart", async () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const firstMount = deferred();
  const destroyed = [];
  let active = null;
  let mountCount = 0;
  const chartRenderer = {
    destroy() {
      if (active) destroyed.push(active);
      active = null;
    },
    mount(host) {
      mountCount += 1;
      active = mountCount === 1 ? "first" : "second";
      host.append(new FakeElement("canvas"));
      return mountCount === 1 ? firstMount.promise : Promise.resolve();
    },
  };

  renderFinancialCard({ document, container, card: chartCard(), chartRenderer });
  renderFinancialCard({ document, container, card: chartCard(), chartRenderer });
  const newerRoot = container.children[0];
  firstMount.reject(new Error("old mount failed late"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(destroyed, ["first"]);
  assert.equal(active, "second");
  assert.equal(container.children[0], newerRoot);
  assert.equal(findAll(newerRoot, "canvas").length, 1);
  assert.equal(findByClass(newerRoot, "financial-card-error").length, 0);
});

test("every missing FactsCard method fails before DOM, chart, paging, or completed-job mutation", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div");
  const chartRenderer = { destroyCalls: 0, destroy() { this.destroyCalls += 1; }, mount() {} };
  const current = renderFinancialCard({
    document, container, chartRenderer,
    card: factsCard([{ key: "memo", label: "이전 카드", value: "유지" }]),
  });
  const previousRoot = current.root;
  const previousPaging = findByClass(previousRoot, "financial-card-paging")[0];
  const previousUpdatePaging = current.updatePaging;
  const createCount = document.createCount;
  const replaceCount = container.replaceCount;
  const destroyCalls = chartRenderer.destroyCalls;
  const backendJob = { state: "completed", card: factsCard([{ key: "memo", label: "완료", value: "그대로" }]) };
  const backendSnapshot = structuredClone(backendJob);

  for (const method of ["classifyCell", "changeTone", "formatNumeric", "formatDatetime", "groupFactsFields"]) {
    globalThis.window.AthenaLib.FactsCard = { ...actualFactsCard, [method]: undefined };
    renderError(() => renderFinancialCard({ document, container, chartRenderer, card: backendJob.card }));
    assert.equal(container.children[0], previousRoot, method);
    assert.equal(findByClass(previousRoot, "financial-card-paging")[0], previousPaging, method);
    assert.equal(current.updatePaging, previousUpdatePaging, method);
    assert.equal(document.createCount, createCount, method);
    assert.equal(container.replaceCount, replaceCount, method);
    assert.equal(chartRenderer.destroyCalls, destroyCalls, method);
    assert.deepEqual(backendJob, backendSnapshot, method);
  }
  globalThis.window.AthenaLib.FactsCard = actualFactsCard;
});

test("each tuple mismatch fails before DOM, chart, paging, or completed-job mutation", () => {
  const cases = [
    { ...factsCard([]), renderKind: "unknown" },
    { ...factsCard([]), rendererId: "table-card-v1" },
    { ...factsCard([]), data: { kind: "table", fields: [] } },
    { ...base("table", { kind: "table", columns: [], rows: [] }, "table-card-v1"), rendererId: "facts-card-v1" },
    { ...base("table", { kind: "table", columns: [], rows: [] }, "table-card-v1"), data: { kind: "facts", columns: [], rows: [] } },
    { ...base("compound", { kind: "compound", header: [], columns: [], rows: [] }, "compound-card-v1"), rendererId: "table-card-v1" },
    { ...base("compound", { kind: "compound", header: [], columns: [], rows: [] }, "compound-card-v1"), data: { kind: "facts", header: [], columns: [], rows: [] } },
    { ...chartCard(), rendererId: "facts-card-v1" },
    { ...chartCard(), data: { ...chartCard().data, kind: "table" } },
  ];
  const document = new FakeDocument();
  const previousRoot = new FakeElement("article");
  const previousPaging = new FakeElement("div");
  previousRoot.append(previousPaging);
  const container = new FakeElement("div");
  container.append(previousRoot);
  const chartRenderer = { destroyCalls: 0, destroy() { this.destroyCalls += 1; }, mount() {} };
  const createCount = document.createCount;
  const replaceCount = container.replaceCount;
  const backendJob = { state: "completed", card: cases[0] };

  for (const card of cases) {
    backendJob.card = card;
    const snapshot = structuredClone(backendJob);
    renderError(() => renderFinancialCard({ document, container, chartRenderer, card }));
    assert.equal(container.children[0], previousRoot);
    assert.equal(previousRoot.children[0], previousPaging);
    assert.equal(document.createCount, createCount);
    assert.equal(container.replaceCount, replaceCount);
    assert.equal(chartRenderer.destroyCalls, 0);
    assert.deepEqual(backendJob, snapshot);
  }
});

test("each missing chart method fails before DOM construction or prior-chart destruction", () => {
  for (const missing of ["mount", "destroy"]) {
    const document = new FakeDocument();
    const previousRoot = new FakeElement("article");
    const container = new FakeElement("div");
    container.append(previousRoot);
    const calls = [];
    const chartRenderer = {
      mount() { calls.push("mount"); },
      destroy() { calls.push("destroy"); },
      [missing]: undefined,
    };
    const job = { state: "completed", card: chartCard() };
    const snapshot = structuredClone(job);
    renderError(() => renderFinancialCard({ document, container, chartRenderer, card: job.card }));
    assert.equal(container.children[0], previousRoot, missing);
    assert.equal(container.replaceCount, 0, missing);
    assert.equal(document.createCount, 0, missing);
    assert.deepEqual(calls, [], missing);
    assert.deepEqual(job, snapshot, missing);
  }
});

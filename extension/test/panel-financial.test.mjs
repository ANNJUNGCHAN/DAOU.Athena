import test from "node:test";
import assert from "node:assert/strict";
import { createFinancialPanelController } from "../src/sidepanel/panel-financial.mjs";

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.value = "";
    this.disabled = false;
    this.hidden = false;
    this.className = "";
    this._text = "";
  }
  set textContent(value) { this._text = String(value ?? ""); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = [...children]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
}

class FakeDocument {
  constructor(ids) { this.nodes = new Map(ids.map((id) => [`#${id}`, new FakeElement()])); }
  querySelector(selector) { return this.nodes.get(selector) || null; }
  createElement(tagName) { return new FakeElement(tagName); }
}

function find(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
  return null;
}

const ids = [
  "financial-section", "financial-readiness", "financial-refresh", "financial-profile",
  "financial-credentials", "financial-credentials-form", "financial-profile-id", "financial-profile-label",
  "financial-environment", "financial-app-key", "financial-secret-key", "financial-credential-save",
  "financial-credential-delete", "financial-query-form", "financial-query-status", "financial-query-stop",
  "financial-card",
];

const profileId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";

function tableCard() {
  return {
    jobId, renderKind: "table", rendererId: "table-card-v1", title: "표",
    provenance: { environment: "mock", trId: "ka10001", fetchedAt: "2026-10-19T00:00:00.000Z", sourceAsOf: null },
    page: { pageIndex: 0, pageCount: 2, previousPageToken: null, nextPageToken: "next" },
    continuation: { available: true, continuationToken: "continue" },
    data: { kind: "table", columns: [{ key: "value", label: "값" }], rows: [{ value: "1" }] },
  };
}

test("financial panel warms status, clears secrets, and starts a query only after the explicit submit", async () => {
  const document = new FakeDocument(ids);
  const calls = [];
  const scheduled = [];
  let id = 10;
  const send = async (type, payload) => {
    calls.push({ type, payload });
    if (type === "panel.financial.credentials.status") return {
      profiles: [{ profileId, label: "모의", environment: "mock", revision: 1, state: "ready" }], mutation: null,
    };
    if (type === "panel.financial.credentials.configure") return {
      mutation: { mutationId: payload.params.mutationId, state: "queued" },
    };
    if (type === "panel.financial.query.start") return {
      job: { jobId, state: "queued", card: null },
    };
    throw new Error(`unexpected ${type}`);
  };
  const controller = createFinancialPanelController({
    document,
    send,
    createId: () => `00000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancelSchedule: () => {},
    chartRenderer: { destroy() {} },
  });
  controller.showOperation({
    kind: "capability-detail", operationRef: "base:stockinfo", domain: "quotes", name: "주식 기본 정보",
    requiredArguments: [
      { alias: "stk_cd", description: "종목 코드", required: true, jsonSchema: { type: "string" } },
      { alias: "trade_pwd", description: "거래 비밀번호", required: true, jsonSchema: { type: "string" } },
    ],
    optionalArguments: [],
  });
  const queryHost = document.querySelector("#financial-query-form");
  const queryForm = find(queryHost, (node) => node.tagName === "FORM");
  const querySubmit = find(queryHost, (node) => node.tagName === "BUTTON");
  assert.equal(querySubmit.disabled, true);
  await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.type === "panel.financial.credentials.status").length, 1);

  const profile = document.querySelector("#financial-profile");
  profile.value = profileId;
  profile.dispatch("change");
  assert.equal(querySubmit.disabled, false);
  const argument = find(queryHost, (node) => node.id === "financial-arg-stk_cd");
  argument.value = "005930";
  argument.dispatch("input");
  const password = find(queryHost, (node) => node.id === "financial-arg-trade_pwd");
  assert.equal(argument.type, "text");
  assert.equal(password.type, "password");
  password.value = "query-secret-canary";
  password.dispatch("input");
  assert.doesNotMatch(queryHost.textContent, /query-secret-canary/);
  assert.match(queryHost.textContent, /••••/);
  assert.equal(calls.some((call) => call.type === "panel.financial.query.start"), false);
  queryForm.dispatch("submit");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.type === "panel.financial.query.start").length, 1);
  assert.deepEqual(calls.find((call) => call.type === "panel.financial.query.start").payload.params.arguments, {
    stk_cd: "005930", trade_pwd: "query-secret-canary",
  });

  document.querySelector("#financial-profile-label").value = "새 프로필";
  document.querySelector("#financial-environment").value = "mock";
  document.querySelector("#financial-app-key").value = "app-key-canary";
  document.querySelector("#financial-secret-key").value = "secret-key-canary";
  await document.querySelector("#financial-credentials-form").dispatch("submit");
  assert.equal(document.querySelector("#financial-app-key").value, "");
  assert.equal(document.querySelector("#financial-secret-key").value, "");
  assert.equal(calls.filter((call) => call.type === "panel.financial.credentials.configure").length, 1);
  assert.equal(scheduled.length, 2);

  await controller.applyConnection({ connected: false, financial: { configured: false, unknown: { jobId } } });
  await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: { unknown: { jobId } } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.type === "panel.financial.credentials.status").length, 2);
  assert.equal(calls.filter((call) => call.type === "panel.financial.query.start").length, 1);
  assert.match(document.querySelector("#financial-query-status").textContent, /자동으로 다시 실행하지 않/);
});

test("stop invalidates polling before one cancel request and ignores duplicate clicks", async () => {
  const document = new FakeDocument(ids);
  const scheduled = [];
  const cancelled = [];
  const calls = [];
  let resolveCancel;
  const cancelResponse = new Promise((resolve) => { resolveCancel = resolve; });
  const send = async (type, payload) => {
    calls.push({ type, payload });
    if (type === "panel.financial.credentials.status") return {
      profiles: [{ profileId, label: "모의", environment: "mock", revision: 1, state: "ready" }], mutation: null,
    };
    if (type === "panel.financial.query.start") return { job: { jobId, state: "queued", card: null } };
    if (type === "panel.financial.query.cancel") return cancelResponse;
    if (type === "panel.financial.query.status") throw new Error("stale poll should not run");
    throw new Error(`unexpected ${type}`);
  };
  const controller = createFinancialPanelController({
    document, send, createId: () => "00000000-0000-4000-8000-000000000099",
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancelSchedule: (id) => { cancelled.push(id); }, chartRenderer: { destroy() {} },
  });
  controller.showOperation({
    kind: "capability-detail", operationRef: "base:stockinfo", domain: "quotes", name: "기본",
    requiredArguments: [{ alias: "stk_cd", description: "종목", required: true, jsonSchema: { type: "string" } }],
    optionalArguments: [],
  });
  await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
  await new Promise((resolve) => setImmediate(resolve));
  document.querySelector("#financial-profile").value = profileId;
  document.querySelector("#financial-profile").dispatch("change");
  const queryHost = document.querySelector("#financial-query-form");
  find(queryHost, (node) => node.id === "financial-arg-stk_cd").value = "005930";
  await find(queryHost, (node) => node.tagName === "FORM").dispatch("submit");
  await new Promise((resolve) => setImmediate(resolve));
  const firstCancel = document.querySelector("#financial-query-stop").dispatch("click");
  const duplicateCancel = document.querySelector("#financial-query-stop").dispatch("click");
  assert.equal(calls.filter((call) => call.type === "panel.financial.query.cancel").length, 1);
  assert.equal(cancelled.length, 1);
  await scheduled[0]();
  assert.equal(calls.filter((call) => call.type === "panel.financial.query.status").length, 0);
  resolveCancel({ job: { jobId, state: "cancelled", card: null, errorCode: "QUERY_CANCELLED" } });
  await Promise.all([firstCancel, duplicateCancel]);
  assert.equal(document.querySelector("#financial-query-stop").disabled, true);
});

test("mutation polling shows durable-commit overrun and tracked-status unknown exactly", async () => {
  const document = new FakeDocument(ids);
  const scheduled = [];
  let mutationPoll = 0;
  const mutationId = "00000000-0000-4000-8000-000000000077";
  const send = async (type, payload) => {
    if (type === "panel.financial.credentials.status" && payload.mutationId) {
      mutationPoll += 1;
      if (mutationPoll === 1) return {
        profiles: [], mutation: { mutationId, state: "running", runDeadlineAt: "2020-01-01T00:00:00.000Z" },
      };
      throw Object.assign(new Error("lost"), { code: "CREDENTIAL_MUTATION_NOT_FOUND" });
    }
    if (type === "panel.financial.credentials.status") return { profiles: [], mutation: null };
    if (type === "panel.financial.credentials.configure") return { mutation: { mutationId, state: "queued" } };
    throw new Error(`unexpected ${type}`);
  };
  const controller = createFinancialPanelController({
    document, send, createId: () => mutationId,
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancelSchedule: () => {}, chartRenderer: { destroy() {} },
  });
  await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
  await new Promise((resolve) => setImmediate(resolve));
  document.querySelector("#financial-profile-label").value = "모의";
  document.querySelector("#financial-environment").value = "mock";
  document.querySelector("#financial-app-key").value = "key";
  document.querySelector("#financial-secret-key").value = "secret";
  await document.querySelector("#financial-credentials-form").dispatch("submit");
  await scheduled.shift()();
  assert.equal(document.querySelector("#financial-readiness").textContent, "로컬 보안 저장 결과 확인 중");
  await scheduled.shift()();
  assert.equal(document.querySelector("#financial-readiness").textContent, "설정 결과 확인 불가");
});

test("profile reasonCode renders distinct safe readiness messages", async () => {
  for (const [reasonCode, expected] of [
    ["TOKEN_REJECTED", "키움 인증이 거부되었습니다. 키를 다시 확인해 주세요."],
    ["NETWORK_UNAVAILABLE", "키움 인증 서버에 연결할 수 없습니다."],
    ["LOCK_CONFLICT", "다른 ATHENA 실행기가 이 프로필을 사용 중입니다."],
    ["VAULT_UNAVAILABLE", "Windows 보안 저장소를 사용할 수 없습니다."],
    ["DELETING", "선택한 자격 증명 프로필을 삭제하는 중입니다."],
  ]) {
    const document = new FakeDocument(ids);
    const controller = createFinancialPanelController({
      document,
      send: async () => ({
        profiles: [{ profileId, label: "상태", environment: "mock", revision: 1, state: "blocked", reasonCode }],
        mutation: null,
      }),
      chartRenderer: { destroy() {} },
    });
    await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(document.querySelector("#financial-readiness").textContent, expected, reasonCode);
  }
});

test("query request error codes render fixed Korean messages without automatic retry", async () => {
  for (const [code, expected] of [
    ["UPSTREAM_UNAVAILABLE", "선택한 환경에서 키움 조회를 사용할 수 없습니다."],
    ["PAYLOAD_TOO_LARGE", "조회 요청 크기가 허용 범위를 넘었습니다."],
    ["QUERY_JOB_NOT_FOUND", "이전 조회 상태를 찾지 못했습니다."],
    ["CONTINUATION_ALREADY_USED", "이미 사용한 다음 조회 요청입니다."],
  ]) {
    const document = new FakeDocument(ids);
    let starts = 0;
    const controller = createFinancialPanelController({
      document,
      send: async (type) => {
        if (type === "panel.financial.credentials.status") return {
          profiles: [{ profileId, label: "모의", environment: "mock", revision: 1, state: "ready" }], mutation: null,
        };
        if (type === "panel.financial.query.start") {
          starts += 1;
          throw Object.assign(new Error(code), { code });
        }
        throw new Error(`unexpected ${type}`);
      },
      chartRenderer: { destroy() {} },
    });
    controller.showOperation({
      kind: "capability-detail", operationRef: "base:stockinfo", domain: "quotes", name: "기본",
      requiredArguments: [{ alias: "stk_cd", description: "종목", required: true, jsonSchema: { type: "string" } }],
      optionalArguments: [],
    });
    await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
    await new Promise((resolve) => setImmediate(resolve));
    document.querySelector("#financial-profile").value = profileId;
    document.querySelector("#financial-profile").dispatch("change");
    const host = document.querySelector("#financial-query-form");
    find(host, (node) => node.id === "financial-arg-stk_cd").value = "005930";
    await find(host, (node) => node.tagName === "FORM").dispatch("submit");
    assert.equal(starts, 1, code);
    assert.match(document.querySelector("#financial-query-status").textContent, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), code);
    assert.match(document.querySelector("#financial-query-status").textContent, /자동으로 다시 요청하지 않습니다/, code);
  }
});

test("old page and continuation controls close after a continuation and Stop", async () => {
  const document = new FakeDocument(ids);
  const calls = [];
  const scheduled = [];
  const send = async (type) => {
    calls.push(type);
    if (type === "panel.financial.credentials.status") return {
      profiles: [{ profileId, label: "모의", environment: "mock", revision: 1, state: "ready" }], mutation: null,
    };
    if (type === "panel.financial.query.start") return { job: { jobId, state: "completed", card: tableCard() } };
    if (type === "panel.financial.query.continue") return { job: { jobId: `${jobId.slice(0, -1)}3`, state: "queued", card: null } };
    if (type === "panel.financial.query.cancel") return { job: { jobId: `${jobId.slice(0, -1)}3`, state: "cancelled", card: null, errorCode: "QUERY_CANCELLED" } };
    throw new Error(`unexpected ${type}`);
  };
  const controller = createFinancialPanelController({
    document, send, createId: () => "00000000-0000-4000-8000-000000000099",
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancelSchedule: () => {}, chartRenderer: { destroy() {} },
  });
  controller.showOperation({
    kind: "capability-detail", operationRef: "base:stockinfo", domain: "quotes", name: "기본",
    requiredArguments: [{ alias: "stk_cd", description: "종목", required: true, jsonSchema: { type: "string" } }],
    optionalArguments: [],
  });
  await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
  await new Promise((resolve) => setImmediate(resolve));
  document.querySelector("#financial-profile").value = profileId;
  document.querySelector("#financial-profile").dispatch("change");
  const form = document.querySelector("#financial-query-form");
  find(form, (node) => node.id === "financial-arg-stk_cd").value = "005930";
  await find(form, (node) => node.tagName === "FORM").dispatch("submit");
  const oldCard = document.querySelector("#financial-card");
  const page = find(oldCard, (node) => node.textContent === "다음 페이지");
  const more = find(oldCard, (node) => node.textContent === "브로커 다음 조회");
  await more.dispatch("click");
  await document.querySelector("#financial-query-stop").dispatch("click");
  const before = calls.length;
  await page.dispatch("click");
  await more.dispatch("click");
  assert.equal(calls.length, before);
  assert.equal(calls.filter((type) => type === "panel.financial.query.continue").length, 1);
  assert.equal(calls.filter((type) => type === "panel.financial.query.cancel").length, 1);
});

test("late start response cannot overwrite disconnect and double submit stays single-flight", async () => {
  const document = new FakeDocument(ids);
  const calls = [];
  const scheduled = [];
  let resolveStart;
  const deferredStart = new Promise((resolve) => { resolveStart = resolve; });
  const controller = createFinancialPanelController({
    document,
    send: async (type) => {
      calls.push(type);
      if (type === "panel.financial.credentials.status") return {
        profiles: [{ profileId, label: "모의", environment: "mock", revision: 1, state: "ready" }], mutation: null,
      };
      if (type === "panel.financial.query.start") return deferredStart;
      throw new Error(`unexpected ${type}`);
    },
    schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
    cancelSchedule: () => {}, chartRenderer: { destroy() {} },
  });
  controller.showOperation({
    kind: "capability-detail", operationRef: "base:stockinfo", domain: "quotes", name: "기본",
    requiredArguments: [{ alias: "stk_cd", description: "종목", required: true, jsonSchema: { type: "string" } }],
    optionalArguments: [],
  });
  await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
  await new Promise((resolve) => setImmediate(resolve));
  document.querySelector("#financial-profile").value = profileId;
  document.querySelector("#financial-profile").dispatch("change");
  const host = document.querySelector("#financial-query-form");
  find(host, (node) => node.id === "financial-arg-stk_cd").value = "005930";
  const form = find(host, (node) => node.tagName === "FORM");
  const first = form.dispatch("submit");
  const duplicate = form.dispatch("submit");
  assert.equal(calls.filter((type) => type === "panel.financial.query.start").length, 1);
  await controller.applyConnection({ connected: false, financial: { configured: false } });
  resolveStart({ job: { jobId, state: "queued", card: null } });
  await Promise.all([first, duplicate]);
  assert.equal(controller.snapshot().currentJob, null);
  assert.equal(scheduled.length, 0);
  assert.equal(document.querySelector("#financial-readiness").textContent, "로컬 실행기에 연결해 주세요.");
});

test("late configure and delete responses cannot overwrite disconnect or schedule polling", async () => {
  for (const action of ["configure", "delete"]) {
    const document = new FakeDocument(ids);
    const scheduled = [];
    const calls = [];
    let resolveMutation;
    const deferredMutation = new Promise((resolve) => { resolveMutation = resolve; });
    const controller = createFinancialPanelController({
      document,
      send: async (type) => {
        calls.push(type);
        if (type === "panel.financial.credentials.status") return {
          profiles: [{ profileId, label: "모의", environment: "mock", revision: 1, state: "ready" }], mutation: null,
        };
        if (type === `panel.financial.credentials.${action}`) return deferredMutation;
        throw new Error(`unexpected ${type}`);
      },
      schedule: (callback) => { scheduled.push(callback); return scheduled.length; },
      cancelSchedule: () => {}, chartRenderer: { destroy() {} },
    });
    await controller.applyConnection({ connected: true, runtime: { financial: { configured: true } }, financial: {} });
    await new Promise((resolve) => setImmediate(resolve));
    document.querySelector("#financial-profile").value = profileId;
    document.querySelector("#financial-profile").dispatch("change");
    let first;
    let duplicate;
    if (action === "configure") {
      first = document.querySelector("#financial-credentials-form").dispatch("submit");
      duplicate = document.querySelector("#financial-credentials-form").dispatch("submit");
    } else {
      first = document.querySelector("#financial-credential-delete").dispatch("click");
      duplicate = document.querySelector("#financial-credential-delete").dispatch("click");
    }
    assert.equal(calls.filter((type) => type === `panel.financial.credentials.${action}`).length, 1, action);
    await controller.applyConnection({ connected: false, financial: { configured: false } });
    resolveMutation({ mutation: { mutationId: "00000000-0000-4000-8000-000000000088", state: "queued" } });
    await Promise.all([first, duplicate]);
    assert.equal(scheduled.length, 0, action);
    assert.equal(document.querySelector("#financial-readiness").textContent, "로컬 실행기에 연결해 주세요.", action);
  }
});

test("journaled credential unknown restores the exact message without replay or warmup", async () => {
  const document = new FakeDocument(ids);
  const calls = [];
  const controller = createFinancialPanelController({
    document,
    send: async (type) => {
      calls.push(type);
      if (type === "panel.financial.credentials.status") return {
        profiles: [{ profileId, label: "현재 프로필", environment: "mock", revision: 7, state: "ready" }],
        mutation: null,
      };
      throw new Error("no side effect expected");
    },
    chartRenderer: { destroy() {} },
  });
  await controller.applyConnection({
    connected: true,
    runtime: { financial: { configured: true } },
    financial: {
      configured: true,
      profiles: [],
      unknown: {
        kind: "mutation", reasonCode: "CREDENTIAL_MUTATION_NOT_FOUND",
        mutationId: "00000000-0000-4000-8000-000000000088",
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.querySelector("#financial-readiness").textContent, "설정 결과 확인 불가");
  assert.deepEqual(calls, []);
  document.querySelector("#financial-refresh").dispatch("click");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(document.querySelector("#financial-readiness").textContent, "설정 결과 확인 불가");
  assert.equal(controller.snapshot().profiles[0].revision, 7);
  assert.deepEqual(calls, ["panel.financial.credentials.status"]);
  assert.equal(calls.some((type) => /configure|delete|query\.start/u.test(type)), false);
});

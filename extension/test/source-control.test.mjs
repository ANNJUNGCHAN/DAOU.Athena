import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createProtocolValidator } from "../../contracts/wts-foundation.mjs";
import {
  SOURCE_REQUEST_TIMEOUT_MS,
  assertSourceStateAvailable,
  createSourceActivityGate,
  createSourceControlCoordinator,
  routeSourcePanelMessage,
} from "../src/source-control.mjs";

const schema = JSON.parse(await readFile(
  resolve(import.meta.dirname, "../../contracts/wts-foundation.protocol.schema.json"),
  "utf8",
));
const validator = createProtocolValidator(schema);
const catalogVersion = `sha256:${"a".repeat(64)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function backend(overrides = {}) {
  return {
    configured: true,
    state: "ready",
    profile: "wts-readonly-v1",
    apiVersion: "selector-readonly-v1",
    catalogVersion,
    ownedChild: true,
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return {
    profile: "wts-readonly-v1",
    apiVersion: "selector-readonly-v1",
    catalogVersion,
    operationCount: 264,
    ...overrides,
  };
}

function listCard(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "capability-list",
    canvasId: "00000000-0000-4000-8000-000000000001",
    title: "조회 기능 찾기",
    catalogVersion,
    fetchedAt: "2026-10-19T06:00:00.000Z",
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    query: "외국인 매매",
    items: [{
      operationRef: "base:stockinfo",
      kind: "query",
      domain: "stock",
      name: "종목 정보",
      groupTitle: null,
    }],
    ...overrides,
  };
}

function detailCard(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "capability-detail",
    canvasId: "00000000-0000-4000-8000-000000000002",
    title: "종목 정보",
    catalogVersion,
    fetchedAt: "2026-10-19T06:00:00.000Z",
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    operationRef: "base:stockinfo",
    domain: "stock",
    name: "종목 정보",
    executionPolicy: "selector_query",
    requiredArguments: [],
    optionalArguments: [],
    responseFields: [],
    execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
    ...overrides,
  };
}

function coordinatorFixture(responses) {
  const calls = [];
  const coordinator = createSourceControlCoordinator({
    request: async (method, params, options) => {
      calls.push({ method, params, options });
      const value = responses[method];
      return typeof value === "function" ? value(params) : { ok: true, result: value };
    },
    validateBackendStatus: validator.validateBackendStatus,
    validateSourceManifest: validator.validateSourceManifest,
    validateSourceCard: validator.validateSourceCard,
  });
  return { coordinator, calls };
}

test("search validates before transport and uses ensure, a fresh manifest, and fixed limit five", async () => {
  const value = coordinatorFixture({
    "backend.ensure": backend(),
    "source.manifest": manifest(),
    "source.search": listCard(),
  });
  await assert.rejects(value.coordinator.search({ query: " " }), /2자 이상/);
  assert.equal(value.calls.length, 0);

  const result = await value.coordinator.search({ query: "  외국인 매매  " });
  assert.equal(result.kind, "capability-list");
  assert.deepEqual(value.calls.map((call) => call.method), [
    "backend.ensure",
    "source.manifest",
    "source.search",
  ]);
  assert.deepEqual(value.calls[2].params, {
    query: "외국인 매매",
    limit: 5,
    expectedCatalogVersion: catalogVersion,
  });
  assert.deepEqual(value.calls.map((call) => call.options), [
    { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS },
    { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS },
    { timeoutMs: SOURCE_REQUEST_TIMEOUT_MS },
  ]);
});

test("describe aborts on fresh manifest drift before sending the detail request", async () => {
  const changed = `sha256:${"b".repeat(64)}`;
  const value = coordinatorFixture({
    "backend.ensure": backend({ catalogVersion: changed }),
    "source.manifest": manifest({ catalogVersion: changed }),
    "source.describe": detailCard(),
  });
  await assert.rejects(value.coordinator.describe({
    operationRef: "base:stockinfo",
    expectedCatalogVersion: catalogVersion,
  }), /다시 검색/);
  assert.deepEqual(value.calls.map((call) => call.method), ["backend.ensure", "source.manifest"]);
});

test("coordinator rejects unknown input and mismatched direct cards", async () => {
  const invalid = coordinatorFixture({});
  await assert.rejects(invalid.coordinator.search({ query: "종목", limit: 1 }), /형식/);
  await assert.rejects(invalid.coordinator.describe({
    operationRef: "base:StockInfo",
    expectedCatalogVersion: catalogVersion,
  }), /식별자/);
  assert.equal(invalid.calls.length, 0);

  const mismatched = coordinatorFixture({
    "backend.ensure": backend(),
    "source.manifest": manifest(),
    "source.search": listCard({ query: "다른 검색" }),
  });
  await assert.rejects(mismatched.coordinator.search({ query: "외국인 매매" }), /일치하지 않습니다/);
});

test("coordinator fails closed when ensure and fresh manifest catalog identities disagree", async () => {
  const value = coordinatorFixture({
    "backend.ensure": backend(),
    "source.manifest": manifest({ catalogVersion: `sha256:${"b".repeat(64)}` }),
    "source.search": listCard(),
  });
  await assert.rejects(value.coordinator.search({ query: "외국인 매매" }), /준비 상태와 일치하지 않습니다/);
  assert.deepEqual(value.calls.map((call) => call.method), ["backend.ensure", "source.manifest"]);
});

test("panel routing accepts only the two exact source message shapes", async () => {
  const calls = [];
  const coordinator = {
    search: async (input) => { calls.push(["search", input]); return "list"; },
    describe: async (input) => { calls.push(["describe", input]); return "detail"; },
  };
  assert.equal(await routeSourcePanelMessage({ type: "panel.source.search", query: "종목 정보" }, coordinator), "list");
  assert.equal(await routeSourcePanelMessage({
    type: "panel.source.describe",
    operationRef: "base:stockinfo",
    expectedCatalogVersion: catalogVersion,
  }, coordinator), "detail");
  assert.deepEqual(calls, [
    ["search", { query: "종목 정보" }],
    ["describe", { operationRef: "base:stockinfo", expectedCatalogVersion: catalogVersion }],
  ]);
  assert.throws(() => routeSourcePanelMessage({
    type: "panel.source.search",
    query: "종목 정보",
    limit: 1,
  }, coordinator), /형식/);
});

test("activity gate excludes foreground and duplicate source traffic without coalescing", async () => {
  let releaseForeground;
  const foregroundWait = new Promise((resolve) => { releaseForeground = resolve; });
  const gate = createSourceActivityGate();
  const foreground = gate.runForeground(() => foregroundWait);
  await assert.rejects(gate.runSource(async () => "source"), /다른 WTS 요청/);
  releaseForeground();
  await foreground;

  let releaseSource;
  const sourceWait = new Promise((resolve) => { releaseSource = resolve; });
  const source = gate.runSource(() => sourceWait);
  assert.equal(gate.running(), true);
  await assert.rejects(gate.runSource(async () => "duplicate"), /다른 조회 기능/);
  await assert.rejects(gate.runForeground(async () => "summary"), /조회 기능 요청/);
  releaseSource("done");
  assert.equal(await source, "done");
  assert.equal(gate.running(), false);
});

test("source state guard blocks pending capture, receipt, dispatch, and active task states", () => {
  const idle = {
    connected: true,
    configured: true,
    controlRunning: false,
    taskRunning: false,
    pendingCapture: false,
    pendingReceipt: false,
    journal: { version: 1, activeTaskId: null, dispatch: null },
    latestTask: null,
  };
  assert.doesNotThrow(() => assertSourceStateAvailable(idle));
  assert.throws(() => assertSourceStateAvailable({ ...idle, pendingCapture: true }), /화면 조사/);
  assert.throws(() => assertSourceStateAvailable({ ...idle, pendingReceipt: true }), /화면 제어 결과/);
  assert.throws(() => assertSourceStateAvailable({
    ...idle,
    journal: { ...idle.journal, dispatch: { state: "armed" } },
  }), /미확인 WTS 대화 작업/);
  assert.throws(() => assertSourceStateAvailable({
    ...idle,
    journal: { ...idle.journal, activeTaskId: "task" },
  }), /상태를 먼저 확인/);
  assert.throws(() => assertSourceStateAvailable({
    ...idle,
    journal: { ...idle.journal, activeTaskId: "task" },
    latestTask: { status: "ready" },
  }), /진행 중인/);
  assert.doesNotThrow(() => assertSourceStateAvailable({
    ...idle,
    journal: { ...idle.journal, activeTaskId: "task" },
    latestTask: { status: "completed" },
  }));
});

test("disconnect invalidation rejects a late source result and cannot clear a new generation", async () => {
  const releases = [];
  const gate = createSourceActivityGate();
  const first = gate.runSource(() => new Promise((resolve) => releases.push(resolve)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gate.invalidateSource(), true);
  const second = gate.runSource(() => new Promise((resolve) => releases.push(resolve)));
  await new Promise((resolve) => setImmediate(resolve));
  releases[0]("late");
  await assert.rejects(first, /연결이 종료/);
  assert.equal(gate.running(), true);
  releases[1]("current");
  assert.equal(await second, "current");
  assert.equal(gate.running(), false);
});

test("conversation reservation is exclusive across routing and admitted source ownership", async () => {
  const releases = [];
  const gate = createSourceActivityGate();
  const reservation = gate.reserveConversation();
  assert.deepEqual(gate.conversationStatus(), { running: true, phase: "routing" });
  await assert.rejects(gate.runForeground(async () => "foreground"), /대화 요청/);
  await assert.rejects(gate.runSource(async () => "source"), /대화 요청/);
  const source = reservation.runSource(() => new Promise((resolve) => releases.push(resolve)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(gate.conversationStatus(), { running: true, phase: "source" });
  assert.equal(gate.running(), true);
  assert.equal(reservation.cancel(), false);
  releases[0]("done");
  assert.equal(await source, "done");
  reservation.release();
  assert.deepEqual(gate.conversationStatus(), { running: false, phase: "idle" });
});

test("conversation stop during deferred source preflight prevents search and describe invocation", async () => {
  for (const operation of ["search", "describe"]) {
    const preflight = deferred();
    let calls = 0;
    const gate = createSourceActivityGate({ assertSourceCanStart: () => preflight.promise });
    const reservation = gate.reserveConversation();
    const pending = reservation.runSource(() => {
      calls += 1;
      return operation;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(gate.conversationStatus(), { running: true, phase: "routing" });
    assert.equal(reservation.cancel(), true);
    preflight.resolve();
    await assert.rejects(pending, /취소|종료/);
    assert.equal(calls, 0, `${operation} must not start after stop wins during preflight`);
    reservation.release();
  }
});

test("conversation cancellation and disconnect invalidation reject late branch admission", async () => {
  for (const invalidate of [false, true]) {
    const gate = createSourceActivityGate();
    const reservation = gate.reserveConversation();
    const release = deferred();
    const routing = reservation.runRouting(() => release.promise);
    if (invalidate) assert.equal(gate.invalidateConversation(), true);
    else assert.equal(reservation.cancel(), true);
    release.resolve("late-route");
    await assert.rejects(routing, /취소|종료/);
    assert.throws(() => reservation.runControl(async () => "late-control"), /취소|종료/);
    reservation.release();
  }
});

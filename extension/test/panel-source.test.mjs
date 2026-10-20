import test from "node:test";
import assert from "node:assert/strict";
import {
  canStartPanelConversation,
  canStopPanelConversation,
  createPanelConversationController,
  createSourceActivityPoller,
  formatPanelConversationError,
  normalizeConversationText,
  readPanelHealth,
  resolvePanelControlHealthMessage,
} from "../src/sidepanel/panel-source.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const catalogVersion = `sha256:${"a".repeat(64)}`;

function detailCard() {
  return {
    schemaVersion: 1,
    kind: "capability-detail",
    canvasId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "기능 상세",
    catalogVersion,
    fetchedAt: "2026-10-19T00:00:00Z",
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    operationRef: "base:ka10001",
    domain: "domestic-stock",
    name: "주식기본정보요청",
    executionPolicy: "selector_detail_required",
    requiredArguments: [],
    optionalArguments: [],
    responseFields: [],
    execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
  };
}

test("submit trims one unified request and forwards its caller-issued identity", async () => {
  const calls = [];
  const results = [];
  const result = { kind: "unsupported", submissionId: firstId, message: "지원하지 않음" };
  const controller = createPanelConversationController({
    async request(type, payload) { calls.push({ type, payload }); return result; },
    onResult(value) { results.push(value); },
    onError() {},
  });
  assert.deepEqual(await controller.submit("  조회 기능 찾아줘: 현재가  ", firstId), { accepted: true, result });
  assert.deepEqual(calls, [{
    type: "panel.chat.submit",
    payload: { text: "조회 기능 찾아줘: 현재가", submissionId: firstId },
  }]);
  assert.deepEqual(results, [result]);
  assert.equal(controller.running(), false);
});

test("malformed provider starts never reach the operation handoff", async () => {
  const operation = { operationId: secondId, kind: "plan", state: "running", revision: 1, cancellable: true };
  for (const invalidOperation of [null, { ...operation, operationId: "not-an-id" },
    { ...operation, kind: "connect" }, { ...operation, state: "succeeded" },
    { ...operation, revision: 0 }, { ...operation, cancellable: "yes" }]) {
    const results = [];
    const errors = [];
    const controller = createPanelConversationController({
      request: async () => ({ kind: "provider-pending", submissionId: firstId, operation: invalidOperation }),
      onResult(result) { results.push(result); },
      onError(error) { errors.push(error); },
    });
    assert.deepEqual(await controller.submit("안녕", firstId), { accepted: true, result: null });
    assert.deepEqual(results, []);
    assert.equal(errors.length, 1);
    assert.equal(controller.running(), false);
  }
});

test("conversation errors explain known failures without rendering arbitrary backend details", () => {
  assert.match(formatPanelConversationError(new Error("현재 열린 ChatGPT 패널 소유자가 아닙니다.")), /패널을 닫고 다시 열어/);
  assert.match(formatPanelConversationError({ code: "PROVIDER_MODEL_NOT_SELECTED", message: "token=secret" }), /모델이 선택되지/);
  assert.match(formatPanelConversationError({ code: "PROVIDER_MODEL_CATALOG_REQUIRED" }), /모델 목록/);
  assert.match(formatPanelConversationError({ code: "PROVIDER_BUSY" }), /다른 ChatGPT 작업/);
  assert.match(formatPanelConversationError({ code: "PROVIDER_PREVIOUS_RESULT_PENDING" }), /이전 ChatGPT 작업 결과/);
  assert.match(formatPanelConversationError(new Error("로컬 실행기 응답 시간이 초과되었습니다. 요청은 자동 재시도하지 않습니다.")), /응답 시간이 초과/);
  const fallback = "요청을 완료하지 못했습니다. 자동으로 다시 실행하지 않습니다.";
  for (const error of [undefined, new Error("token=secret https://example.invalid/internal"),
    { code: "UNKNOWN_SECRET", message: "secret" }, { code: "__proto__" },
    new Error("현재 열린 ChatGPT 패널 소유자가 아닙니다. secret")]) {
    assert.equal(formatPanelConversationError(error), fallback);
  }
});

test("describe forwards the issued list identity and exact catalog binding", async () => {
  const calls = [];
  const result = { kind: "source-card", submissionId: firstId, card: detailCard() };
  const controller = createPanelConversationController({
    async request(type, payload) { calls.push({ type, payload }); return result; },
    onResult() {},
    onError() {},
  });
  await controller.describe({
    submissionId: firstId,
    operationRef: "base:ka10001",
    expectedCatalogVersion: "sha256:abc",
  });
  assert.deepEqual(calls, [{
    type: "panel.chat.describe",
    payload: { submissionId: firstId, operationRef: "base:ka10001", expectedCatalogVersion: "sha256:abc" },
  }]);
});

test("invalid source cards become bounded request errors before UI rendering", async () => {
  const results = [];
  const errors = [];
  const controller = createPanelConversationController({
    request: async () => ({ kind: "source-card", submissionId: firstId, card: { kind: "capability-detail" } }),
    onResult(value) { results.push(value); },
    onError(value) { errors.push(value); },
  });
  assert.deepEqual(await controller.describe({
    submissionId: firstId,
    operationRef: "base:ka10001",
    expectedCatalogVersion: catalogVersion,
  }), { accepted: true, result: null });
  assert.deepEqual(results, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].submissionId, firstId);
});

test("disconnect invalidation discards a late success and clears busy immediately", async () => {
  const pending = deferred();
  const results = [];
  const running = [];
  const controller = createPanelConversationController({
    request: async () => pending.promise,
    onResult(result) { results.push(result); },
    onError() {},
    onRunningChange(value, phase) { running.push({ value, phase }); },
  });
  const result = controller.submit("현재가", firstId);
  assert.equal(controller.invalidate(), firstId);
  assert.equal(controller.invalidate(), null);
  pending.resolve({ kind: "unsupported", submissionId: firstId, message: "지원하지 않음" });
  assert.deepEqual(await result, { accepted: false, result: null });
  assert.equal(controller.running(), false);
  assert.deepEqual(running, [
    { value: true, phase: "routing" },
    { value: false, phase: "idle" },
  ]);
  assert.deepEqual(results, []);
});

test("a newer request wins over an older response", async () => {
  const first = deferred();
  const second = deferred();
  let call = 0;
  const results = [];
  const controller = createPanelConversationController({
    request: async () => (++call === 1 ? first.promise : second.promise),
    onResult(result) { results.push(result); },
    onError() {},
  });
  const oldResult = controller.submit("첫 검색", firstId);
  const newResult = controller.submit("새 검색", secondId);
  const newest = { kind: "unsupported", submissionId: secondId, message: "new" };
  second.resolve(newest);
  assert.deepEqual(await newResult, { accepted: true, result: newest });
  first.resolve({ kind: "unsupported", submissionId: firstId, message: "old" });
  assert.deepEqual(await oldResult, { accepted: false, result: null });
  assert.deepEqual(results, [newest]);
});

test("errors are reported without rendering a result and invalid text never calls the service", async () => {
  let calls = 0;
  const errors = [];
  const controller = createPanelConversationController({
    async request() { calls += 1; throw new Error("secret backend path"); },
    onResult() {},
    onError(value) { errors.push(value); },
  });
  assert.throws(() => controller.submit(" ", firstId), /한 글자 이상/);
  assert.equal(calls, 0);
  assert.deepEqual(await controller.submit("정상 검색", firstId), { accepted: true, result: null });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].submissionId, firstId);
});

test("unified composer works for configured metadata without capture and excludes recovery lanes", () => {
  const ready = {
    connected: true,
    controlReady: false,
    sourceConfigured: true,
    conversationRunning: false,
    sourceRunning: false,
    disconnecting: false,
    captureRunning: false,
    directProbeRunning: false,
    pendingCapture: false,
    pendingReceipt: false,
    controlRunning: false,
    taskRunning: false,
  };
  assert.equal(canStartPanelConversation(ready), true);
  assert.equal(canStartPanelConversation({ ...ready, sourceConfigured: false, controlReady: true }), true);
  for (const blocked of [
    "conversationRunning", "sourceRunning", "disconnecting", "captureRunning", "directProbeRunning", "pendingCapture",
    "pendingReceipt", "controlRunning", "taskRunning",
  ]) {
    assert.equal(canStartPanelConversation({ ...ready, [blocked]: true }), false, blocked);
  }
  assert.equal(canStartPanelConversation({ ...ready, connected: false }), false);
  assert.equal(canStartPanelConversation({ ...ready, sourceConfigured: false }), false);
});

test("Stop is available for routing, control acceptance, and tasks but never source dispatch", () => {
  const base = { connected: true, conversationRunning: true, taskRunning: false };
  assert.equal(canStopPanelConversation({ ...base, phase: "routing" }), true);
  assert.equal(canStopPanelConversation({ ...base, phase: "control" }), true);
  assert.equal(canStopPanelConversation({ ...base, phase: "source" }), false);
  assert.equal(canStopPanelConversation({ ...base, conversationRunning: false, phase: "idle" }), false);
  assert.equal(canStopPanelConversation({ ...base, conversationRunning: false, phase: "idle", taskRunning: true, taskStatus: "ready" }), true);
  assert.equal(canStopPanelConversation({ ...base, conversationRunning: false, phase: "idle", taskRunning: true, taskStatus: "cancel_requested" }), false);
});

test("result renderer failures propagate and still release conversation busy", async () => {
  const running = [];
  const controller = createPanelConversationController({
    request: async () => ({ kind: "unsupported", submissionId: firstId, message: "x" }),
    onResult() { throw new TypeError("DOM implementation failed"); },
    onError() {},
    onRunningChange(value, phase) { running.push({ value, phase }); },
  });
  await assert.rejects(controller.submit("현재가", firstId), /DOM implementation failed/);
  assert.equal(controller.running(), false);
  assert.deepEqual(running, [
    { value: true, phase: "routing" },
    { value: false, phase: "idle" },
  ]);
});

test("a mismatched response identity is rejected before UI dispatch", async () => {
  const results = [];
  const errors = [];
  const controller = createPanelConversationController({
    request: async () => ({ kind: "unsupported", submissionId: secondId, message: "wrong" }),
    onResult(value) { results.push(value); },
    onError(value) { errors.push(value); },
  });
  assert.deepEqual(await controller.submit("현재가", firstId), { accepted: true, result: null });
  assert.deepEqual(results, []);
  assert.equal(errors.length, 1);
});

test("a transient health read failure preserves an active source request and its later result", async () => {
  const pending = deferred();
  const results = [];
  const appliedHealth = [];
  const readErrors = [];
  const controller = createPanelConversationController({
    request: async () => pending.promise,
    onResult(value) { results.push(value); },
    onError() {},
  });
  const sourceResult = controller.describe({
    submissionId: firstId,
    operationRef: "base:ka10001",
    expectedCatalogVersion: catalogVersion,
  });
  assert.equal(controller.running(), true);

  const healthRead = await readPanelHealth({
    readHealth: async () => { throw new Error("transient health failure"); },
    onHealth(value) { appliedHealth.push(value); },
    onError(error) { readErrors.push(error.message); },
  });
  assert.equal(healthRead.ok, false);
  assert.deepEqual(appliedHealth, []);
  assert.deepEqual(readErrors, ["transient health failure"]);
  assert.equal(controller.running(), true);

  const result = { kind: "source-card", submissionId: firstId, card: detailCard() };
  pending.resolve(result);
  assert.deepEqual(await sourceResult, { accepted: true, result });
  assert.deepEqual(results, [result]);
});

test("health application failures remain programmer errors instead of transport fallbacks", async () => {
  await assert.rejects(readPanelHealth({
    readHealth: async () => ({ connected: true }),
    onHealth() { throw new Error("health renderer failed"); },
  }), /health renderer failed/);
});

test("reopened and pushed health expose the authoritative control gate", () => {
  const idle = { messageKind: "health" };
  assert.equal(resolvePanelControlHealthMessage({
    connected: true,
    controlReady: false,
    controlBlockedReason: "설치된 실행기는 protocol 6과 호환되지 않습니다.",
  }, idle), "설치된 실행기는 protocol 6과 호환되지 않습니다.");
  assert.equal(resolvePanelControlHealthMessage({
    connected: true,
    controlReady: true,
  }, idle), "지원되는 WTS 화면 작업을 사용할 수 있습니다.");
  assert.equal(resolvePanelControlHealthMessage({
    connected: true,
    controlReady: false,
    controlBlockedReason: "새 gate 불일치",
  }, idle), "새 gate 불일치");
});

test("task, source, control, and error messages take precedence over health copy", () => {
  const health = {
    connected: true,
    controlReady: false,
    controlBlockedReason: "호환되지 않는 실행기",
  };
  for (const state of [
    { taskPresent: true },
    { conversationRunning: true },
    { sourceRunning: true },
    { controlRunning: true },
    { messageKind: "task" },
    { messageKind: "result" },
    { messageKind: "error" },
  ]) assert.equal(resolvePanelControlHealthMessage(health, state), null);
  assert.equal(resolvePanelControlHealthMessage({ connected: false, controlReady: false }, {}), null);
  assert.equal(resolvePanelControlHealthMessage({ connected: true, controlReady: false }, {}), "현재 화면 조사 1회 저장 후 사용할 수 있습니다.");
});

test("cached source activity from a reopened panel clears after bounded health reconciliation", async () => {
  const scheduled = [];
  const observed = [];
  const health = [{ sourceRunning: true }, { sourceRunning: false }];
  const poller = createSourceActivityPoller({
    async readHealth() { return health.shift(); },
    onHealth(value) { observed.push(value); },
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel() {},
    delayMs: 100,
    maxChecks: 3,
  });
  poller.observe(true);
  assert.equal(poller.active(), true);
  await scheduled.shift()();
  assert.equal(poller.active(), true);
  await scheduled.shift()();
  assert.equal(poller.active(), false);
  assert.deepEqual(observed, [{ sourceRunning: true }, { sourceRunning: false }]);
});

test("source activity reconciliation is bounded when cached health never settles", async () => {
  const scheduled = [];
  const stalled = [];
  const poller = createSourceActivityPoller({
    async readHealth() { return { sourceRunning: true }; },
    onHealth() {},
    onStalled(value) { stalled.push(value); },
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel() {},
    delayMs: 100,
    maxChecks: 2,
  });
  poller.observe(true);
  await scheduled.shift()();
  await scheduled.shift()();
  assert.equal(poller.active(), false);
  assert.equal(scheduled.length, 0);
  assert.equal(stalled.length, 1);
  assert.equal(stalled[0].checks, 2);
});

test("persistent health errors are reported and end in retryable stall state", async () => {
  const scheduled = [];
  const errors = [];
  const stalled = [];
  const failure = new Error("health unavailable");
  const poller = createSourceActivityPoller({
    async readHealth() { throw failure; },
    onHealth() {},
    onError(error, context) { errors.push({ error, context }); },
    onStalled(value) { stalled.push(value); },
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel() {},
    delayMs: 100,
    maxChecks: 2,
  });
  poller.observe(true);
  await scheduled.shift()();
  await scheduled.shift()();
  assert.deepEqual(errors.map(({ context }) => context.check), [1, 2]);
  assert.equal(errors[0].error, failure);
  assert.equal(stalled[0].lastError, failure);
  assert.equal(poller.active(), false);
});

test("stop invalidates an in-flight health read after disconnect", async () => {
  const scheduled = [];
  const observed = [];
  let resolveHealth;
  const poller = createSourceActivityPoller({
    readHealth: () => new Promise((resolve) => { resolveHealth = resolve; }),
    onHealth(value) { observed.push(value); },
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel() {},
    delayMs: 100,
    maxChecks: 3,
  });
  poller.observe(true);
  const pending = scheduled.shift()();
  poller.stop();
  resolveHealth({ sourceRunning: false });
  await pending;
  assert.deepEqual(observed, []);
  assert.equal(scheduled.length, 0);
  assert.equal(poller.active(), false);
});

test("stop also discards a late health error after disconnect", async () => {
  const scheduled = [];
  const errors = [];
  let rejectHealth;
  const poller = createSourceActivityPoller({
    readHealth: () => new Promise((_resolve, reject) => { rejectHealth = reject; }),
    onHealth() {},
    onError(error) { errors.push(error); },
    schedule(callback) { scheduled.push(callback); return callback; },
    cancel() {},
    delayMs: 100,
    maxChecks: 3,
  });
  poller.observe(true);
  const pending = scheduled.shift()();
  poller.stop();
  rejectHealth(new Error("late failure"));
  await pending;
  assert.deepEqual(errors, []);
  assert.equal(poller.active(), false);
});

test("conversation text validation trims only its outer boundary and enforces total length", () => {
  assert.equal(normalizeConversationText("  조회 기능 찾아줘: 현재가  "), "조회 기능 찾아줘: 현재가");
  assert.throws(() => normalizeConversationText(" "), /한 글자 이상/);
  assert.throws(() => normalizeConversationText("가".repeat(513)), /512자 이하/);
});

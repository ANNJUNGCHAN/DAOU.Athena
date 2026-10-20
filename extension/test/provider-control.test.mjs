import test from "node:test";
import assert from "node:assert/strict";

import { createConversationDispatcher } from "../src/conversation-dispatch.mjs";
import { createProviderControlCoordinator, routeProviderPanelMessage } from "../src/provider-control.mjs";
import { createSourceActivityGate } from "../src/source-control.mjs";
import { createPanelConversationController } from "../src/sidepanel/panel-source.mjs";
import { mergeConversationResult } from "../src/sidepanel/panel-chat.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OWNER_2 = "22222222-2222-4222-8222-222222222222";
const SUBMISSION = "33333333-3333-4333-8333-333333333333";
const OPERATION = "44444444-4444-4444-8444-444444444444";
const CANCELLATION = "55555555-5555-4555-8555-555555555555";
const CATALOG = "wts-main-control-3";

const providerMetadata = Object.freeze({
  id: "openai-chatgpt-siwc-v1",
  apiVersion: "openai-provider-native-v1",
  methods: [
    "provider.status", "provider.connect.start", "provider.models.start", "provider.model.select",
    "provider.plan.start", "provider.operation.get", "provider.operation.cancel",
    "provider.disconnect.start", "provider.account.reset.start",
  ],
  asyncJobs: true,
  auth: "explicit-browser-consent",
  tokenStorage: "native-memory-only",
  planner: "proposal-only",
  modelCatalog: true,
  tools: false,
  order: false,
  dataSent: "user-text-and-fixed-control-catalog",
});

function ok(result) { return { ok: true, result }; }
function operation({ state = "running", revision = 1, kind = "plan", result = null, error = null, operationId = OPERATION } = {}) {
  return { operationId, kind, state, revision, cancellable: state === "running", result, error };
}
function status({ connection = "connected", catalog = "ready", selectedModel = { slug: "gpt-test", displayName: "GPT Test", compatibility: "untested" }, active = null } = {}) {
  return { provider: "openai-chatgpt-siwc-v1", connection, accountResetAvailable: true, catalog, selectedModel, operation: active };
}
function reservation() {
  return {
    phase: "provider-planning",
    released: 0,
    claimed: false,
    claimProvider() { this.claimed = true; },
    providerClaimed() { return this.claimed; },
    holdForConfirmation() { this.phase = "awaiting-confirmation"; },
    runControl(task) { this.phase = "control"; return task(); },
    release() { this.released += 1; },
  };
}
function createHarness(responses = {}, options = {}) {
  const calls = [];
  const controls = [];
  const queues = new Map(Object.entries(responses).map(([key, value]) => [key, [...value]]));
  const coordinator = createProviderControlCoordinator({
    randomUuid: () => CANCELLATION,
    async request(method, params) {
      calls.push({ method, params });
      const queue = queues.get(method) || [];
      if (!queue.length) throw new Error(`unexpected ${method}`);
      const next = queue.shift();
      return typeof next === "function" ? next(params) : next;
    },
    async runControl(text, submissionId) {
      controls.push({ text, submissionId });
      return { kind: "control-task", submissionId, task: { id: "task-1", submissionId } };
    },
    ...options,
  });
  coordinator.bindRuntime({ generation: 1, provider: providerMetadata });
  coordinator.attachOwner(OWNER);
  return { coordinator, calls, controls };
}

test("a real provider start result reaches the panel conversation handoff without executing WTS", async () => {
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
  });
  await value.coordinator.refreshStatus(OWNER);
  const gate = createSourceActivityGate();
  const dispatcher = createConversationDispatcher({
    activityGate: gate,
    unsupportedMessage: "unsupported",
    validateConversationRoute: (result) => result,
    route: async (input) => ({ kind: "unsupported", submissionId: input.submissionId, message: "unsupported" }),
    startProvider: (input, held, ownerId) => value.coordinator.startPlan(input, held, ownerId),
  });
  const tracked = [];
  const errors = [];
  let messages = [];
  const controller = createPanelConversationController({
    request(type, payload) {
      assert.equal(type, "panel.chat.submit");
      return dispatcher.submit({ ...payload, ownerId: OWNER });
    },
    onResult(result) {
      messages = mergeConversationResult(messages, result);
      if (result.kind === "provider-pending") tracked.push(result);
    },
    onError(error) { errors.push(error); },
  });

  const outcome = await controller.submit("안녕. 연결이 됐는지 한 문장으로 답해줘.", SUBMISSION);
  assert.equal(outcome.result?.kind, "provider-pending");
  assert.deepEqual(errors, []);
  assert.deepEqual(tracked, [outcome.result]);
  assert.deepEqual(tracked[0].operation, {
    operationId: OPERATION, kind: "plan", state: "running", revision: 1, cancellable: true,
  });
  assert.equal(messages.at(-1).label, "ChatGPT");
  assert.equal(messages.at(-1).terminal, false);
  assert.equal(controller.running(), false);
  assert.deepEqual(gate.conversationStatus(), { running: true, phase: "provider-planning" });
  assert.deepEqual(value.controls, []);
  assert.equal(value.calls.filter((call) => call.method === "provider.plan.start").length, 1);
});

test("provider lifecycle loads live models, requires explicit selection, and retains proposal until exact confirmation", async () => {
  const planResult = { submissionId: SUBMISSION, catalogVersion: CATALOG, assistantText: "주봉 전환을 제안합니다.", proposal: { kind: "wts-control", text: "주봉으로" } };
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.get": [
      ok(operation({ state: "succeeded", revision: 2, result: planResult })),
      ok(operation({ state: "succeeded", revision: 2, result: planResult })),
    ],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  const pending = await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "주봉으로 바꿔줘" }, held, OWNER);
  assert.equal(pending.kind, "provider-pending");
  assert.equal(held.released, 0);
  const complete = await value.coordinator.poll(OWNER);
  assert.equal(complete.proposal.commandText, "주봉으로");
  assert.equal(complete.conversationPhase, "awaiting-confirmation");
  assert.equal(held.released, 0, "consuming Native terminal must keep the SW reservation");
  assert.deepEqual(value.controls, [], "provider proposal must never auto-execute");

  await assert.rejects(
    value.coordinator.confirm(OWNER, { submissionId: SUBMISSION, catalogVersion: "wrong" }),
    /일치하지 않습니다/,
  );
  const result = await value.coordinator.confirm(OWNER, { submissionId: SUBMISSION, catalogVersion: CATALOG });
  assert.equal(result.kind, "control-task");
  assert.deepEqual(value.controls, [{ text: "주봉으로", submissionId: SUBMISSION }]);
  assert.equal(held.released, 1);
  await assert.rejects(
    value.coordinator.confirm(OWNER, { submissionId: SUBMISSION, catalogVersion: CATALOG }),
    /실행 제안이 없거나/,
  );
  assert.equal(value.controls.length, 1, "repeated confirmation must not click twice");
});

test("explicit connect, live model catalog, and explicit model selection update only from validated Native results", async () => {
  const connectRunning = operation({ kind: "connect" });
  const connectDone = operation({ kind: "connect", state: "succeeded", revision: 2, result: { connection: "connected" } });
  const modelsRunning = operation({ operationId: OWNER_2, kind: "models" });
  const modelsDone = operation({ operationId: OWNER_2, kind: "models", state: "succeeded", revision: 2, result: { models: [{ slug: "gpt-live", displayName: "GPT Live" }] } });
  const value = createHarness({
    "provider.connect.start": [ok(connectRunning)],
    "provider.operation.get": [ok(connectDone), ok(connectDone), ok(modelsDone), ok(modelsDone)],
    "provider.models.start": [ok(modelsRunning)],
    "provider.model.select": [ok(status({ selectedModel: { slug: "gpt-live", displayName: "GPT Live", compatibility: "untested" } }))],
  });
  await value.coordinator.start(OWNER, "connect");
  await value.coordinator.poll(OWNER);
  assert.equal(value.coordinator.snapshot().connection, "connected");
  await value.coordinator.start(OWNER, "models");
  await value.coordinator.poll(OWNER);
  assert.deepEqual(value.coordinator.snapshot().models, [{ slug: "gpt-live", displayName: "GPT Live" }]);
  assert.equal(value.coordinator.snapshot().selectedModel, null);
  await value.coordinator.select(OWNER, "gpt-live");
  assert.equal(value.coordinator.snapshot().selectedModel.slug, "gpt-live");
});

for (const terminalState of ["failed", "cancelled"]) {
  test(`a ${terminalState} connect terminal clears an imported connecting state without retrying`, async () => {
    const error = {
      code: terminalState === "failed" ? "PROVIDER_CONNECT_FAILED" : "PROVIDER_CONNECT_CANCELLED",
      message: terminalState === "failed" ? "ChatGPT 계정 연결을 완료하지 못했습니다." : "ChatGPT 계정 연결을 취소했습니다.",
    };
    const terminal = operation({ kind: "connect", state: terminalState, revision: 2, error });
    const value = createHarness({
      "provider.status": [ok(status({
        connection: "connecting", catalog: "unavailable", selectedModel: null,
        active: operation({ kind: "connect" }),
      }))],
      "provider.operation.get": [ok(terminal), ok(terminal)],
    });
    assert.equal((await value.coordinator.refreshStatus(OWNER)).connection, "connecting");

    const completed = await value.coordinator.poll(OWNER);
    assert.equal(completed.connection, "signed-out");
    assert.equal(completed.catalog, "unavailable");
    assert.deepEqual(completed.models, []);
    assert.equal(completed.selectedModel, null);
    assert.equal(completed.operation, null);
    assert.deepEqual(completed.terminal, { kind: "connect", state: terminalState, result: null, error });
    assert.deepEqual(value.calls, [
      { method: "provider.status", params: {} },
      { method: "provider.operation.get", params: { operationId: OPERATION, consume: false } },
      { method: "provider.operation.get", params: { operationId: OPERATION, consume: true } },
    ]);
    assert.deepEqual(value.controls, []);
    await value.coordinator.poll(OWNER);
    assert.equal(value.calls.length, 3, "settled connections must not start or replay authentication");
  });
}

function failedModelsHarness(afterFailure, terminalState = "failed", responses = {}) {
  const terminal = operation({
    kind: "models", state: terminalState, revision: 2,
    error: {
      code: terminalState === "failed" ? "PROVIDER_MODELS_FAILED" : "PROVIDER_MODELS_CANCELLED",
      message: terminalState === "failed" ? "ChatGPT 모델 목록을 가져오지 못했습니다." : "ChatGPT 모델 목록 요청을 취소했습니다.",
    },
  });
  return {
    ...createHarness({
      "provider.status": [ok(status()), afterFailure],
      "provider.models.start": [ok(operation({ kind: "models" }))],
      "provider.operation.get": [ok(terminal), ok(terminal)],
      ...responses,
    }),
    terminal,
  };
}

test("an accepted models start invalidates the old catalog and selected model", async () => {
  const loaded = operation({ kind: "models", state: "succeeded", revision: 2, result: { models: [{ slug: "gpt-test", displayName: "GPT Test" }] } });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.models.start": [ok(operation({ kind: "models" })), ok(operation({ kind: "models", operationId: OWNER_2 }))],
    "provider.operation.get": [ok(loaded), ok(loaded)],
    "provider.model.select": [ok(status())],
  });
  await value.coordinator.refreshStatus(OWNER);
  await value.coordinator.start(OWNER, "models");
  await value.coordinator.poll(OWNER);
  await value.coordinator.select(OWNER, "gpt-test");
  assert.equal(value.coordinator.snapshot().models.length, 1);
  assert.equal(value.coordinator.snapshot().selectedModel.slug, "gpt-test");
  const pending = await value.coordinator.start(OWNER, "models");
  assert.equal(pending.catalog, "loading");
  assert.equal(pending.selectedModel, null);
  assert.deepEqual(pending.models, []);
  await assert.rejects(value.coordinator.select(OWNER, "gpt-test"), /진행 중/);
  assert.equal(value.calls.filter((call) => call.method === "provider.model.select").length, 1);
});

for (const terminalState of ["failed", "cancelled"]) {
  for (const connection of ["connected", "signed-out"]) {
    test(`${terminalState} models reconcile ${connection} without replacing the terminal error`, async () => {
      const catalog = connection === "connected" ? "not-loaded" : "unavailable";
      const value = failedModelsHarness(ok(status({ connection, catalog, selectedModel: null })), terminalState);
      await value.coordinator.refreshStatus(OWNER);
      await value.coordinator.start(OWNER, "models");
      const settled = await value.coordinator.poll(OWNER);
      assert.equal(settled.connection, connection);
      assert.equal(settled.catalog, catalog);
      assert.equal(settled.selectedModel, null);
      assert.deepEqual(settled.models, []);
      assert.equal(settled.operation, null);
      assert.deepEqual(settled.terminal, { kind: "models", state: terminalState, result: null, error: value.terminal.error });
      await assert.rejects(value.coordinator.select(OWNER, "gpt-test"), /모델 목록/);
      assert.deepEqual(value.calls.map((call) => call.method), [
        "provider.status", "provider.models.start", "provider.operation.get", "provider.operation.get", "provider.status",
      ]);
      assert.deepEqual(value.controls, []);
    });
  }
}

test("manual status recovery can reconcile a consumed models terminal without starting another job", async () => {
  const terminal = operation({ kind: "models", state: "failed", revision: 2, error: { code: "PROVIDER_MODELS_FAILED", message: "ChatGPT 모델 목록을 가져오지 못했습니다." } });
  const summary = { operationId: OPERATION, kind: "models", state: "failed", revision: 2, cancellable: false };
  const terminalStatus = status({ catalog: "not-loaded", selectedModel: null, active: summary });
  const value = createHarness({
    "provider.status": [ok(status()), ok(terminalStatus), ok(terminalStatus), ok(terminalStatus)],
    "provider.models.start": [ok(operation({ kind: "models" }))],
    "provider.operation.get": [ok(terminal), ok(terminal), ok(terminal), ok(terminal)],
  });
  await value.coordinator.refreshStatus(OWNER);
  await value.coordinator.start(OWNER, "models");
  const original = await value.coordinator.poll(OWNER);
  const refreshed = await value.coordinator.refreshStatus(OWNER);
  assert.deepEqual(refreshed.operation, summary, "Native still reports the consumed terminal summary");
  const recovered = await value.coordinator.poll(OWNER);
  assert.deepEqual(recovered.terminal, original.terminal);
  assert.equal(recovered.connection, "connected");
  assert.equal(recovered.catalog, "not-loaded");
  assert.equal(recovered.selectedModel, null);
  assert.equal(recovered.operation, null);
  assert.deepEqual(value.calls.filter((call) => call.method.endsWith(".start")).map((call) => call.method), ["provider.models.start"]);
  assert.deepEqual(value.controls, []);
});

for (const failure of [() => Promise.reject(new Error("private transport detail")), ok(status())]) {
  test(`unavailable or inconsistent post-models status settles fail closed (${typeof failure})`, async () => {
    const value = failedModelsHarness(failure);
    await value.coordinator.refreshStatus(OWNER);
    await value.coordinator.start(OWNER, "models");
    const settled = await value.coordinator.poll(OWNER);
    assert.equal(settled.connection, "unknown");
    assert.equal(settled.catalog, "unavailable");
    assert.equal(settled.selectedModel, null);
    assert.deepEqual(settled.models, []);
    assert.equal(settled.operation, null);
    assert.deepEqual(settled.terminal.error, value.terminal.error);
    assert.equal(JSON.stringify(settled).includes("private transport detail"), false);
    await assert.rejects(value.coordinator.select(OWNER, "gpt-test"), /모델 목록/);
    await value.coordinator.poll(OWNER);
    assert.equal(value.calls.length, 5, "status failure must not repeat model loading or authentication");
  });
}

test("models consume cannot clear state or read status after the owner changes", async () => {
  let resolveConsume;
  let consuming = false;
  const pendingConsume = new Promise((resolve) => { resolveConsume = resolve; });
  const value = failedModelsHarness(ok(status({ catalog: "not-loaded", selectedModel: null })), "failed", {
    "provider.operation.get": [() => ok(value.terminal), () => { consuming = true; return pendingConsume; }],
  });
  await value.coordinator.refreshStatus(OWNER);
  await value.coordinator.start(OWNER, "models");
  const pendingPoll = value.coordinator.poll(OWNER);
  const rejected = assert.rejects(pendingPoll, /이전/);
  for (let index = 0; index < 10 && !consuming; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(consuming, true);
  value.coordinator.detachOwner(OWNER);
  value.coordinator.attachOwner(OWNER_2);
  const replacement = value.coordinator.snapshot();
  resolveConsume(ok(value.terminal));
  await rejected;
  assert.deepEqual(value.coordinator.snapshot(), replacement);
  assert.equal(value.calls.filter((call) => call.method === "provider.status").length, 1);
});

for (const race of ["native-generation", "owner-swap", "operation-swap"]) {
  test(`post-models status cannot overwrite ${race}`, async () => {
    let resolveStatus;
    let statusRequested = false;
    const pendingStatus = new Promise((resolve) => { resolveStatus = resolve; });
    const value = failedModelsHarness(() => { statusRequested = true; return pendingStatus; }, "failed", {
      "provider.disconnect.start": [ok(operation({ kind: "disconnect", operationId: OWNER_2 }))],
    });
    await value.coordinator.refreshStatus(OWNER);
    await value.coordinator.start(OWNER, "models");
    const pendingPoll = value.coordinator.poll(OWNER);
    const rejected = assert.rejects(pendingPoll, /이전|일치/);
    for (let index = 0; index < 10 && !statusRequested; index += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(statusRequested, true);
    if (race === "native-generation") value.coordinator.invalidateRuntime(2);
    else if (race === "owner-swap") {
      value.coordinator.detachOwner(OWNER);
      value.coordinator.attachOwner(OWNER_2);
    } else await value.coordinator.start(OWNER, "disconnect");
    const replacement = value.coordinator.snapshot();
    resolveStatus(ok(status({ catalog: "not-loaded", selectedModel: null })));
    await rejected;
    assert.deepEqual(value.coordinator.snapshot(), replacement);
  });
}

test("null plan and explicit rejection release the held reservation without WTS handoff", async () => {
  const nullResult = { submissionId: SUBMISSION, catalogVersion: CATALOG, assistantText: "안녕하세요.", proposal: null };
  const value = createHarness({
    "provider.status": [ok(status()), ok(status())],
    "provider.plan.start": [ok(operation()), ok(operation({ operationId: "66666666-6666-4666-8666-666666666666" }))],
    "provider.operation.get": [
      ok(operation({ state: "succeeded", revision: 2, result: nullResult })),
      ok(operation({ state: "succeeded", revision: 2, result: nullResult })),
      ok(operation({ operationId: "66666666-6666-4666-8666-666666666666", state: "succeeded", revision: 2, result: { ...nullResult, proposal: { kind: "wts-control", text: "일봉으로" } } })),
      ok(operation({ operationId: "66666666-6666-4666-8666-666666666666", state: "succeeded", revision: 2, result: { ...nullResult, proposal: { kind: "wts-control", text: "일봉으로" } } })),
    ],
  });
  await value.coordinator.refreshStatus(OWNER);
  const first = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "인사" }, first, OWNER);
  await value.coordinator.poll(OWNER);
  assert.equal(first.released, 1);
  assert.deepEqual(value.controls, []);

  await value.coordinator.refreshStatus(OWNER);
  const second = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "일봉" }, second, OWNER);
  await value.coordinator.poll(OWNER);
  value.coordinator.reject(OWNER, { submissionId: SUBMISSION, catalogVersion: CATALOG });
  assert.equal(second.released, 1);
  assert.deepEqual(value.controls, []);
});

test("mismatched operation identity and stale revision are rejected before terminal consume", async () => {
  for (const terminal of [
    operation({ operationId: OWNER_2, state: "succeeded", revision: 2, result: null }),
    operation({ state: "running", revision: 0 }),
  ]) {
    const value = createHarness({
      "provider.status": [ok(status())],
      "provider.plan.start": [ok(operation())],
      "provider.operation.get": [ok(terminal)],
    });
    await value.coordinator.refreshStatus(OWNER);
    await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, reservation(), OWNER);
    await assert.rejects(value.coordinator.poll(OWNER), /식별자|이전|일치|올바르지/);
    assert.equal(value.calls.filter((call) => call.method === "provider.operation.get").length, 1);
    assert.deepEqual(value.controls, []);
  }
});

test("owner port closure cancels planning, fences execution, and a new owner may only reconcile cancellation", async () => {
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.cancel": [ok(operation({ state: "cancelling", revision: 2 }))],
    "provider.operation.get": [
      ok(operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } })),
      ok(operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } })),
    ],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  value.coordinator.detachOwner(OWNER);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(value.calls.some((call) => call.method === "provider.operation.cancel"), true);
  assert.equal(held.released, 0);
  value.coordinator.attachOwner(OWNER_2);
  await value.coordinator.poll(OWNER_2);
  assert.equal(held.released, 1);
  assert.deepEqual(value.controls, []);
});

test("owner closure completes cancellation and releases the gate even when the panel is not reopened", async () => {
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.cancel": [ok(operation({ state: "cancelling", revision: 2 }))],
    "provider.operation.get": [
      ok(operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } })),
      ok(operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } })),
    ],
  }, { setTimer: (callback) => queueMicrotask(callback) });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  value.coordinator.detachOwner(OWNER);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.deepEqual(value.controls, []);
});

test("owner closure retains the conversation gate when cancel transport and bounded reconciliation fail", async () => {
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.cancel": [() => Promise.reject(new Error("cancel transport failed"))],
    "provider.operation.get": [ok(operation()), ok(operation()), ok(operation()), ok(operation())],
  }, { setTimer: (callback) => queueMicrotask(callback) });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  value.coordinator.detachOwner(OWNER);
  for (let index = 0; index < 8; index += 1) await new Promise((resolve) => setImmediate(resolve));
  const snapshot = value.coordinator.snapshot();
  assert.equal(held.released, 0);
  assert.deepEqual(snapshot.operation, {
    operationId: OPERATION, kind: "plan", state: "running", revision: 1, cancellable: true,
  });
  assert.equal(snapshot.conversationPhase, "provider-planning");
  assert.equal(snapshot.ownerAttached, false);
  assert.match(snapshot.recoveryError, /상태를 자동으로 확인하지 못했습니다/);
  assert.equal(value.calls.filter((call) => call.method === "provider.operation.get").length, 4);
  assert.deepEqual(value.controls, []);
  value.coordinator.invalidateRuntime(2);
  assert.equal(held.released, 1);
});

test("owner closure while plan start is pending retains the gate and cancels once the operation identity arrives", async () => {
  let resolveStart;
  let resolveCancel;
  const delayedStart = new Promise((resolve) => { resolveStart = resolve; });
  const delayedCancel = new Promise((resolve) => { resolveCancel = resolve; });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [() => delayedStart],
    "provider.operation.cancel": [() => delayedCancel],
    "provider.operation.get": [
      ok(operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } })),
      ok(operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } })),
    ],
  }, { setTimer: (callback) => queueMicrotask(callback) });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  const pending = value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  value.coordinator.detachOwner(OWNER);
  assert.equal(held.released, 0);
  assert.equal(value.coordinator.snapshot().conversationPhase, "provider-planning");
  resolveStart(ok(operation()));
  const detached = await pending;
  assert.equal(detached.kind, "provider-detached");
  assert.equal(held.released, 0);
  assert.equal(value.coordinator.snapshot().operation.state, "running");
  resolveCancel(ok(operation({ state: "cancelling", revision: 2 })));
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.equal(value.coordinator.snapshot().proposal, null);
  assert.deepEqual(value.controls, []);
});

test("detached pending start known Native rejection releases its own reservation without creating an operation", async () => {
  let resolveStart;
  const delayedStart = new Promise((resolve) => { resolveStart = resolve; });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [() => delayedStart],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  const pending = value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  value.coordinator.detachOwner(OWNER);
  resolveStart({ ok: false, error: { code: "PROVIDER_PLAN_REJECTED", message: "start failed" } });
  await assert.rejects(pending, /start failed/);
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.equal(value.coordinator.snapshot().conversationPhase, "idle");
});

test("Native invalidation safely releases a detached pending start and fences its late acknowledgement", async () => {
  let resolveStart;
  const delayedStart = new Promise((resolve) => { resolveStart = resolve; });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [() => delayedStart],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  const pending = value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  value.coordinator.detachOwner(OWNER);
  value.coordinator.invalidateRuntime(2);
  assert.equal(held.released, 1);
  resolveStart(ok(operation()));
  await assert.rejects(pending, /작업 시작 응답/);
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.equal(value.coordinator.snapshot().conversationPhase, "idle");
});

test("owner port closure while awaiting confirmation invalidates proposal and releases without execution", async () => {
  const planResult = { submissionId: SUBMISSION, catalogVersion: CATALOG, assistantText: "제안", proposal: { kind: "wts-control", text: "월봉으로" } };
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.get": [ok(operation({ state: "succeeded", revision: 2, result: planResult })), ok(operation({ state: "succeeded", revision: 2, result: planResult }))],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "월봉" }, held, OWNER);
  await value.coordinator.poll(OWNER);
  value.coordinator.detachOwner(OWNER);
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().proposal, null);
  assert.deepEqual(value.controls, []);
});

test("owner closure during terminal consume keeps the exact job until consume then releases without proposal", async () => {
  let resolveConsume;
  const consume = new Promise((resolve) => { resolveConsume = resolve; });
  const planResult = { submissionId: SUBMISSION, catalogVersion: CATALOG, assistantText: "제안", proposal: { kind: "wts-control", text: "월봉으로" } };
  const terminal = operation({ state: "succeeded", revision: 2, result: planResult });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.get": [ok(terminal), () => consume],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "월봉" }, held, OWNER);
  const polling = value.coordinator.poll(OWNER);
  await new Promise((resolve) => setImmediate(resolve));
  value.coordinator.detachOwner(OWNER);
  assert.equal(held.released, 0);
  assert.equal(value.coordinator.snapshot().conversationPhase, "provider-planning");
  resolveConsume(ok(terminal));
  const settled = await polling;
  assert.equal(settled.terminal.state, "succeeded");
  assert.equal(held.released, 1);
  assert.equal(settled.proposal, null);
  assert.deepEqual(value.controls, []);
});

test("late panel cancel response cannot revive an operation settled by owner-detach cancellation", async () => {
  let resolvePanelCancel;
  const panelCancel = new Promise((resolve) => { resolvePanelCancel = resolve; });
  const cancelled = operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
    "provider.operation.cancel": [() => panelCancel, ok(operation({ state: "cancelling", revision: 2 }))],
    "provider.operation.get": [ok(cancelled), ok(cancelled)],
  }, { setTimer: (callback) => queueMicrotask(callback) });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER);
  const lateCancel = value.coordinator.cancelCurrent(OWNER);
  value.coordinator.detachOwner(OWNER);
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().operation, null);
  resolvePanelCancel(ok(operation({ state: "cancelling", revision: 2 })));
  await assert.rejects(lateCancel, /이전 ChatGPT 취소 응답/);
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.equal(value.coordinator.snapshot().conversationPhase, "idle");
});

test("new Native generation fences a late provider status response", async () => {
  let resolveStatus;
  const late = new Promise((resolve) => { resolveStatus = resolve; });
  const value = createHarness({ "provider.status": [() => late] });
  const pending = value.coordinator.refreshStatus(OWNER);
  value.coordinator.bindRuntime({ generation: 2, provider: providerMetadata });
  resolveStatus(ok(status()));
  await assert.rejects(pending, /현재 로컬 실행기 연결/);
});

test("late refresh cannot regress a newer explicit model selection", async () => {
  let resolveStatus;
  const delayedStatus = new Promise((resolve) => { resolveStatus = resolve; });
  const selected = { slug: "gpt-new", displayName: "GPT New", compatibility: "untested" };
  const value = createHarness({
    "provider.status": [ok(status()), () => delayedStatus],
    "provider.model.select": [ok(status({ selectedModel: selected }))],
  });
  await value.coordinator.refreshStatus(OWNER);
  const refreshing = value.coordinator.refreshStatus(OWNER);
  await value.coordinator.select(OWNER, selected.slug);
  resolveStatus(ok(status({ selectedModel: { slug: "gpt-old", displayName: "GPT Old", compatibility: "untested" } })));
  await assert.rejects(refreshing, /현재 로컬 실행기 연결/);
  assert.equal(value.coordinator.snapshot().selectedModel.slug, selected.slug);
});

test("new Native generation rejects a late start response before it can become current operation", async () => {
  let resolveStart;
  const late = new Promise((resolve) => { resolveStart = resolve; });
  const value = createHarness({ "provider.connect.start": [() => late] });
  const pending = value.coordinator.start(OWNER, "connect");
  value.coordinator.bindRuntime({ generation: 2, provider: providerMetadata });
  resolveStart(ok(operation({ kind: "connect" })));
  await assert.rejects(pending, /작업 시작 응답/);
  assert.equal(value.coordinator.snapshot().operation, null);
});

test("late plan start from an old Native generation cannot release the newer plan reservation", async () => {
  let resolveOldStart;
  const oldStart = new Promise((resolve) => { resolveOldStart = resolve; });
  const newerOperationId = "66666666-6666-4666-8666-666666666666";
  const value = createHarness({
    "provider.status": [ok(status()), ok(status())],
    "provider.plan.start": [() => oldStart, ok(operation({ operationId: newerOperationId }))],
  });
  await value.coordinator.refreshStatus(OWNER);
  const first = reservation();
  const oldPending = value.coordinator.startPlan({ submissionId: SUBMISSION, text: "old" }, first, OWNER);
  value.coordinator.bindRuntime({ generation: 2, provider: providerMetadata });
  assert.equal(first.released, 1);
  await value.coordinator.refreshStatus(OWNER);
  const second = reservation();
  const secondSubmission = "77777777-7777-4777-8777-777777777777";
  await value.coordinator.startPlan({ submissionId: secondSubmission, text: "new" }, second, OWNER);
  resolveOldStart(ok(operation()));
  await assert.rejects(oldPending, /작업 시작 응답/);
  const snapshot = value.coordinator.snapshot();
  assert.equal(first.released, 1);
  assert.equal(second.released, 0);
  assert.equal(snapshot.conversationPhase, "provider-planning");
  assert.equal(snapshot.operation.operationId, newerOperationId);
});

test("provider fallback requires the exact live owner retained with the plan", async () => {
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [ok(operation())],
  });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await assert.rejects(
    value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER_2),
    /소유자/,
  );
  assert.equal(held.released, 0);
  assert.equal(value.calls.some((call) => call.method === "provider.plan.start"), false);
});

test("plan start acknowledgement window blocks model selection and other provider starts", async () => {
  let resolveStart;
  const delayedStart = new Promise((resolve) => { resolveStart = resolve; });
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [() => delayedStart],
  });
  await value.coordinator.refreshStatus(OWNER);
  const pending = value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, reservation(), OWNER);
  await assert.rejects(value.coordinator.select(OWNER, "gpt-other"), /계획 작업/);
  await assert.rejects(value.coordinator.start(OWNER, "disconnect"), /계획 작업/);
  resolveStart(ok(operation()));
  await pending;
});

test("status-imported orphan plan terminal is read-only and cannot create confirmation authority", async () => {
  const orphanOperation = operation({ state: "running" });
  const planResult = { submissionId: SUBMISSION, catalogVersion: CATALOG, assistantText: "이전 응답", proposal: { kind: "wts-control", text: "월봉으로" } };
  const terminal = operation({ state: "succeeded", revision: 2, result: planResult });
  const value = createHarness({
    "provider.status": [ok(status({ active: orphanOperation }))],
    "provider.operation.get": [ok(terminal), ok(terminal)],
  });
  await value.coordinator.refreshStatus(OWNER);
  const settled = await value.coordinator.poll(OWNER);
  assert.equal(settled.terminal.result.assistantText, "이전 응답");
  assert.equal(settled.proposal, null);
  assert.equal(settled.conversationPhase, "idle");
  assert.deepEqual(value.controls, []);
  await assert.rejects(
    value.coordinator.confirm(OWNER, { submissionId: SUBMISSION, catalogVersion: CATALOG }),
    /실행 제안이 없거나/,
  );
});

test("panel router rejects forged owner and caller-supplied command text", async () => {
  const value = createHarness({});
  await assert.rejects(routeProviderPanelMessage({ type: "panel.provider.status", ownerId: OWNER_2 }, value.coordinator), /소유자/);
  assert.throws(() => routeProviderPanelMessage({ type: "panel.provider.confirm", ownerId: OWNER, submissionId: SUBMISSION, catalogVersion: CATALOG, command: "년봉으로" }, value.coordinator), /형식/);
});

test("conversation dispatcher remains deterministic-first and calls provider only for unsupported text", async () => {
  const gate = createSourceActivityGate();
  const providerCalls = [];
  const dispatcher = createConversationDispatcher({
    activityGate: gate,
    unsupportedMessage: "unsupported",
    validateConversationRoute: (value) => value,
    route: async (input) => input.text === "주봉으로"
      ? { kind: "wts-control", submissionId: input.submissionId, text: input.text }
      : { kind: "unsupported", submissionId: input.submissionId, message: "unsupported" },
    startControl: async ({ submissionId }) => ({ task: { id: "task", submissionId } }),
    searchSource: async () => { throw new Error("not used"); },
    describeSource: async () => { throw new Error("not used"); },
    startProvider: async (input, _reservation, ownerId) => { providerCalls.push({ input, ownerId }); return null; },
  });
  const deterministic = await dispatcher.submit({ submissionId: SUBMISSION, text: "주봉으로" });
  assert.equal(deterministic.kind, "control-task");
  assert.equal(providerCalls.length, 0);
  const unsupportedId = "77777777-7777-4777-8777-777777777777";
  const fallback = await dispatcher.submit({ submissionId: unsupportedId, text: "안녕" });
  assert.equal(fallback.kind, "unsupported");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].ownerId, null);
});

test("detached provider start remains internal and keeps the conversation reservation until coordinator settlement", async () => {
  const gate = createSourceActivityGate();
  let held = null;
  const dispatcher = createConversationDispatcher({
    activityGate: gate,
    unsupportedMessage: "unsupported",
    validateConversationRoute: (value) => value,
    route: async (input) => ({ kind: "unsupported", submissionId: input.submissionId, message: "unsupported" }),
    startControl: async () => { throw new Error("not used"); },
    searchSource: async () => { throw new Error("not used"); },
    describeSource: async () => { throw new Error("not used"); },
    startProvider: async (_input, reservationValue) => {
      held = reservationValue;
      return { kind: "provider-detached", submissionId: SUBMISSION };
    },
  });
  await assert.rejects(
    dispatcher.submit({ submissionId: SUBMISSION, text: "unsupported", ownerId: OWNER }),
    /실행 전에 취소/,
  );
  assert.equal(gate.conversationStatus().running, true);
  assert.equal(gate.conversationStatus().phase, "provider-planning");
  held.release();
  assert.equal(gate.conversationStatus().running, false);
});

test("dispatcher-to-service-worker provider adapter transfers the reservation before an unknown start timeout", async () => {
  const timeout = new Error("로컬 실행기 응답 시간이 초과되었습니다. 요청은 자동 재시도하지 않습니다.");
  const value = createHarness({
    "provider.status": [ok(status())],
    "provider.plan.start": [() => Promise.reject(timeout)],
  });
  await value.coordinator.refreshStatus(OWNER);
  const gate = createSourceActivityGate();
  const dispatcher = createConversationDispatcher({
    activityGate: gate,
    unsupportedMessage: "unsupported",
    validateConversationRoute: (result) => result,
    route: async (input) => ({ kind: "unsupported", submissionId: input.submissionId, message: "unsupported" }),
    startControl: async () => { throw new Error("not used"); },
    searchSource: async () => { throw new Error("not used"); },
    describeSource: async () => { throw new Error("not used"); },
    startProvider: (input, heldReservation, ownerId) => value.coordinator.startPlan(input, heldReservation, ownerId),
  });
  await assert.rejects(
    dispatcher.submit({ submissionId: SUBMISSION, text: "unsupported", ownerId: OWNER }),
    /응답 시간이 초과/,
  );
  assert.deepEqual(gate.conversationStatus(), { running: true, phase: "provider-planning" });
  assert.equal(value.coordinator.snapshot().conversationPhase, "provider-planning");
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.match(value.coordinator.snapshot().recoveryError, /응답 시간이 초과/);
  value.coordinator.invalidateRuntime(2);
  assert.deepEqual(gate.conversationStatus(), { running: false, phase: "idle" });
  assert.deepEqual(value.controls, []);
});

test("unknown start timeout reconciles through status and cancels the recovered detached operation", async () => {
  const timeout = new Error("로컬 실행기 응답 시간이 초과되었습니다. 요청은 자동 재시도하지 않습니다.");
  const cancelled = operation({ state: "cancelled", revision: 3, error: { code: "PROVIDER_PLAN_CANCELLED", message: "취소됨" } });
  const value = createHarness({
    "provider.status": [ok(status()), ok(status({ active: operation() }))],
    "provider.plan.start": [() => Promise.reject(timeout)],
    "provider.operation.cancel": [ok(operation({ state: "cancelling", revision: 2 }))],
    "provider.operation.get": [ok(cancelled), ok(cancelled)],
  }, { setTimer: (callback) => queueMicrotask(callback) });
  await value.coordinator.refreshStatus(OWNER);
  const held = reservation();
  await assert.rejects(
    value.coordinator.startPlan({ submissionId: SUBMISSION, text: "test" }, held, OWNER),
    /응답 시간이 초과/,
  );
  assert.equal(held.released, 0);
  await value.coordinator.refreshStatus(OWNER);
  for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(held.released, 1);
  assert.equal(value.coordinator.snapshot().operation, null);
  assert.equal(value.coordinator.snapshot().conversationPhase, "idle");
  assert.deepEqual(value.controls, []);
});

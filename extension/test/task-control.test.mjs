import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_ACTION_IDS,
  CONTROL_CATALOG_VERSION,
  LEGACY_CONTROL_CATALOG_VERSION,
  MARKET_NAVIGATE_ACTION_ID,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from "../../contracts/wts-foundation.mjs";
import { createTaskControlCoordinator, validateTaskJournal } from "../src/task-control.mjs";

const CATALOG = CONTROL_CATALOG_VERSION;
const LEGACY_CATALOG = LEGACY_CONTROL_CATALOG_VERSION;
const PREVIOUS_CATALOG = PREVIOUS_CONTROL_CATALOG_VERSION;
const OPEN = CHART_OPEN_ACTION_ID;
const PERIOD = CHART_PERIOD_SET_ACTION_ID;
const SITEMAP_OPEN = SITEMAP_OPEN_ACTION_ID;
const MARKET_NAVIGATE = MARKET_NAVIGATE_ACTION_ID;
const baseMs = Date.parse("2026-10-19T03:00:00.000Z");
const schema = JSON.parse(await readFile(resolve(import.meta.dirname, "../../contracts/wts-foundation.protocol.schema.json"), "utf8"));
const validator = createProtocolValidator(schema);

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function ids() {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

function observation(createId, state = {}) {
  const exactState = state.stateKind === "market-navigation"
    ? {
      stateKind: "market-navigation",
      screenId: "main-market-navigation",
      targetId: "market-menu-001",
      blocked: false,
      sitemapVisible: false,
      sitemapOpenEnabled: true,
      targetAvailable: false,
      activeTargetId: null,
      contextToken: "a".repeat(64),
      instrumentToken: "f".repeat(64),
      ...state,
    }
    : {
      screenId: "main-other",
      activeTab: "quote",
      period: "other",
      blocked: false,
      chartOpenEnabled: true,
      periodEnabled: true,
      contextToken: "a".repeat(64),
      instrumentToken: "f".repeat(64),
      ...state,
    };
  return {
    id: createId(),
    capturedAt: new Date(baseMs).toISOString(),
    source: {
      origin: "https://wts.kiwoom.com",
      path: "/",
      tabId: 7,
      windowId: 3,
      frameId: 0,
      documentId: "document-1",
    },
    state: exactState,
  };
}

function createRuntime(createId, stepSpecs = [
  { actionId: OPEN, args: {} },
  { actionId: PERIOD, args: { period: "week" } },
], options = {}) {
  const runtimeCatalog = options.catalogVersion || CATALOG;
  const tasks = new Map();
  const commits = [];
  const commitAttempts = [];
  const exactCommits = new Map();
  const exactCancels = new Map();
  const cancelAttempts = [];
  let startCalls = 0;
  let nextCalls = 0;
  let cancelCalls = 0;
  let beforeStart = null;
  let beforeCommit = null;
  let afterCancel = null;

  function clone(value) { return structuredClone(value); }
  function result(method, requestId, value) {
    return { protocolVersion: 4, requestId, method, ok: true, result: value };
  }
  function taskMessage(task) {
    if (task.status === "completed") return "모든 차트 작업을 완료했습니다.";
    if (task.status === "cancelled") return "사용자가 작업을 취소했습니다.";
    return "차트 작업을 진행합니다.";
  }
  function compilerForCatalog() {
    if (runtimeCatalog === LEGACY_CATALOG) {
      return { kind: "deterministic", id: "deterministic-korean-chart-v1", version: "1", generative: false, bundleHash: null };
    }
    if (runtimeCatalog === PREVIOUS_CATALOG) {
      return { kind: "deterministic", id: "deterministic-korean-chart-v2", version: "2", generative: false, bundleHash: null };
    }
    return { kind: "deterministic", id: "deterministic-korean-wts-v3", version: "3", generative: false, bundleHash: null };
  }
  function newTask(submissionId, text) {
    const task = {
      schemaVersion: 1,
      id: createId(),
      submissionId,
      revision: 1,
      createdAt: new Date(baseMs).toISOString(),
      updatedAt: new Date(baseMs).toISOString(),
      catalogVersion: runtimeCatalog,
      compiler: compilerForCatalog(),
      status: "ready",
      input: { text },
      cursor: 0,
      steps: stepSpecs.map((spec, index) => ({
        id: createId(),
        index,
        actionId: spec.actionId,
        args: spec.args,
        status: "pending",
        proposalId: null,
        receiptId: null,
      })),
      activeProposal: null,
      cancelRequested: false,
      message: "차트 작업을 시작합니다.",
    };
    tasks.set(task.id, task);
    return task;
  }

  async function request(method, params) {
    if (method === "control.task.start") {
      startCalls += 1;
      if (beforeStart) await beforeStart.promise;
      const task = newTask(params.submissionId, params.text);
      return { ok: true, result: { task: clone(task) } };
    }
    const task = tasks.get(params.taskId);
    if (!task) throw new Error("task missing");
    if (method === "control.task.get") return { ok: true, result: { task: clone(task) } };
    if (method === "control.task.next") {
      nextCalls += 1;
      assert.equal(params.expectedRevision, task.revision);
      assert.equal(task.status, "ready");
      const step = task.steps[task.cursor];
      if (options.satisfyStep?.(step, params.observation) === true) {
        step.status = "satisfied";
        task.cursor += 1;
        task.revision += 1;
        task.status = task.cursor === task.steps.length ? "completed" : "ready";
        task.message = taskMessage(task);
        return { ok: true, result: {
          task: clone(task),
          outcome: { status: task.status, message: task.message, proposal: null },
        } };
      }
      const proposal = {
        id: createId(),
        catalogVersion: runtimeCatalog,
        observation: params.observation,
        actionId: step.actionId,
        args: step.args,
        expiresAt: new Date(baseMs + 5_000).toISOString(),
      };
      step.status = "awaiting_receipt";
      step.proposalId = proposal.id;
      task.activeProposal = proposal;
      task.status = "awaiting_receipt";
      task.revision += 1;
      return { ok: true, result: {
        task: clone(task),
        outcome: { status: "proposed", message: "실행 제안", proposal: clone(proposal) },
      } };
    }
    if (method === "control.task.step.commit") {
      const key = JSON.stringify(params);
      commitAttempts.push(key);
      if (exactCommits.has(key)) return { ok: true, result: clone(exactCommits.get(key)) };
      if (beforeCommit) await beforeCommit(params);
      const proposal = task.activeProposal;
      assert.ok(proposal);
      assert.equal(params.stepId, task.steps[task.cursor].id);
      assert.equal(params.receipt.proposalId, proposal.id);
      if (task.status === "cancel_requested") {
        assert.equal(params.expectedRevision, task.revision - 1);
      } else {
        assert.equal(params.expectedRevision, task.revision);
      }
      const step = task.steps[task.cursor];
      step.receiptId = params.receipt.id;
      step.status = params.receipt.status;
      task.activeProposal = null;
      task.revision += 1;
      if (params.receipt.status === "verified") {
        task.cursor += 1;
        task.status = task.cancelRequested
          ? "cancelled"
          : task.cursor === task.steps.length ? "completed" : "ready";
      } else if (params.receipt.status === "cancelled") {
        task.status = "cancelled";
      } else {
        task.status = params.receipt.status === "blocked" ? "blocked" : "unverified";
      }
      task.message = taskMessage(task);
      commits.push(clone(params));
      const value = { task: clone(task), receiptId: params.receipt.id, stored: true };
      exactCommits.set(key, value);
      return { ok: true, result: clone(value) };
    }
    if (method === "control.task.cancel") {
      cancelCalls += 1;
      const key = JSON.stringify(params);
      cancelAttempts.push(key);
      if (exactCancels.has(key)) return { ok: true, result: clone(exactCancels.get(key)) };
      if (["completed", "cancelled", "blocked", "unsupported", "unverified"].includes(task.status)) {
        const value = { task: clone(task) };
        exactCancels.set(key, value);
        return { ok: true, result: value };
      }
      assert.equal(params.expectedRevision, task.revision);
      task.cancelRequested = true;
      task.revision += 1;
      if (task.status === "ready") task.status = "cancelled";
      else task.status = "cancel_requested";
      task.message = taskMessage(task);
      const value = { task: clone(task) };
      exactCancels.set(key, value);
      if (afterCancel) await afterCancel(params, value);
      return { ok: true, result: clone(value) };
    }
    throw new Error(`unexpected ${method}`);
  }

  return {
    request,
    tasks,
    commits,
    commitAttempts,
    cancelAttempts,
    counts: () => ({ startCalls, nextCalls, cancelCalls }),
    delayStart() { beforeStart = deferred(); return beforeStart; },
    setBeforeCommit(value) { beforeCommit = value; },
    setAfterCancel(value) { afterCancel = value; },
  };
}

function fixture(options = {}) {
  const createId = ids();
  const runtime = options.runtime || createRuntime(createId, options.steps);
  let journal = options.journal;
  let screen = { screenId: "main-other", activeTab: "quote", period: "other" };
  let observations = 0;
  const observedActions = [];
  let clicks = 0;
  const errors = [];
  const changes = [];
  const observationGate = options.observationGate || null;
  const clickGate = options.clickGate || null;
  const coordinator = createTaskControlCoordinator({
    now: () => baseMs + 100,
    wait: options.wait || (async () => {}),
    createId,
    request: runtime.request,
    observeCurrent: async (action) => {
      observations += 1;
      observedActions.push(structuredClone(action));
      if (observationGate && observations === observationGate.at) await observationGate.gate.promise;
      if (options.beforeObserve) screen = options.beforeObserve(observations, screen, action) || screen;
      if ([SITEMAP_OPEN, MARKET_NAVIGATE].includes(action?.actionId) && (
        screen.stateKind !== "market-navigation" || screen.targetId !== action.args.targetId
      )) {
        screen = {
          stateKind: "market-navigation",
          screenId: "main-market-navigation",
          targetId: action.args.targetId,
          blocked: false,
          sitemapVisible: false,
          sitemapOpenEnabled: true,
          targetAvailable: false,
          activeTargetId: null,
        };
      } else if ([OPEN, PERIOD].includes(action?.actionId) && screen.stateKind === "market-navigation") {
        screen = { screenId: "main-other", activeTab: "quote", period: "other" };
      }
      return observation(createId, screen);
    },
    executeOnce: async (proposal) => {
      clicks += 1;
      if (clickGate) await clickGate.promise;
      if (proposal.actionId === OPEN) screen = { screenId: "main-chart", activeTab: "chart", period: "day" };
      if (proposal.actionId === PERIOD) screen = { screenId: "main-chart", activeTab: "chart", period: proposal.args.period };
      if (proposal.actionId === SITEMAP_OPEN) screen = {
        stateKind: "market-navigation",
        screenId: "main-market-navigation",
        targetId: proposal.args.targetId,
        blocked: false,
        sitemapVisible: true,
        sitemapOpenEnabled: false,
        targetAvailable: true,
        activeTargetId: null,
      };
      if (proposal.actionId === MARKET_NAVIGATE) screen = {
        stateKind: "market-navigation",
        screenId: "main-market-navigation",
        targetId: proposal.args.targetId,
        blocked: false,
        sitemapVisible: false,
        sitemapOpenEnabled: true,
        targetAvailable: false,
        activeTargetId: proposal.args.targetId,
      };
      if (options.afterExecute) screen = options.afterExecute(proposal, screen) || screen;
      return { observation: observation(createId, screen), acted: true, reason: null };
    },
    observeSameDocument: options.observeSameDocument || (async (_source, action) => {
      observedActions.push(structuredClone(action));
      return observation(createId, screen);
    }),
    loadState: options.loadState || (async () => structuredClone(journal)),
    saveState: options.saveState || (async (value) => {
      journal = structuredClone(value);
      if (options.afterSave) await options.afterSave(value);
    }),
    validateControlTask: validator.validateControlTask,
    validateControlObservation: validator.validateControlObservation,
    validateControlProposal: validator.validateControlProposal,
    validateControlReceipt: validator.validateControlReceipt,
    catalogVersion: CATALOG,
    retiredCatalogVersions: [LEGACY_CATALOG, PREVIOUS_CATALOG],
    actionIds: CONTROL_ACTION_IDS,
    chartOpenActionId: OPEN,
    periodSetActionId: PERIOD,
    sitemapOpenActionId: SITEMAP_OPEN,
    marketNavigateActionId: MARKET_NAVIGATE,
    postconditionTimeoutMs: 20,
    pollIntervalMs: 1,
    onTaskError: (error) => errors.push(error),
    onTaskChange: (task) => changes.push(structuredClone(task)),
  });
  return {
    coordinator,
    runtime,
    createId,
    counts: () => ({ observations, clicks }),
    observedActions,
    journal: () => structuredClone(journal),
    errors,
    changes,
  };
}

async function waitForIdle(coordinator) {
  for (let index = 0; index < 100 && coordinator.running(); index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(coordinator.running(), false);
}

async function seedRetiredReady(runtime, createId, text = "차트 열고 주봉으로", catalogVersion = LEGACY_CATALOG) {
  const started = (await runtime.request("control.task.start", {
    submissionId: createId(),
    text,
  })).result.task;
  const stored = runtime.tasks.get(started.id);
  stored.catalogVersion = catalogVersion;
  stored.compiler = catalogVersion === LEGACY_CATALOG
    ? { kind: "deterministic", id: "deterministic-korean-chart-v1", version: "1", generative: false, bundleHash: null }
    : { kind: "deterministic", id: "deterministic-korean-chart-v2", version: "2", generative: false, bundleHash: null };
  return structuredClone(stored);
}

const seedLegacyReady = seedRetiredReady;

test("compound task observes and clicks each step once, then clears dispatch", async () => {
  const value = fixture();
  const sent = await value.coordinator.send("차트 열고 주봉으로");
  assert.equal(sent.task.status, "ready");
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.deepEqual(value.errors.map((error) => ({ message: error.message, issues: error.issues })), []);
  assert.equal(task.status, "completed");
  assert.deepEqual(task.steps.map((step) => step.status), ["verified", "verified"]);
  assert.deepEqual(value.counts(), { observations: 2, clicks: 2 });
  assert.equal(value.runtime.commits.length, 2);
  assert.equal(value.journal().dispatch, null);
});

test("satisfied chart and market steps each receive a fresh action-scoped observation", async () => {
  const steps = [
    { actionId: OPEN, args: {} },
    { actionId: SITEMAP_OPEN, args: { targetId: "market-menu-001" } },
    { actionId: MARKET_NAVIGATE, args: { targetId: "market-menu-001" } },
  ];
  const createId = ids();
  const runtime = createRuntime(createId, steps, {
    satisfyStep: (step) => [OPEN, SITEMAP_OPEN].includes(step.actionId),
  });
  const value = fixture({ runtime, steps });
  await value.coordinator.send("차트와 시장 메뉴");
  await waitForIdle(value.coordinator);
  assert.deepEqual(value.errors.map((error) => error.issues || error.message), []);
  assert.equal((await value.coordinator.get()).task.status, "completed");
  assert.deepEqual(value.observedActions.slice(0, 3), steps);
  assert.equal(value.counts().observations, 3);
  assert.equal(value.counts().clicks, 1);
});

test("a stale ready response without exact one-step progress stops before dispatch", async () => {
  const createId = ids();
  const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }]);
  const original = runtime.request;
  runtime.request = async (method, params) => {
    if (method !== "control.task.next") return original(method, params);
    const task = structuredClone(runtime.tasks.get(params.taskId));
    return { ok: true, result: { task, outcome: { status: "ready", message: task.message, proposal: null } } };
  };
  const value = fixture({ runtime, steps: [{ actionId: OPEN, args: {} }] });
  await value.coordinator.send("차트 열어줘");
  await waitForIdle(value.coordinator);
  assert.equal(value.counts().clicks, 0);
  assert.match(value.errors.at(-1).message, /정확히 한 단계 전진/);
});

test("a satisfied-step response cannot switch from the current catalog before the next observation", async () => {
  const createId = ids();
  const steps = [
    { actionId: OPEN, args: {} },
    { actionId: PERIOD, args: { period: "week" } },
  ];
  const runtime = createRuntime(createId, steps, { satisfyStep: (step) => step.actionId === OPEN });
  const original = runtime.request;
  runtime.request = async (method, params) => {
    const response = await original(method, params);
    if (method === "control.task.next" && response.result?.outcome?.status === "ready") {
      response.result.task.catalogVersion = PREVIOUS_CATALOG;
      response.result.task.compiler = {
        kind: "deterministic",
        id: "deterministic-korean-chart-v2",
        version: "2",
        generative: false,
        bundleHash: null,
      };
    }
    return response;
  };
  const value = fixture({ runtime, steps });
  await value.coordinator.send("차트 열고 주봉으로");
  await waitForIdle(value.coordinator);
  assert.deepEqual(value.counts(), { observations: 1, clicks: 0 });
  assert.match(value.errors.at(-1).message, /정확히 한 단계 전진/);
});

test("concurrent sends share one start and one background execution", async () => {
  const value = fixture();
  const gate = value.runtime.delayStart();
  const first = value.coordinator.send("차트 열어줘");
  const second = value.coordinator.send("차트 열어줘");
  assert.equal(first, second);
  gate.resolve();
  await first;
  await waitForIdle(value.coordinator);
  assert.equal(value.runtime.counts().startCalls, 1);
  assert.equal(value.counts().clicks, 2);
});

test("an explicit conversation submission id is passed unchanged to durable task start", async () => {
  const value = fixture({ steps: [{ actionId: OPEN, args: {} }] });
  const submissionId = "00000000-0000-4000-8000-999999999999";
  const { task } = await value.coordinator.send("차트 열어줘", submissionId);
  assert.equal(task.submissionId, submissionId);
  await waitForIdle(value.coordinator);
});

test("concurrent sends reject different text while an exact input shares one start", async () => {
  const value = fixture();
  const gate = value.runtime.delayStart();
  const first = value.coordinator.send("차트 열어줘");
  const same = value.coordinator.send("차트 열어줘");
  assert.equal(first, same);
  await assert.rejects(value.coordinator.send("주봉으로"), /다른 WTS 대화 작업/);
  gate.resolve();
  await first;
  await waitForIdle(value.coordinator);
  assert.equal(value.runtime.counts().startCalls, 1);
});

test("cancel while a new task start is pending cancels that task before observation or dispatch", async () => {
  const value = fixture({ steps: [{ actionId: OPEN, args: {} }] });
  const gate = value.runtime.delayStart();
  const sending = value.coordinator.send("차트 열어줘");
  while (value.runtime.counts().startCalls < 1) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = value.coordinator.cancel();
  gate.resolve();
  const [sendResult, cancelResult] = await Promise.all([sending, cancelling]);
  await waitForIdle(value.coordinator);
  assert.equal(sendResult.task.status, "cancelled");
  assert.equal(cancelResult.task.status, "cancelled");
  assert.equal(cancelResult.task.id, sendResult.task.id);
  assert.deepEqual(value.runtime.counts(), { startCalls: 1, nextCalls: 0, cancelCalls: 1 });
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
});

test("cancel between steps stops the whole task before another click", async () => {
  const gate = deferred();
  const value = fixture({ observationGate: { at: 2, gate } });
  await value.coordinator.send("차트 열고 주봉으로");
  while (value.counts().observations < 2) await new Promise((resolve) => setImmediate(resolve));
  const cancelled = value.coordinator.cancel();
  gate.resolve();
  await cancelled;
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
});

test("cancel after verified sitemap open commits no market target click", async () => {
  const gate = deferred();
  const steps = [
    { actionId: SITEMAP_OPEN, args: { targetId: "market-menu-001" } },
    { actionId: MARKET_NAVIGATE, args: { targetId: "market-menu-001" } },
  ];
  const value = fixture({ steps, observationGate: { at: 2, gate } });
  await value.coordinator.send("시장 메뉴 열어줘: 시세분석 > 급등락");
  while (value.counts().observations < 2) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = value.coordinator.cancel();
  gate.resolve();
  await cancelling;
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
  assert.equal(value.runtime.commits.length, 1);
  assert.equal(value.runtime.commits[0].receipt.actionId, SITEMAP_OPEN);
});

test("cancel during a click finishes that receipt and starts no next step", async () => {
  const clickGate = deferred();
  const value = fixture({ clickGate });
  await value.coordinator.send("차트 열고 주봉으로");
  while (value.counts().clicks < 1) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = value.coordinator.cancel();
  clickGate.resolve();
  const cancelled = await cancelling;
  assert.equal(cancelled.task.status, "cancel_requested");
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
  assert.equal(value.runtime.commits.length, 1);
});

test("cancel during post-click wait records one unverified receipt without another observation", async () => {
  const waitEntered = deferred();
  const releaseWait = deferred();
  const pollId = ids();
  let polls = 0;
  const value = fixture({
    steps: [{ actionId: PERIOD, args: { period: "week" } }],
    beforeObserve: () => ({ screenId: "main-chart", activeTab: "chart", period: "day" }),
    afterExecute: () => ({ screenId: "main-chart", activeTab: "chart", period: "day" }),
    wait: async () => {
      waitEntered.resolve();
      await releaseWait.promise;
    },
    observeSameDocument: async () => {
      polls += 1;
      return observation(pollId, { screenId: "main-chart", activeTab: "chart", period: "day" });
    },
  });
  await value.coordinator.send("주봉으로");
  await waitEntered.promise;
  const cancelling = value.coordinator.cancel();
  releaseWait.resolve();
  await cancelling;
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 1);
  assert.equal(polls, 0);
  assert.equal(value.runtime.commits.length, 1);
  assert.equal(value.runtime.commits[0].receipt.status, "unverified");
  assert.equal(value.runtime.commits[0].receipt.reason, "POSTCONDITION_TIMEOUT");
});

test("cancel during a post-click observation stops after that observation without another poll", async () => {
  const observationEntered = deferred();
  const releaseObservation = deferred();
  const pollId = ids();
  let polls = 0;
  const value = fixture({
    steps: [{ actionId: PERIOD, args: { period: "week" } }],
    beforeObserve: () => ({ screenId: "main-chart", activeTab: "chart", period: "day" }),
    afterExecute: () => ({ screenId: "main-chart", activeTab: "chart", period: "day" }),
    observeSameDocument: async () => {
      polls += 1;
      observationEntered.resolve();
      await releaseObservation.promise;
      return observation(pollId, { screenId: "main-chart", activeTab: "chart", period: "week" });
    },
  });
  await value.coordinator.send("주봉으로");
  await observationEntered.promise;
  const cancelling = value.coordinator.cancel();
  releaseObservation.resolve();
  await cancelling;
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 1);
  assert.equal(polls, 1);
  assert.equal(value.runtime.commits.length, 1);
  assert.equal(value.runtime.commits[0].receipt.status, "unverified");
  assert.equal(value.runtime.commits[0].receipt.reason, "POSTCONDITION_TIMEOUT");
});

test("lost cancel reply retries the exact cancellation wrapper without changing revision", async () => {
  const clickGate = deferred();
  const value = fixture({ clickGate });
  let replies = 0;
  value.runtime.setAfterCancel(async () => {
    replies += 1;
    if (replies === 1) throw new Error("cancel reply lost");
  });
  await value.coordinator.send("차트 열고 주봉으로");
  while (value.counts().clicks < 1) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = value.coordinator.cancel();
  clickGate.resolve();
  const result = await cancelling;
  assert.equal(result.task.status, "cancel_requested");
  assert.equal(value.runtime.cancelAttempts.length, 2);
  assert.equal(value.runtime.cancelAttempts[0], value.runtime.cancelAttempts[1]);
  await waitForIdle(value.coordinator);
  assert.equal((await value.coordinator.get()).task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
});

test("commit-pending cancellation reconciles ready and submits a fresh cancellation wrapper", async () => {
  const createId = ids();
  const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }]);
  const started = (await runtime.request("control.task.start", {
    submissionId: createId(),
    text: "차트 열어줘",
  })).result.task;
  const originalRequest = runtime.request;
  const attempts = [];
  let cancellationAttempt = 0;
  runtime.request = async (method, params) => {
    if (method !== "control.task.cancel") return originalRequest(method, params);
    attempts.push(structuredClone(params));
    cancellationAttempt += 1;
    if (cancellationAttempt === 1) {
      const task = runtime.tasks.get(params.taskId);
      task.revision = 4;
      task.status = "ready";
      task.cancelRequested = false;
      return { ok: false, error: { code: "TASK_COMMIT_PENDING", message: "commit pending" } };
    }
    if (cancellationAttempt === 2) {
      return { ok: false, error: { code: "TASK_REVISION_CONFLICT", message: "revision changed" } };
    }
    return originalRequest(method, params);
  };
  const value = fixture({
    runtime,
    steps: [{ actionId: OPEN, args: {} }],
    journal: { version: 1, activeTaskId: started.id, dispatch: null },
  });
  const { task } = await value.coordinator.cancel();
  assert.equal(task.status, "cancelled");
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[1], attempts[0]);
  assert.equal(attempts[2].expectedRevision, 4);
  assert.notEqual(attempts[2].cancellationId, attempts[0].cancellationId);
  assert.equal(value.counts().clicks, 0);
});

test("cancel after arming but before execute records a cancelled receipt without clicking", async () => {
  const armed = deferred();
  const release = deferred();
  const value = fixture({
    steps: [{ actionId: OPEN, args: {} }],
    afterSave: async (journal) => {
      if (journal.dispatch?.state === "armed") {
        armed.resolve();
        await release.promise;
      }
    },
  });
  await value.coordinator.send("차트 열어줘");
  await armed.promise;
  const cancelling = value.coordinator.cancel();
  release.resolve();
  await cancelling;
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 0);
  assert.equal(value.runtime.commits[0].receipt.status, "cancelled");
  assert.equal(value.runtime.commits[0].receipt.reason, "CANCELLED");
});

test("restart with armed dispatch records uncertainty and never clicks", async () => {
  const createId = ids();
  const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }]);
  const started = (await runtime.request("control.task.start", { submissionId: createId(), text: "차트 열어줘" })).result.task;
  const before = observation(createId);
  const proposed = (await runtime.request("control.task.next", { taskId: started.id, expectedRevision: started.revision, observation: before })).result.task;
  const proposal = proposed.activeProposal;
  const value = fixture({
    runtime,
    steps: [{ actionId: OPEN, args: {} }],
    journal: {
      version: 1,
      activeTaskId: proposed.id,
      dispatch: {
        state: "armed",
        taskId: proposed.id,
        stepId: proposed.steps[0].id,
        expectedRevision: proposed.revision,
        proposal,
      },
    },
  });
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 0);
  assert.equal(runtime.commits[0].receipt.reason, "EXECUTION_ERROR");
  assert.equal(value.journal().dispatch, null);
});

test("restart with an armed market dispatch records the exact action without clicking", async () => {
  const createId = ids();
  const steps = [{ actionId: SITEMAP_OPEN, args: { targetId: "market-menu-001" } }];
  const runtime = createRuntime(createId, steps);
  const started = (await runtime.request("control.task.start", { submissionId: createId(), text: "시장 메뉴" })).result.task;
  const before = observation(createId, {
    stateKind: "market-navigation",
    targetId: "market-menu-001",
    sitemapVisible: false,
  });
  const proposed = (await runtime.request("control.task.next", {
    taskId: started.id,
    expectedRevision: started.revision,
    observation: before,
  })).result.task;
  const value = fixture({
    runtime,
    steps,
    journal: {
      version: 1,
      activeTaskId: proposed.id,
      dispatch: {
        state: "armed",
        taskId: proposed.id,
        stepId: proposed.steps[0].id,
        expectedRevision: proposed.revision,
        proposal: proposed.activeProposal,
      },
    },
  });
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 0);
  assert.equal(runtime.commits[0].receipt.actionId, SITEMAP_OPEN);
  assert.deepEqual(runtime.commits[0].receipt.args, { targetId: "market-menu-001" });
});

test("restart after server proposal but before armed journal reconciles without clicking", async () => {
  const createId = ids();
  const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }]);
  const started = (await runtime.request("control.task.start", { submissionId: createId(), text: "차트 열어줘" })).result.task;
  const proposed = (await runtime.request("control.task.next", {
    taskId: started.id,
    expectedRevision: started.revision,
    observation: observation(createId),
  })).result.task;
  const value = fixture({
    runtime,
    journal: { version: 1, activeTaskId: proposed.id, dispatch: null },
  });
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 0);
  assert.equal(runtime.commits.length, 1);
  assert.equal(runtime.commits[0].expectedRevision, proposed.revision);
  assert.equal(runtime.commits[0].receipt.reason, "EXECUTION_ERROR");
});

test("cancel-requested recovery without a journal uses the original proposal revision", async () => {
  const createId = ids();
  const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }]);
  const started = (await runtime.request("control.task.start", { submissionId: createId(), text: "차트 열어줘" })).result.task;
  const proposed = (await runtime.request("control.task.next", {
    taskId: started.id,
    expectedRevision: started.revision,
    observation: observation(createId),
  })).result.task;
  const cancelled = (await runtime.request("control.task.cancel", {
    taskId: proposed.id,
    expectedRevision: proposed.revision,
    cancellationId: createId(),
  })).result.task;
  assert.equal(cancelled.status, "cancel_requested");
  const value = fixture({
    runtime,
    journal: { version: 1, activeTaskId: cancelled.id, dispatch: null },
  });
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 0);
  assert.equal(runtime.commits[0].expectedRevision, cancelled.revision - 1);
});

test("compound task stops before a later step when the instrument context changes", async () => {
  const value = fixture({
    beforeObserve: (count, screen) => count === 2
      ? { ...screen, instrumentToken: "e".repeat(64) }
      : screen,
  });
  await value.coordinator.send("차트 열고 주봉으로");
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
  assert.equal(value.runtime.counts().nextCalls, 1);
  assert.match(value.errors.at(-1).message, /종목이 바뀌어/);
});

test("receipt pending retry reuses the exact wrapper and never clicks again", async () => {
  const value = fixture({ steps: [{ actionId: OPEN, args: {} }] });
  let attempts = 0;
  value.runtime.setBeforeCommit(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("native disconnected");
  });
  await value.coordinator.send("차트 열어줘");
  await waitForIdle(value.coordinator);
  const pending = value.journal().dispatch;
  assert.equal(pending.state, "receipt_pending");
  const exact = JSON.stringify(pending.wrapper);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "completed");
  assert.equal(value.counts().clicks, 1);
  assert.equal(attempts, 2);
  assert.equal(JSON.stringify(pending.wrapper), exact);
  assert.equal(value.journal().dispatch, null);
});

test("a restart does not auto-resume a clean ready next step", async () => {
  const createId = ids();
  const runtime = createRuntime(createId);
  const started = (await runtime.request("control.task.start", {
    submissionId: createId(),
    text: "차트 열고 주봉으로",
  })).result.task;
  const before = observation(createId);
  const proposed = (await runtime.request("control.task.next", {
    taskId: started.id,
    expectedRevision: started.revision,
    observation: before,
  })).result.task;
  const receipt = {
    id: createId(),
    proposalId: proposed.activeProposal.id,
    catalogVersion: CATALOG,
    actionId: OPEN,
    args: {},
    before,
    after: observation(createId, { screenId: "main-chart", activeTab: "chart", period: "day" }),
    status: "verified",
    reason: "POSTCONDITION_MET",
    completedAt: new Date(baseMs + 100).toISOString(),
  };
  const ready = (await runtime.request("control.task.step.commit", {
    taskId: proposed.id,
    stepId: proposed.steps[0].id,
    expectedRevision: proposed.revision,
    receipt,
  })).result.task;
  assert.equal(ready.status, "ready");
  const value = fixture({
    runtime,
    journal: { version: 1, activeTaskId: ready.id, dispatch: null },
  });
  const result = await value.coordinator.get();
  assert.equal(result.task.status, "ready");
  assert.equal(result.task.cursor, 1);
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
  assert.equal(runtime.counts().nextCalls, 1);
});

test("get and reconcile leave a clean legacy ready task readable without retiring or resuming it", async () => {
  const createId = ids();
  const runtime = createRuntime(createId);
  const legacy = await seedLegacyReady(runtime, createId);
  const value = fixture({
    runtime,
    journal: { version: 1, activeTaskId: legacy.id, dispatch: null },
  });
  assert.equal((await value.coordinator.get()).task.status, "ready");
  assert.equal((await value.coordinator.reconcile()).task.status, "ready");
  assert.deepEqual(runtime.counts(), { startCalls: 1, nextCalls: 0, cancelCalls: 0 });
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
});

test("fresh send retires catalog 1 and catalog 2 ready tasks through exact cancellation", async () => {
  for (const retiredCatalog of [LEGACY_CATALOG, PREVIOUS_CATALOG]) {
    const createId = ids();
    const runtime = createRuntime(createId);
    const legacy = await seedRetiredReady(runtime, createId, "차트 열고 주봉으로", retiredCatalog);
    const value = fixture({
      runtime,
      journal: { version: 1, activeTaskId: legacy.id, dispatch: null },
    });
    const sent = await value.coordinator.send("월봉으로");
    assert.equal(sent.task.catalogVersion, CATALOG);
    assert.equal(sent.task.input.text, "월봉으로");
    assert.deepEqual(runtime.counts(), { startCalls: 2, nextCalls: 1, cancelCalls: 1 });
    const cancelledIndex = value.changes.findIndex((task) => task.id === legacy.id && task.status === "cancelled");
    const currentIndex = value.changes.findIndex((task) => task.id === sent.task.id && task.catalogVersion === CATALOG);
    assert.equal(cancelledIndex >= 0, true);
    assert.equal(currentIndex > cancelledIndex, true);
    await waitForIdle(value.coordinator);
  }
});

test("legacy retirement retries one stable cancellation wrapper after a lost reply", async () => {
  const createId = ids();
  const runtime = createRuntime(createId);
  const legacy = await seedLegacyReady(runtime, createId);
  let replies = 0;
  runtime.setAfterCancel(async () => {
    replies += 1;
    if (replies === 1) throw new Error("cancel reply lost");
  });
  const value = fixture({
    runtime,
    journal: { version: 1, activeTaskId: legacy.id, dispatch: null },
  });
  await value.coordinator.send("년봉으로");
  assert.equal(runtime.cancelAttempts.length, 2);
  assert.equal(runtime.cancelAttempts[0], runtime.cancelAttempts[1]);
  assert.equal(runtime.counts().startCalls, 2);
  await waitForIdle(value.coordinator);
});

test("unresolved legacy cancellation conflict or pending commit starts no current task and clicks nothing", async () => {
  for (const code of ["TASK_REVISION_CONFLICT", "TASK_COMMIT_PENDING"]) {
    const createId = ids();
    const runtime = createRuntime(createId);
    const legacy = await seedLegacyReady(runtime, createId);
    const original = runtime.request;
    runtime.request = async (method, params) => method === "control.task.cancel"
      ? { ok: false, error: { code, message: code } }
      : original(method, params);
    const value = fixture({
      runtime,
      journal: { version: 1, activeTaskId: legacy.id, dispatch: null },
    });
    await assert.rejects(value.coordinator.send("월봉으로"), new RegExp(code));
    assert.equal(runtime.counts().startCalls, 1);
    assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
  }
});

test("user cancellation during legacy retirement shares the cancellation and prevents the new start", async () => {
  const createId = ids();
  const runtime = createRuntime(createId);
  const legacy = await seedLegacyReady(runtime, createId);
  const entered = deferred();
  const release = deferred();
  runtime.setAfterCancel(async () => {
    entered.resolve();
    await release.promise;
  });
  const value = fixture({
    runtime,
    journal: { version: 1, activeTaskId: legacy.id, dispatch: null },
  });
  const sending = value.coordinator.send("년봉으로");
  await entered.promise;
  const cancelling = value.coordinator.cancel();
  release.resolve();
  const [sendResult, cancelResult] = await Promise.all([sending, cancelling]);
  assert.equal(sendResult.task.status, "cancelled");
  assert.equal(cancelResult.task.status, "cancelled");
  assert.equal(runtime.counts().startCalls, 1);
  assert.equal(runtime.cancelAttempts.length, 1);
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
});

test("legacy armed, unjournaled, and receipt-pending recovery preserve the proposal catalog and never click", async () => {
  for (const recovery of ["armed", "unjournaled", "receipt_pending"]) {
    const createId = ids();
    const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }], {
      catalogVersion: LEGACY_CATALOG,
    });
    const started = (await runtime.request("control.task.start", {
      submissionId: createId(),
      text: "차트 열어줘",
    })).result.task;
    const proposed = (await runtime.request("control.task.next", {
      taskId: started.id,
      expectedRevision: started.revision,
      observation: observation(createId),
    })).result.task;
    let dispatch = null;
    if (recovery === "armed") {
      dispatch = {
        state: "armed",
        taskId: proposed.id,
        stepId: proposed.steps[0].id,
        expectedRevision: proposed.revision,
        proposal: proposed.activeProposal,
      };
    } else if (recovery === "receipt_pending") {
      const receipt = validator.validateControlReceipt({
        id: createId(),
        proposalId: proposed.activeProposal.id,
        catalogVersion: LEGACY_CATALOG,
        actionId: OPEN,
        args: {},
        before: proposed.activeProposal.observation,
        after: null,
        status: "unverified",
        reason: "EXECUTION_ERROR",
        completedAt: new Date(baseMs + 100).toISOString(),
      });
      dispatch = {
        state: "receipt_pending",
        wrapper: {
          method: "control.task.step.commit",
          params: {
            taskId: proposed.id,
            stepId: proposed.steps[0].id,
            expectedRevision: proposed.revision,
            receipt,
          },
        },
      };
    }
    const exactPending = dispatch?.state === "receipt_pending" ? JSON.stringify(dispatch.wrapper) : null;
    const value = fixture({
      runtime,
      journal: { version: 1, activeTaskId: proposed.id, dispatch },
    });
    const result = await value.coordinator.get();
    assert.equal(result.task.status, "unverified", recovery);
    assert.equal(runtime.commits[0].receipt.catalogVersion, LEGACY_CATALOG, recovery);
    if (exactPending) assert.equal(runtime.commitAttempts[0], JSON.stringify(JSON.parse(exactPending).params));
    assert.deepEqual(value.counts(), { observations: 0, clicks: 0 }, recovery);
  }
});

test("current execution rejects a legacy or task-mismatched proposal before clicking", async () => {
  for (const mutate of ["legacy", "mismatch"]) {
    const createId = ids();
    const runtime = createRuntime(createId, [{ actionId: OPEN, args: {} }]);
    const original = runtime.request;
    runtime.request = async (method, params) => {
      const response = await original(method, params);
      if (method === "control.task.next" && response.ok) {
        if (mutate === "legacy") {
          response.result.task.catalogVersion = LEGACY_CATALOG;
          response.result.task.compiler = {
            kind: "deterministic",
            id: "deterministic-korean-chart-v1",
            version: "1",
            generative: false,
            bundleHash: null,
          };
          response.result.task.activeProposal.catalogVersion = LEGACY_CATALOG;
          response.result.outcome.proposal.catalogVersion = LEGACY_CATALOG;
        } else {
          response.result.outcome.proposal = {
            ...response.result.outcome.proposal,
            id: "00000000-0000-4000-8000-999999999999",
          };
        }
      }
      return response;
    };
    const value = fixture({ runtime });
    await value.coordinator.send("차트 열어줘");
    await waitForIdle(value.coordinator);
    assert.equal(value.counts().clicks, 0, mutate);
    assert.match(value.errors.at(-1).message, /계약이 일치|현재 작업 단계|실행 제안 진행 상태/, mutate);
  }
});

test("commit acknowledgement followed by clear failure retries only the exact commit", async () => {
  let journal;
  let failClear = true;
  const value = fixture({
    steps: [{ actionId: OPEN, args: {} }],
    loadState: async () => structuredClone(journal),
    saveState: async (next) => {
      if (failClear && next.dispatch === null && journal?.dispatch?.state === "receipt_pending") {
        throw new Error("clear failed");
      }
      journal = structuredClone(next);
    },
  });
  await value.coordinator.send("차트 열어줘");
  await waitForIdle(value.coordinator);
  assert.equal(value.counts().clicks, 1);
  assert.equal(value.runtime.commits.length, 1);
  assert.equal(journal.dispatch.state, "receipt_pending");
  const exact = JSON.stringify(journal.dispatch.wrapper);
  failClear = false;
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "completed");
  assert.equal(value.counts().clicks, 1);
  assert.equal(value.runtime.commits.length, 1);
  assert.deepEqual(value.runtime.commitAttempts.slice(-2), [
    JSON.stringify(JSON.parse(exact).params),
    JSON.stringify(JSON.parse(exact).params),
  ]);
  assert.equal(journal.dispatch, null);
});

test("a failed armed journal write never clicks or advances the task", async () => {
  let writes = 0;
  const value = fixture({
    steps: [{ actionId: OPEN, args: {} }],
    saveState: async () => {
      writes += 1;
      if (writes >= 2) throw new Error("storage unavailable");
    },
  });
  await value.coordinator.send("차트 열어줘");
  await waitForIdle(value.coordinator);
  assert.equal(value.counts().clicks, 0);
  assert.equal(value.runtime.commits.length, 0);
});

test("journal validation rejects unknown and incomplete dispatch states", () => {
  assert.deepEqual(validateTaskJournal(undefined), { version: 1, activeTaskId: null, dispatch: null });
  assert.throws(() => validateTaskJournal({ version: 1, activeTaskId: null, dispatch: { state: "unknown" } }), /실행 상태/);
  assert.throws(() => validateTaskJournal({ version: 1, activeTaskId: null, dispatch: { state: "armed" } }), /준비 기록/);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_ACTION_IDS,
  CONTROL_CATALOG_VERSION,
  LEGACY_CONTROL_CATALOG_VERSION,
  MARKET_NAVIGATE_ACTION_ID,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  PROTOCOL_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from "../../contracts/wts-foundation.mjs";
import { ControlPlanner } from "../../local-runtime/src/control-planner.mjs";
import { createRequestHandler } from "../../local-runtime/src/host.mjs";
import { ReceiptStore } from "../../local-runtime/src/receipt-store.mjs";
import { TaskEngine } from "../../local-runtime/src/task-engine.mjs";
import { TaskStore } from "../../local-runtime/src/task-store.mjs";
import { createTaskControlCoordinator } from "../src/task-control.mjs";

const schema = JSON.parse(await readFile(
  new URL("../../contracts/wts-foundation.protocol.schema.json", import.meta.url),
  "utf8",
));
const validator = createProtocolValidator(schema);
const BASE_MS = Date.parse("2026-10-19T03:00:00.000Z");

function idFactory(start = 0) {
  let value = start;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function controlObservation(createId, screen) {
  return {
    id: createId(),
    capturedAt: new Date(BASE_MS).toISOString(),
    source: {
      origin: "https://wts.kiwoom.com",
      path: "/",
      tabId: 7,
      windowId: 3,
      frameId: 0,
      documentId: screen.documentId ?? "document-1",
    },
    state: {
      screenId: screen.screenId,
      activeTab: screen.activeTab,
      period: screen.period,
      blocked: false,
      chartOpenEnabled: screen.screenId === "main-other",
      periodEnabled: screen.screenId === "main-chart",
      contextToken: "a".repeat(64),
      instrumentToken: screen.instrumentToken ?? "f".repeat(64),
    },
  };
}

async function createDataRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "athena-wts-task-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function actualRuntime(
  root,
  createId,
  intercept = async (_method, _params, response) => response,
  options = {},
) {
  const planner = new ControlPlanner({ now: () => BASE_MS, createId });
  const receiptStore = options.receiptStore
    ?? new ReceiptStore(root, validator.validateControlReceipt);
  const taskStore = new TaskStore(
    root,
    validator.validateControlTask,
    validator.validateControlReceipt,
  );
  const taskEngine = new TaskEngine({
    planner,
    taskStore,
    receiptStore,
    validateTask: validator.validateControlTask,
    validateReceipt: validator.validateControlReceipt,
    now: () => BASE_MS,
    createId,
  });
  const handle = createRequestHandler({
    validator,
    store: null,
    planner,
    receiptStore,
    taskEngine,
    runtimeVersion: "0.5.0",
  });
  let cancelHandle = null;
  if (options.separateCancelEngine) {
    const cancelTaskStore = new TaskStore(
      root,
      validator.validateControlTask,
      validator.validateControlReceipt,
    );
    const cancelEngine = new TaskEngine({
      planner,
      taskStore: cancelTaskStore,
      receiptStore,
      validateTask: validator.validateControlTask,
      validateReceipt: validator.validateControlReceipt,
      now: () => BASE_MS,
      createId,
    });
    cancelHandle = createRequestHandler({
      validator,
      store: null,
      planner,
      receiptStore,
      taskEngine: cancelEngine,
      runtimeVersion: "0.5.0",
    });
  }
  let requestNumber = 0;
  return {
    async request(method, params) {
      const response = await (method === "control.task.cancel" && cancelHandle ? cancelHandle : handle)({
        protocolVersion: PROTOCOL_VERSION,
        requestId: `integration-${String(++requestNumber).padStart(4, "0")}`,
        method,
        params,
      });
      return intercept(method, structuredClone(params), response);
    },
  };
}

function coordinatorFixture({
  root,
  createId,
  journal: initialJournal,
  initialScreen,
  intercept,
  beforeObserve,
  beforeClick,
  afterSave,
  receiptStore,
  separateCancelEngine,
}) {
  let journal = structuredClone(initialJournal);
  let screen = {
    screenId: "main-other",
    activeTab: "quote",
    period: "none",
    instrumentToken: "f".repeat(64),
    ...initialScreen,
  };
  let observations = 0;
  let clicks = 0;
  const errors = [];
  const runtime = actualRuntime(root, createId, intercept, { receiptStore, separateCancelEngine });
  const coordinator = createTaskControlCoordinator({
    now: () => BASE_MS + 100,
    wait: async () => {},
    createId,
    request: runtime.request,
    observeCurrent: async () => {
      observations += 1;
      if (beforeObserve) screen = await beforeObserve(observations, structuredClone(screen)) ?? screen;
      return controlObservation(createId, screen);
    },
    executeOnce: async (proposal) => {
      clicks += 1;
      if (beforeClick) await beforeClick(clicks, proposal);
      if (proposal.actionId === CHART_OPEN_ACTION_ID) {
        screen = { ...screen, screenId: "main-chart", activeTab: "chart", period: "day" };
      } else if (proposal.actionId === CHART_PERIOD_SET_ACTION_ID) {
        screen = { ...screen, screenId: "main-chart", activeTab: "chart", period: proposal.args.period };
      }
      return { observation: controlObservation(createId, screen), acted: true, reason: null };
    },
    observeSameDocument: async () => controlObservation(createId, screen),
    loadState: async () => structuredClone(journal),
    saveState: async (value) => {
      journal = structuredClone(value);
      if (afterSave) await afterSave(structuredClone(value));
    },
    validateControlTask: validator.validateControlTask,
    validateControlObservation: validator.validateControlObservation,
    validateControlProposal: validator.validateControlProposal,
    validateControlReceipt: validator.validateControlReceipt,
    catalogVersion: CONTROL_CATALOG_VERSION,
    retiredCatalogVersions: [LEGACY_CONTROL_CATALOG_VERSION, PREVIOUS_CONTROL_CATALOG_VERSION],
    actionIds: CONTROL_ACTION_IDS,
    chartOpenActionId: CHART_OPEN_ACTION_ID,
    periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
    sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
    marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
    postconditionTimeoutMs: 20,
    pollIntervalMs: 1,
    onTaskError: (error) => errors.push(error),
  });
  return {
    coordinator,
    runtime,
    counts: () => ({ observations, clicks }),
    journal: () => structuredClone(journal),
    errors,
  };
}

async function waitForIdle(coordinator) {
  const deadline = Date.now() + 2_000;
  while (coordinator.running() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(coordinator.running(), false, "coordinator should become idle");
}

async function receiptCount(root) {
  try {
    return (await readdir(path.join(root, "receipts"))).filter((name) => name.endsWith(".json")).length;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

async function sha256File(filePath) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function legacyCompiler() {
  return {
    kind: "deterministic",
    id: "deterministic-korean-chart-v1",
    version: "1",
    generative: false,
    bundleHash: null,
  };
}

function legacyReadyRecord(createId) {
  const taskId = createId();
  const openStepId = createId();
  const weekStepId = createId();
  const proposalId = createId();
  const receiptId = createId();
  const before = controlObservation(createId, {
    screenId: "main-other",
    activeTab: "quote",
    period: "none",
  });
  const after = controlObservation(createId, {
    screenId: "main-chart",
    activeTab: "chart",
    period: "day",
  });
  const receipt = {
    id: receiptId,
    proposalId,
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    actionId: CHART_OPEN_ACTION_ID,
    args: {},
    before,
    after,
    status: "verified",
    reason: "POSTCONDITION_MET",
    completedAt: new Date(BASE_MS + 50).toISOString(),
  };
  const task = {
    schemaVersion: 1,
    id: taskId,
    submissionId: taskId,
    revision: 3,
    createdAt: new Date(BASE_MS).toISOString(),
    updatedAt: new Date(BASE_MS + 50).toISOString(),
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    compiler: legacyCompiler(),
    status: "ready",
    input: { text: "차트 열고 주봉으로" },
    cursor: 1,
    steps: [
      {
        id: openStepId,
        index: 0,
        actionId: CHART_OPEN_ACTION_ID,
        args: {},
        status: "verified",
        proposalId,
        receiptId,
      },
      {
        id: weekStepId,
        index: 1,
        actionId: CHART_PERIOD_SET_ACTION_ID,
        args: { period: "week" },
        status: "pending",
        proposalId: null,
        receiptId: null,
      },
    ],
    activeProposal: null,
    cancelRequested: false,
    message: "다음 작업을 실행하려면 화면을 다시 확인합니다.",
  };
  return {
    task,
    receipt,
    record: {
      schemaVersion: 1,
      task,
      binding: {
        tabId: before.source.tabId,
        windowId: before.source.windowId,
        documentId: before.source.documentId,
        instrumentToken: before.state.instrumentToken,
      },
      commits: [{ stepId: openStepId, expectedRevision: 2, receipt }],
      cancellations: [],
      pendingCommit: null,
    },
  };
}

function legacyAwaitingRecord(createId, { pendingCommit = false } = {}) {
  const taskId = createId();
  const stepId = createId();
  const proposalId = createId();
  const before = controlObservation(createId, {
    screenId: "main-other",
    activeTab: "quote",
    period: "none",
  });
  const proposal = {
    id: proposalId,
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    observation: before,
    actionId: CHART_OPEN_ACTION_ID,
    args: {},
    expiresAt: new Date(BASE_MS + 5_000).toISOString(),
  };
  const task = {
    schemaVersion: 1,
    id: taskId,
    submissionId: taskId,
    revision: pendingCommit ? 3 : 2,
    createdAt: new Date(BASE_MS).toISOString(),
    updatedAt: new Date(BASE_MS).toISOString(),
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    compiler: legacyCompiler(),
    status: "awaiting_receipt",
    input: { text: "차트 열어줘" },
    cursor: 0,
    steps: [{
      id: stepId,
      index: 0,
      actionId: CHART_OPEN_ACTION_ID,
      args: {},
      status: "awaiting_receipt",
      proposalId,
      receiptId: null,
    }],
    activeProposal: proposal,
    cancelRequested: false,
    message: "현재 종목의 차트 화면을 여는 동작을 제안했습니다.",
  };
  const receipt = {
    id: createId(),
    proposalId,
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    actionId: CHART_OPEN_ACTION_ID,
    args: {},
    before,
    after: null,
    status: "unverified",
    reason: "EXECUTION_ERROR",
    completedAt: new Date(BASE_MS + 100).toISOString(),
  };
  return {
    task,
    proposal,
    receipt,
    stepId,
    record: {
      schemaVersion: 1,
      task,
      binding: {
        tabId: before.source.tabId,
        windowId: before.source.windowId,
        documentId: before.source.documentId,
        instrumentToken: before.state.instrumentToken,
      },
      commits: [],
      cancellations: [],
      pendingCommit: pendingCommit
        ? { stepId, expectedRevision: 2, receipt }
        : null,
    },
  };
}

async function persistTaskRecord(root, record) {
  const taskStore = new TaskStore(
    root,
    validator.validateControlTask,
    validator.validateControlReceipt,
  );
  const initial = structuredClone(record);
  initial.task.revision = 1;
  initial.task.updatedAt = initial.task.createdAt;
  initial.task.status = "ready";
  initial.task.cursor = 0;
  initial.task.steps = initial.task.steps.map((step) => ({
    ...step,
    status: "pending",
    proposalId: null,
    receiptId: null,
  }));
  initial.task.activeProposal = null;
  initial.task.cancelRequested = false;
  initial.task.message = `${initial.task.steps.length}개 차트 작업을 로컬 규칙으로 확인했습니다.`;
  initial.binding = null;
  initial.commits = [];
  initial.cancellations = [];
  initial.pendingCommit = null;
  await taskStore.create(initial);
  if (record.task.revision === 1) return initial;

  if (record.task.revision === 2) return taskStore.update(record, 1);

  const intermediate = structuredClone(record);
  intermediate.task.revision = 2;
  intermediate.task.updatedAt = new Date(BASE_MS).toISOString();
  intermediate.pendingCommit = null;
  intermediate.commits = [];
  if (record.commits.length > 0) {
    const committed = record.commits[0];
    const step = intermediate.task.steps.find((item) => item.id === committed.stepId);
    step.status = "awaiting_receipt";
    step.receiptId = null;
    intermediate.task.status = "awaiting_receipt";
    intermediate.task.cursor = step.index;
    intermediate.task.activeProposal = {
      id: committed.receipt.proposalId,
      catalogVersion: committed.receipt.catalogVersion,
      observation: committed.receipt.before,
      actionId: committed.receipt.actionId,
      args: committed.receipt.args,
      expiresAt: new Date(BASE_MS + 5_000).toISOString(),
    };
    intermediate.task.message = "현재 종목의 차트 화면을 여는 동작을 제안했습니다.";
  }
  await taskStore.update(intermediate, 1);
  return taskStore.update(record, 2);
}

test("compound open and week task persists two verified receipts", async (t) => {
  const root = await createDataRoot(t);
  const value = coordinatorFixture({ root, createId: idFactory() });

  await value.coordinator.send("차트 열고 주봉으로");
  await waitForIdle(value.coordinator);

  const { task } = await value.coordinator.get();
  assert.equal(task.status, "completed");
  assert.deepEqual(task.steps.map((step) => step.status), ["verified", "verified"]);
  assert.deepEqual(value.counts(), { observations: 2, clicks: 2 });
  assert.equal(await receiptCount(root), 2);
});

test("current quote to chart to month task persists both verified transitions", async (t) => {
  const root = await createDataRoot(t);
  const value = coordinatorFixture({ root, createId: idFactory() });

  await value.coordinator.send("차트 열고 월봉으로");
  await waitForIdle(value.coordinator);

  const { task } = await value.coordinator.get();
  assert.equal(task.catalogVersion, CONTROL_CATALOG_VERSION);
  assert.equal(task.status, "completed");
  assert.deepEqual(task.steps.map((step) => step.status), ["verified", "verified"]);
  assert.deepEqual(value.counts(), { observations: 2, clicks: 2 });
  assert.equal(await receiptCount(root), 2);
});

test("current month to year compound satisfies month and clicks year once", async (t) => {
  const root = await createDataRoot(t);
  const value = coordinatorFixture({
    root,
    createId: idFactory(),
    initialScreen: {
      screenId: "main-chart",
      activeTab: "chart",
      period: "month",
    },
  });

  await value.coordinator.send("월봉으로 바꾸고 년봉으로");
  await waitForIdle(value.coordinator);

  const { task } = await value.coordinator.get();
  assert.equal(task.status, "completed");
  assert.deepEqual(task.steps.map((step) => step.status), ["satisfied", "verified"]);
  assert.deepEqual(value.counts(), { observations: 2, clicks: 1 });
  assert.equal(await receiptCount(root), 1);
});

test("unknown whole input produces an unsupported task without clicking", async (t) => {
  const root = await createDataRoot(t);
  const value = coordinatorFixture({ root, createId: idFactory() });

  const { task } = await value.coordinator.send("차트 열어줘 빨리");
  await waitForIdle(value.coordinator);

  assert.equal(task.status, "unsupported");
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
  assert.equal(await receiptCount(root), 0);
});

test("negative whole input produces an unsupported task without clicking", async (t) => {
  const root = await createDataRoot(t);
  const value = coordinatorFixture({ root, createId: idFactory() });

  const { task } = await value.coordinator.send("차트 열지 마");
  await waitForIdle(value.coordinator);

  assert.equal(task.status, "unsupported");
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
  assert.equal(await receiptCount(root), 0);
});

test("cancellation after the month click prevents the year click", async (t) => {
  const root = await createDataRoot(t);
  const secondObservation = deferred();
  const value = coordinatorFixture({
    root,
    createId: idFactory(),
    initialScreen: { screenId: "main-chart", activeTab: "chart", period: "day" },
    beforeObserve: async (count, screen) => {
      if (count === 2) await secondObservation.promise;
      return screen;
    },
  });

  await value.coordinator.send("월봉으로 바꾸고 년봉으로");
  while (value.counts().observations < 2) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = value.coordinator.cancel();
  secondObservation.resolve();
  await cancelling;
  await waitForIdle(value.coordinator);

  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
  assert.equal(await receiptCount(root), 1);
});

test("month commit claim winning the cancel race still prevents the year click", async (t) => {
  const root = await createDataRoot(t);
  const recordEntered = deferred();
  const releaseRecord = deferred();
  const pendingSeen = deferred();
  const releasePendingResponse = deferred();
  const storedReceipts = new ReceiptStore(root, validator.validateControlReceipt);
  const receiptStore = {
    async record(receipt) {
      recordEntered.resolve();
      await releaseRecord.promise;
      return storedReceipts.record(receipt);
    },
  };
  const value = coordinatorFixture({
    root,
    createId: idFactory(),
    initialScreen: { screenId: "main-chart", activeTab: "chart", period: "day" },
    receiptStore,
    separateCancelEngine: true,
    intercept: async (method, _params, response) => {
      if (
        method === "control.task.cancel"
        && response.ok === false
        && response.error.code === "TASK_COMMIT_PENDING"
      ) {
        pendingSeen.resolve();
        await releasePendingResponse.promise;
      }
      return response;
    },
  });

  await value.coordinator.send("월봉으로 바꾸고 년봉으로");
  await recordEntered.promise;
  const cancelling = value.coordinator.cancel();
  await pendingSeen.promise;
  releaseRecord.resolve();
  releasePendingResponse.resolve();

  const cancelled = await cancelling;
  assert.equal(cancelled.task.status, "cancelled");
  await waitForIdle(value.coordinator);
  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
  assert.equal(await receiptCount(root), 1);
});

test("restart after a lost next response records uncertainty without clicking", async (t) => {
  const root = await createDataRoot(t);
  let loseNext = true;
  const first = coordinatorFixture({
    root,
    createId: idFactory(),
    intercept: async (method, _params, response) => {
      if (method === "control.task.next" && loseNext) {
        loseNext = false;
        throw new Error("native response lost");
      }
      return response;
    },
  });
  await first.coordinator.send("차트 열어줘");
  await waitForIdle(first.coordinator);
  assert.equal(first.counts().clicks, 0);

  const restarted = coordinatorFixture({
    root,
    createId: idFactory(1_000),
    journal: first.journal(),
  });
  const { task } = await restarted.coordinator.get();

  assert.equal(task.status, "unverified");
  assert.equal(restarted.counts().clicks, 0);
  assert.equal(await receiptCount(root), 1);
});

test("restart with an armed journal records uncertainty without repeating the click", async (t) => {
  const root = await createDataRoot(t);
  const createId = idFactory();
  const runtime = actualRuntime(root, createId);
  const submissionId = createId();
  const started = (await runtime.request("control.task.start", {
    submissionId,
    text: "차트 열어줘",
  })).result.task;
  const proposed = (await runtime.request("control.task.next", {
    taskId: started.id,
    expectedRevision: started.revision,
    observation: controlObservation(createId, {
      screenId: "main-other",
      activeTab: "quote",
      period: "none",
    }),
  })).result.task;
  const restarted = coordinatorFixture({
    root,
    createId: idFactory(1_000),
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

  const { task } = await restarted.coordinator.get();

  assert.equal(task.status, "unverified");
  assert.equal(restarted.counts().clicks, 0);
  assert.equal(await receiptCount(root), 1);
});

test("fresh send retires a legacy ready task before starting the current task", async (t) => {
  const root = await createDataRoot(t);
  const legacy = legacyReadyRecord(idFactory());
  await persistTaskRecord(root, legacy.record);
  const legacyReceiptStore = new ReceiptStore(root, validator.validateControlReceipt);
  await legacyReceiptStore.record(legacy.receipt);
  const legacyRevisionPath = path.join(root, "tasks", `${legacy.task.id}.3.json`);
  const legacyReceiptPath = path.join(root, "receipts", `${legacy.receipt.id}.json`);
  const revisionHash = await sha256File(legacyRevisionPath);
  const receiptHash = await sha256File(legacyReceiptPath);
  const value = coordinatorFixture({
    root,
    createId: idFactory(1_000),
    journal: { version: 1, activeTaskId: legacy.task.id, dispatch: null },
    initialScreen: { screenId: "main-chart", activeTab: "chart", period: "day" },
  });

  await value.coordinator.send("월봉으로");
  await waitForIdle(value.coordinator);

  const { task: current } = await value.coordinator.get();
  const retired = (await value.runtime.request("control.task.get", {
    taskId: legacy.task.id,
  })).result.task;
  assert.equal(retired.catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(retired.status, "cancelled");
  assert.equal(retired.revision, 4);
  assert.equal(current.catalogVersion, CONTROL_CATALOG_VERSION);
  assert.equal(current.status, "completed");
  assert.equal(value.counts().clicks, 1);
  assert.equal(await sha256File(legacyRevisionPath), revisionHash);
  assert.equal(await sha256File(legacyReceiptPath), receiptHash);
});

test("legacy armed recovery preserves its catalog and never replays the click", async (t) => {
  const root = await createDataRoot(t);
  const legacy = legacyAwaitingRecord(idFactory());
  await persistTaskRecord(root, legacy.record);
  const value = coordinatorFixture({
    root,
    createId: idFactory(1_000),
    journal: {
      version: 1,
      activeTaskId: legacy.task.id,
      dispatch: {
        state: "armed",
        taskId: legacy.task.id,
        stepId: legacy.stepId,
        expectedRevision: 2,
        proposal: legacy.proposal,
      },
    },
  });

  const { task } = await value.coordinator.get();

  assert.equal(task.catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 0);
  const storedReceipt = JSON.parse(await readFile(
    path.join(root, "receipts", `${task.steps[0].receiptId}.json`),
    "utf8",
  ));
  assert.equal(storedReceipt.catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
});

test("legacy pending commit recovery preserves its exact receipt without replaying the click", async (t) => {
  const root = await createDataRoot(t);
  const legacy = legacyAwaitingRecord(idFactory(), { pendingCommit: true });
  await persistTaskRecord(root, legacy.record);
  const wrapper = {
    method: "control.task.step.commit",
    params: {
      taskId: legacy.task.id,
      stepId: legacy.stepId,
      expectedRevision: 2,
      receipt: legacy.receipt,
    },
  };
  const value = coordinatorFixture({
    root,
    createId: idFactory(1_000),
    journal: {
      version: 1,
      activeTaskId: legacy.task.id,
      dispatch: { state: "receipt_pending", wrapper },
    },
  });

  const { task } = await value.coordinator.get();

  assert.equal(task.catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(task.status, "unverified");
  assert.equal(value.counts().clicks, 0);
  assert.equal(await receiptCount(root), 1);
  const storedReceipt = JSON.parse(await readFile(
    path.join(root, "receipts", `${legacy.receipt.id}.json`),
    "utf8",
  ));
  assert.deepEqual(storedReceipt, legacy.receipt);
});

test("instrument context change between steps prevents a wrong-target click", async (t) => {
  const root = await createDataRoot(t);
  const value = coordinatorFixture({
    root,
    createId: idFactory(),
    beforeObserve: async (count, screen) => count === 2
      ? { ...screen, instrumentToken: "e".repeat(64) }
      : screen,
  });

  await value.coordinator.send("차트 열고 주봉으로");
  await waitForIdle(value.coordinator);

  const { task } = await value.coordinator.get();
  assert.equal(task.status, "cancelled");
  assert.equal(value.counts().clicks, 1);
  assert.match(value.errors.at(-1).message, /종목이 바뀌어/u);
});

test("month commit retry after reply loss is idempotent and never repeats the click", async (t) => {
  const root = await createDataRoot(t);
  const commitParams = [];
  let loseCommit = true;
  const first = coordinatorFixture({
    root,
    createId: idFactory(),
    initialScreen: { screenId: "main-chart", activeTab: "chart", period: "day" },
    intercept: async (method, params, response) => {
      if (method === "control.task.step.commit") {
        commitParams.push(JSON.stringify(params));
        if (loseCommit) {
          loseCommit = false;
          throw new Error("commit reply lost");
        }
      }
      return response;
    },
  });
  await first.coordinator.send("월봉으로");
  await waitForIdle(first.coordinator);
  assert.equal(first.counts().clicks, 1);
  assert.equal(first.journal().dispatch.state, "receipt_pending");

  const restarted = coordinatorFixture({
    root,
    createId: idFactory(1_000),
    journal: first.journal(),
    intercept: async (method, params, response) => {
      if (method === "control.task.step.commit") commitParams.push(JSON.stringify(params));
      return response;
    },
  });
  const { task } = await restarted.coordinator.get();

  assert.equal(task.status, "completed");
  assert.equal(restarted.counts().clicks, 0);
  assert.equal(await receiptCount(root), 1);
  assert.equal(commitParams.length, 2);
  assert.equal(commitParams[1], commitParams[0]);
  assert.equal(restarted.journal().dispatch, null);
});

test("month receipt persistence failure recovers after restart without repeating the click", async (t) => {
  const root = await createDataRoot(t);
  const storedReceipts = new ReceiptStore(root, validator.validateControlReceipt);
  let failRecord = true;
  const failingReceiptStore = {
    async record(receipt) {
      if (failRecord) {
        failRecord = false;
        throw new Error("receipt storage unavailable");
      }
      return storedReceipts.record(receipt);
    },
  };
  const first = coordinatorFixture({
    root,
    createId: idFactory(),
    initialScreen: { screenId: "main-chart", activeTab: "chart", period: "day" },
    receiptStore: failingReceiptStore,
  });
  await first.coordinator.send("월봉으로");
  await waitForIdle(first.coordinator);
  assert.equal(first.counts().clicks, 1);
  assert.equal(first.journal().dispatch.state, "receipt_pending");
  assert.equal(await receiptCount(root), 0);

  const restarted = coordinatorFixture({
    root,
    createId: idFactory(1_000),
    journal: first.journal(),
  });
  const { task } = await restarted.coordinator.get();

  assert.equal(task.status, "completed");
  assert.equal(restarted.counts().clicks, 0);
  assert.equal(await receiptCount(root), 1);
  assert.equal(restarted.journal().dispatch, null);
});

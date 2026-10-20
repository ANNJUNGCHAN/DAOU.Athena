import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONVERSATION_UNSUPPORTED_MESSAGE,
  CONTROL_ACTION_IDS,
  CONTROL_CATALOG_VERSION,
  LEGACY_CONTROL_CATALOG_VERSION,
  MARKET_NAVIGATE_ACTION_ID,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  PROTOCOL_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  SOURCE_API_VERSION,
  SOURCE_PROFILE,
  createProtocolValidator,
} from "../../contracts/wts-foundation.mjs";
import { ControlPlanner } from "../../local-runtime/src/control-planner.mjs";
import { createRequestHandler } from "../../local-runtime/src/host.mjs";
import { ReceiptStore } from "../../local-runtime/src/receipt-store.mjs";
import { TaskEngine } from "../../local-runtime/src/task-engine.mjs";
import { TaskStore } from "../../local-runtime/src/task-store.mjs";
import {
  createConversationDispatcher,
  routeConversationPanelMessage,
} from "../src/conversation-dispatch.mjs";
import {
  assertSourceStateAvailable,
  createSourceActivityGate,
  createSourceControlCoordinator,
} from "../src/source-control.mjs";
import { createTaskControlCoordinator } from "../src/task-control.mjs";

const schema = JSON.parse(await readFile(
  new URL("../../contracts/wts-foundation.protocol.schema.json", import.meta.url),
  "utf8",
));
const validator = createProtocolValidator(schema);
const BASE_MS = Date.parse("2026-10-19T07:00:00.000Z");
const CATALOG_A = `sha256:${"a".repeat(64)}`;
const CATALOG_B = `sha256:${"b".repeat(64)}`;

function idFactory(start = 0) {
  let value = start;
  return () => `00000000-0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function unwrap(response) {
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "로컬 실행기 요청이 실패했습니다.");
    error.code = response?.error?.code;
    throw error;
  }
  return response.result;
}

function observation(createId, screen) {
  return {
    id: createId(),
    capturedAt: new Date(BASE_MS).toISOString(),
    source: {
      origin: "https://wts.kiwoom.com",
      path: "/",
      tabId: 7,
      windowId: 3,
      frameId: 0,
      documentId: "document-1",
    },
    state: {
      screenId: screen.screenId,
      activeTab: screen.activeTab,
      period: screen.period,
      blocked: false,
      chartOpenEnabled: screen.screenId === "main-other",
      periodEnabled: screen.screenId === "main-chart",
      contextToken: "a".repeat(64),
      instrumentToken: "f".repeat(64),
    },
  };
}

async function createRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "athena-wts-conversation-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function backendStatus(catalogVersion) {
  return {
    state: "ready",
    profile: SOURCE_PROFILE,
    apiVersion: SOURCE_API_VERSION,
    catalogVersion,
    ownedChild: true,
  };
}

function sourceManifest(catalogVersion) {
  return {
    profile: SOURCE_PROFILE,
    apiVersion: SOURCE_API_VERSION,
    catalogVersion,
    operationCount: 1,
  };
}

function listCard(createId, catalogVersion, query) {
  return {
    schemaVersion: 1,
    kind: "capability-list",
    canvasId: createId(),
    title: "조회 기능 찾기",
    catalogVersion,
    fetchedAt: new Date(BASE_MS).toISOString(),
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    query,
    items: [{
      operationRef: "base:stockinfo",
      kind: "query",
      domain: "stock",
      name: "종목 정보",
      groupTitle: null,
    }],
  };
}

function detailCard(createId, catalogVersion) {
  return {
    schemaVersion: 1,
    kind: "capability-detail",
    canvasId: createId(),
    title: "종목 정보",
    catalogVersion,
    fetchedAt: new Date(BASE_MS).toISOString(),
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    operationRef: "base:stockinfo",
    domain: "stock",
    name: "종목 정보",
    executionPolicy: "selector_query",
    requiredArguments: [],
    optionalArguments: [],
    responseFields: [],
    execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
  };
}

async function fixture(t, options = {}) {
  const root = await createRoot(t);
  const createId = idFactory(options.idStart ?? 0);
  const state = {
    connected: true,
    configured: true,
    controlReady: true,
    pendingCapture: false,
    pendingReceipt: false,
    catalogVersion: CATALOG_A,
    ...options.state,
  };
  const hostCalls = [];
  const sourceOperations = [];
  const backendCalls = [];
  let journal;
  let latestTask = null;
  let screen = { screenId: "main-other", activeTab: "quote", period: "none" };
  let observations = 0;
  let clicks = 0;

  const planner = new ControlPlanner({ now: () => BASE_MS, createId });
  const receiptStore = new ReceiptStore(root, validator.validateControlReceipt);
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
  const backendSupervisor = {
    status() {
      backendCalls.push("status");
      return backendStatus(state.catalogVersion);
    },
    async ensure() {
      backendCalls.push("ensure");
      return backendStatus(state.catalogVersion);
    },
  };
  const sourceBridge = {
    async execute(operation, input) {
      sourceOperations.push({ operation, input: structuredClone(input) });
      if (operation === "manifest") return sourceManifest(state.catalogVersion);
      if (operation === "search") {
        if (options.searchGate) {
          options.searchGate.entered.resolve();
          await options.searchGate.release.promise;
        }
        return listCard(createId, state.catalogVersion, input.query);
      }
      if (operation === "describe") return detailCard(createId, state.catalogVersion);
      throw new Error(`forbidden source operation: ${operation}`);
    },
  };
  const handle = createRequestHandler({
    validator,
    store: null,
    planner,
    receiptStore,
    taskEngine,
    runtimeVersion: "0.5.0-test",
    backendSupervisor,
    sourceBridge,
  });
  let requestNumber = 0;
  const request = async (method, params, requestOptions) => {
    hostCalls.push({ method, params: structuredClone(params), options: requestOptions });
    return handle({
      protocolVersion: PROTOCOL_VERSION,
      requestId: `conversation-${String(++requestNumber).padStart(4, "0")}`,
      method,
      params,
    });
  };

  const taskCoordinator = createTaskControlCoordinator({
    now: () => BASE_MS + 100,
    wait: async () => {},
    createId,
    request,
    observeCurrent: async () => {
      observations += 1;
      return observation(createId, screen);
    },
    executeOnce: async (proposal) => {
      clicks += 1;
      if (proposal.actionId === CHART_OPEN_ACTION_ID) {
        screen = { screenId: "main-chart", activeTab: "chart", period: "day" };
      } else if (proposal.actionId === CHART_PERIOD_SET_ACTION_ID) {
        screen = { screenId: "main-chart", activeTab: "chart", period: proposal.args.period };
      }
      return { observation: observation(createId, screen), acted: true, reason: null };
    },
    observeSameDocument: async () => observation(createId, screen),
    loadState: async () => structuredClone(journal),
    saveState: async (value) => { journal = structuredClone(value); },
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
    onTaskChange: (task) => { latestTask = task; },
  });
  const sourceCoordinator = createSourceControlCoordinator({
    request,
    validateBackendStatus: validator.validateBackendStatus,
    validateSourceManifest: validator.validateSourceManifest,
    validateSourceCard: validator.validateSourceCard,
  });
  const activityGate = createSourceActivityGate({
    async assertSourceCanStart() {
      assertSourceStateAvailable({
        connected: state.connected,
        configured: state.configured,
        controlRunning: false,
        taskRunning: taskCoordinator.running(),
        pendingCapture: state.pendingCapture,
        pendingReceipt: state.pendingReceipt,
        journal: journal ?? { version: 1, activeTaskId: null, dispatch: null },
        latestTask,
      });
    },
  });
  const route = async (input) => {
    const result = unwrap(await request("conversation.route", input));
    if (options.routeGate) {
      options.routeGate.entered.resolve();
      await options.routeGate.release.promise;
    }
    return result;
  };
  const dispatcher = createConversationDispatcher({
    route,
    validateConversationRoute: validator.validateConversationRoute,
    activityGate,
    unsupportedMessage: CONVERSATION_UNSUPPORTED_MESSAGE,
    async startControl({ submissionId, text }) {
      const currentJournal = journal ?? { version: 1, activeTaskId: null, dispatch: null };
      if (!state.controlReady) {
        throw new Error("화면 조사 저장과 v5 로컬 실행기 연결을 먼저 완료해 주세요.");
      }
      if (state.pendingCapture) throw new Error("저장하지 못한 화면 조사를 먼저 처리해 주세요.");
      if (state.pendingReceipt || currentJournal.dispatch !== null) {
        throw new Error("미확인 WTS 대화 작업 결과를 먼저 복구해 주세요.");
      }
      return taskCoordinator.send(text, submissionId);
    },
    searchSource: (input) => sourceCoordinator.search(input),
    describeSource: (input) => sourceCoordinator.describe(input),
  });
  return {
    root,
    state,
    dispatcher,
    taskCoordinator,
    hostCalls,
    sourceOperations,
    backendCalls,
    counts: () => ({ observations, clicks }),
  };
}

async function waitForIdle(coordinator) {
  const deadline = Date.now() + 2_000;
  while (coordinator.running() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(coordinator.running(), false, "task coordinator should become idle");
}

function submit(dispatcher, submissionId, text) {
  return routeConversationPanelMessage({
    type: "panel.chat.submit",
    ownerId: "90000000-0000-4000-8000-000000000001",
    submissionId,
    text,
  }, dispatcher);
}

test("source conversation searches and describes metadata without executing a financial query", async (t) => {
  const value = await fixture(t);
  const submissionId = "10000000-0000-4000-8000-000000000001";

  const searched = await submit(value.dispatcher, submissionId, "조회 기능 찾아줘: 외국인 매매");
  const described = await routeConversationPanelMessage({
    type: "panel.chat.describe",
    submissionId,
    operationRef: searched.card.items[0].operationRef,
    expectedCatalogVersion: searched.card.catalogVersion,
  }, value.dispatcher);

  assert.equal(searched.kind, "source-card");
  assert.equal(described.kind, "source-card");
  assert.equal(described.submissionId, submissionId);
  assert.deepEqual(value.sourceOperations.map(({ operation }) => operation), [
    "manifest", "search", "manifest", "describe",
  ]);
  assert.deepEqual(value.backendCalls, ["ensure", "ensure"]);
  assert.equal(value.sourceOperations.some(({ operation }) =>
    !["manifest", "search", "describe"].includes(operation)), false);
});

test("identical concurrent and completed submissions execute the source route exactly once", async (t) => {
  const searchGate = { entered: deferred(), release: deferred() };
  const value = await fixture(t, { searchGate });
  const submissionId = "10000000-0000-4000-8000-000000000002";
  const first = submit(value.dispatcher, submissionId, "조회 기능 찾아줘: 종목 정보");
  const second = submit(value.dispatcher, submissionId, "조회 기능 찾아줘: 종목 정보");
  assert.equal(first, second);
  await searchGate.entered.promise;
  searchGate.release.resolve();
  const firstResult = await first;
  assert.deepEqual(await second, firstResult);
  assert.deepEqual(await submit(
    value.dispatcher,
    submissionId,
    "조회 기능 찾아줘: 종목 정보",
  ), firstResult);

  assert.equal(value.hostCalls.filter(({ method }) => method === "conversation.route").length, 1);
  assert.equal(value.sourceOperations.filter(({ operation }) => operation === "search").length, 1);
});

test("unsupported conversation has no task, browser, backend, or source side effect", async (t) => {
  const value = await fixture(t);
  const result = await submit(
    value.dispatcher,
    "10000000-0000-4000-8000-000000000003",
    "삼성전자 매수해줘",
  );

  assert.deepEqual(result, {
    kind: "unsupported",
    submissionId: "10000000-0000-4000-8000-000000000003",
    message: CONVERSATION_UNSUPPORTED_MESSAGE,
  });
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
  assert.equal(value.hostCalls.filter(({ method }) => method.startsWith("control.task.")).length, 0);
  assert.equal(value.backendCalls.length, 0);
  assert.equal(value.sourceOperations.length, 0);
});

test("chart conversation passes the panel submission id through the existing task path", async (t) => {
  const value = await fixture(t);
  const submissionId = "10000000-0000-4000-8000-000000000004";

  const accepted = await submit(value.dispatcher, submissionId, "차트 열어줘");
  await waitForIdle(value.taskCoordinator);
  const { task } = await value.taskCoordinator.get();

  assert.equal(accepted.kind, "control-task");
  assert.equal(accepted.submissionId, submissionId);
  assert.equal(accepted.task.id, submissionId);
  assert.equal(task.status, "completed");
  assert.deepEqual(value.counts(), { observations: 1, clicks: 1 });
  const starts = value.hostCalls.filter(({ method }) => method === "control.task.start");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].params.submissionId, submissionId);
});

test("metadata conversation works without capture while chart conversation remains capture-gated", async (t) => {
  const value = await fixture(t, { state: { controlReady: false } });

  const source = await submit(
    value.dispatcher,
    "10000000-0000-4000-8000-000000000005",
    "조회 기능 찾아줘: 종목 정보",
  );
  assert.equal(source.kind, "source-card");
  await assert.rejects(
    submit(value.dispatcher, "10000000-0000-4000-8000-000000000006", "차트 열어줘"),
    /화면 조사 저장/u,
  );
  assert.equal(value.hostCalls.filter(({ method }) => method === "control.task.start").length, 0);
  assert.deepEqual(value.counts(), { observations: 0, clicks: 0 });
});

test("pending receipt blocks source dispatch after routing and before backend startup", async (t) => {
  const value = await fixture(t, { state: { pendingReceipt: true } });

  await assert.rejects(
    submit(
      value.dispatcher,
      "10000000-0000-4000-8000-000000000007",
      "조회 기능 찾아줘: 종목 정보",
    ),
    /화면 제어 결과/u,
  );

  assert.equal(value.hostCalls.filter(({ method }) => method === "conversation.route").length, 1);
  assert.equal(value.backendCalls.length, 0);
  assert.equal(value.sourceOperations.length, 0);
});

test("routing cancellation rejects the late route result without branch dispatch", async (t) => {
  const routeGate = { entered: deferred(), release: deferred() };
  const value = await fixture(t, { routeGate });
  const pending = submit(
    value.dispatcher,
    "10000000-0000-4000-8000-000000000008",
    "조회 기능 찾아줘: 종목 정보",
  );
  await routeGate.entered.promise;

  assert.deepEqual(value.dispatcher.cancel(), { cancelled: true, phase: "routing" });
  routeGate.release.resolve();
  await assert.rejects(pending, /실행 전에 취소/u);
  assert.equal(value.backendCalls.length, 0);
  assert.equal(value.sourceOperations.length, 0);
});

test("disconnect invalidation discards a late source result and does not cache it", async (t) => {
  const searchGate = { entered: deferred(), release: deferred() };
  const value = await fixture(t, { searchGate });
  const submissionId = "10000000-0000-4000-8000-000000000009";
  const pending = submit(value.dispatcher, submissionId, "조회 기능 찾아줘: 종목 정보");
  await searchGate.entered.promise;

  value.dispatcher.invalidate();
  searchGate.release.resolve();
  await assert.rejects(pending, /취소되었거나 로컬 실행기 연결이 종료/u);
  assert.deepEqual(value.dispatcher.status(), { running: false, routing: false, phase: "idle" });

  const retried = await submit(value.dispatcher, submissionId, "조회 기능 찾아줘: 종목 정보");
  assert.equal(retried.kind, "source-card");
  assert.equal(value.hostCalls.filter(({ method }) => method === "conversation.route").length, 2);
  assert.equal(value.sourceOperations.filter(({ operation }) => operation === "search").length, 2);
});

test("detail catalog drift fails before source describe and requires a fresh search", async (t) => {
  const value = await fixture(t);
  const submissionId = "10000000-0000-4000-8000-000000000010";
  const searched = await submit(value.dispatcher, submissionId, "조회 기능 찾아줘: 종목 정보");
  value.state.catalogVersion = CATALOG_B;

  await assert.rejects(routeConversationPanelMessage({
    type: "panel.chat.describe",
    submissionId,
    operationRef: searched.card.items[0].operationRef,
    expectedCatalogVersion: searched.card.catalogVersion,
  }, value.dispatcher), /다시 검색/u);

  assert.deepEqual(value.sourceOperations.map(({ operation }) => operation), [
    "manifest", "search", "manifest",
  ]);
  assert.equal(value.sourceOperations.some(({ operation }) => operation === "describe"), false);
});

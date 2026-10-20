import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  MARKET_MENU_TARGETS,
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
import { createControlBrowserBridge } from "../src/browser-control.mjs";
import {
  createConversationDispatcher,
  routeConversationPanelMessage,
} from "../src/conversation-dispatch.mjs";
import { createSourceActivityGate } from "../src/source-control.mjs";
import { createTaskControlCoordinator } from "../src/task-control.mjs";
import { runMarketNavigationAdapter } from "../src/wts/market-navigation-adapter.mjs";
import {
  createMarketNavigationFixture,
  withMarketNavigationGlobals,
} from "./helpers/market-navigation-dom.mjs";

const schema = JSON.parse(await readFile(
  new URL("../../contracts/wts-foundation.protocol.schema.json", import.meta.url),
  "utf8",
));
const validator = createProtocolValidator(schema);
const BASE_MS = Date.parse("2026-10-19T10:00:00.000Z");
const TAB = Object.freeze({ id: 7, windowId: 3, url: "https://wts.kiwoom.com/" });

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
    const error = new Error(response?.error?.message || "native request failed");
    error.code = response?.error?.code;
    throw error;
  }
  return response.result;
}

function marketCommand(target) {
  return `시장 메뉴 열어줘: ${target.sitemapGroup} > ${target.buttonLabel}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function chartState(overrides = {}) {
  return {
    screenId: "main-chart",
    activeTab: "chart",
    period: "day",
    blocked: false,
    chartOpenEnabled: true,
    periodEnabled: true,
    contextToken: "a".repeat(64),
    instrumentToken: sha256("삼성전자 005930"),
    ...overrides,
  };
}

async function createDataRoot(t, label) {
  const root = await mkdtemp(path.join(os.tmpdir(), `athena-wts-market-${label}-`));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function receiptFiles(root) {
  try {
    return (await readdir(path.join(root, "receipts")))
      .filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function waitForIdle(coordinator) {
  const deadline = Date.now() + 2_000;
  while (coordinator.running() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(coordinator.running(), false, "market task coordinator should become idle");
}

function createRuntime(root, createId, intercept = async (_method, _params, response) => response) {
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
  const handle = createRequestHandler({
    validator,
    store: null,
    planner,
    receiptStore,
    taskEngine,
    runtimeVersion: "0.6.0-test",
  });
  let requestNumber = 0;
  const calls = [];
  return {
    calls,
    async request(method, params) {
      calls.push({ method, params: structuredClone(params) });
      const response = await handle({
        protocolVersion: PROTOCOL_VERSION,
        requestId: `market-${String(++requestNumber).padStart(4, "0")}`,
        method,
        params,
      });
      return intercept(method, structuredClone(params), response);
    },
  };
}

function createBrowser(fixture, createId, options = {}) {
  const injections = [];
  const scripting = {
    async executeScript(input) {
      injections.push({
        mode: input.args[0].mode,
        actionId: input.args[0].actionId ?? "chart",
        targetId: input.args[0].args?.targetId ?? null,
      });
      const result = await withMarketNavigationGlobals(
        fixture,
        () => input.func(...input.args),
      );
      return [{ frameId: 0, documentId: "document-1", result }];
    },
  };
  const chartAdapter = options.chartAdapter ?? (async () => ({
    state: chartState(),
    acted: false,
    reason: null,
  }));
  const bridge = createControlBrowserBridge({
    tabs: { query: async () => [TAB] },
    scripting,
    runChartAdapter: chartAdapter,
    runMarketNavigationAdapter,
    validateControlObservation: validator.validateControlObservation,
    chartOpenActionId: CHART_OPEN_ACTION_ID,
    periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
    sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
    marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
    marketMenuTargets: MARKET_MENU_TARGETS,
    createId,
    now: () => new Date(BASE_MS).toISOString(),
    nowMs: () => BASE_MS,
  });
  return { bridge, injections };
}

function createCoordinator({
  runtime,
  browser,
  createId,
  journalRef,
  observeCurrent = browser.observeCurrent,
  afterSave,
  onTaskError = () => {},
}) {
  return createTaskControlCoordinator({
    now: () => BASE_MS + 100,
    wait: async () => {},
    createId,
    request: runtime.request,
    observeCurrent,
    executeOnce: browser.executeOnce,
    observeSameDocument: browser.observeSameDocument,
    loadState: async () => structuredClone(journalRef.value),
    saveState: async (value) => {
      journalRef.value = structuredClone(value);
      await afterSave?.(structuredClone(value));
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
    marketPostconditionTimeoutMs: 20,
    pollIntervalMs: 1,
    onTaskError,
  });
}

function createDispatcher(runtime, coordinator) {
  const activityGate = createSourceActivityGate({
    async assertSourceCanStart() {},
  });
  return createConversationDispatcher({
    route: async (input) => unwrap(await runtime.request("conversation.route", input)),
    validateConversationRoute: validator.validateConversationRoute,
    activityGate,
    unsupportedMessage: CONVERSATION_UNSUPPORTED_MESSAGE,
    startControl: ({ submissionId, text }) => coordinator.send(text, submissionId),
    searchSource: async () => { throw new Error("source search is outside this test"); },
    describeSource: async () => { throw new Error("source describe is outside this test"); },
  });
}

function submit(dispatcher, submissionId, text) {
  return routeConversationPanelMessage({
    type: "panel.chat.submit",
    ownerId: "90000000-0000-4000-8000-000000000001",
    submissionId,
    text,
  }, dispatcher);
}

test("all 25 canonical market chats complete through the native task runtime with two receipts", async (t) => {
  for (const [index, target] of MARKET_MENU_TARGETS.entries()) {
    const root = await createDataRoot(t, target.id);
    const createId = idFactory(index * 1_000);
    const fixture = createMarketNavigationFixture({
      catalog: MARKET_MENU_TARGETS,
      targetId: target.id,
    });
    const runtime = createRuntime(root, createId);
    const { bridge, injections } = createBrowser(fixture, createId);
    const journalRef = { value: undefined };
    const errors = [];
    const coordinator = createCoordinator({
      runtime,
      browser: bridge,
      createId,
      journalRef,
      onTaskError: (error) => errors.push(error),
    });
    const dispatcher = createDispatcher(runtime, coordinator);
    const submissionId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

    const accepted = await submit(dispatcher, submissionId, marketCommand(target));
    await waitForIdle(coordinator);
    const { task } = await coordinator.get();

    assert.equal(accepted.kind, "control-task", target.id);
    assert.equal(task.status, "completed", target.id);
    assert.deepEqual(task.steps.map(({ actionId, args, status }) => ({ actionId, args, status })), [
      { actionId: SITEMAP_OPEN_ACTION_ID, args: { targetId: target.id }, status: "verified" },
      { actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId: target.id }, status: "verified" },
    ], target.id);
    assert.equal(fixture.opener.clicks, 1, target.id);
    assert.equal(fixture.targetButton.clicks, 1, target.id);
    assert.equal((await receiptFiles(root)).length, 2, target.id);
    assert.deepEqual(errors, [], target.id);
    assert.deepEqual(
      injections.filter(({ mode }) => mode === "execute").map(({ actionId }) => actionId),
      [SITEMAP_OPEN_ACTION_ID, MARKET_NAVIGATE_ACTION_ID],
      target.id,
    );
  }
});

test("mixed satisfied chart and already-active market A re-observe before market B", async (t) => {
  const root = await createDataRoot(t, "mixed");
  const createId = idFactory();
  const marketA = MARKET_MENU_TARGETS[0];
  const marketB = MARKET_MENU_TARGETS[1];
  const fixture = createMarketNavigationFixture({
    catalog: MARKET_MENU_TARGETS,
    targetId: marketB.id,
    activeTargetId: marketA.id,
  });
  const runtime = createRuntime(root, createId);
  const { bridge, injections } = createBrowser(fixture, createId);
  const journalRef = { value: undefined };
  const errors = [];
  const coordinator = createCoordinator({
    runtime,
    browser: bridge,
    createId,
    journalRef,
    onTaskError: (error) => errors.push(error),
  });

  await coordinator.send(
    `차트 열어줘, ${marketCommand(marketA)}, ${marketCommand(marketB)}`,
    "20000000-0000-4000-8000-000000000001",
  );
  await waitForIdle(coordinator);
  const { task } = await coordinator.get();

  assert.equal(
    task.status,
    "completed",
    JSON.stringify({ stack: errors.at(-1)?.stack, issues: errors.at(-1)?.issues }),
  );
  assert.deepEqual(task.steps.map(({ status }) => status), [
    "satisfied", "satisfied", "satisfied", "verified", "verified",
  ]);
  assert.equal(fixture.opener.clicks, 1);
  assert.equal(fixture.targetButton.clicks, 1);
  assert.equal((await receiptFiles(root)).length, 2);
  assert.deepEqual(
    injections.filter(({ mode }) => mode === "observe").map(({ actionId, targetId }) => ({ actionId, targetId })),
    [
      { actionId: CHART_OPEN_ACTION_ID, targetId: null },
      { actionId: SITEMAP_OPEN_ACTION_ID, targetId: marketA.id },
      { actionId: MARKET_NAVIGATE_ACTION_ID, targetId: marketA.id },
      { actionId: SITEMAP_OPEN_ACTION_ID, targetId: marketB.id },
      { actionId: MARKET_NAVIGATE_ACTION_ID, targetId: marketB.id },
    ],
  );
});

test("cancelling after the sitemap receipt prevents the target click", async (t) => {
  const root = await createDataRoot(t, "cancel");
  const createId = idFactory();
  const target = MARKET_MENU_TARGETS[2];
  const fixture = createMarketNavigationFixture({ catalog: MARKET_MENU_TARGETS, targetId: target.id });
  const runtime = createRuntime(root, createId);
  const { bridge } = createBrowser(fixture, createId);
  const secondObservation = deferred();
  let observations = 0;
  const journalRef = { value: undefined };
  const errors = [];
  const coordinator = createCoordinator({
    runtime,
    browser: bridge,
    createId,
    journalRef,
    observeCurrent: async (action) => {
      observations += 1;
      if (observations === 2) await secondObservation.promise;
      return bridge.observeCurrent(action);
    },
    onTaskError: (error) => errors.push(error),
  });

  await coordinator.send(marketCommand(target), "30000000-0000-4000-8000-000000000001");
  while (observations < 2) await new Promise((resolve) => setImmediate(resolve));
  const cancelling = coordinator.cancel();
  secondObservation.resolve();
  await cancelling;
  await waitForIdle(coordinator);
  const { task } = await coordinator.get();

  assert.equal(task.status, "cancelled");
  assert.equal(fixture.opener.clicks, 1);
  assert.equal(fixture.targetButton.clicks, 0);
  assert.equal((await receiptFiles(root)).length, 1);
  assert.deepEqual(task.steps.map(({ status }) => status), ["verified", "cancelled"]);
  assert.deepEqual(errors, []);
});

test("receipt-pending restart commits the exact receipt and never repeats the opener click", async (t) => {
  const root = await createDataRoot(t, "recovery");
  const createId = idFactory();
  const target = MARKET_MENU_TARGETS[3];
  const fixture = createMarketNavigationFixture({ catalog: MARKET_MENU_TARGETS, targetId: target.id });
  let loseFirstCommit = true;
  const runtime = createRuntime(root, createId, async (method, _params, response) => {
    if (method === "control.task.step.commit" && loseFirstCommit) {
      loseFirstCommit = false;
      throw new Error("commit reply lost");
    }
    return response;
  });
  const { bridge } = createBrowser(fixture, createId);
  const journalRef = { value: undefined };
  const errors = [];
  const first = createCoordinator({
    runtime,
    browser: bridge,
    createId,
    journalRef,
    onTaskError: (error) => errors.push(error),
  });

  await first.send(marketCommand(target), "40000000-0000-4000-8000-000000000001");
  await waitForIdle(first);
  assert.equal(fixture.opener.clicks, 1);
  assert.equal(fixture.targetButton.clicks, 0);
  assert.equal(journalRef.value.dispatch.state, "receipt_pending");
  assert.match(errors.at(-1).message, /commit reply lost/u);

  const restarted = createCoordinator({ runtime, browser: bridge, createId, journalRef });
  await restarted.get();
  const { task } = await restarted.get();

  assert.equal(task.status, "ready");
  assert.equal(fixture.opener.clicks, 1);
  assert.equal(fixture.targetButton.clicks, 0);
  assert.equal((await receiptFiles(root)).length, 1);
  assert.equal(journalRef.value.dispatch, null);
});

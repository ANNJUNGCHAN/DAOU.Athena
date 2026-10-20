import test from "node:test";
import assert from "node:assert/strict";
import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  SITEMAP_OPEN_ACTION_ID,
} from "../../contracts/wts-foundation.mjs";
import { createControlBrowserBridge } from "../src/browser-control.mjs";

const observedAt = "2026-10-18T12:00:00.000Z";
const source = {
  origin: "https://wts.kiwoom.com",
  path: "/",
  tabId: 7,
  windowId: 3,
  frameId: 0,
  documentId: "document-1",
};
const state = {
  screenId: "main-chart",
  activeTab: "chart",
  period: "day",
  blocked: false,
  chartOpenEnabled: true,
  periodEnabled: true,
  contextToken: "a".repeat(64),
  instrumentToken: "f".repeat(64),
};

function runChartAdapter() {}
function runMarketNavigationAdapter() {}

function makeBridge(tabSequence, scripting) {
  let index = 0;
  return createControlBrowserBridge({
    tabs: { query: async () => [tabSequence[Math.min(index++, tabSequence.length - 1)]] },
    scripting,
    runChartAdapter,
    runMarketNavigationAdapter,
    validateControlObservation: (value) => value,
    chartOpenActionId: CHART_OPEN_ACTION_ID,
    periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
    sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
    marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
    marketMenuTargets: MARKET_MENU_TARGETS,
    createId: () => "00000000-0000-4000-8000-000000000001",
    now: () => observedAt,
    nowMs: () => Date.parse(observedAt),
  });
}

test("the explicit chart facade targets only the active top frame and binds its document ID", async () => {
  const calls = [];
  const tab = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/" };
  const bridge = makeBridge([tab, tab], {
    executeScript: async (input) => {
      calls.push(input);
      return [{ frameId: 0, documentId: "document-1", result: { state, acted: false, reason: null } }];
    },
  });
  const result = await bridge.chart.observeCurrent();
  assert.deepEqual(calls[0].target, { tabId: 7, frameIds: [0] });
  assert.equal(calls[0].func, runChartAdapter);
  assert.equal(calls[0].args[0].mode, "observe");
  assert.deepEqual(result.source, source);
});

test("task observations select the adapter by exact action and pass only the canonical market catalog", async () => {
  const calls = [];
  const tab = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/" };
  const bridge = makeBridge([tab, tab, tab, tab], {
    executeScript: async (input) => {
      calls.push(input);
      return [{ frameId: 0, documentId: "document-1", result: { state, acted: false, reason: null } }];
    },
  });
  await bridge.observeCurrent({ actionId: CHART_OPEN_ACTION_ID, args: {} });
  await bridge.observeCurrent({ actionId: SITEMAP_OPEN_ACTION_ID, args: { targetId: "market-menu-022" } });
  assert.equal(calls[0].func, runChartAdapter);
  assert.deepEqual(calls[0].args[0], { mode: "observe", actionId: CHART_OPEN_ACTION_ID, args: {} });
  assert.equal(calls[1].func, runMarketNavigationAdapter);
  assert.deepEqual(calls[1].args[0], {
    mode: "observe",
    actionId: SITEMAP_OPEN_ACTION_ID,
    args: { targetId: "market-menu-022" },
    catalog: MARKET_MENU_TARGETS,
  });
});

test("unknown actions and non-canonical market targets fail before injection", async () => {
  let calls = 0;
  const tab = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/" };
  const bridge = makeBridge([tab], { executeScript: async () => { calls += 1; return []; } });
  await assert.rejects(
    bridge.observeCurrent({ actionId: "wts.main.unknown", args: {} }),
    /허용되지 않은/,
  );
  await assert.rejects(
    bridge.observeCurrent({ actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId: "market-menu-999" } }),
    /고정 시장 메뉴 대상/,
  );
  await assert.rejects(
    bridge.observeCurrent({ actionId: CHART_OPEN_ACTION_ID, args: { selector: "button" } }),
    /고정 차트 동작 인자/,
  );
  assert.equal(calls, 0);
});

test("execution uses the exact planned document and full expected state once", async () => {
  const calls = [];
  const tab = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/" };
  const bridge = makeBridge([tab, tab], {
    executeScript: async (input) => {
      calls.push(input);
      return [{ frameId: 0, documentId: "document-1", result: { state: { ...state, period: "week" }, acted: true, reason: null } }];
    },
  });
  const proposal = {
    observation: { id: "00000000-0000-4000-8000-000000000002", capturedAt: observedAt, source, state },
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: "week" },
    expiresAt: "2026-10-18T12:00:05.000Z",
  };
  const result = await bridge.executeOnce(proposal);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].target, { tabId: 7, documentIds: ["document-1"] });
  assert.deepEqual(calls[0].args[0], {
    mode: "execute",
    expectedState: state,
    actionId: proposal.actionId,
    args: proposal.args,
  });
  assert.equal(result.acted, true);
});

test("active tab changes and document mismatches fail closed", async () => {
  const original = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/" };
  const changed = { id: 8, windowId: 3, url: "https://wts.kiwoom.com/" };
  let calls = 0;
  const changedTabBridge = makeBridge([changed], { executeScript: async () => { calls += 1; return []; } });
  const action = { actionId: CHART_OPEN_ACTION_ID, args: {} };
  await assert.rejects(changedTabBridge.observeSameDocument(source, action), /탭 또는 창/);
  assert.equal(calls, 0);

  const changedDocumentBridge = makeBridge([original], {
    executeScript: async () => [{ frameId: 0, documentId: "document-2", result: { state, acted: false, reason: null } }],
  });
  await assert.rejects(changedDocumentBridge.observeSameDocument(source, action), /문서 식별자/);
});

test("an executeScript failure is marked as a click that may already have run", async () => {
  const tab = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/" };
  const bridge = makeBridge([tab], {
    executeScript: async () => { throw new Error("context destroyed"); },
  });
  const proposal = {
    observation: { id: "00000000-0000-4000-8000-000000000002", capturedAt: observedAt, source, state },
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: "week" },
    expiresAt: "2026-10-18T12:00:05.000Z",
  };
  await assert.rejects(
    bridge.executeOnce(proposal),
    (error) => error.controlReason === "DOCUMENT_CHANGED" && error.actionMayHaveRun === true,
  );
});

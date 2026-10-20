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
  MARKET_MENU_PROFILE,
  MARKET_NAVIGATE_ACTION_ID,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from "../../contracts/wts-foundation.mjs";
import {
  assertControlIdle,
  assertPilotRuntimeGate,
  createControlCoordinator,
  prepareReceiptArchive,
} from "../src/control-core.mjs";

const schema = JSON.parse(await readFile(resolve(import.meta.dirname, "../../contracts/wts-foundation.protocol.schema.json"), "utf8"));
const validator = createProtocolValidator(schema);
const actionIds = CONTROL_ACTION_IDS;
const baseMs = Date.parse("2026-10-18T12:00:00.000Z");
let uuidCounter = 0;
const createId = () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, "0")}`;

function state(overrides = {}) {
  return {
    screenId: "main-chart",
    activeTab: "chart",
    period: "day",
    blocked: false,
    chartOpenEnabled: true,
    periodEnabled: true,
    contextToken: "a".repeat(64),
    instrumentToken: "f".repeat(64),
    ...overrides,
  };
}

function marketState(overrides = {}) {
  return {
    stateKind: "market-navigation",
    screenId: "main-market-navigation",
    targetId: "market-menu-001",
    blocked: false,
    sitemapVisible: true,
    sitemapOpenEnabled: false,
    targetAvailable: true,
    activeTargetId: null,
    contextToken: "c".repeat(64),
    instrumentToken: "f".repeat(64),
    ...overrides,
  };
}

function observation(overrides = {}) {
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
    state: state(),
    ...overrides,
  };
}

function proposal(before, overrides = {}) {
  return {
    id: createId(),
    catalogVersion: CONTROL_CATALOG_VERSION,
    observation: before,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: "week" },
    expiresAt: new Date(baseMs + 5_000).toISOString(),
    ...overrides,
  };
}

function coordinatorFixture(overrides = {}) {
  const before = overrides.before || observation();
  const planned = overrides.proposal || proposal(before);
  const receipts = [];
  const clicks = [];
  let pendingReceipt = null;
  let planCalls = 0;
  let receiptCalls = 0;
  const coordinator = createControlCoordinator({
    now: overrides.now || (() => baseMs + 100),
    wait: overrides.wait || (async () => {}),
    createId,
    observeCurrent: overrides.observeCurrent || (async () => before),
    executeOnce: overrides.executeOnce || (async (value) => {
      clicks.push(value.id);
      return { observation: observation({ state: state({ period: "week", contextToken: "b".repeat(64) }) }), acted: true, reason: null };
    }),
    observeSameDocument: overrides.observeSameDocument || (async () => observation({ state: state({ period: "week", contextToken: "b".repeat(64) }) })),
    request: overrides.request || (async (method, params) => {
      if (method === "control.plan") {
        planCalls += 1;
        return { ok: true, result: { status: "proposed", message: "주봉 전환", proposal: planned } };
      }
      receiptCalls += 1;
      receipts.push(params.receipt);
      return { ok: true, result: { receiptId: params.receipt.id, stored: true } };
    }),
    loadPendingReceipt: overrides.loadPendingReceipt || (async () => pendingReceipt),
    savePendingReceipt: overrides.savePendingReceipt || (async (value) => { pendingReceipt = value; }),
    clearPendingReceipt: overrides.clearPendingReceipt || (async () => { pendingReceipt = null; }),
    archivePendingReceipt: overrides.archivePendingReceipt || (async () => { throw new Error("not configured"); }),
    validateControlObservation: validator.validateControlObservation,
    validateControlProposal: validator.validateControlProposal,
    validateControlReceipt: validator.validateControlReceipt,
    catalogVersion: CONTROL_CATALOG_VERSION,
    actionIds,
    chartOpenActionId: CHART_OPEN_ACTION_ID,
    periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
    sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
    marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
    postconditionTimeoutMs: 20,
    pollIntervalMs: 1,
  });
  return {
    coordinator,
    before,
    planned,
    clicks,
    receipts,
    counts: () => ({ planCalls, receiptCalls }),
    pending: () => pendingReceipt,
    setPending: (value) => { pendingReceipt = value; },
  };
}

test("runtime gate requires exact v6 bounded task catalog, market profile, and a stored foundation capture", () => {
  const runtime = {
    runtimeVersion: "0.6.0",
    capabilities: { observationStorage: true, screenControl: true, laya: false, localPlanner: false },
    control: {
      catalogVersion: CONTROL_CATALOG_VERSION,
      actions: actionIds,
      commandMode: "bounded-korean-v3",
      taskMode: "bounded-compound-v1",
      maxTaskSteps: 12,
      planner: {
        kind: "deterministic",
        id: "deterministic-korean-wts-v3",
        version: "3",
        bundleHash: null,
        generative: false,
        localModelReady: false,
      },
      market: MARKET_MENU_PROFILE,
    },
  };
  const gate = { runtime, summary: { captureCount: 1 }, protocolVersion: 6, catalogVersion: CONTROL_CATALOG_VERSION, actionIds, marketMenuProfile: MARKET_MENU_PROFILE };
  assert.equal(assertPilotRuntimeGate(gate).ready, true);
  assert.throws(() => assertPilotRuntimeGate({ ...gate, summary: { captureCount: 0 } }), /1회 이상/);
  assert.throws(() => assertPilotRuntimeGate({ ...gate, protocolVersion: 5 }), /v6 계약/);
  assert.throws(() => assertPilotRuntimeGate({
    ...gate,
    runtime: { ...runtime, runtimeVersion: "0.3.0" },
  }), /v6 계약/);
  assert.throws(() => assertPilotRuntimeGate({
    ...gate,
    runtime: { ...runtime, control: { ...runtime.control, market: { ...MARKET_MENU_PROFILE, targetCount: 24 } } },
  }), /v6 계약/);
});

test("one user command produces one click and a verified receipt", async () => {
  const fixture = coordinatorFixture();
  const result = await fixture.coordinator.execute("주봉으로");
  assert.equal(result.status, "verified");
  assert.equal(fixture.clicks.length, 1);
  assert.equal(fixture.receipts.length, 1);
  assert.equal(fixture.receipts[0].reason, "POSTCONDITION_MET");
  assert.equal(fixture.receipts[0].after.state.period, "week");
});

test("market navigation gets a 3000 ms observation-only postcondition budget", async () => {
  let clock = 100;
  let polls = 0;
  const before = observation({ state: marketState() });
  const planned = proposal(before, {
    actionId: MARKET_NAVIGATE_ACTION_ID,
    args: { targetId: "market-menu-001" },
  });
  const immediate = observation({ state: marketState() });
  const completed = observation({ state: marketState({ sitemapVisible: false, targetAvailable: false, activeTargetId: "market-menu-001" }) });
  const value = coordinatorFixture({
    before,
    proposal: planned,
    now: () => baseMs + clock,
    wait: async (ms) => { clock += ms; },
    executeOnce: async () => ({ observation: immediate, acted: true, reason: null }),
    observeSameDocument: async () => {
      polls += 1;
      return polls === 3 ? completed : immediate;
    },
  });
  const result = await value.coordinator.execute("시장 메뉴 열어줘: 시세분석 > 급등락");
  assert.equal(result.status, "verified");
  assert.equal(polls, 3);
  assert.equal(result.receipt.after.state.activeTargetId, "market-menu-001");
});

test("successful receipt persistence clears only the exact serialized pending body", async () => {
  const cleared = [];
  const fixture = coordinatorFixture({
    clearPendingReceipt: async (exactJson) => { cleared.push(exactJson); },
  });
  const result = await fixture.coordinator.execute("주봉으로");
  assert.equal(cleared.length, 1);
  assert.deepEqual(JSON.parse(cleared[0]), result.receipt);
});

test("concurrent execute calls share one flight", async () => {
  let release;
  const waitForPlan = new Promise((resolve) => { release = resolve; });
  const fixture = coordinatorFixture({
    request: async (method, params) => {
      if (method === "control.plan") {
        await waitForPlan;
        return { ok: true, result: { status: "proposed", message: "주봉 전환", proposal: fixture.planned } };
      }
      return { ok: true, result: { receiptId: params.receipt.id, stored: true } };
    },
  });
  const first = fixture.coordinator.execute("주봉으로");
  const second = fixture.coordinator.execute("일봉으로");
  release();
  assert.equal(first, second);
  await first;
  assert.equal(fixture.clicks.length, 1);
});

test("stale or mismatched proposals never click", async () => {
  const before = observation();
  const stale = proposal(before, { expiresAt: new Date(baseMs + 50).toISOString() });
  const fixture = coordinatorFixture({ before, proposal: stale, now: () => baseMs + 100 });
  await assert.rejects(fixture.coordinator.execute("주봉으로"), /만료/);
  assert.equal(fixture.clicks.length, 0);
  assert.equal(fixture.receipts.length, 0);
});

test("adapter precondition rejection records blocked without retrying the click", async () => {
  const fixture = coordinatorFixture({
    executeOnce: async () => ({
      observation: observation({ state: state({ period: "other", contextToken: "c".repeat(64) }) }),
      acted: false,
      reason: "PRECONDITION_CHANGED",
    }),
  });
  const result = await fixture.coordinator.execute("주봉으로");
  assert.equal(result.status, "blocked");
  assert.equal(fixture.receipts[0].reason, "PRECONDITION_CHANGED");
});

test("a document change after a possible click is recorded as unverified", async () => {
  const error = new Error("document changed");
  error.controlReason = "DOCUMENT_CHANGED";
  error.actionMayHaveRun = true;
  const fixture = coordinatorFixture({ executeOnce: async () => { throw error; } });
  const result = await fixture.coordinator.execute("주봉으로");
  assert.equal(result.status, "unverified");
  assert.equal(fixture.receipts[0].reason, "DOCUMENT_CHANGED");
  assert.match(result.message, /자동 재시도하지 않습니다/);
});

test("postcondition timeout records one click and never retries the action", async () => {
  let clock = baseMs + 100;
  const fixture = coordinatorFixture({
    now: () => clock,
    wait: async (ms) => { clock += ms; },
    executeOnce: async (value) => {
      fixture.clicks.push(value.id);
      return { observation: observation(), acted: true, reason: null };
    },
    observeSameDocument: async () => observation(),
  });
  const result = await fixture.coordinator.execute("주봉으로");
  assert.equal(result.status, "unverified");
  assert.equal(result.receipt.reason, "POSTCONDITION_TIMEOUT");
  assert.equal(fixture.clicks.length, 1);
});

test("an instrument change after the click stops polling and cannot be verified", async () => {
  let polls = 0;
  const fixture = coordinatorFixture({
    executeOnce: async () => ({
      observation: observation({
        state: state({
          period: "week",
          contextToken: "b".repeat(64),
          instrumentToken: "e".repeat(64),
        }),
      }),
      acted: true,
      reason: null,
    }),
    observeSameDocument: async () => {
      polls += 1;
      return observation({ state: state({ period: "week" }) });
    },
  });
  const result = await fixture.coordinator.execute("주봉으로");
  assert.equal(result.status, "unverified");
  assert.equal(result.receipt.reason, "PRECONDITION_CHANGED");
  assert.equal(polls, 0);
});

test("receipt storage failure keeps the exact receipt and retry does not click again", async () => {
  let recordAttempts = 0;
  let pending = null;
  const before = observation();
  const planned = proposal(before);
  const clicks = [];
  const coordinator = createControlCoordinator({
    now: () => baseMs + 100,
    wait: async () => {},
    createId,
    observeCurrent: async () => before,
    executeOnce: async () => {
      clicks.push("click");
      return { observation: observation({ state: state({ period: "week", contextToken: "d".repeat(64) }) }), acted: true, reason: null };
    },
    observeSameDocument: async () => { throw new Error("not needed"); },
    request: async (method, params) => {
      if (method === "control.plan") return { ok: true, result: { status: "proposed", message: "주봉 전환", proposal: planned } };
      recordAttempts += 1;
      if (recordAttempts === 1) throw new Error("host unavailable");
      return { ok: true, result: { receiptId: params.receipt.id, stored: true } };
    },
    loadPendingReceipt: async () => pending,
    savePendingReceipt: async (value) => { pending = value; },
    clearPendingReceipt: async () => { pending = null; },
    archivePendingReceipt: async () => { throw new Error("not configured"); },
    validateControlObservation: validator.validateControlObservation,
    validateControlProposal: validator.validateControlProposal,
    validateControlReceipt: validator.validateControlReceipt,
    catalogVersion: CONTROL_CATALOG_VERSION,
    actionIds,
    chartOpenActionId: CHART_OPEN_ACTION_ID,
    periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
  });
  await assert.rejects(coordinator.execute("주봉으로"), /동작은 반복하지 않습니다/);
  const exact = pending;
  await coordinator.retryReceipt();
  assert.equal(clicks.length, 1);
  assert.equal(pending, null);
  assert.equal(recordAttempts, 2);
  assert.ok(exact.includes("POSTCONDITION_MET"));
});

test("legacy pending receipt retry preserves the frozen exact JSON without relabeling or clicking", async () => {
  const before = observation();
  const legacyReceipt = validator.validateControlReceipt({
    id: createId(),
    proposalId: createId(),
    catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
    actionId: CHART_PERIOD_SET_ACTION_ID,
    args: { period: "week" },
    before,
    after: null,
    status: "unverified",
    reason: "EXECUTION_ERROR",
    completedAt: new Date(baseMs + 100).toISOString(),
  });
  const pendingJson = JSON.stringify(legacyReceipt);
  const requests = [];
  let cleared = null;
  const coordinator = createControlCoordinator({
    request: async (method, params) => {
      requests.push({ method, params: structuredClone(params) });
      return { ok: true, result: { receiptId: params.receipt.id, stored: true } };
    },
    observeCurrent: async () => { throw new Error("retry must not observe"); },
    executeOnce: async () => { throw new Error("retry must not click"); },
    observeSameDocument: async () => { throw new Error("retry must not poll"); },
    loadPendingReceipt: async () => pendingJson,
    savePendingReceipt: async () => { throw new Error("retry should succeed"); },
    clearPendingReceipt: async (exactJson) => { cleared = exactJson; },
    archivePendingReceipt: async () => { throw new Error("not configured"); },
    validateControlObservation: validator.validateControlObservation,
    validateControlProposal: validator.validateControlProposal,
    validateControlReceipt: validator.validateControlReceipt,
    catalogVersion: CONTROL_CATALOG_VERSION,
    actionIds,
    chartOpenActionId: CHART_OPEN_ACTION_ID,
    periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
  });

  await coordinator.retryReceipt();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "control.receipt.record");
  assert.equal(JSON.stringify(requests[0].params.receipt), pendingJson);
  assert.equal(requests[0].params.receipt.catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(cleared, pendingJson);
});

test("cancel during planning records cancellation before any click", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const before = observation();
  const planned = proposal(before);
  const fixture = coordinatorFixture({
    before,
    proposal: planned,
    request: async (method, params) => {
      if (method === "control.plan") {
        await gate;
        return { ok: true, result: { status: "proposed", message: "주봉 전환", proposal: planned } };
      }
      fixture.receipts.push(params.receipt);
      return { ok: true, result: { receiptId: params.receipt.id, stored: true } };
    },
  });
  const pending = fixture.coordinator.execute("주봉으로");
  await Promise.resolve();
  assert.equal(fixture.coordinator.running(), true);
  assert.throws(() => assertControlIdle(fixture.coordinator), /연결을 해제할 수 없습니다/);
  assert.equal(fixture.coordinator.cancel(), true);
  release();
  const result = await pending;
  assert.equal(result.status, "cancelled");
  assert.equal(fixture.clicks.length, 0);
  assert.equal(fixture.receipts[0].reason, "CANCELLED");
  assert.doesNotThrow(() => assertControlIdle(fixture.coordinator));
});

test("pending receipt archive preserves exact JSON and enforces immutable bounded entries", () => {
  const before = observation();
  const planned = proposal(before);
  const receipt = {
    id: createId(),
    proposalId: planned.id,
    catalogVersion: CONTROL_CATALOG_VERSION,
    actionId: planned.actionId,
    args: planned.args,
    before,
    after: null,
    status: "unverified",
    reason: "DOCUMENT_CHANGED",
    completedAt: new Date(baseMs + 100).toISOString(),
  };
  const pendingJson = JSON.stringify(receipt);
  const first = prepareReceiptArchive({
    archive: null,
    pendingJson,
    validateControlReceipt: validator.validateControlReceipt,
  });
  assert.equal(first.archive.receipts[receipt.id], pendingJson);
  const same = prepareReceiptArchive({
    archive: first.archive,
    pendingJson,
    validateControlReceipt: validator.validateControlReceipt,
  });
  assert.deepEqual(same, first);
  const differentJson = JSON.stringify({ ...receipt, completedAt: new Date(baseMs + 200).toISOString() });
  assert.throws(() => prepareReceiptArchive({
    archive: first.archive,
    pendingJson: differentJson,
    validateControlReceipt: validator.validateControlReceipt,
  }), /다른 내용/);
  assert.throws(() => prepareReceiptArchive({
    archive: first.archive,
    pendingJson: JSON.stringify({ ...receipt, id: createId() }),
    validateControlReceipt: validator.validateControlReceipt,
    maxEntries: 1,
  }), /최대 1건/);
  assert.throws(() => prepareReceiptArchive({
    archive: null,
    pendingJson,
    validateControlReceipt: validator.validateControlReceipt,
    maxBytes: 32,
  }), /512 KiB 제한/);
});

test("archive action forwards only the exact pending receipt and clears nothing itself", async () => {
  const archived = [];
  const fixture = coordinatorFixture({
    archivePendingReceipt: async (pendingJson) => {
      archived.push(pendingJson);
      return { receiptId: "00000000-0000-4000-8000-000000000099", archived: true };
    },
  });
  const exact = JSON.stringify({ exact: "pending receipt bytes" });
  fixture.setPending(exact);
  const result = await fixture.coordinator.archiveReceipt();
  assert.equal(result.archived, true);
  assert.deepEqual(archived, [exact]);
  assert.equal(fixture.pending(), exact);
});

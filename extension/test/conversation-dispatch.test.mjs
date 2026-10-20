import assert from "node:assert/strict";
import test from "node:test";

import {
  CANCELLED_MESSAGE,
  assertConversationControlStateAvailable,
  createConversationDispatcher,
  routeConversationPanelMessage,
} from "../src/conversation-dispatch.mjs";
import { createSourceActivityGate } from "../src/source-control.mjs";

const UNSUPPORTED = "지금은 차트 명령과 “조회 기능 찾아줘: 검색어”만 지원합니다.";
const catalogVersion = `sha256:${"a".repeat(64)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function id(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function listCard(index = 1) {
  return {
    schemaVersion: 1,
    kind: "capability-list",
    canvasId: id(100 + index),
    title: "조회 기능 찾기",
    catalogVersion,
    fetchedAt: "2026-10-19T06:00:00.000Z",
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    query: "외국인 매매",
    items: [{ operationRef: `base:stockinfo${index}`, kind: "query", domain: "stock", name: "종목 정보", groupTitle: null }],
  };
}

function detailCard(operationRef, index = 1) {
  return {
    schemaVersion: 1,
    kind: "capability-detail",
    canvasId: id(200 + index),
    title: "종목 정보",
    catalogVersion,
    fetchedAt: "2026-10-19T06:00:00.000Z",
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    operationRef,
    domain: "stock",
    name: "종목 정보",
    executionPolicy: "selector_query",
    requiredArguments: [],
    optionalArguments: [],
    responseFields: [],
    execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
  };
}

function validateRoute(value) {
  if (!value || typeof value !== "object" || !["wts-control", "source-search", "unsupported"].includes(value.kind)) {
    throw new TypeError("invalid route");
  }
  return value;
}

function fixture(overrides = {}) {
  const calls = { route: [], control: [], search: [], describe: [], sourceGate: 0 };
  const activityGate = overrides.activityGate || createSourceActivityGate({
    assertSourceCanStart: async () => { calls.sourceGate += 1; },
  });
  const dispatcher = createConversationDispatcher({
    activityGate,
    unsupportedMessage: UNSUPPORTED,
    validateConversationRoute: overrides.validateConversationRoute || validateRoute,
    route: overrides.route || (async (input) => {
      calls.route.push(input);
      return { kind: "unsupported", submissionId: input.submissionId, message: UNSUPPORTED };
    }),
    startControl: overrides.startControl || (async (input) => {
      calls.control.push(input);
      return { task: { id: id(900), submissionId: input.submissionId, status: "ready" } };
    }),
    searchSource: overrides.searchSource || (async (input) => {
      calls.search.push(input);
      return listCard();
    }),
    describeSource: overrides.describeSource || (async (input) => {
      calls.describe.push(input);
      return detailCard(input.operationRef);
    }),
    maxEntries: overrides.maxEntries,
    maxBytes: overrides.maxBytes,
  });
  return { dispatcher, activityGate, calls };
}

test("control branch gate refuses missing capture readiness and every pending recovery lane", () => {
  const idle = {
    controlReady: true,
    controlRunning: false,
    taskRunning: false,
    pendingCapture: false,
    pendingReceipt: false,
    journal: { version: 1, activeTaskId: null, dispatch: null },
  };
  assert.doesNotThrow(() => assertConversationControlStateAvailable(idle));
  assert.throws(() => assertConversationControlStateAvailable({ ...idle, controlReady: false }), /화면 조사 저장/);
  assert.throws(() => assertConversationControlStateAvailable({ ...idle, controlRunning: true }), /진행 중/);
  assert.throws(() => assertConversationControlStateAvailable({ ...idle, taskRunning: true }), /진행 중/);
  assert.throws(() => assertConversationControlStateAvailable({ ...idle, pendingCapture: true }), /화면 조사/);
  assert.throws(() => assertConversationControlStateAvailable({ ...idle, pendingReceipt: true }), /화면 제어 결과/);
  assert.throws(() => assertConversationControlStateAvailable({
    ...idle,
    journal: { ...idle.journal, dispatch: { state: "armed" } },
  }), /먼저 복구/);
});

test("unsupported route has no delegated side effects and returns the fixed local result", async () => {
  const value = fixture();
  const result = await value.dispatcher.submit({ submissionId: id(1), text: "  알 수 없는 요청  " });
  assert.deepEqual(result, { kind: "unsupported", submissionId: id(1), message: UNSUPPORTED });
  assert.deepEqual(value.calls.route, [{ submissionId: id(1), text: "알 수 없는 요청" }]);
  assert.deepEqual(value.calls.control, []);
  assert.deepEqual(value.calls.search, []);
  assert.equal(value.calls.sourceGate, 0);
});

test("control route passes the durable submission id through exactly once", async () => {
  const value = fixture({
    route: async (input) => {
      value.calls.route.push(input);
      return { kind: "wts-control", submissionId: input.submissionId, text: "월봉으로" };
    },
  });
  const input = { submissionId: id(2), text: "월봉으로" };
  const result = await value.dispatcher.submit(input);
  assert.equal(result.kind, "control-task");
  assert.equal(result.task.submissionId, input.submissionId);
  assert.deepEqual(value.calls.control, [{ submissionId: input.submissionId, text: "월봉으로" }]);
});

test("control route binding accepts the native whitespace-normalized submitted text", async () => {
  const value = fixture({
    route: async (input) => ({
      kind: "wts-control",
      submissionId: input.submissionId,
      text: "차트 열어줘",
    }),
  });
  const result = await value.dispatcher.submit({ submissionId: id(19), text: "차트   열어줘" });
  assert.equal(result.kind, "control-task");
  assert.deepEqual(value.calls.control, [{ submissionId: id(19), text: "차트 열어줘" }]);
});

test("control route reply text must match the normalized submitted text before dispatch", async () => {
  const value = fixture({
    route: async (input) => ({
      kind: "wts-control",
      submissionId: input.submissionId,
      text: "년봉으로",
    }),
  });
  await assert.rejects(
    value.dispatcher.submit({ submissionId: id(17), text: "  차트 열어줘  " }),
    /화면 제어 내용이 대화 요청과 일치하지 않습니다/,
  );
  assert.deepEqual(value.calls.control, []);
  assert.deepEqual(value.calls.search, []);
});

test("source route works through the source gate without a control capture gate", async () => {
  const value = fixture({
    route: async (input) => ({ kind: "source-search", submissionId: input.submissionId, query: "외국인 매매" }),
  });
  const result = await value.dispatcher.submit({ submissionId: id(3), text: "조회 기능 찾아줘: 외국인 매매" });
  assert.equal(result.kind, "source-card");
  assert.equal(result.card.kind, "capability-list");
  assert.deepEqual(value.calls.search, [{ query: "외국인 매매" }]);
  assert.equal(value.calls.sourceGate, 1);
});

test("source route reply query must match the exact trimmed fixed-prefix query before dispatch", async () => {
  const value = fixture({
    route: async (input) => ({
      kind: "source-search",
      submissionId: input.submissionId,
      query: "다른 검색어",
    }),
  });
  await assert.rejects(
    value.dispatcher.submit({ submissionId: id(18), text: "  조회 기능 찾아줘: 외국인 매매  " }),
    /조회 기능 검색어가 대화 요청과 일치하지 않습니다/,
  );
  assert.deepEqual(value.calls.control, []);
  assert.deepEqual(value.calls.search, []);
});

test("source route reply cannot bind an input missing the required prefix space", async () => {
  const value = fixture({
    route: async (input) => ({
      kind: "source-search",
      submissionId: input.submissionId,
      query: "종목",
    }),
  });
  await assert.rejects(
    value.dispatcher.submit({ submissionId: id(20), text: "조회 기능 찾아줘:종목" }),
    /조회 기능 검색어가 대화 요청과 일치하지 않습니다/,
  );
  assert.deepEqual(value.calls.search, []);
});

test("same submission coalesces in flight and completed reply recovery never repeats dispatch", async () => {
  const routeGate = deferred();
  let routeCalls = 0;
  const value = fixture({
    route: async (input) => {
      routeCalls += 1;
      await routeGate.promise;
      return { kind: "wts-control", submissionId: input.submissionId, text: input.text };
    },
  });
  const input = { submissionId: id(4), text: "주봉으로" };
  const first = value.dispatcher.submit(input);
  const same = value.dispatcher.submit({ ...input, text: "  주봉으로  " });
  assert.equal(first, same);
  await assert.rejects(value.dispatcher.submit({ ...input, text: "일봉으로" }), /다른 내용/);
  routeGate.resolve();
  const result = await first;
  assert.equal((await value.dispatcher.submit(input)), result);
  assert.equal(routeCalls, 1);
  assert.equal(value.calls.control.length, 1);
});

test("exclusive reservation blocks source and foreground entries and refuses admission behind existing work", async () => {
  const routeGate = deferred();
  const value = fixture({
    route: async (input) => {
      await routeGate.promise;
      return { kind: "unsupported", submissionId: input.submissionId, message: UNSUPPORTED };
    },
  });
  const pending = value.dispatcher.submit({ submissionId: id(5), text: "대기" });
  await assert.rejects(value.activityGate.runForeground(async () => "foreground"), /대화 요청/);
  await assert.rejects(value.activityGate.runSource(async () => "source"), /대화 요청/);
  routeGate.resolve();
  await pending;

  const foregroundGate = deferred();
  const foreground = value.activityGate.runForeground(() => foregroundGate.promise);
  await assert.rejects(
    value.dispatcher.submit({ submissionId: id(6), text: "대기" }),
    /다른 WTS 요청/,
  );
  foregroundGate.resolve();
  await foreground;

  const sourceGate = deferred();
  const source = value.activityGate.runSource(() => sourceGate.promise);
  await assert.rejects(
    value.dispatcher.submit({ submissionId: id(6), text: "대기" }),
    /다른 WTS 요청/,
  );
  sourceGate.resolve("done");
  await source;
});

test("stop and disconnect invalidate late route results before any branch dispatch", async () => {
  for (const mode of ["cancel", "disconnect"]) {
    const gate = deferred();
    const value = fixture({
      route: async (input) => {
        await gate.promise;
        return { kind: "wts-control", submissionId: input.submissionId, text: "일봉으로" };
      },
    });
    const pending = value.dispatcher.submit({ submissionId: id(mode === "cancel" ? 7 : 8), text: "일봉으로" });
    if (mode === "cancel") {
      assert.deepEqual(value.dispatcher.cancel(), { cancelled: true, phase: "routing" });
    } else {
      value.dispatcher.invalidate();
    }
    gate.resolve();
    await assert.rejects(pending, mode === "cancel" ? new RegExp(CANCELLED_MESSAGE) : /종료|취소/);
    assert.equal(value.calls.control.length, 0);
    assert.equal(value.calls.search.length, 0);
  }
});

test("source phase cannot be falsely cancelled and remains busy until completion", async () => {
  const sourceGate = deferred();
  const value = fixture({
    route: async (input) => ({ kind: "source-search", submissionId: input.submissionId, query: "종목" }),
    searchSource: async (input) => {
      value.calls.search.push(input);
      return sourceGate.promise;
    },
  });
  const pending = value.dispatcher.submit({ submissionId: id(9), text: "조회 기능 찾아줘: 종목" });
  while (value.dispatcher.status().phase !== "source") await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(value.dispatcher.cancel(), { cancelled: false, phase: "source" });
  assert.equal(value.dispatcher.status().running, true);
  sourceGate.resolve(listCard());
  await pending;
  assert.equal(value.dispatcher.status().running, false);
});

test("describe requires an exact issued list binding and keeps the list submission identity", async () => {
  const value = fixture({
    route: async (input) => ({ kind: "source-search", submissionId: input.submissionId, query: "종목" }),
  });
  const submissionId = id(10);
  const search = await value.dispatcher.submit({ submissionId, text: "조회 기능 찾아줘: 종목" });
  const operationRef = search.card.items[0].operationRef;
  await assert.rejects(value.dispatcher.describe({
    submissionId: id(11), operationRef, expectedCatalogVersion: catalogVersion,
  }), /다시 검색/);
  await assert.rejects(value.dispatcher.describe({
    submissionId, operationRef: "base:not-issued", expectedCatalogVersion: catalogVersion,
  }), /다시 검색/);
  const detail = await value.dispatcher.describe({ submissionId, operationRef, expectedCatalogVersion: catalogVersion });
  assert.equal(detail.kind, "source-card");
  assert.equal(detail.submissionId, submissionId);
  assert.notEqual(detail.card.canvasId, search.card.canvasId);
  assert.deepEqual(value.calls.describe, [{ operationRef, expectedCatalogVersion: catalogVersion }]);
});

test("mismatched route identity and invalid panel shapes fail before dispatch", async () => {
  const value = fixture({
    route: async () => ({ kind: "unsupported", submissionId: id(99), message: UNSUPPORTED }),
  });
  await assert.rejects(value.dispatcher.submit({ submissionId: id(12), text: "대기" }), /식별자가 일치/);
  assert.throws(() => value.dispatcher.submit({ submissionId: id(13), text: " ", extra: true }), /형식/);
  assert.equal(value.calls.control.length, 0);
  assert.equal(value.calls.search.length, 0);
});

test("panel routing accepts only exact unified submit and bound describe shapes", async () => {
  const calls = [];
  const dispatcher = {
    submit: async (input) => { calls.push(["submit", input]); return "submitted"; },
    describe: async (input) => { calls.push(["describe", input]); return "described"; },
  };
  assert.equal(await routeConversationPanelMessage({
    type: "panel.chat.submit", submissionId: id(14), text: "차트 열어줘", ownerId: id(15),
  }, dispatcher), "submitted");
  assert.equal(await routeConversationPanelMessage({
    type: "panel.chat.describe",
    submissionId: id(14),
    operationRef: "base:stockinfo1",
    expectedCatalogVersion: catalogVersion,
  }, dispatcher), "described");
  assert.throws(() => routeConversationPanelMessage({
    type: "panel.chat.submit", submissionId: id(14), text: "차트 열어줘", ownerId: id(15), selector: "#secret",
  }, dispatcher), /형식/);
  assert.deepEqual(calls, [
    ["submit", { submissionId: id(14), text: "차트 열어줘", ownerId: id(15) }],
    ["describe", {
      submissionId: id(14), operationRef: "base:stockinfo1", expectedCatalogVersion: catalogVersion,
    }],
  ]);
});

test("bounded list bindings evict the oldest whole search result", async () => {
  let index = 0;
  const value = fixture({
    maxEntries: 1,
    route: async (input) => ({
      kind: "source-search",
      submissionId: input.submissionId,
      query: input.text.slice("조회 기능 찾아줘: ".length).trim(),
    }),
    searchSource: async () => listCard(++index),
  });
  const first = await value.dispatcher.submit({ submissionId: id(15), text: "조회 기능 찾아줘: 첫 검색" });
  const second = await value.dispatcher.submit({ submissionId: id(16), text: "조회 기능 찾아줘: 둘째 검색" });
  await assert.rejects(value.dispatcher.describe({
    submissionId: id(15),
    operationRef: first.card.items[0].operationRef,
    expectedCatalogVersion: catalogVersion,
  }), /다시 검색/);
  const detail = await value.dispatcher.describe({
    submissionId: id(16),
    operationRef: second.card.items[0].operationRef,
    expectedCatalogVersion: catalogVersion,
  });
  assert.equal(detail.submissionId, id(16));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  appendSessionEntry,
  appendSubmissionInput,
  createChatTaskView,
  formatTaskAction,
  isTaskRunning,
  mergeConversationResult,
  mergeTaskMessages,
} from "../src/sidepanel/panel-chat.mjs";
import {
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  SITEMAP_OPEN_ACTION_ID,
} from "../../contracts/wts-foundation.mjs";

const catalogVersion = `sha256:${"a".repeat(64)}`;
const marketActionFormatOptions = {
  marketMenuTargetById: new Map(MARKET_MENU_TARGETS.map((target) => [target.id, target])),
  marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
  sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
};

function sourceCard(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "capability-list",
    canvasId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    title: "조회 기능",
    catalogVersion,
    fetchedAt: "2026-10-19T00:00:00Z",
    notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
    query: "현재가",
    items: [],
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: "8f329fda-e8a5-4cc4-8900-cde067590e13",
    revision: 2,
    status: "awaiting_receipt",
    input: { text: "차트 열고 주봉으로" },
    cursor: 0,
    message: "차트 열기 결과를 확인하고 있습니다.",
    steps: [
      { id: "step-1", index: 0, actionId: "wts.main.p3.chart.open", args: {}, status: "awaiting_receipt" },
      { id: "step-2", index: 1, actionId: "wts.main.p3.chart.period.set", args: { period: "week" }, status: "pending" },
    ],
    ...overrides,
  };
}

test("task view exposes identity, bounded progress, steps and stop state", () => {
  const view = createChatTaskView(task());
  assert.equal(view.visible, true);
  assert.equal(view.id, "8f329fda-e8a5-4cc4-8900-cde067590e13");
  assert.equal(view.status, "현재 단계 확인 중");
  assert.equal(view.progress, "0 / 2");
  assert.equal(view.running, true);
  assert.equal(view.stopAvailable, true);
  assert.deepEqual(view.steps.map(({ action, status }) => ({ action, status })), [
    { action: "차트 열기", status: "확인 중" },
    { action: "주봉으로 전환", status: "대기" },
  ]);
});

test("cancel requested stays running but does not offer a duplicate stop", () => {
  const view = createChatTaskView(task({ status: "cancel_requested" }));
  assert.equal(isTaskRunning(task({ status: "cancel_requested" })), true);
  assert.equal(view.stopAvailable, false);
  assert.equal(view.status, "중지 요청됨");
});

test("terminal task completes progress and disables stop", () => {
  const completed = task({
    status: "completed",
    cursor: 2,
    steps: task().steps.map((step) => ({ ...step, status: "verified" })),
  });
  const view = createChatTaskView(completed);
  assert.equal(view.progress, "2 / 2");
  assert.equal(view.running, false);
  assert.equal(view.stopAvailable, false);
});

test("messages are deduplicated by task revision and bounded", () => {
  let messages = [];
  messages = mergeTaskMessages(messages, task(), 3);
  messages = mergeTaskMessages(messages, task(), 3);
  assert.equal(messages.length, 2);
  messages = mergeTaskMessages(messages, task({ revision: 3, message: "다음 단계를 준비합니다." }), 3);
  messages = mergeTaskMessages(messages, task({ revision: 4, message: "완료했습니다." }), 3);
  assert.deepEqual(messages.map((message) => message.key), [
    `${task().id}:revision:2`,
    `${task().id}:revision:3`,
    `${task().id}:revision:4`,
  ]);
  messages = mergeTaskMessages(messages, task({ revision: 4, message: "완료했습니다." }), 3);
  assert.deepEqual(messages.map((message) => message.key), [
    `${task().id}:revision:2`,
    `${task().id}:revision:3`,
    `${task().id}:revision:4`,
  ]);
});

test("message text remains plain data for the textContent renderer", () => {
  const unsafe = task({
    input: { text: "<img src=x onerror=alert(1)>" },
    message: "<script>unexpected()</script>",
  });
  const messages = mergeTaskMessages([], unsafe);
  assert.equal(messages[0].text, "<img src=x onerror=alert(1)>");
  assert.equal(messages[1].text, "<script>unexpected()</script>");
});

test("known action labels are Korean and unknown ids remain explicit", () => {
  assert.equal(formatTaskAction({ actionId: "wts.main.p3.chart.period.set", args: { period: "day" } }), "일봉으로 전환");
  assert.equal(formatTaskAction({ actionId: "wts.main.p3.chart.period.set", args: { period: "month" } }), "월봉으로 전환");
  assert.equal(formatTaskAction({ actionId: "wts.main.p3.chart.period.set", args: { period: "year" } }), "년봉으로 전환");
  assert.equal(formatTaskAction({ actionId: "future.action", args: {} }), "future.action");
});

test("market action labels come only from the canonical target catalog", () => {
  const targetId = "market-menu-010";
  assert.equal(
    formatTaskAction({
      actionId: SITEMAP_OPEN_ACTION_ID,
      args: { targetId, sitemapGroup: "변조된 그룹", buttonLabel: "변조된 메뉴" },
    }, marketActionFormatOptions),
    "사이트맵 열기 · 순위 → 전일대비 등락률 순위",
  );
  assert.equal(
    formatTaskAction({ actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId } }, marketActionFormatOptions),
    "순위 → 전일대비 등락률 순위 이동",
  );
  assert.equal(
    formatTaskAction({ actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId: "unknown-target" } }, marketActionFormatOptions),
    MARKET_NAVIGATE_ACTION_ID,
  );
});

test("typed source cards keep exact submission binding and unique canvas identities", () => {
  const submissionId = "11111111-1111-4111-8111-111111111111";
  let messages = appendSubmissionInput([], submissionId, "조회 기능 찾아줘: 현재가");
  assert.equal(messages[0].terminal, false);
  messages = mergeConversationResult(messages, { kind: "source-card", submissionId, card: sourceCard() });
  assert.equal(messages[0].terminal, true);
  messages = mergeConversationResult(messages, {
    kind: "source-card",
    submissionId,
    card: {
      schemaVersion: 1,
      kind: "capability-detail",
      canvasId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "현재가 상세",
      catalogVersion,
      fetchedAt: "2026-10-19T00:00:00Z",
      notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
      operationRef: "base:ka10001",
      domain: "stock",
      name: "현재가",
      executionPolicy: "selector_query",
      requiredArguments: [],
      optionalArguments: [],
      responseFields: [],
      execution: { available: false, reason: "FINANCIAL_QUERY_NOT_CONNECTED" },
    },
  });
  assert.deepEqual(messages.map(({ key, kind }) => ({ key, kind })), [
    { key: `${submissionId}:input`, kind: "text" },
    { key: `${submissionId}:card:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, kind: "source-card" },
    { key: `${submissionId}:card:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`, kind: "source-card" },
  ]);
  assert.equal(messages[2].submissionId, submissionId);
});

test("session history drops oldest whole terminal entries by count and encoded bytes", () => {
  let messages = [];
  for (let index = 0; index < 13; index += 1) {
    messages = appendSessionEntry(messages, {
      key: `message-${index}`,
      kind: "text",
      role: "assistant",
      label: "ATHENA 로컬 실행기",
      text: String(index),
    });
  }
  assert.equal(messages.length, 12);
  assert.equal(messages[0].key, "message-1");

  messages = [];
  for (let index = 0; index < 4; index += 1) {
    messages = appendSessionEntry(messages, {
      key: `large-${index}`,
      kind: "text",
      role: "assistant",
      label: "ATHENA 로컬 실행기",
      text: "가".repeat(120),
    }, { maxEntries: 12, maxBytes: 700 });
  }
  assert.equal(messages.length < 4, true);
  assert.equal(messages.at(-1).key, "large-3");
  assert.equal(new TextEncoder().encode(JSON.stringify(messages)).byteLength <= 700, true);
});

test("active nonterminal entries are not partially truncated to satisfy capacity", () => {
  assert.throws(() => appendSessionEntry([], {
    key: "active",
    kind: "text",
    role: "assistant",
    label: "ATHENA 로컬 실행기",
    text: "진행".repeat(100),
    terminal: false,
  }, { maxEntries: 12, maxBytes: 100 }), /bounded capacity/);
});

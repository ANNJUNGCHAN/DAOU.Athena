import { collectCurrentFrame } from "./collector.mjs";
import { buildCapture, createCaptureCoordinator } from "./capture-core.mjs";
import { createNativeClient } from "./native-client.mjs";
import {
  assertConversationControlStateAvailable,
  createConversationDispatcher,
  routeConversationPanelMessage,
} from "./conversation-dispatch.mjs";
import {
  assertSourceStateAvailable,
  createSourceActivityGate,
  createSourceControlCoordinator,
  routeSourcePanelMessage,
} from "./source-control.mjs";
import {
  assertControlIdle,
  assertPilotRuntimeGate,
  createControlCoordinator,
  prepareReceiptArchive,
} from "./control-core.mjs";
import { createControlBrowserBridge } from "./browser-control.mjs";
import { createTaskControlCoordinator, validateTaskJournal } from "./task-control.mjs";
import { createFinancialControlCoordinator } from "./financial-control.mjs";
import { createProviderControlCoordinator, routeProviderPanelMessage } from "./provider-control.mjs";
import { runChartAdapter } from "./wts/chart-adapter.mjs";
import { runMarketNavigationAdapter } from "./wts/market-navigation-adapter.mjs";
import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONVERSATION_UNSUPPORTED_MESSAGE,
  CONTROL_ACTION_IDS,
  CONTROL_CATALOG_VERSION,
  LEGACY_CONTROL_CATALOG_VERSION,
  MARKET_MENU_PROFILE,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  HOST_NAME,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  createProtocolValidator,
} from "./contracts/wts-foundation.mjs";
import schema from "./contracts/wts-foundation.schema.mjs";

const PANEL_URL = chrome.runtime.getURL("sidepanel/index.html");
const PROVIDER_PANEL_REQUESTS = new Set([
  "panel.provider.status", "panel.provider.get", "panel.provider.cancel", "panel.provider.select",
  "panel.provider.confirm", "panel.provider.reject", "panel.provider.connect", "panel.provider.models",
  "panel.provider.disconnect", "panel.provider.reset", "panel.chat.submit",
]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WTS_ORIGIN = "https://wts.kiwoom.com";
const PENDING_CAPTURE_KEY = "pendingWtsCaptureV1";
const CONTROL_RECEIPTS_KEY = "wtsControlReceiptsV2";
const CONTROL_TASK_KEY = "wtsControlTaskV3";
const FINANCIAL_JOURNAL_KEY = "wtsFinancialJournalV1";
let controlGate = null;
let controlBlockedReason = null;
let connectedRuntime = null;
let latestTask = null;
let conversationDispatcher = null;
let financialCoordinator = null;
let providerCoordinator = null;
let providerPanelOwner = null;
let nativeGeneration = 0;

const validator = createProtocolValidator(schema);
const nativeClient = createNativeClient({
  connectNative: (hostName) => chrome.runtime.connectNative(hostName),
  validateRequest: validator.validateRequest,
  validateResponse: validator.validateResponse,
  maxMessageBytes: MAX_MESSAGE_BYTES,
  onStatusChange: (status) => notifyPanelStatus(status),
});

function notifyPanelStatus(status) {
  if (status.connected === false) {
    conversationDispatcher?.invalidate();
    sourceActivity.invalidateSource();
    controlGate = null;
    controlBlockedReason = null;
    connectedRuntime = null;
    latestTask = null;
    financialCoordinator?.disconnect(status.error || undefined);
    nativeGeneration += 1;
    providerCoordinator?.invalidateRuntime(nativeGeneration);
  }
  chrome.runtime.sendMessage({ type: "native.status", status }).catch(() => {});
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

async function configurePanelForTab(tabId, rawUrl) {
  let enabled = false;
  try { enabled = new URL(rawUrl || "").origin === WTS_ORIGIN; } catch {}
  await chrome.sidePanel.setOptions({ tabId, path: "sidepanel/index.html", enabled });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    configurePanelForTab(tabId, changeInfo.url || tab.url).catch(() => {});
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId)
    .then((tab) => configurePanelForTab(tabId, tab.url))
    .catch(() => {});
});
chrome.tabs.query({}).then((tabs) => Promise.all(
  tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => configurePanelForTab(tab.id, tab.url)),
)).catch(() => {});

function request(method, params, options) {
  return nativeClient.request({
    protocolVersion: PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    method,
    params,
  }, options);
}

financialCoordinator = createFinancialControlCoordinator({
  request,
  async loadJournal() {
    const stored = await chrome.storage.local.get(FINANCIAL_JOURNAL_KEY);
    return stored[FINANCIAL_JOURNAL_KEY] ?? null;
  },
  async saveJournal(value) {
    await chrome.storage.local.set({ [FINANCIAL_JOURNAL_KEY]: value });
  },
  onStateChange(state) {
    chrome.runtime.sendMessage({ type: "financial.status", state }).catch(() => {});
  },
});

function updateControlGate(runtime, summary) {
  connectedRuntime = runtime;
  try {
    controlGate = assertPilotRuntimeGate({
      runtime: { ...runtime, runtimeVersion: "0.6.0" },
      summary,
      protocolVersion: 6,
      catalogVersion: CONTROL_CATALOG_VERSION,
      actionIds: CONTROL_ACTION_IDS,
      marketMenuProfile: MARKET_MENU_PROFILE,
    });
    controlBlockedReason = null;
    return { ready: true, reason: null };
  } catch (error) {
    controlGate = null;
    controlBlockedReason = error.message;
    return { ready: false, reason: error.message };
  }
}

function assertPanelSender(sender) {
  if (sender?.id !== chrome.runtime.id || sender?.url !== PANEL_URL) {
    throw new Error("허용되지 않은 확장 프로그램 발신자입니다.");
  }
}

function assertProviderPanelOwner(port, ownerId) {
  if (!port || providerPanelOwner?.port !== port || providerPanelOwner.ownerId !== ownerId) {
    throw new Error("현재 열린 ChatGPT 패널 소유자가 아닙니다.");
  }
}

function parseWtsUrl(value) {
  const url = new URL(value);
  if (url.origin !== WTS_ORIGIN) throw new Error("현재 탭이 키움 WTS가 아닙니다.");
  return url;
}

async function activeWtsTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !Number.isInteger(tab.windowId) || !tab.url) {
    throw new Error("조사할 활성 탭을 찾지 못했습니다.");
  }
  parseWtsUrl(tab.url);
  return tab;
}

async function collectCapture() {
  const tab = await activeWtsTab();
  const capturedAt = new Date().toISOString();
  const injections = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: collectCurrentFrame,
    args: [{ maxHeadings: 40, maxControls: 120, maxFrames: 30, maxTextLength: 160 }],
    world: "ISOLATED",
  });

  const rebound = await chrome.tabs.get(tab.id);
  return buildCapture({
    tab,
    reboundTab: rebound,
    injections,
    capturedAt,
    createId: () => crypto.randomUUID(),
    validateObservation: validator.validateObservation,
    maxObservations: 16,
    maxCaptureBytes: MAX_MESSAGE_BYTES - 1_024,
  });
}

const captureCoordinator = createCaptureCoordinator({
  async loadPending() {
    const stored = await chrome.storage.local.get(PENDING_CAPTURE_KEY);
    return typeof stored[PENDING_CAPTURE_KEY] === "string" ? stored[PENDING_CAPTURE_KEY] : null;
  },
  async savePending(captureJson) {
    await chrome.storage.local.set({ [PENDING_CAPTURE_KEY]: captureJson });
  },
  async clearPending() {
    await chrome.storage.local.remove(PENDING_CAPTURE_KEY);
  },
  collectCapture,
  async sendCapture(capture) {
    const response = await request("inventory.record", { capture });
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  },
});

const browserControl = createControlBrowserBridge({
  tabs: chrome.tabs,
  scripting: chrome.scripting,
  runChartAdapter,
  runMarketNavigationAdapter,
  validateControlObservation: validator.validateControlObservation,
  chartOpenActionId: CHART_OPEN_ACTION_ID,
  periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
  sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
  marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
  marketMenuTargets: MARKET_MENU_TARGETS,
});

async function loadTaskJournal() {
  const stored = await chrome.storage.local.get(CONTROL_TASK_KEY);
  return validateTaskJournal(stored[CONTROL_TASK_KEY]);
}

async function saveTaskJournal(value) {
  await chrome.storage.local.set({ [CONTROL_TASK_KEY]: validateTaskJournal(value) });
}

async function readControlReceiptState() {
  const stored = await chrome.storage.local.get(CONTROL_RECEIPTS_KEY);
  const value = stored[CONTROL_RECEIPTS_KEY];
  if (value === undefined) return { version: 1, pending: null, archived: {} };
  if (
    value?.version !== 1
    || !(value.pending === null || typeof value.pending === "string")
    || !value.archived
    || typeof value.archived !== "object"
    || Array.isArray(value.archived)
  ) {
    throw new Error("WTS 제어 결과 저장소 형식이 올바르지 않습니다.");
  }
  return value;
}

const controlCoordinator = createControlCoordinator({
  request,
  observeCurrent: browserControl.chart.observeCurrent,
  executeOnce: browserControl.executeOnce,
  observeSameDocument: browserControl.chart.observeSameDocument,
  async loadPendingReceipt() {
    return (await readControlReceiptState()).pending;
  },
  async savePendingReceipt(receiptJson) {
    const state = await readControlReceiptState();
    if (state.pending !== null && state.pending !== receiptJson) {
      throw new Error("다른 미확인 결과가 이미 보류 중입니다.");
    }
    await chrome.storage.local.set({
      [CONTROL_RECEIPTS_KEY]: { ...state, pending: receiptJson },
    });
  },
  async clearPendingReceipt(expectedJson) {
    const state = await readControlReceiptState();
    if (state.pending !== null && state.pending !== expectedJson) {
      throw new Error("보류된 결과가 저장 요청과 일치하지 않습니다.");
    }
    await chrome.storage.local.set({
      [CONTROL_RECEIPTS_KEY]: { ...state, pending: null },
    });
  },
  async archivePendingReceipt(pendingJson) {
    const state = await readControlReceiptState();
    if (state.pending !== pendingJson) {
      throw new Error("보류된 결과가 보관 요청과 일치하지 않습니다.");
    }
    const prepared = prepareReceiptArchive({
      archive: { version: 1, receipts: state.archived },
      pendingJson,
      validateControlReceipt: validator.validateControlReceipt,
    });
    await chrome.storage.local.set({
      [CONTROL_RECEIPTS_KEY]: {
        version: 1,
        pending: null,
        archived: prepared.archive.receipts,
      },
    });
    return { receiptId: prepared.receiptId, archived: true };
  },
  validateControlObservation: validator.validateControlObservation,
  validateControlProposal: validator.validateControlProposal,
  validateControlReceipt: validator.validateControlReceipt,
  catalogVersion: CONTROL_CATALOG_VERSION,
  actionIds: CONTROL_ACTION_IDS,
  chartOpenActionId: CHART_OPEN_ACTION_ID,
  periodSetActionId: CHART_PERIOD_SET_ACTION_ID,
  sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
  marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
});

const taskCoordinator = createTaskControlCoordinator({
  request,
  observeCurrent: browserControl.observeCurrent,
  executeOnce: browserControl.executeOnce,
  observeSameDocument: browserControl.observeSameDocument,
  loadState: loadTaskJournal,
  saveState: saveTaskJournal,
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
  onTaskChange(task) {
    latestTask = task;
    chrome.runtime.sendMessage({ type: "task.status", task }).catch(() => {});
  },
  onTaskError(error) {
    chrome.runtime.sendMessage({
      type: "task.error",
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
  },
});

const sourceCoordinator = createSourceControlCoordinator({
  request,
  validateBackendStatus: validator.validateBackendStatus,
  validateSourceManifest: validator.validateSourceManifest,
  validateSourceCard: validator.validateSourceCard,
});

const sourceActivity = createSourceActivityGate({
  async assertSourceCanStart() {
    assertSourceStateAvailable({
      connected: nativeClient.status().connected,
      configured: connectedRuntime?.source?.configured === true,
      controlRunning: controlCoordinator.running(),
      taskRunning: taskCoordinator.running(),
      pendingCapture: await captureCoordinator.hasPending(),
      pendingReceipt: await controlCoordinator.hasPendingReceipt(),
      journal: await loadTaskJournal(),
      latestTask,
    });
  },
});

providerCoordinator = createProviderControlCoordinator({
  request,
  runControl: async (text, submissionId) => {
    await assertConversationControlCanStart();
    const result = await taskCoordinator.send(text, submissionId);
    if (!result?.task || result.task.submissionId !== submissionId) throw new Error("ChatGPT 실행 제안의 WTS 작업이 생성되지 않았습니다.");
    return { kind: "control-task", submissionId, task: result.task };
  },
});

async function assertConversationControlCanStart() {
  const journal = validateTaskJournal(await loadTaskJournal());
  assertConversationControlStateAvailable({
    controlReady: Boolean(controlGate),
    controlRunning: controlCoordinator.running(),
    taskRunning: taskCoordinator.running(),
    pendingCapture: await captureCoordinator.hasPending(),
    pendingReceipt: await controlCoordinator.hasPendingReceipt(),
    financialRunning: financialCoordinator.snapshot().running,
    journal,
  });
}

conversationDispatcher = createConversationDispatcher({
  activityGate: sourceActivity,
  unsupportedMessage: CONVERSATION_UNSUPPORTED_MESSAGE,
  validateConversationRoute: validator.validateConversationRoute,
  async route(input) {
    const response = await request("conversation.route", input);
    if (!response.ok) throw new Error(response.error.message);
    return response.result;
  },
  async startControl({ submissionId, text }) {
    await assertConversationControlCanStart();
    return taskCoordinator.send(text, submissionId);
  },
  searchSource: (input) => sourceCoordinator.search(input),
  describeSource: (input) => sourceCoordinator.describe(input),
  startProvider: (input, reservation, ownerId) => providerCoordinator.startPlan(input, reservation, ownerId),
});

function runForeground(task) {
  return sourceActivity.runForeground(task);
}

async function collectAndStore() {
  if (!nativeClient.status().connected) throw new Error("먼저 로컬 실행기에 연결해 주세요.");
  const outcome = await captureCoordinator.collectOrRetry();
  return {
    captureId: outcome.result.captureId,
    observationCount: outcome.result.observationCount,
    stored: outcome.result.stored,
    retried: outcome.retried,
    truncated: outcome.capture.observations.some((item) => item.truncated),
  };
}

async function handlePanelMessage(message, sender, ownerPort = null) {
  assertPanelSender(sender);
  switch (message?.type) {
    case "panel.health": {
      const conversation = conversationDispatcher.status();
      return {
        ...nativeClient.status(),
        pendingCapture: await captureCoordinator.hasPending(),
        pendingReceipt: await controlCoordinator.hasPendingReceipt(),
        controlReady: Boolean(controlGate),
        controlBlockedReason,
        controlRunning: controlCoordinator.running(),
        taskRunning: taskCoordinator.running(),
        sourceConfigured: connectedRuntime?.source?.configured === true,
        sourceRunning: sourceActivity.running(),
        conversationRunning: conversation.running,
        conversationRouting: conversation.routing,
        conversationPhase: conversation.phase,
        financial: financialCoordinator.snapshot(),
        provider: providerCoordinator.snapshot(),
      };
    }
    case "panel.connect": {
      conversationDispatcher.invalidate();
      return runForeground(async () => {
        nativeClient.connect(HOST_NAME);
        const [helloResponse, summaryResponse] = await Promise.all([
          request("runtime.hello", {}),
          request("inventory.summary", {}),
        ]);
        if (!helloResponse.ok) throw new Error(helloResponse.error.message);
        if (!summaryResponse.ok) throw new Error(summaryResponse.error.message);
        const control = updateControlGate(helloResponse.result, summaryResponse.result);
        nativeGeneration += 1;
        providerCoordinator.bindRuntime({ generation: nativeGeneration, provider: helloResponse.result.provider });
        financialCoordinator.connect(helloResponse.result.financial);
        await financialCoordinator.reconcile();
        const chat = control.ready ? await taskCoordinator.reconcile() : { task: null };
        latestTask = chat.task;
        return {
          ...nativeClient.status(),
          pendingCapture: await captureCoordinator.hasPending(),
          pendingReceipt: await controlCoordinator.hasPendingReceipt(),
          controlReady: control.ready,
          controlBlockedReason: control.reason,
          controlRunning: controlCoordinator.running(),
          taskRunning: taskCoordinator.running(),
          sourceConfigured: helloResponse.result.source.configured,
          sourceRunning: false,
          conversationRunning: false,
          conversationRouting: false,
          conversationPhase: "idle",
          task: chat.task,
          runtime: helloResponse.result,
          summary: summaryResponse.result,
          financial: financialCoordinator.snapshot(),
          provider: providerCoordinator.snapshot(),
        };
      });
    }
    case "panel.disconnect":
      assertControlIdle(controlCoordinator);
      if (taskCoordinator.running()) throw new Error("WTS 대화 작업이 진행 중에는 로컬 실행기 연결을 해제할 수 없습니다.");
      conversationDispatcher.invalidate();
      sourceActivity.invalidateSource();
      controlGate = null;
      controlBlockedReason = null;
      connectedRuntime = null;
      latestTask = null;
      nativeClient.disconnect();
      financialCoordinator.disconnect();
      nativeGeneration += 1;
      providerCoordinator.invalidateRuntime(nativeGeneration);
      return nativeClient.status();
    case "panel.collectAndStore": {
      return runForeground(async () => {
        const result = await collectAndStore();
        if (connectedRuntime) {
          const summaryResponse = await request("inventory.summary", {});
          if (!summaryResponse.ok) throw new Error(summaryResponse.error.message);
          result.control = updateControlGate(connectedRuntime, summaryResponse.result);
        }
        return result;
      });
    }
    case "panel.discardPending":
      return runForeground(async () => {
        await captureCoordinator.discardPending();
        return { discarded: true };
      });
    case "panel.summary": {
      return runForeground(async () => {
        const response = await request("inventory.summary", {});
        if (!response.ok) throw new Error(response.error.message);
        return response.result;
      });
    }
    case "panel.control.execute":
      return runForeground(() => {
        if (!controlGate) throw new Error(controlBlockedReason || "화면 조사 저장과 v6 로컬 실행기 연결을 먼저 완료해 주세요.");
        return controlCoordinator.execute(message.command);
      });
    case "panel.control.cancel":
      return runForeground(() => ({ cancelled: controlCoordinator.cancel() }));
    case "panel.control.retryReceipt":
      return runForeground(() => controlCoordinator.retryReceipt());
    case "panel.control.archiveReceipt":
      return runForeground(() => controlCoordinator.archiveReceipt());
    case "panel.chat.submit":
      assertProviderPanelOwner(ownerPort, message?.ownerId);
      return routeConversationPanelMessage(message, conversationDispatcher);
    case "panel.chat.describe":
      return routeConversationPanelMessage(message, conversationDispatcher);
    case "panel.chat.get":
      if (conversationDispatcher.status().running) {
        if (!controlGate) return { task: null };
        return taskCoordinator.get();
      }
      return runForeground(() => {
        if (!controlGate) return { task: null };
        return taskCoordinator.get();
      });
    case "panel.chat.cancel": {
      const conversation = conversationDispatcher.cancel();
      if (conversation.cancelled) {
        if (conversation.phase === "control") {
          const result = await taskCoordinator.cancel();
          return result?.task ? result : { task: null };
        }
        return { task: null };
      }
      if (conversation.phase === "source") return { task: null };
      return runForeground(() => {
        if (!controlGate) return { task: null };
        return taskCoordinator.cancel();
      });
    }
    case "panel.source.search":
      return sourceActivity.runSource(() => routeSourcePanelMessage(message, sourceCoordinator));
    case "panel.source.describe":
      return sourceActivity.runSource(() => routeSourcePanelMessage(message, sourceCoordinator));
    case "panel.provider.status":
    case "panel.provider.get":
    case "panel.provider.cancel":
    case "panel.provider.select":
    case "panel.provider.confirm":
    case "panel.provider.reject":
      assertProviderPanelOwner(ownerPort, message?.ownerId);
      return routeProviderPanelMessage(message, providerCoordinator);
    case "panel.provider.connect":
    case "panel.provider.models":
    case "panel.provider.disconnect":
    case "panel.provider.reset":
      assertProviderPanelOwner(ownerPort, message?.ownerId);
      if (financialCoordinator.snapshot().running) throw new Error("금융 조회 또는 자격 증명 작업이 진행 중입니다.");
      return runForeground(() => routeProviderPanelMessage(message, providerCoordinator));
    case "panel.financial.credentials.status":
      return runForeground(() => financialCoordinator.credentialsStatus(message.mutationId ?? null));
    case "panel.financial.credentials.configure":
      return runForeground(() => financialCoordinator.configure(message.params));
    case "panel.financial.credentials.delete":
      return runForeground(() => financialCoordinator.deleteProfile(message.params));
    case "panel.financial.query.start":
      return runForeground(() => financialCoordinator.start(message.params));
    case "panel.financial.query.status":
      return runForeground(() => financialCoordinator.status(message.jobId));
    case "panel.financial.query.page":
      return runForeground(() => financialCoordinator.page(message.params));
    case "panel.financial.query.continue":
      return runForeground(() => financialCoordinator.continueQuery(message.params));
    case "panel.financial.query.cancel":
      return runForeground(() => financialCoordinator.cancel(message.params));
    default:
      throw new Error("지원하지 않는 사이드패널 요청입니다.");
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handlePanelMessage(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof Error && typeof error.code === "string" ? error.code : null,
    }));
  return true;
});

chrome.runtime.onConnect.addListener((port) => {
  let ownerId = null;
  let ownerAttached = false;
  const pendingRequests = new Set();
  const cleanupOwner = () => {
    if (!ownerAttached) return;
    ownerAttached = false;
    pendingRequests.clear();
    if (providerPanelOwner?.port !== port || providerPanelOwner.ownerId !== ownerId) return;
    providerPanelOwner = null;
    if (conversationDispatcher.status().phase === "routing") conversationDispatcher.cancel();
    providerCoordinator.detachOwner(ownerId);
  };
  const postResponse = (response) => {
    if (!ownerAttached || providerPanelOwner?.port !== port) return;
    try { port.postMessage(response); } catch {
      cleanupOwner();
      try { port.disconnect(); } catch {}
    }
  };
  try {
    assertPanelSender(port.sender);
    if (port.name !== "athena-provider-panel-v1") throw new Error("지원하지 않는 패널 연결입니다.");
    ownerId = crypto.randomUUID();
    providerCoordinator.attachOwner(ownerId);
    ownerAttached = true;
    providerPanelOwner = { ownerId, port };
    port.onDisconnect.addListener(cleanupOwner);
    port.onMessage.addListener((envelope) => {
      if (!ownerAttached || providerPanelOwner?.port !== port) return;
      const requestId = envelope?.requestId;
      if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) return;
      if (pendingRequests.has(requestId)) return;
      if (pendingRequests.size >= 16) {
        postResponse({ type: "provider.response", requestId, ok: false, error: "ChatGPT 패널 요청이 많습니다. 진행 중인 요청이 끝난 뒤 다시 시도해 주세요.", errorCode: null });
        return;
      }
      pendingRequests.add(requestId);
      void (async () => {
        assertProviderPanelOwner(port, envelope.ownerId);
        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
            Object.keys(envelope).sort().join(",") !== "message,ownerId,requestId,type" || envelope.type !== "provider.request" ||
            !envelope.message || typeof envelope.message !== "object" || Array.isArray(envelope.message) ||
            !PROVIDER_PANEL_REQUESTS.has(envelope.message.type) || Object.hasOwn(envelope.message, "ownerId")) {
          throw new Error("ChatGPT 패널 요청 형식이 올바르지 않습니다.");
        }
        return handlePanelMessage({ ...envelope.message, ownerId }, port.sender, port);
      })().then((result) => postResponse({ type: "provider.response", requestId, ok: true, result }))
        .catch((error) => postResponse({
          type: "provider.response", requestId, ok: false,
          error: error instanceof Error ? error.message : String(error),
          errorCode: error instanceof Error && typeof error.code === "string" ? error.code : null,
        })).finally(() => pendingRequests.delete(requestId));
    });
    port.postMessage({ type: "provider.owner", ownerId });
  } catch (error) {
    cleanupOwner();
    try { port.postMessage({ type: "provider.owner.error", error: error instanceof Error ? error.message : String(error) }); } catch {}
    try { port.disconnect(); } catch {}
  }
});

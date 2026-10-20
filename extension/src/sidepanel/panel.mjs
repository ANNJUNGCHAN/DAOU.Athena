import { performDisconnect } from "./panel-actions.mjs";
import { createNativeClient } from "../native-client.mjs";
import {
  createNativeDiagnostic,
  formatNativeDiagnostic,
  mountNativeDiagnostic,
  runDirectNativeProbe,
} from "./native-diagnostic.mjs";
import {
  appendSessionEntry,
  appendSubmissionInput,
  createChatTaskView,
  isTaskRunning,
  mergeConversationResult,
  mergeTaskMessages,
  settleSubmissionMessages,
} from "./panel-chat.mjs";
import { createTaskPollingController } from "./panel-chat-polling.mjs";
import {
  canStartPanelConversation,
  canStopPanelConversation,
  createPanelConversationController,
  createSourceActivityPoller,
  formatPanelConversationError,
  normalizeConversationText,
  readPanelHealth,
  resolvePanelControlHealthMessage,
} from "./panel-source.mjs";
import { renderSourceCard } from "./source-cards.mjs";
import { createFinancialPanelController } from "./panel-financial.mjs";
import { createFinancialChartRenderer } from "./financial-chart-renderer.mjs";
import { createProviderPanelController } from "./provider-panel.mjs";
import {
  HOST_NAME,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from "../contracts/wts-foundation.mjs";
import schema from "../contracts/wts-foundation.schema.mjs";

const elements = {
  tab: document.querySelector("#tab-status"),
  connection: document.querySelector("#connection-status"),
  count: document.querySelector("#observation-count"),
  connect: document.querySelector("#connect"),
  disconnect: document.querySelector("#disconnect"),
  collect: document.querySelector("#collect"),
  discard: document.querySelector("#discard"),
  message: document.querySelector("#message"),
  chatLog: document.querySelector("#chat-log"),
  chatInput: document.querySelector("#chat-input"),
  chatSend: document.querySelector("#chat-send"),
  chatStop: document.querySelector("#chat-stop"),
  provider: {
    status: document.querySelector("#provider-status"),
    operation: document.querySelector("#provider-operation"),
    connect: document.querySelector("#provider-connect"),
    disconnect: document.querySelector("#provider-disconnect"),
    reset: document.querySelector("#provider-reset"),
    model: document.querySelector("#provider-model"),
    models: document.querySelector("#provider-models"),
    refresh: document.querySelector("#provider-refresh"),
    cancel: document.querySelector("#provider-cancel"),
    proposal: document.querySelector("#provider-proposal"),
    assistant: document.querySelector("#provider-assistant-text"),
    command: document.querySelector("#provider-command-text"),
    execute: document.querySelector("#provider-execute"),
    reject: document.querySelector("#provider-reject"),
  },
  exampleChips: [...document.querySelectorAll("[data-command]")],
  taskCard: document.querySelector("#task-card"),
  taskId: document.querySelector("#task-id"),
  taskStatus: document.querySelector("#task-status"),
  taskProgress: document.querySelector("#task-progress"),
  taskSteps: document.querySelector("#task-steps"),
  taskRefresh: document.querySelector("#task-refresh"),
  retryReceipt: document.querySelector("#retry-receipt"),
  archiveReceipt: document.querySelector("#archive-receipt"),
  controlMessage: document.querySelector("#control-message"),
  sourceRefresh: document.querySelector("#source-refresh"),
  sourceMessage: document.querySelector("#source-message"),
};

const taskActionFormatOptions = Object.freeze({
  marketMenuTargetById: new Map(MARKET_MENU_TARGETS.map((target) => [target.id, target])),
  marketNavigateActionId: MARKET_NAVIGATE_ACTION_ID,
  sitemapOpenActionId: SITEMAP_OPEN_ACTION_ID,
});

const nativeDiagnostic = createNativeDiagnostic({ runtime: chrome.runtime, hostName: HOST_NAME });
const financialPanel = createFinancialPanelController({
  document,
  send,
  chartRenderer: createFinancialChartRenderer(),
});
const nativeDiagnosticElements = mountNativeDiagnostic(document, elements.message.parentElement);
function renderNativeDiagnostic() {
  nativeDiagnosticElements.output.textContent = formatNativeDiagnostic(nativeDiagnostic.snapshot());
}
renderNativeDiagnostic();
let directProbeRunning = false;

let controlReady = false;
let pendingReceipt = false;
let controlRunning = false;
let captureRunning = false;
let wtsOpen = false;
let nativeConnected = false;
let sourceConfigured = false;
let serverSourceRunning = false;
let localConversationRunning = false;
let localConversationPhase = "idle";
let serverConversationRunning = false;
let serverConversationRouting = false;
let serverConversationPhase = "idle";
let disconnecting = false;
let stopRequestRunning = false;
let providerBusy = false;
let providerPanel = null;
let pendingCapture = false;
let sourceActivityPoller = null;
let sourceRefreshVisible = false;
let currentTask = null;
let lastControlHealth = null;
let controlMessageKind = "health";
let sessionMessages = [];
const renderedMessageKeys = new Set();

function setControlMessage(text, kind = "activity") {
  elements.controlMessage.textContent = text;
  controlMessageKind = kind;
}

function renderControlHealth(health) {
  const message = resolvePanelControlHealthMessage(health, {
    taskPresent: Boolean(currentTask),
    conversationRunning: conversationBusy(),
    sourceRunning: sourceBusy(),
    controlRunning,
    messageKind: controlMessageKind,
  });
  if (!message) return false;
  setControlMessage(message, "health");
  return true;
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...payload });
  if (!response?.ok) {
    const error = new Error(response?.error || "확장 프로그램 요청에 실패했습니다.");
    if (typeof response?.errorCode === "string") error.code = response.errorCode;
    throw error;
  }
  return response.result;
}

function addConversationError(submissionId, error) {
  sessionMessages = appendSessionEntry(settleSubmissionMessages(sessionMessages, submissionId), {
    key: `${submissionId}:error`,
    kind: "text",
    role: "assistant",
    label: "ATHENA 로컬 실행기",
    text: formatPanelConversationError(error),
  });
  renderSessionMessages();
}

function invalidateConversation() {
  const submissionId = conversationController.invalidate();
  if (!submissionId) return;
  sessionMessages = settleSubmissionMessages(sessionMessages, submissionId);
  renderSessionMessages();
}

const conversationController = createPanelConversationController({
  request(type, payload) {
    if (type !== "panel.chat.submit") return send(type, payload);
    return providerPanel.request(type, payload);
  },
  onResult(result) {
    sessionMessages = mergeConversationResult(sessionMessages, result);
    if (result.kind === "control-task") taskPoller.accept(result.task);
    else renderSessionMessages();
    if (result.kind === "provider-pending") providerPanel?.trackOperation(result);
    if (result.kind === "source-card") {
      elements.sourceMessage.textContent = "기능 메타데이터만 표시했습니다. 실제 금융 데이터는 조회하지 않았습니다.";
      if (result.card?.kind === "capability-detail") financialPanel.showOperation(result.card);
    } else if (result.kind === "unsupported") {
      setControlMessage(result.message, "result");
    }
  },
  onError({ submissionId, error }) {
    addConversationError(submissionId, error);
    setControlMessage(formatPanelConversationError(error), "error");
  },
  onRunningChange(running, phase) {
    localConversationRunning = running;
    localConversationPhase = phase;
    if (running) sourceActivityPoller?.observe(true);
    if (!running) {
      if (!serverConversationRunning && !serverSourceRunning) sourceActivityPoller?.stop();
    }
    refreshControlButtons();
  },
});

function conversationPhase() {
  if (serverConversationRouting) return "routing";
  if (serverConversationRunning) return serverConversationPhase;
  if (localConversationRunning) return localConversationPhase;
  return "idle";
}

function conversationBusy() {
  return localConversationRunning || serverConversationRunning || providerBusy;
}

function sourceBusy() {
  return serverSourceRunning || conversationPhase() === "source";
}

function canStartConversation() {
  return canStartPanelConversation({
    connected: nativeConnected,
    controlReady,
    sourceConfigured,
    conversationRunning: conversationBusy(),
    sourceRunning: sourceBusy(),
    disconnecting,
    captureRunning,
    directProbeRunning,
    pendingCapture,
    pendingReceipt,
    controlRunning,
    taskRunning: isTaskRunning(currentTask),
  });
}

function canDescribeSource() {
  return sourceConfigured && canStartConversation();
}

function setConnected(connected) {
  const wasConnected = nativeConnected;
  nativeConnected = connected;
  if (!connected) {
    sourceConfigured = false;
    serverSourceRunning = false;
    serverConversationRunning = false;
    serverConversationRouting = false;
    serverConversationPhase = "idle";
    sourceActivityPoller?.stop();
    sourceRefreshVisible = false;
    if (wasConnected) invalidateConversation();
  }
  elements.connection.textContent = connected ? "연결됨" : "연결 안 됨";
  elements.connect.disabled = connected;
  elements.disconnect.disabled = !connected;
  elements.collect.disabled = !connected;
  if (!connected) stopTaskPolling();
  refreshControlButtons();
}

function setPending(pending) {
  pendingCapture = pending;
  elements.collect.textContent = pending ? "동일한 캡처 저장 재시도" : "현재 화면 조사";
  refreshControlButtons();
}

function refreshControlButtons() {
  const connected = nativeConnected;
  const taskRunning = isTaskRunning(currentTask);
  const sourceIsBusy = sourceBusy();
  const conversationIsBusy = conversationBusy();
  const unavailable = !canStartConversation();
  const phase = conversationPhase();
  elements.disconnect.disabled = !connected || controlRunning || taskRunning || disconnecting;
  elements.collect.disabled = !connected || !wtsOpen || controlRunning || taskRunning || conversationIsBusy || sourceIsBusy || captureRunning || disconnecting;
  elements.discard.disabled = !pendingCapture || conversationIsBusy || sourceIsBusy || captureRunning || disconnecting;
  elements.chatInput.disabled = unavailable;
  const inputLength = elements.chatInput.value.trim().length;
  elements.chatSend.disabled = unavailable || inputLength < 1 || inputLength > 512;
  for (const chip of elements.exampleChips) chip.disabled = unavailable;
  elements.chatStop.disabled = stopRequestRunning || !canStopPanelConversation({
    connected,
    conversationRunning: conversationIsBusy,
    phase,
    taskRunning,
    taskStatus: currentTask?.status,
  });
  elements.retryReceipt.disabled = !connected || !pendingReceipt || controlRunning || taskRunning || conversationIsBusy || sourceIsBusy || disconnecting;
  elements.archiveReceipt.disabled = !pendingReceipt || controlRunning || taskRunning || conversationIsBusy || sourceIsBusy || disconnecting;
  elements.sourceRefresh.hidden = !sourceRefreshVisible;
  elements.sourceRefresh.disabled = !connected || disconnecting;
  for (const button of elements.chatLog.querySelectorAll(".source-card button")) button.disabled = !canDescribeSource();
  nativeDiagnosticElements.probeButton.disabled = directProbeRunning || conversationIsBusy || sourceIsBusy || disconnecting;
}

function requestSourceDetail(submissionId, payload) {
  if (!canDescribeSource()) {
    elements.sourceMessage.textContent = "다른 로컬 작업이 진행 중이거나 메타데이터 소스를 사용할 수 없습니다.";
    return;
  }
  elements.sourceMessage.textContent = "기능 상세 메타데이터를 확인하는 중…";
  void conversationController.describe({ submissionId, ...payload });
}

function renderSessionMessages() {
  const currentKeys = new Set(sessionMessages.map((message) => message.key));
  for (const child of [...elements.chatLog.children]) {
    if (currentKeys.has(child.dataset.messageKey)) continue;
    renderedMessageKeys.delete(child.dataset.messageKey);
    child.remove();
  }
  for (const message of sessionMessages) {
    if (renderedMessageKeys.has(message.key)) continue;
    const item = document.createElement("li");
    item.className = "chat-message";
    item.dataset.kind = message.kind;
    item.dataset.role = message.role;
    item.dataset.messageKey = message.key;
    const label = document.createElement("strong");
    label.textContent = message.label;
    item.append(label);
    if (message.kind === "source-card") {
      const host = document.createElement("div");
      host.className = "conversation-card-host";
      item.append(host);
      const rendered = renderSourceCard({
        document,
        container: host,
        state: { status: "ready", card: message.card },
        onDescribe: message.card.kind === "capability-list"
          ? (payload) => requestSourceDetail(message.submissionId, payload)
          : undefined,
      });
      if (rendered.status === "error") throw new TypeError("validated source card could not be rendered");
    } else {
      const text = document.createElement("span");
      text.textContent = message.text;
      item.append(text);
    }
    elements.chatLog.append(item);
    renderedMessageKeys.add(message.key);
  }
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
  refreshControlButtons();
}

function renderTask(task) {
  currentTask = task || null;
  const view = createChatTaskView(currentTask, taskActionFormatOptions);
  elements.taskCard.hidden = !view.visible;
  elements.taskId.textContent = view.id;
  elements.taskStatus.textContent = view.status;
  const progressText = `${view.progress} · ${view.status}`;
  if (elements.taskProgress.textContent !== progressText) elements.taskProgress.textContent = progressText;
  if (currentTask) setControlMessage(view.message, "task");
  else {
    const previousMessageKind = controlMessageKind;
    controlMessageKind = "health";
    if (!renderControlHealth(lastControlHealth)) {
      if (conversationBusy() || sourceBusy() || controlRunning) controlMessageKind = previousMessageKind;
      else setControlMessage(view.message, "idle");
    }
  }

  elements.taskSteps.replaceChildren();
  for (const step of view.steps) {
    const item = document.createElement("li");
    item.className = "task-step";
    item.dataset.state = step.state;
    const action = document.createElement("span");
    action.textContent = step.action;
    const status = document.createElement("span");
    status.textContent = step.status;
    item.append(action, status);
    elements.taskSteps.append(item);
  }

  sessionMessages = mergeTaskMessages(sessionMessages, currentTask);
  renderSessionMessages();
}

function handleTaskUpdate(task) {
  elements.taskRefresh.hidden = true;
  renderTask(task);
}

function showTaskRefreshError(error, { willRetry, delay }) {
  elements.taskRefresh.hidden = false;
  elements.taskRefresh.disabled = false;
  setControlMessage(willRetry
    ? `작업 상태 확인에 실패했습니다. ${Math.ceil(delay / 1000)}초 뒤 다시 확인합니다: ${error.message}`
    : `작업 상태를 확인하지 못했습니다. 새로고침으로 상태만 다시 조회할 수 있습니다: ${error.message}`, "error");
}

function showTaskPollingStalled() {
  elements.taskRefresh.hidden = false;
  elements.taskRefresh.disabled = false;
  setControlMessage("작업 상태가 오래 바뀌지 않아 자동 확인을 멈췄습니다. 상태 새로고침은 화면 동작을 다시 실행하지 않습니다.", "error");
}

const taskPoller = createTaskPollingController({
  async fetchTask() {
    const result = await send("panel.chat.get");
    return result.task;
  },
  onTask: handleTaskUpdate,
  onError: showTaskRefreshError,
  onStalled: showTaskPollingStalled,
});

providerPanel = createProviderPanelController({
  runtime: chrome.runtime,
  elements: elements.provider,
  onPortDisconnect: invalidateConversation,
  onBusyChange(value) {
    providerBusy = value;
    refreshControlButtons();
  },
  onPlanTerminal({ submissionId, terminal, proposal }) {
    if (!submissionId) return;
    sessionMessages = settleSubmissionMessages(sessionMessages, submissionId);
    const text = terminal.state === "succeeded"
      ? String(terminal.result?.assistantText || "ChatGPT 응답을 받았습니다.")
      : String(terminal.error?.message || "ChatGPT 요청이 완료되지 않았습니다.");
    sessionMessages = appendSessionEntry(sessionMessages, {
      key: `${submissionId}:provider:${terminal.state}`,
      kind: "text",
      role: "assistant",
      label: "ChatGPT",
      text,
    });
    renderSessionMessages();
    setControlMessage(proposal ? "ChatGPT의 WTS 실행 제안을 확인해 주세요." : "ChatGPT 응답을 표시했습니다.", "result");
  },
  onControlResult(result) {
    if (result?.kind === "control-task" && result.task) {
      sessionMessages = mergeTaskMessages(sessionMessages, result.task);
      taskPoller.accept(result.task);
    }
  },
});

function stopTaskPolling() {
  taskPoller.stop();
}

async function refreshChatTask() {
  if (elements.connection.textContent !== "연결됨") return { ok: false, error: new Error("로컬 실행기에 연결되어 있지 않습니다.") };
  return taskPoller.refreshOnce();
}

async function loadAndMonitorCurrentTask() {
  const refreshed = await refreshChatTask();
  if (refreshed.ok && isTaskRunning(currentTask)) taskPoller.start(currentTask);
  if (!refreshed.ok) {
    taskPoller.startUnknown();
    showTaskRefreshError(refreshed.error, { willRetry: true, delay: 500 });
  }
  return refreshed.ok;
}

function applyControlHealth(health) {
  lastControlHealth = health;
  if (typeof health?.controlReady === "boolean") controlReady = health.controlReady;
  if (typeof health?.pendingReceipt === "boolean") pendingReceipt = health.pendingReceipt;
  if (typeof health?.controlRunning === "boolean") controlRunning = health.controlRunning;
  renderControlHealth(health);
  refreshControlButtons();
}

function renderSourceStatus() {
  if (sourceRefreshVisible) return;
  if (!nativeConnected) elements.sourceMessage.textContent = "로컬 실행기에 연결해 주세요.";
  else if (!sourceConfigured) elements.sourceMessage.textContent = "이 로컬 실행기에는 기능 메타데이터 소스가 구성되어 있지 않습니다.";
  else if (conversationPhase() === "source" || serverSourceRunning) {
    elements.sourceMessage.textContent = "로컬 기능 메타데이터를 확인하는 중입니다. 중지는 사용할 수 없으며 연결 해제로 취소할 수 있습니다.";
  } else elements.sourceMessage.textContent = "‘조회 기능 찾아줘: 검색어’ 요청은 로컬 메타데이터만 확인합니다.";
}

function applyHealth(health, { reconcileSource = true } = {}) {
  setConnected(Boolean(health?.connected));
  providerPanel?.applyNativeConnection(Boolean(health?.connected));
  const configured = health?.runtime?.source?.configured ?? health?.sourceConfigured;
  if (typeof configured === "boolean") sourceConfigured = configured;
  if (typeof health?.sourceRunning === "boolean") serverSourceRunning = health.sourceRunning;
  if (typeof health?.conversationRunning === "boolean") serverConversationRunning = health.conversationRunning;
  if (typeof health?.conversationRouting === "boolean") serverConversationRouting = health.conversationRouting;
  if (["idle", "routing", "control", "source", "provider-planning", "awaiting-confirmation"].includes(health?.conversationPhase)) {
    serverConversationPhase = health.conversationPhase;
  }
  if (!serverSourceRunning && !serverConversationRunning && !localConversationRunning) sourceRefreshVisible = false;
  if (reconcileSource) {
    sourceActivityPoller?.observe(serverSourceRunning || serverConversationRunning || localConversationRunning);
  }
  if (typeof health?.pendingCapture === "boolean") setPending(health.pendingCapture);
  applyControlHealth(health);
  renderSourceStatus();
  if (!health?.connected && health?.error) elements.message.textContent = health.error;
  void financialPanel.applyConnection(health);
}

async function refreshHealth() {
  const outcome = await readPanelHealth({
    readHealth: () => send("panel.health"),
    onHealth: applyHealth,
    onError() {
      sourceRefreshVisible = nativeConnected;
      if (conversationBusy() || sourceBusy()) sourceActivityPoller?.observe(true);
      elements.message.textContent = "로컬 실행기 상태를 확인하지 못했습니다. 마지막으로 확인된 연결과 작업 상태를 유지합니다.";
      if (nativeConnected) {
        elements.sourceMessage.textContent = "상태 읽기에 실패했습니다. 활동 상태 다시 확인으로 상태만 재조회할 수 있습니다.";
      }
      refreshControlButtons();
    },
  });
  await refreshTab();
  return outcome;
}

sourceActivityPoller = createSourceActivityPoller({
  readHealth: () => send("panel.health"),
  onHealth: (health) => applyHealth(health, { reconcileSource: false }),
  delayMs: 250,
  maxChecks: 240,
  isRunning: (health) => localConversationRunning || health?.conversationRunning === true || health?.sourceRunning === true,
  onError() {
    sourceRefreshVisible = true;
    elements.sourceMessage.textContent = "로컬 작업 상태를 확인하지 못했습니다. 자동 재시도 중이며 직접 다시 확인할 수도 있습니다.";
    refreshControlButtons();
  },
  onStalled() {
    sourceRefreshVisible = true;
    elements.sourceMessage.textContent = "로컬 작업 상태 확인을 멈췄습니다. 활동 상태 다시 확인은 화면 동작을 실행하지 않습니다.";
    refreshControlButtons();
  },
});

async function refreshTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  wtsOpen = false;
  try {
    const url = new URL(tab?.url || "");
    wtsOpen = url.origin === "https://wts.kiwoom.com";
  } catch {}
  elements.tab.textContent = wtsOpen ? "열림" : "찾지 못함";
  refreshControlButtons();
}

async function refreshSummary() {
  const summary = await send("panel.summary");
  elements.count.textContent = `${summary.captureCount} / ${summary.observationCount}`;
}

elements.connect.addEventListener("click", async () => {
  const attempt = nativeDiagnostic.beginAttempt();
  renderNativeDiagnostic();
  elements.message.textContent = "로컬 실행기에 연결하는 중…";
  try {
    const health = await send("panel.connect");
    invalidateConversation();
    applyHealth(health);
    await refreshSummary();
    await refreshTab();
    await loadAndMonitorCurrentTask();
    elements.message.textContent = "로컬 저장소에 연결되었습니다.";
    nativeDiagnostic.succeed(attempt.attemptId);
    renderNativeDiagnostic();
  } catch (error) {
    await refreshHealth();
    nativeDiagnostic.fail(attempt.attemptId, error.message);
    renderNativeDiagnostic();
    elements.message.textContent = error.message;
  }
});

nativeDiagnosticElements.probeButton.addEventListener("click", async () => {
  if (directProbeRunning || conversationBusy() || sourceBusy() || disconnecting) return;
  directProbeRunning = true;
  nativeDiagnosticElements.probeButton.disabled = true;
  refreshControlButtons();
  const attempt = nativeDiagnostic.beginAttempt("direct-panel");
  renderNativeDiagnostic();
  const validator = createProtocolValidator(schema);
  const client = createNativeClient({
    connectNative: (hostName) => chrome.runtime.connectNative(hostName),
    validateRequest: validator.validateRequest,
    validateResponse: validator.validateResponse,
    maxMessageBytes: MAX_MESSAGE_BYTES,
  });
  try {
    const hello = await runDirectNativeProbe({
      client,
      hostName: HOST_NAME,
      protocolVersion: PROTOCOL_VERSION,
      requestId: attempt.attemptId,
    });
    nativeDiagnostic.succeed(attempt.attemptId, `runtime.hello 응답 확인 (${hello.runtimeVersion})`);
  } catch (error) {
    nativeDiagnostic.fail(attempt.attemptId, error.message);
  } finally {
    directProbeRunning = false;
    refreshControlButtons();
    renderNativeDiagnostic();
  }
});

elements.disconnect.addEventListener("click", async () => {
  disconnecting = true;
  sourceActivityPoller.stop();
  invalidateConversation();
  refreshControlButtons();
  await performDisconnect({
    send,
    async onDisconnected() {
      setConnected(false);
      controlReady = false;
      controlRunning = false;
      disconnecting = false;
      taskPoller.start(null);
      refreshControlButtons();
      elements.message.textContent = "로컬 실행기 연결을 해제했습니다.";
    },
    async onRejected(error) {
      disconnecting = false;
      await refreshHealth();
      elements.message.textContent = error.message;
    },
  });
});

elements.collect.addEventListener("click", async () => {
  if (conversationBusy() || sourceBusy() || disconnecting) return;
  captureRunning = true;
  elements.collect.disabled = true;
  refreshControlButtons();
  elements.message.textContent = "현재 WTS 화면 구조를 조사하는 중…";
  try {
    const result = await send("panel.collectAndStore");
    setPending(false);
    await refreshSummary();
    if (result.control) {
      controlReady = Boolean(result.control.ready);
      setControlMessage(result.control.ready
        ? "화면 조사가 저장되어 지원되는 WTS 화면 작업이 활성화됐습니다."
        : result.control.reason, "health");
      refreshControlButtons();
    }
    elements.message.textContent = `${result.observationCount}개 프레임을 하나의 캡처로 로컬에 저장했습니다.${result.retried ? " 보류된 캡처를 동일하게 재시도했습니다." : ""}${result.truncated ? " 일부는 크기 제한에 맞춰 잘랐습니다." : ""}`;
  } catch (error) {
    await refreshHealth();
    elements.message.textContent = error.message;
  } finally {
    captureRunning = false;
    await refreshTab();
  }
});

elements.sourceRefresh.addEventListener("click", async () => {
  if (disconnecting || !nativeConnected) return;
  sourceActivityPoller.stop();
  elements.sourceRefresh.disabled = true;
  elements.sourceMessage.textContent = "로컬 작업 상태를 다시 확인하는 중…";
  try {
    const health = await send("panel.health");
    applyHealth(health);
    if (health.sourceRunning === true || health.conversationRunning === true) {
      sourceRefreshVisible = true;
      elements.sourceMessage.textContent = "로컬 대화 작업이 아직 진행 중입니다. 상태만 계속 확인합니다.";
    }
  } catch {
    sourceRefreshVisible = true;
    elements.sourceMessage.textContent = "로컬 작업 상태를 확인하지 못했습니다. 활동 상태 다시 확인으로 재시도할 수 있습니다.";
  } finally {
    refreshControlButtons();
  }
});

async function submitChat() {
  if (elements.chatSend.disabled || disconnecting) return;
  let text;
  try {
    text = normalizeConversationText(elements.chatInput.value);
  } catch {
    setControlMessage("한 글자 이상 512자 이하의 요청을 입력해 주세요.", "error");
    refreshControlButtons();
    return;
  }
  const submissionId = crypto.randomUUID();
  sessionMessages = appendSubmissionInput(sessionMessages, submissionId, text);
  renderSessionMessages();
  elements.chatInput.value = "";
  setControlMessage("요청 전체를 로컬에서 분류하는 중…");
  refreshControlButtons();
  await conversationController.submit(text, submissionId);
}

elements.chatSend.addEventListener("click", submitChat);
elements.chatInput.addEventListener("input", refreshControlButtons);
elements.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    submitChat();
  }
});
for (const chip of elements.exampleChips) {
  chip.addEventListener("click", () => {
    elements.chatInput.value = chip.dataset.command || "";
    elements.chatInput.focus();
    refreshControlButtons();
  });
}

elements.chatStop.addEventListener("click", async () => {
  if (elements.chatStop.disabled) return;
  stopRequestRunning = true;
  setControlMessage("중지를 요청하는 중…");
  invalidateConversation();
  refreshControlButtons();
  try {
    const result = await send("panel.chat.cancel");
    taskPoller.accept(result.task);
    if (!result.task) {
      const health = await send("panel.health");
      applyHealth(health);
      if (health.conversationPhase === "source" && health.conversationRunning === true) {
        setControlMessage("기능 메타데이터 확인이 이미 시작되어 중지하지 않았습니다. 연결 해제로 취소할 수 있습니다.", "result");
      } else {
        setControlMessage("요청 표시를 중지했습니다. 실행 전 취소되었거나 이미 끝난 메타데이터 확인일 수 있으며, 자동으로 다시 실행하지 않습니다.", "result");
      }
    } else if (result.task.status === "cancel_requested") {
      setControlMessage("현재 단계의 결과를 확인한 뒤 멈춥니다. 진행 중인 클릭을 다시 실행하지 않습니다.", "task");
    }
  } catch (error) {
    setControlMessage(error.message, "error");
  } finally {
    stopRequestRunning = false;
    refreshControlButtons();
  }
});

elements.taskRefresh.addEventListener("click", async () => {
  elements.taskRefresh.disabled = true;
  taskPoller.stop();
  const refreshed = await refreshChatTask();
  if (refreshed.ok && isTaskRunning(currentTask) && !taskPoller.running()) {
    elements.taskRefresh.hidden = false;
    elements.taskRefresh.disabled = false;
    setControlMessage(`${currentTask.message} 자동 확인은 멈춰 있으며, 상태 새로고침은 화면 동작을 다시 실행하지 않습니다.`, "task");
  } else if (!elements.taskRefresh.hidden) {
    elements.taskRefresh.disabled = false;
  }
});

elements.retryReceipt.addEventListener("click", async () => {
  if (disconnecting || conversationBusy() || sourceBusy()) return;
  elements.retryReceipt.disabled = true;
  try {
    await send("panel.control.retryReceipt");
    pendingReceipt = false;
    setControlMessage("동일한 결과 영수증을 로컬에 저장했습니다.", "result");
  } catch (error) {
    setControlMessage(error.message, "error");
  } finally {
    refreshControlButtons();
  }
});

elements.archiveReceipt.addEventListener("click", async () => {
  if (disconnecting || conversationBusy() || sourceBusy()) return;
  elements.archiveReceipt.disabled = true;
  try {
    await send("panel.control.archiveReceipt");
    pendingReceipt = false;
    setControlMessage("미확인 결과를 별도 보관했습니다. 실행 성공 증거나 LAYA 학습 자료로 취급하지 않습니다.", "result");
  } catch (error) {
    setControlMessage(error.message, "error");
  } finally {
    refreshControlButtons();
  }
});

elements.discard.addEventListener("click", async () => {
  if (disconnecting || conversationBusy() || sourceBusy()) return;
  try {
    await send("panel.discardPending");
    setPending(false);
    elements.message.textContent = "실패한 캡처를 폐기했습니다. 다음 조사는 새 캡처로 시작합니다.";
  } catch (error) {
    elements.message.textContent = error.message;
  }
});

chrome.tabs.onActivated.addListener(refreshTab);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.url) refreshTab();
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === "native.status") applyHealth(message.status);
  if (message?.type === "financial.status") {
    void financialPanel.applyConnection({ connected: nativeConnected, financial: message.state });
  }
  if (message?.type === "task.status") taskPoller.accept(message.task);
  if (message?.type === "task.error") {
    taskPoller.stop();
    showTaskRefreshError(new Error(message.error || "작업 실행 중 오류가 발생했습니다."), { willRetry: false, delay: null });
  }
});
window.addEventListener("focus", async () => {
  await refreshHealth();
});

const initialHealth = await readPanelHealth({
  readHealth: () => send("panel.health"),
  onHealth: applyHealth,
  onError() {
    elements.message.textContent = "로컬 실행기 상태를 확인하지 못했습니다. 연결 버튼으로 다시 시도할 수 있습니다.";
  },
});
await refreshTab();
if (initialHealth.ok && initialHealth.health.connected) {
  try {
    await refreshSummary();
  } catch {
    elements.message.textContent = "로컬 저장 요약을 확인하지 못했습니다. 연결 상태는 유지합니다.";
  }
  await loadAndMonitorCurrentTask();
}

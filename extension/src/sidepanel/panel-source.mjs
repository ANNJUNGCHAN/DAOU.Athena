import { normalizeSourceCard } from "./source-cards.mjs";

const CONVERSATION_KINDS = new Set(["control-task", "source-card", "unsupported", "provider-pending"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function normalizeConversationText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 1 || text.length > 512) {
    throw new TypeError("한 글자 이상 512자 이하의 요청을 입력해 주세요.");
  }
  return text;
}

function validateResult(result, submissionId, expectedKind = null) {
  if (!result || result.submissionId !== submissionId || !CONVERSATION_KINDS.has(result.kind) ||
      (expectedKind && result.kind !== expectedKind)) {
    throw new TypeError("conversation response is invalid");
  }
  if (result.kind === "control-task" && !result.task) throw new TypeError("conversation task is missing");
  if (result.kind === "provider-pending") {
    const operation = result.operation;
    if (!UUID_PATTERN.test(operation?.operationId) || operation.kind !== "plan" || operation.state !== "running" ||
        !Number.isInteger(operation.revision) || operation.revision < 1 || typeof operation.cancellable !== "boolean") {
      throw new TypeError("conversation provider operation is invalid");
    }
  }
  if (result.kind === "source-card") {
    if (!result.card) throw new TypeError("conversation card is missing");
    return { ...result, card: normalizeSourceCard(result.card) };
  }
  if (result.kind === "unsupported" && typeof result.message !== "string") {
    throw new TypeError("conversation message is missing");
  }
  return result;
}

export function formatPanelConversationError(error) {
  const knownCodes = {
    PROVIDER_MODEL_NOT_SELECTED: "ChatGPT 모델이 선택되지 않았습니다. 모델을 선택한 뒤 새 요청으로 보내 주세요.",
    PROVIDER_MODEL_CATALOG_REQUIRED: "ChatGPT 모델 목록을 불러온 뒤 사용할 모델을 선택해 주세요.",
    PROVIDER_BUSY: "다른 ChatGPT 작업이 진행 중입니다. 현재 작업 상태를 먼저 확인해 주세요.",
    PROVIDER_PREVIOUS_RESULT_PENDING: "이전 ChatGPT 작업 결과를 먼저 확인해 주세요.",
  };
  let message = Object.hasOwn(knownCodes, error?.code) ? knownCodes[error.code] : null;
  if (!message && error?.message === "현재 열린 ChatGPT 패널 소유자가 아닙니다.") {
    message = "ChatGPT 패널 연결을 확인할 수 없습니다. 패널을 닫고 다시 열어 주세요.";
  }
  if (!message && error?.message === "로컬 실행기 응답 시간이 초과되었습니다. 요청은 자동 재시도하지 않습니다.") {
    message = "로컬 실행기의 응답 시간이 초과되었습니다. 연결과 작업 상태를 먼저 확인해 주세요.";
  }
  return `${message || "요청을 완료하지 못했습니다."} 자동으로 다시 실행하지 않습니다.`;
}

export function createPanelConversationController({ request, onResult, onError, onRunningChange = () => {} }) {
  if (typeof request !== "function" || typeof onResult !== "function" || typeof onError !== "function") {
    throw new TypeError("request, onResult, and onError are required");
  }
  let generation = 0;
  let running = false;
  let phase = "idle";
  let activeSubmissionId = null;

  function setRunning(next, nextPhase = "idle") {
    if (running === next && phase === nextPhase) return;
    running = next;
    phase = next ? nextPhase : "idle";
    onRunningChange(running, phase);
  }

  function invalidate() {
    const submissionId = activeSubmissionId;
    generation += 1;
    setRunning(false);
    activeSubmissionId = null;
    return submissionId;
  }

  async function run(type, payload, runPhase, expectedKind = null) {
    const requestGeneration = ++generation;
    activeSubmissionId = payload.submissionId;
    setRunning(true, runPhase);
    let result;
    try {
      result = validateResult(await request(type, payload), payload.submissionId, expectedKind);
    } catch (error) {
      if (requestGeneration !== generation) return { accepted: false, result: null };
      try {
        onError({ type, submissionId: payload.submissionId, error });
        return { accepted: true, result: null };
      } finally {
        setRunning(false);
        activeSubmissionId = null;
      }
    }
    if (requestGeneration !== generation) return { accepted: false, result: null };
    try {
      onResult(result);
      return { accepted: true, result };
    } finally {
      if (requestGeneration === generation) {
        setRunning(false);
        activeSubmissionId = null;
      }
    }
  }

  return {
    invalidate,
    running: () => running,
    phase: () => phase,
    submit(value, submissionId) {
      return run("panel.chat.submit", { text: normalizeConversationText(value), submissionId }, "routing");
    },
    describe({ submissionId, operationRef, expectedCatalogVersion }) {
      return run("panel.chat.describe", { submissionId, operationRef, expectedCatalogVersion }, "source", "source-card");
    },
  };
}

export function canStartPanelConversation(state) {
  return Boolean(state?.connected && (state?.controlReady || state?.sourceConfigured) &&
    !state?.conversationRunning && !state?.sourceRunning && !state?.disconnecting &&
    !state?.captureRunning && !state?.directProbeRunning && !state?.pendingCapture &&
    !state?.pendingReceipt && !state?.controlRunning && !state?.taskRunning);
}

export function canStopPanelConversation(state) {
  if (!state?.connected || state?.phase === "source") return false;
  if (state?.taskRunning) return state?.taskStatus !== "cancel_requested";
  return Boolean(state?.conversationRunning && ["routing", "control"].includes(state?.phase));
}

export function resolvePanelControlHealthMessage(health, state = {}) {
  if (health?.connected !== true || state.taskPresent || state.conversationRunning ||
      state.sourceRunning || state.controlRunning || ["error", "result", "task"].includes(state.messageKind)) {
    return null;
  }
  if (health.controlReady === true) return "지원되는 WTS 화면 작업을 사용할 수 있습니다.";
  if (health.controlReady !== false) return null;
  return typeof health.controlBlockedReason === "string" && health.controlBlockedReason.trim()
    ? health.controlBlockedReason
    : "현재 화면 조사 1회 저장 후 사용할 수 있습니다.";
}

export async function readPanelHealth({ readHealth, onHealth, onError = () => {} }) {
  if (typeof readHealth !== "function" || typeof onHealth !== "function" || typeof onError !== "function") {
    throw new TypeError("readHealth, onHealth, and onError must be functions");
  }
  let health;
  try {
    health = await readHealth();
  } catch (error) {
    onError(error);
    return { ok: false, error };
  }
  onHealth(health);
  return { ok: true, health };
}

export function createSourceActivityPoller({
  readHealth,
  onHealth,
  onError = () => {},
  onStalled = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
  delayMs = 1_000,
  maxChecks = 60,
  isRunning = (health) => health?.sourceRunning === true,
}) {
  if (typeof readHealth !== "function" || typeof onHealth !== "function" ||
      typeof isRunning !== "function" ||
      !Number.isInteger(delayMs) || delayMs < 100 || !Number.isInteger(maxChecks) || maxChecks < 1) {
    throw new TypeError("source activity poller configuration is invalid");
  }
  let timer = null;
  let active = false;
  let checks = 0;
  let generation = 0;
  let lastError = null;

  function stop() {
    generation += 1;
    active = false;
    checks = 0;
    lastError = null;
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function queue(expectedGeneration) {
    if (!active || timer !== null) return;
    timer = schedule(async () => {
      timer = null;
      if (!active || expectedGeneration !== generation) return;
      checks += 1;
      let health = null;
      let healthError = null;
      try {
        health = await readHealth();
        lastError = null;
      } catch (error) {
        lastError = error;
        healthError = error;
      }
      if (!active || expectedGeneration !== generation) return;
      if (healthError) onError(healthError, { check: checks, maxChecks });
      if (health) onHealth(health);
      if (health && !isRunning(health)) stop();
      else if (checks >= maxChecks) {
        active = false;
        onStalled({ checks, lastError });
      } else queue(expectedGeneration);
    }, delayMs);
  }

  return {
    observe(sourceRunning) {
      if (!sourceRunning) {
        stop();
        return;
      }
      if (active) return;
      active = true;
      checks = 0;
      lastError = null;
      generation += 1;
      queue(generation);
    },
    stop,
    active: () => active,
  };
}

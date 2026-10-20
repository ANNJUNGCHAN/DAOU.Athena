import { normalizeSourceCard } from "./source-cards.mjs";

export const SESSION_ENTRY_LIMIT = 12;
export const SESSION_BYTE_LIMIT = 256 * 1024;

const TERMINAL_TASK_STATUSES = new Set([
  "blocked",
  "completed",
  "cancelled",
  "unsupported",
  "unverified",
]);

const TASK_STATUS_LABELS = {
  ready: "실행 준비",
  awaiting_receipt: "현재 단계 확인 중",
  blocked: "중단됨",
  cancel_requested: "중지 요청됨",
  completed: "완료",
  cancelled: "취소됨",
  unsupported: "지원하지 않는 명령",
  unverified: "결과 확인 필요",
};

const STEP_STATUS_LABELS = {
  pending: "대기",
  satisfied: "이미 충족",
  awaiting_receipt: "확인 중",
  verified: "완료",
  blocked: "중단",
  cancelled: "취소",
  unverified: "확인 필요",
};

export function isTaskRunning(task) {
  return Boolean(task?.id) && !TERMINAL_TASK_STATUSES.has(task.status);
}

export function formatTaskAction(step, {
  marketMenuTargetById = new Map(),
  marketNavigateActionId,
  sitemapOpenActionId,
} = {}) {
  if (step?.actionId === "wts.main.p3.chart.open") return "차트 열기";
  if (step?.actionId === "wts.main.p3.chart.period.set") {
    if (step.args?.period === "day") return "일봉으로 전환";
    if (step.args?.period === "week") return "주봉으로 전환";
    if (step.args?.period === "month") return "월봉으로 전환";
    if (step.args?.period === "year") return "년봉으로 전환";
  }
  if (step?.actionId === sitemapOpenActionId || step?.actionId === marketNavigateActionId) {
    const target = marketMenuTargetById.get(step.args?.targetId);
    if (!target) return step.actionId;
    const destination = `${target.sitemapGroup} → ${target.buttonLabel}`;
    return step.actionId === sitemapOpenActionId
      ? `사이트맵 열기 · ${destination}`
      : `${destination} 이동`;
  }
  return step?.actionId || "알 수 없는 단계";
}

export function createChatTaskView(task, actionFormatOptions) {
  if (!task) {
    return {
      visible: false,
      id: "",
      status: "작업 없음",
      progress: "0 / 0",
      message: "명령을 입력하면 현재 WTS 화면을 확인한 뒤 한 단계씩 실행합니다.",
      running: false,
      stopAvailable: false,
      steps: [],
    };
  }

  const steps = Array.isArray(task.steps) ? task.steps : [];
  const finishedCount = steps.filter((step) => ["satisfied", "verified"].includes(step.status)).length;
  return {
    visible: true,
    id: String(task.id || ""),
    status: TASK_STATUS_LABELS[task.status] || String(task.status || "상태 확인 중"),
    progress: `${finishedCount} / ${steps.length}`,
    message: String(task.message || "현재 작업 상태를 확인하고 있습니다."),
    running: isTaskRunning(task),
    stopAvailable: isTaskRunning(task) && task.status !== "cancel_requested",
    steps: steps.map((step) => ({
      id: String(step.id || step.index),
      action: formatTaskAction(step, actionFormatOptions),
      status: STEP_STATUS_LABELS[step.status] || String(step.status || "확인 중"),
      state: String(step.status || "pending"),
    })),
  };
}

function encodedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function normalizeTextEntry(entry) {
  if (!["user", "assistant"].includes(entry?.role) || typeof entry?.key !== "string" ||
      typeof entry?.label !== "string" || typeof entry?.text !== "string") {
    throw new TypeError("conversation text entry is invalid");
  }
  return {
    key: entry.key,
    kind: "text",
    role: entry.role,
    label: entry.label,
    text: entry.text,
    terminal: entry.terminal !== false,
  };
}

function normalizeCardEntry(entry) {
  if (typeof entry?.key !== "string" || typeof entry?.submissionId !== "string") {
    throw new TypeError("conversation card entry is invalid");
  }
  return {
    key: entry.key,
    kind: "source-card",
    role: "assistant",
    label: "ATHENA 로컬 실행기",
    submissionId: entry.submissionId,
    card: normalizeSourceCard(entry.card),
    terminal: true,
  };
}

function normalizeSessionEntry(entry) {
  if (entry?.kind === "text") return normalizeTextEntry(entry);
  if (entry?.kind === "source-card") return normalizeCardEntry(entry);
  throw new TypeError("conversation entry kind is invalid");
}

export function appendSessionEntry(messages, entry, {
  maxEntries = SESSION_ENTRY_LIMIT,
  maxBytes = SESSION_BYTE_LIMIT,
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || !Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("conversation bounds are invalid");
  }
  const next = Array.isArray(messages) ? messages.map(normalizeSessionEntry) : [];
  const normalized = normalizeSessionEntry(entry);
  if (!next.some((item) => item.key === normalized.key)) next.push(normalized);
  while (next.length > maxEntries || encodedBytes(next) > maxBytes) {
    const removable = next.findIndex((item) => item.terminal);
    if (removable === -1) break;
    next.splice(removable, 1);
  }
  if (next.length > maxEntries || encodedBytes(next) > maxBytes) {
    throw new RangeError("conversation history exceeds its bounded capacity");
  }
  return next;
}

export function appendSubmissionInput(messages, submissionId, text) {
  return appendSessionEntry(messages, {
    key: `${submissionId}:input`,
    kind: "text",
    role: "user",
    label: "나",
    text,
    terminal: false,
  });
}

export function settleSubmissionMessages(messages, submissionId) {
  return Array.isArray(messages) ? messages.map((entry) => {
    const normalized = normalizeSessionEntry(entry);
    return normalized.key.startsWith(`${submissionId}:`) ? { ...normalized, terminal: true } : normalized;
  }) : [];
}

export function mergeConversationResult(messages, result) {
  if (!result || typeof result.submissionId !== "string") throw new TypeError("conversation result is invalid");
  const settled = settleSubmissionMessages(messages, result.submissionId);
  if (result.kind === "source-card") {
    return appendSessionEntry(settled, {
      key: `${result.submissionId}:card:${result.card?.canvasId || "invalid"}`,
      kind: "source-card",
      submissionId: result.submissionId,
      card: result.card,
    });
  }
  if (result.kind === "unsupported" && typeof result.message === "string") {
    return appendSessionEntry(settled, {
      key: `${result.submissionId}:unsupported`,
      kind: "text",
      role: "assistant",
      label: "ATHENA 로컬 실행기",
      text: result.message,
    });
  }
  if (result.kind === "provider-pending") {
    return appendSessionEntry(settled, {
      key: `${result.submissionId}:provider-pending`,
      kind: "text",
      role: "assistant",
      label: "ChatGPT",
      text: "ChatGPT 응답을 준비하고 있습니다.",
      terminal: false,
    });
  }
  if (result.kind === "control-task" && result.task) return mergeTaskMessages(settled, result.task);
  throw new TypeError("conversation result kind is invalid");
}

export function mergeTaskMessages(messages, task, limit = 12) {
  if (!task?.id) return Array.isArray(messages) ? messages.map(normalizeSessionEntry) : [];
  let next = Array.isArray(messages) ? messages.map((entry) => {
    const normalized = normalizeSessionEntry(entry);
    return normalized.key.startsWith(`${task.id}:`) ? { ...normalized, terminal: true } : normalized;
  }) : [];
  const additions = [];
  if (!next.some((entry) => entry.key?.startsWith(`${task.id}:`))) {
    additions.push({
      key: `${task.id}:input`,
      kind: "text",
      role: "user",
      label: "나",
      text: String(task.input?.text || ""),
      terminal: !isTaskRunning(task),
    });
  }
  additions.push({
    key: `${task.id}:revision:${task.revision}`,
    kind: "text",
    role: "assistant",
    label: "ATHENA 로컬 실행기",
    text: String(task.message || TASK_STATUS_LABELS[task.status] || "작업 상태를 확인했습니다."),
    terminal: !isTaskRunning(task),
  });

  for (const addition of additions) {
    if (addition.text) next = appendSessionEntry(next, addition, { maxEntries: Math.max(1, limit) });
  }
  return next;
}

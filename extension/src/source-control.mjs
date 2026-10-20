export const SOURCE_REQUEST_TIMEOUT_MS = 45_000;

const CATALOG_VERSION_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPERATION_REF_PATTERN = /^(?:base:[a-z0-9]+|detail:[a-z0-9]+:[a-z0-9_]+)$/u;

function assertExactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function unwrap(response) {
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "로컬 조회 기능 요청이 실패했습니다.");
    if (typeof response?.error?.code === "string") error.code = response.error.code;
    throw error;
  }
  return response.result;
}

function validateCatalogVersion(value) {
  if (typeof value !== "string" || !CATALOG_VERSION_PATTERN.test(value)) {
    throw new TypeError("조회 기능 목록 버전이 올바르지 않습니다.");
  }
  return value;
}

function validateSearchInput(input) {
  assertExactObject(input, ["query"], "조회 기능 검색 요청");
  if (typeof input.query !== "string") throw new TypeError("검색어를 입력해 주세요.");
  const query = input.query.trim();
  if (query.length < 2 || query.length > 500) {
    throw new TypeError("검색어는 공백을 제외하고 2자 이상 500자 이하로 입력해 주세요.");
  }
  return query;
}

function validateDescribeInput(input) {
  assertExactObject(input, ["operationRef", "expectedCatalogVersion"], "조회 기능 상세 요청");
  if (
    typeof input.operationRef !== "string"
    || input.operationRef.length > 128
    || !OPERATION_REF_PATTERN.test(input.operationRef)
  ) {
    throw new TypeError("조회 기능 식별자가 올바르지 않습니다.");
  }
  return {
    operationRef: input.operationRef,
    expectedCatalogVersion: validateCatalogVersion(input.expectedCatalogVersion),
  };
}

export function createSourceControlCoordinator({
  request,
  validateBackendStatus,
  validateSourceManifest,
  validateSourceCard,
  timeoutMs = SOURCE_REQUEST_TIMEOUT_MS,
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new RangeError("로컬 조회 기능 제한 시간은 100~60000ms여야 합니다.");
  }
  const options = Object.freeze({ timeoutMs });

  async function prepareManifest() {
    const backend = validateBackendStatus(unwrap(await request("backend.ensure", {}, options)));
    if (
      backend.configured !== true
      || backend.state !== "ready"
      || backend.apiVersion !== "selector-readonly-v1"
      || backend.ownedChild !== true
    ) {
      throw new Error("로컬 조회 기능 백엔드가 준비되지 않았습니다.");
    }
    const manifest = validateSourceManifest(unwrap(await request("source.manifest", {}, options)));
    validateCatalogVersion(manifest.catalogVersion);
    if (manifest.catalogVersion !== backend.catalogVersion) {
      throw new Error("로컬 조회 기능 목록 버전이 준비 상태와 일치하지 않습니다.");
    }
    return manifest;
  }

  return Object.freeze({
    async search(input) {
      const query = validateSearchInput(input);
      const manifest = await prepareManifest();
      const card = validateSourceCard(unwrap(await request("source.search", {
        query,
        limit: 5,
        expectedCatalogVersion: manifest.catalogVersion,
      }, options)));
      if (
        card.kind !== "capability-list"
        || card.catalogVersion !== manifest.catalogVersion
        || card.query !== query
      ) {
        throw new Error("로컬 조회 기능 검색 결과가 요청과 일치하지 않습니다.");
      }
      return card;
    },

    async describe(input) {
      const exact = validateDescribeInput(input);
      const manifest = await prepareManifest();
      if (manifest.catalogVersion !== exact.expectedCatalogVersion) {
        throw new Error("조회 기능 목록이 변경되었습니다. 다시 검색해 주세요.");
      }
      const card = validateSourceCard(unwrap(await request("source.describe", {
        operationRef: exact.operationRef,
        expectedCatalogVersion: manifest.catalogVersion,
      }, options)));
      if (
        card.kind !== "capability-detail"
        || card.catalogVersion !== manifest.catalogVersion
        || card.operationRef !== exact.operationRef
      ) {
        throw new Error("로컬 조회 기능 상세 결과가 요청과 일치하지 않습니다.");
      }
      return card;
    },
  });
}

export function routeSourcePanelMessage(message, coordinator) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("조회 기능 패널 요청 형식이 올바르지 않습니다.");
  }
  if (message.type === "panel.source.search") {
    assertExactObject(message, ["type", "query"], "조회 기능 패널 검색 요청");
    return coordinator.search({ query: message.query });
  }
  if (message.type === "panel.source.describe") {
    assertExactObject(
      message,
      ["type", "operationRef", "expectedCatalogVersion"],
      "조회 기능 패널 상세 요청",
    );
    return coordinator.describe({
      operationRef: message.operationRef,
      expectedCatalogVersion: message.expectedCatalogVersion,
    });
  }
  throw new Error("지원하지 않는 조회 기능 패널 요청입니다.");
}

const TERMINAL_TASK_STATUSES = new Set([
  "blocked",
  "completed",
  "cancelled",
  "unsupported",
  "unverified",
]);

export function assertSourceStateAvailable({
  connected,
  configured,
  controlRunning,
  taskRunning,
  pendingCapture,
  pendingReceipt,
  journal,
  latestTask,
}) {
  if (connected !== true) throw new Error("먼저 로컬 실행기에 연결해 주세요.");
  if (configured !== true) throw new Error("로컬 조회 기능이 구성되지 않았습니다.");
  if (controlRunning === true || taskRunning === true) {
    throw new Error("WTS 화면 제어 또는 대화 작업이 진행 중입니다.");
  }
  if (pendingCapture === true) throw new Error("저장하지 못한 화면 조사를 먼저 처리해 주세요.");
  if (pendingReceipt === true) throw new Error("저장하지 못한 화면 제어 결과를 먼저 처리해 주세요.");
  if (journal?.dispatch !== null) throw new Error("미확인 WTS 대화 작업 결과를 먼저 처리해 주세요.");
  if (journal?.activeTaskId !== null && latestTask === null) {
    throw new Error("WTS 대화 작업 상태를 먼저 확인해 주세요.");
  }
  if (latestTask && !TERMINAL_TASK_STATUSES.has(latestTask.status)) {
    throw new Error("진행 중인 WTS 대화 작업을 먼저 완료하거나 취소해 주세요.");
  }
}

export function createSourceActivityGate({ assertSourceCanStart = async () => {} } = {}) {
  let foregroundCount = 0;
  let sourceRun = null;
  let sourceGeneration = 0;
  let conversationRun = null;
  let conversationGeneration = 0;

  function conversationBusyError() {
    return new Error("다른 대화 요청이 진행 중입니다.");
  }

  function createConversationReservation() {
    if (conversationRun) throw conversationBusyError();
    if (sourceRun || foregroundCount > 0) throw new Error("다른 WTS 요청이 진행 중입니다.");
    const generation = ++conversationGeneration;
    const reservation = { generation, phase: "routing", cancelled: false, providerClaimed: false };
    conversationRun = reservation;

    const assertLive = () => {
      if (
        conversationRun !== reservation
        || reservation.cancelled
        || conversationGeneration !== generation
      ) {
        throw new Error("대화 요청이 취소되었거나 로컬 실행기 연결이 종료되었습니다.");
      }
    };
    const runPhase = (phase, task, beforeTask = null) => {
      assertLive();
      if (!beforeTask) reservation.phase = phase;
      return Promise.resolve()
        .then(assertLive)
        .then(() => beforeTask?.())
        .then(() => {
          assertLive();
          reservation.phase = phase;
          return task();
        })
        .then((result) => {
          assertLive();
          return result;
        });
    };

    return Object.freeze({
      runRouting(task) { return runPhase("routing", task); },
      runControl(task) { return runPhase("control", task); },
      runSource(task) { return runPhase("source", task, assertSourceCanStart); },
      runProvider(task) { return runPhase("provider-planning", task); },
      claimProvider() {
        assertLive();
        reservation.providerClaimed = true;
      },
      providerClaimed() { return reservation.providerClaimed; },
      holdForConfirmation() {
        assertLive();
        reservation.phase = "awaiting-confirmation";
      },
      cancel() {
        if (conversationRun !== reservation || reservation.phase === "source") return false;
        reservation.cancelled = true;
        conversationGeneration += 1;
        return true;
      },
      release() {
        if (conversationRun === reservation) conversationRun = null;
      },
      status() {
        return {
          running: conversationRun === reservation,
          phase: conversationRun === reservation ? reservation.phase : "idle",
        };
      },
    });
  }

  return Object.freeze({
    runForeground(task) {
      if (conversationRun) return Promise.reject(conversationBusyError());
      if (sourceRun) return Promise.reject(new Error("조회 기능 요청이 진행 중입니다."));
      foregroundCount += 1;
      return Promise.resolve()
        .then(task)
        .finally(() => { foregroundCount -= 1; });
    },

    runSource(task) {
      if (conversationRun) return Promise.reject(conversationBusyError());
      if (sourceRun) return Promise.reject(new Error("다른 조회 기능 요청이 진행 중입니다."));
      if (foregroundCount > 0) return Promise.reject(new Error("다른 WTS 요청이 진행 중입니다."));
      const runGeneration = ++sourceGeneration;
      const promise = Promise.resolve()
        .then(assertSourceCanStart)
        .then(task)
        .then((result) => {
          if (sourceGeneration !== runGeneration) throw new Error("로컬 실행기 연결이 종료되었습니다.");
          return result;
        })
        .finally(() => {
          if (sourceRun?.generation === runGeneration) sourceRun = null;
        });
      sourceRun = { generation: runGeneration, promise };
      return promise;
    },

    invalidateSource() {
      const wasRunning = Boolean(sourceRun);
      sourceGeneration += 1;
      sourceRun = null;
      return wasRunning;
    },

    reserveConversation() {
      return createConversationReservation();
    },

    invalidateConversation() {
      const wasRunning = Boolean(conversationRun);
      conversationGeneration += 1;
      conversationRun = null;
      return wasRunning;
    },

    conversationStatus() {
      return {
        running: Boolean(conversationRun),
        phase: conversationRun?.phase || "idle",
      };
    },

    running() {
      return Boolean(sourceRun || conversationRun?.phase === "source");
    },
  });
}

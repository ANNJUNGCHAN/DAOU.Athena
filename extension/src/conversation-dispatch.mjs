const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_MAX_ENTRIES = 12;
const DEFAULT_MAX_BYTES = 256 * 1024;
const CANCELLED_MESSAGE = "대화 요청이 실행 전에 취소되었습니다.";
const SOURCE_SEARCH_PREFIX = "조회 기능 찾아줘: ";

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

function validateSubmissionId(value) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new TypeError("대화 요청 식별자가 올바르지 않습니다.");
  }
  return value;
}

function validateSubmitInput(input) {
  const hasOwner = Object.hasOwn(input || {}, "ownerId");
  assertExactObject(input, hasOwner ? ["submissionId", "text", "ownerId"] : ["submissionId", "text"], "대화 요청");
  const submissionId = validateSubmissionId(input.submissionId);
  const ownerId = hasOwner ? validateSubmissionId(input.ownerId) : null;
  if (typeof input.text !== "string") throw new TypeError("대화 내용을 입력해 주세요.");
  const text = input.text.trim();
  if (text.length < 1 || text.length > 512) {
    throw new TypeError("대화 내용은 공백을 제외하고 1자 이상 512자 이하로 입력해 주세요.");
  }
  return { submissionId, text, ownerId };
}

function validateDescribeInput(input) {
  assertExactObject(
    input,
    ["submissionId", "operationRef", "expectedCatalogVersion"],
    "조회 기능 상세 요청",
  );
  return {
    submissionId: validateSubmissionId(input.submissionId),
    operationRef: input.operationRef,
    expectedCatalogVersion: input.expectedCatalogVersion,
  };
}

export function assertConversationControlStateAvailable({
  controlReady,
  controlRunning,
  taskRunning,
  pendingCapture,
  pendingReceipt,
  financialRunning = false,
  journal,
}) {
  if (controlReady !== true) throw new Error("화면 조사 저장과 v5 로컬 실행기 연결을 먼저 완료해 주세요.");
  if (controlRunning === true || taskRunning === true) {
    throw new Error("다른 WTS 화면 제어 또는 대화 작업이 진행 중입니다.");
  }
  if (financialRunning === true) throw new Error("금융 조회 또는 자격 증명 작업이 진행 중입니다.");
  if (pendingCapture === true) throw new Error("저장하지 못한 화면 조사를 먼저 처리해 주세요.");
  if (pendingReceipt === true) throw new Error("저장하지 못한 화면 제어 결과를 먼저 처리해 주세요.");
  if (journal?.dispatch !== null) throw new Error("미확인 WTS 대화 작업 결과를 먼저 복구해 주세요.");
}

function boundedSet(map, key, value, maxEntries, maxBytes) {
  const encoded = new TextEncoder();
  const exactJson = JSON.stringify({ key, value });
  if (encoded.encode(exactJson).byteLength > maxBytes) return;
  map.delete(key);
  map.set(key, { value, exactJson });
  const totalBytes = () => Array.from(map.values())
    .reduce((total, entry) => total + encoded.encode(entry.exactJson).byteLength, 0);
  while (map.size > maxEntries || totalBytes() > maxBytes) {
    map.delete(map.keys().next().value);
  }
}

export function createConversationDispatcher({
  route,
  validateConversationRoute,
  activityGate,
  startControl,
  searchSource,
  describeSource,
  startProvider,
  unsupportedMessage,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new RangeError("대화 캐시 수 제한이 올바르지 않습니다.");
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new RangeError("대화 캐시 용량 제한이 올바르지 않습니다.");
  let active = null;
  const completed = new Map();
  const bindings = new Map();

  function assertRouteMatches(result, input) {
    const exact = validateConversationRoute(result);
    if (exact.submissionId !== input.submissionId) {
      throw new Error("로컬 실행기의 대화 요청 식별자가 일치하지 않습니다.");
    }
    const normalizedInput = input.text.trim().replace(/\s+/gu, " ");
    if (exact.kind === "wts-control" && exact.text !== normalizedInput) {
      throw new Error("로컬 실행기의 화면 제어 내용이 대화 요청과 일치하지 않습니다.");
    }
    if (exact.kind === "source-search") {
      const query = input.text.startsWith(SOURCE_SEARCH_PREFIX)
        ? input.text.slice(SOURCE_SEARCH_PREFIX.length).trim()
        : null;
      if (query === null || exact.query !== query) {
        throw new Error("로컬 실행기의 조회 기능 검색어가 대화 요청과 일치하지 않습니다.");
      }
    }
    return exact;
  }

  function rememberResult(input, result) {
    boundedSet(completed, input.submissionId, { text: input.text, result }, maxEntries, maxBytes);
  }

  function rememberBinding(submissionId, card) {
    if (card.kind !== "capability-list") throw new Error("조회 기능 검색 결과 카드 형식이 올바르지 않습니다.");
    boundedSet(bindings, submissionId, {
      catalogVersion: card.catalogVersion,
      operationRefs: card.items.map((item) => item.operationRef),
    }, maxEntries, maxBytes);
  }

  function cancellationError() {
    return new Error(CANCELLED_MESSAGE);
  }

  function submit(rawInput) {
    const input = validateSubmitInput(rawInput);
    const cached = completed.get(input.submissionId)?.value;
    if (cached) {
      if (cached.text !== input.text) {
        return Promise.reject(new Error("같은 대화 요청 식별자에 다른 내용이 사용되었습니다."));
      }
      return Promise.resolve(cached.result);
    }
    if (active) {
      if (active.input.submissionId !== input.submissionId) {
        return Promise.reject(new Error("다른 대화 요청이 진행 중입니다."));
      }
      if (active.input.text !== input.text) {
        return Promise.reject(new Error("같은 대화 요청 식별자에 다른 내용이 사용되었습니다."));
      }
      return active.promise;
    }

    let reservation;
    try { reservation = activityGate.reserveConversation(); } catch (error) { return Promise.reject(error); }
    let retained = false;
    const operation = (async () => {
      const routeInput = { submissionId: input.submissionId, text: input.text };
      const routed = assertRouteMatches(await reservation.runRouting(() => route(routeInput)), routeInput);
      if (routed.kind === "unsupported") {
        if (routed.message !== unsupportedMessage) {
          throw new Error("지원하지 않는 대화 응답 문구가 계약과 일치하지 않습니다.");
        }
        if (typeof startProvider === "function") {
          const result = await reservation.runProvider(() => startProvider(routeInput, reservation, input.ownerId));
          retained = result?.kind === "provider-pending" || result?.kind === "provider-detached";
          if (result?.kind === "provider-detached") throw cancellationError();
          if (retained) return result;
        }
        const result = { kind: "unsupported", submissionId: input.submissionId, message: routed.message };
        rememberResult(input, result);
        return result;
      }
      if (routed.kind === "wts-control") {
        const taskResult = await reservation.runControl(() => startControl({
          submissionId: input.submissionId,
          text: routed.text,
        }));
        if (!taskResult?.task || taskResult.task.submissionId !== input.submissionId) {
          throw cancellationError();
        }
        const result = { kind: "control-task", submissionId: input.submissionId, task: taskResult.task };
        rememberResult(input, result);
        return result;
      }
      if (routed.kind === "source-search") {
        const card = await reservation.runSource(() => searchSource({ query: routed.query }));
        rememberBinding(input.submissionId, card);
        const result = { kind: "source-card", submissionId: input.submissionId, card };
        rememberResult(input, result);
        return result;
      }
      throw new Error("지원하지 않는 대화 분류 결과입니다.");
    })().catch((error) => {
      if (reservation.status().running === true && reservation.status().phase !== "source") {
        const status = reservation.status();
        if (status.running && active?.cancelled === true) throw cancellationError();
      }
      throw error;
    }).finally(() => {
      if (!retained && reservation.providerClaimed() !== true) reservation.release();
      if (active?.promise === operation) active = null;
    });
    active = { input, promise: operation, reservation, cancelled: false };
    return operation;
  }

  function describe(rawInput) {
    const input = validateDescribeInput(rawInput);
    const binding = bindings.get(input.submissionId)?.value;
    if (
      !binding
      || binding.catalogVersion !== input.expectedCatalogVersion
      || !binding.operationRefs.includes(input.operationRef)
    ) {
      return Promise.reject(new Error("검색 결과가 만료되었거나 상세 요청과 일치하지 않습니다. 다시 검색해 주세요."));
    }
    if (active) return Promise.reject(new Error("다른 대화 요청이 진행 중입니다."));
    let reservation;
    try { reservation = activityGate.reserveConversation(); } catch (error) { return Promise.reject(error); }
    const operation = reservation.runSource(() => describeSource({
      operationRef: input.operationRef,
      expectedCatalogVersion: input.expectedCatalogVersion,
    })).then((card) => ({ kind: "source-card", submissionId: input.submissionId, card }))
      .finally(() => {
        reservation.release();
        if (active?.promise === operation) active = null;
      });
    active = { input, promise: operation, reservation, cancelled: false };
    return operation;
  }

  return Object.freeze({
    submit,
    describe,
    cancel() {
      if (!active) return { cancelled: false, phase: "idle" };
      const phase = active.reservation.status().phase;
      const cancelled = active.reservation.cancel();
      if (cancelled) active.cancelled = true;
      return { cancelled, phase };
    },
    invalidate() {
      activityGate.invalidateConversation();
      active = null;
      completed.clear();
      bindings.clear();
    },
    status() {
      const status = activityGate.conversationStatus();
      return {
        running: status.running,
        routing: status.phase === "routing",
        phase: status.phase,
      };
    },
  });
}

export function routeConversationPanelMessage(message, dispatcher) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new TypeError("대화 패널 요청 형식이 올바르지 않습니다.");
  }
  if (message.type === "panel.chat.submit") {
    assertExactObject(message, ["type", "submissionId", "text", "ownerId"], "대화 패널 전송 요청");
    return dispatcher.submit({ submissionId: message.submissionId, text: message.text, ownerId: message.ownerId });
  }
  if (message.type === "panel.chat.describe") {
    assertExactObject(
      message,
      ["type", "submissionId", "operationRef", "expectedCatalogVersion"],
      "대화 패널 상세 요청",
    );
    return dispatcher.describe({
      submissionId: message.submissionId,
      operationRef: message.operationRef,
      expectedCatalogVersion: message.expectedCatalogVersion,
    });
  }
  throw new Error("지원하지 않는 대화 패널 요청입니다.");
}

export { CANCELLED_MESSAGE };

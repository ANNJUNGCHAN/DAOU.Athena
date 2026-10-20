const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const PROVIDER_ID = "openai-chatgpt-siwc-v1";
const PROVIDER_API = "openai-provider-native-v1";
const PROVIDER_METHODS = Object.freeze([
  "provider.status", "provider.connect.start", "provider.models.start", "provider.model.select",
  "provider.plan.start", "provider.operation.get", "provider.operation.cancel",
  "provider.disconnect.start", "provider.account.reset.start",
]);

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function unwrap(response) {
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "ChatGPT 요청이 실패했습니다.");
    if (typeof response?.error?.code === "string") error.code = response.error.code;
    throw error;
  }
  return response.result;
}

function validateOperation(value, expected = null) {
  exact(value, ["operationId", "kind", "state", "revision", "cancellable", "result", "error"], "ChatGPT 작업 상태");
  if (!UUID_PATTERN.test(value.operationId) || !Number.isInteger(value.revision) || value.revision < 1) {
    throw new Error("ChatGPT 작업 식별자가 올바르지 않습니다.");
  }
  if (expected) {
    if (value.operationId !== expected.operationId || value.kind !== expected.kind) throw new Error("ChatGPT 작업 응답이 현재 작업과 일치하지 않습니다.");
    if (value.revision < expected.revision) throw new Error("이전 ChatGPT 작업 응답은 사용할 수 없습니다.");
  }
  return value;
}

function validateHelloProvider(provider) {
  if (provider?.id !== PROVIDER_ID || provider?.apiVersion !== PROVIDER_API || provider?.asyncJobs !== true ||
      provider?.auth !== "explicit-browser-consent" || provider?.tokenStorage !== "native-memory-only" ||
      provider?.planner !== "proposal-only" || provider?.modelCatalog !== true ||
      provider?.tools !== false || provider?.order !== false || provider?.dataSent !== "user-text-and-fixed-control-catalog" ||
      !Array.isArray(provider?.methods) || provider.methods.length !== PROVIDER_METHODS.length ||
      PROVIDER_METHODS.some((method) => !provider.methods.includes(method))) {
    throw new Error("로컬 실행기의 ChatGPT 기능 계약이 0.8 요구사항과 일치하지 않습니다.");
  }
  return provider;
}

export function createProviderControlCoordinator({ request, runControl, randomUuid = () => crypto.randomUUID(), setTimer = setTimeout }) {
  let nativeGeneration = 0;
  let runtimeReady = false;
  let owner = null;
  let operation = null;
  let planJob = null;
  let models = [];
  let selectedModel = null;
  let connection = "signed-out";
  let catalog = "unavailable";
  let serial = Promise.resolve();
  let stateEpoch = 0;

  function releasePlanJob(job) {
    if (!job || planJob !== job) return false;
    planJob = null;
    if (!job.released) {
      job.released = true;
      job.reservation.release();
    }
    return true;
  }

  const assertOwner = (ownerId) => {
    if (!owner || ownerId !== owner) throw new Error("현재 열린 ChatGPT 패널 소유자가 아닙니다.");
  };
  const snapshot = () => ({
    nativeGeneration, runtimeReady, ownerAttached: Boolean(owner), connection, catalog,
    models: models.map((item) => ({ ...item })), selectedModel: selectedModel ? { ...selectedModel } : null,
    operation: operation ? { operationId: operation.operationId, kind: operation.kind, state: operation.state, revision: operation.revision, cancellable: operation.cancellable } : null,
    proposal: planJob?.proposal ? {
      submissionId: planJob.submissionId,
      catalogVersion: planJob.catalogVersion,
      assistantText: planJob.proposal.assistantText,
      commandText: planJob.proposal.command.text,
    } : null,
    conversationPhase: planJob ? (planJob.proposal ? "awaiting-confirmation" : "provider-planning") : "idle",
    recoveryError: planJob?.recoveryError ?? null,
  });

  function bindRuntime({ generation, provider }) {
    if (!Number.isInteger(generation) || generation < 1) throw new TypeError("Native 연결 세대가 올바르지 않습니다.");
    validateHelloProvider(provider);
    nativeGeneration = generation;
    runtimeReady = true;
    connection = "signed-out";
    catalog = "unavailable";
    models = [];
    selectedModel = null;
    operation = null;
    stateEpoch += 1;
    releasePlanJob(planJob);
    return snapshot();
  }

  function invalidateRuntime(generation) {
    if (Number.isInteger(generation) && generation > nativeGeneration) nativeGeneration = generation;
    runtimeReady = false;
    connection = "signed-out";
    catalog = "unavailable";
    models = [];
    selectedModel = null;
    operation = null;
    stateEpoch += 1;
    releasePlanJob(planJob);
  }

  function attachOwner(ownerId) {
    if (!UUID_PATTERN.test(ownerId)) throw new TypeError("ChatGPT 패널 소유자 식별자가 올바르지 않습니다.");
    if (owner && owner !== ownerId) throw new Error("다른 ChatGPT 패널이 이미 연결되어 있습니다.");
    owner = ownerId;
    return snapshot();
  }

  async function cancelCurrent(ownerId) {
    assertOwner(ownerId);
    if (!operation || !operation.cancellable || TERMINAL.has(operation.state)) return snapshot();
    const generation = nativeGeneration;
    const current = operation;
    const result = validateOperation(unwrap(await request("provider.operation.cancel", {
      operationId: current.operationId,
      expectedRevision: current.revision,
      cancellationId: randomUuid(),
    })), current);
    if (generation !== nativeGeneration || owner !== ownerId || operation !== current) {
      throw new Error("이전 ChatGPT 취소 응답은 사용할 수 없습니다.");
    }
    operation = result;
    return snapshot();
  }

  function cancelDetachedOperation(job, current) {
    void request("provider.operation.cancel", {
      operationId: current.operationId,
      expectedRevision: current.revision,
      cancellationId: randomUuid(),
    }).then((response) => {
      if (planJob === job && job.generation === nativeGeneration && operation === current) {
        const next = validateOperation(unwrap(response), current);
        operation = next;
        job.recoveryError = null;
        settleDetached(job, 0);
      }
    }).catch((error) => {
      if (planJob !== job || job.generation !== nativeGeneration || operation !== current) return;
      job.recoveryError = error instanceof Error ? error.message : String(error);
      settleDetached(job, 0);
    });
  }

  function detachOwner(ownerId) {
    if (owner !== ownerId) return;
    owner = null;
    const job = planJob;
    if (!job || job.ownerId !== ownerId) return;
    job.detached = true;
    if (job.proposal) {
      job.proposal = null;
      job.catalogVersion = null;
      releasePlanJob(job);
      operation = null;
      return;
    }
    if (["starting", "unknown-start", "consuming"].includes(job.phase)) return;
    if (operation?.kind === "plan" && operation.operationId === job.operationId && operation.cancellable && !TERMINAL.has(operation.state)) {
      cancelDetachedOperation(job, operation);
      return;
    }
    releasePlanJob(job);
  }

  async function refreshStatus(ownerId) {
    assertOwner(ownerId);
    if (!runtimeReady) return snapshot();
    const generation = nativeGeneration;
    const epoch = ++stateEpoch;
    const currentOperation = operation;
    const status = unwrap(await request("provider.status", {}));
    if (generation !== nativeGeneration || epoch !== stateEpoch || owner !== ownerId || status.provider !== PROVIDER_ID || operation !== currentOperation) {
      throw new Error("ChatGPT 상태가 현재 로컬 실행기 연결과 일치하지 않습니다.");
    }
    connection = status.connection;
    catalog = status.catalog;
    selectedModel = status.selectedModel ? { ...status.selectedModel } : null;
    const unknownJob = planJob?.phase === "unknown-start" ? planJob : null;
    if (unknownJob && status.operation) {
      const recovered = validateOperation(status.operation);
      if (recovered.kind !== "plan") throw new Error("ChatGPT 상태가 대기 중인 계획 작업과 일치하지 않습니다.");
      operation = recovered;
      unknownJob.operationId = recovered.operationId;
      unknownJob.phase = "running";
      unknownJob.recoveryError = null;
      if (unknownJob.detached) cancelDetachedOperation(unknownJob, recovered);
    } else if (operation && status.operation && status.operation.operationId === operation.operationId) {
      if (status.operation.kind !== operation.kind || status.operation.revision < operation.revision) throw new Error("ChatGPT 상태가 현재 작업과 일치하지 않습니다.");
      operation = { ...operation, ...status.operation, result: operation.result ?? null, error: operation.error ?? null };
    } else if (!operation && !planJob && status.operation) {
      operation = { ...status.operation, result: null, error: null, orphan: true };
    }
    return snapshot();
  }

  async function start(ownerId, kind) {
    assertOwner(ownerId);
    if (!runtimeReady) throw new Error("먼저 로컬 실행기에 연결해 주세요.");
    if (planJob) throw new Error("ChatGPT 계획 작업이 진행 중입니다.");
    if (operation && !TERMINAL.has(operation.state)) throw new Error("다른 ChatGPT 작업이 진행 중입니다.");
    const method = { connect: "provider.connect.start", models: "provider.models.start", disconnect: "provider.disconnect.start", "account-reset": "provider.account.reset.start" }[kind];
    if (!method) throw new Error("지원하지 않는 ChatGPT 작업입니다.");
    const generation = nativeGeneration;
    const epoch = ++stateEpoch;
    const currentOperation = operation;
    const next = validateOperation(unwrap(await request(method, {})));
    if (generation !== nativeGeneration || epoch !== stateEpoch || owner !== ownerId || operation !== currentOperation || next.kind !== kind || next.state !== "running") {
      throw new Error("ChatGPT 작업 시작 응답이 올바르지 않습니다.");
    }
    operation = next;
    if (kind === "models") {
      catalog = "loading";
      models = [];
      selectedModel = null;
    }
    return snapshot();
  }

  async function select(ownerId, slug) {
    assertOwner(ownerId);
    if (planJob) throw new Error("ChatGPT 계획 작업이 진행 중입니다.");
    if (operation && !TERMINAL.has(operation.state)) throw new Error("다른 ChatGPT 작업이 진행 중입니다.");
    if (connection !== "connected" || catalog !== "ready") throw new Error("ChatGPT 모델 목록을 먼저 불러와 주세요.");
    if (!MODEL_PATTERN.test(slug)) throw new TypeError("ChatGPT 모델 식별자가 올바르지 않습니다.");
    const generation = nativeGeneration;
    const epoch = ++stateEpoch;
    const currentOperation = operation;
    const status = unwrap(await request("provider.model.select", { slug }));
    if (generation !== nativeGeneration || epoch !== stateEpoch || owner !== ownerId || operation !== currentOperation ||
        status.provider !== PROVIDER_ID || status.selectedModel?.slug !== slug) {
      throw new Error("선택된 ChatGPT 모델이 요청과 일치하지 않습니다.");
    }
    connection = status.connection;
    catalog = status.catalog;
    selectedModel = { ...status.selectedModel };
    return snapshot();
  }

  async function startPlan(input, heldReservation, ownerId) {
    assertOwner(ownerId);
    if (!runtimeReady || connection !== "connected" || !selectedModel) return null;
    if (planJob || (operation && !TERMINAL.has(operation.state))) throw new Error("다른 ChatGPT 작업이 진행 중입니다.");
    if (typeof heldReservation?.claimProvider !== "function") throw new TypeError("ChatGPT 대화 예약 소유권을 이전할 수 없습니다.");
    const generation = nativeGeneration;
    const job = {
      token: {}, generation, ownerId, reservation: heldReservation, submissionId: input.submissionId,
      detached: false, phase: "starting", operationId: null, proposal: null, catalogVersion: null,
      recoveryError: null, released: false,
    };
    planJob = job;
    heldReservation.claimProvider();
    let response;
    try {
      response = await request("provider.plan.start", input);
    } catch (error) {
      if (planJob === job && generation === nativeGeneration) {
        job.detached = true;
        job.phase = "unknown-start";
        job.recoveryError = error instanceof Error ? error.message : String(error);
      }
      throw error;
    }
    try {
      const next = validateOperation(unwrap(response));
      if (generation !== nativeGeneration || planJob !== job || next.kind !== "plan" || next.state !== "running") {
        throw new Error("ChatGPT 계획 작업 시작 응답이 올바르지 않습니다.");
      }
      operation = next;
      job.operationId = next.operationId;
      job.phase = "running";
      if (job.detached || owner !== job.ownerId) {
        job.detached = true;
        cancelDetachedOperation(job, next);
        return { kind: "provider-detached", submissionId: input.submissionId };
      }
    } catch (error) {
      if (planJob === job) releasePlanJob(job);
      throw error;
    }
    return { kind: "provider-pending", submissionId: input.submissionId, operation: snapshot().operation };
  }

  function queuePoll(expectedOwnerId = null) {
    serial = serial.catch(() => {}).then(async () => {
      if (expectedOwnerId !== null && owner !== expectedOwnerId) throw new Error("현재 열린 ChatGPT 패널 소유자가 아닙니다.");
      if (!operation) return snapshot();
      const generation = nativeGeneration;
      const current = operation;
      const orphan = current.orphan === true;
      const job = current.kind === "plan" && planJob?.operationId === current.operationId ? planJob : null;
      let next = validateOperation(unwrap(await request("provider.operation.get", { operationId: current.operationId, consume: false })), current);
      if (generation !== nativeGeneration || operation !== current || (expectedOwnerId !== null && owner !== expectedOwnerId) ||
          (job && planJob !== job)) throw new Error("이전 로컬 실행기 연결의 ChatGPT 응답은 사용할 수 없습니다.");
      operation = next;
      if (job) job.recoveryError = null;
      if (!TERMINAL.has(next.state)) return snapshot();
      if (next.kind === "plan" && next.state === "succeeded") {
        const result = next.result;
        if ((job && result?.submissionId !== job.submissionId) || typeof result?.catalogVersion !== "string" || typeof result?.assistantText !== "string") {
          throw new Error("ChatGPT 완료 응답이 현재 대화와 일치하지 않습니다.");
        }
        if (result.proposal !== null && (result.proposal?.kind !== "wts-control" || typeof result.proposal.text !== "string" || !result.proposal.text.trim())) {
          throw new Error("ChatGPT 실행 제안 형식이 올바르지 않습니다.");
        }
      }
      if (job) job.phase = "consuming";
      const consumed = validateOperation(unwrap(await request("provider.operation.get", { operationId: current.operationId, consume: true })), next);
      if (generation !== nativeGeneration || operation !== next || consumed.revision !== next.revision || consumed.state !== next.state ||
          (job && planJob !== job)) {
        throw new Error("ChatGPT 작업 소비 응답이 완료 상태와 일치하지 않습니다.");
      }
      if (next.kind === "models" && ["failed", "cancelled"].includes(next.state)) {
        if (expectedOwnerId !== null && owner !== expectedOwnerId) {
          throw new Error("이전 ChatGPT 패널의 모델 목록 상태는 사용할 수 없습니다.");
        }
        const epoch = ++stateEpoch;
        connection = "unknown";
        catalog = "unavailable";
        models = [];
        selectedModel = null;
        let status = null;
        try { status = unwrap(await request("provider.status", {})); } catch {}
        if (generation !== nativeGeneration || epoch !== stateEpoch || operation !== next ||
            (expectedOwnerId !== null && owner !== expectedOwnerId)) {
          throw new Error("이전 로컬 실행기 연결의 ChatGPT 상태는 사용할 수 없습니다.");
        }
        const retained = status?.connection === "connected" && status.catalog === "not-loaded";
        const signedOut = status?.connection === "signed-out" && status.catalog === "unavailable";
        if (status?.provider === PROVIDER_ID && status.selectedModel === null && (retained || signedOut)) {
          connection = status.connection;
          catalog = status.catalog;
        }
      }
      next = consumed;
      operation = null;
      if (next.kind !== "plan") stateEpoch += 1;
      if (next.kind === "models" && next.state === "succeeded") {
        models = next.result.models.map((item) => ({ slug: item.slug, displayName: item.displayName }));
        catalog = "ready";
      }
      if (next.kind === "connect" && next.state === "succeeded") { connection = "connected"; catalog = "not-loaded"; }
      if (next.kind === "connect" && ["failed", "cancelled"].includes(next.state)) {
        connection = "signed-out";
        catalog = "unavailable";
        models = [];
        selectedModel = null;
      }
      if (["disconnect", "account-reset"].includes(next.kind) && next.state === "succeeded") { connection = "signed-out"; catalog = "unavailable"; models = []; selectedModel = null; }
      if (next.kind === "plan") {
        if (job && !orphan && !job.detached && next.state === "succeeded" && next.result.proposal !== null && owner === job.ownerId) {
          job.catalogVersion = next.result.catalogVersion;
          job.proposal = { assistantText: next.result.assistantText, command: { ...next.result.proposal } };
          job.phase = "confirmation";
          job.reservation.holdForConfirmation();
        } else if (job) {
          job.proposal = null;
          job.catalogVersion = null;
          releasePlanJob(job);
        }
      }
      return { ...snapshot(), terminal: { kind: next.kind, state: next.state, result: next.result, error: next.error } };
    });
    return serial;
  }

  function poll(ownerId) {
    assertOwner(ownerId);
    return queuePoll(ownerId);
  }

  function settleDetached(job, attempt) {
    if (attempt >= 4) {
      if (planJob === job) job.recoveryError ||= "ChatGPT 취소 상태를 자동으로 확인하지 못했습니다. 패널을 다시 열어 상태를 확인해 주세요.";
      return;
    }
    setTimer(() => {
      if (!job.detached || planJob !== job || job.generation !== nativeGeneration || operation?.operationId !== job.operationId) return;
      void queuePoll().then(() => {
        if (job.detached && planJob === job && operation?.operationId === job.operationId) settleDetached(job, attempt + 1);
      }).catch((error) => {
        if (!job.detached || planJob !== job || job.generation !== nativeGeneration || operation?.operationId !== job.operationId) return;
        job.recoveryError = error instanceof Error ? error.message : String(error);
        settleDetached(job, attempt + 1);
      });
    }, 250);
  }

  async function confirm(ownerId, identity) {
    assertOwner(ownerId);
    exact(identity, ["submissionId", "catalogVersion"], "ChatGPT 실행 확인");
    const job = planJob;
    if (!job?.proposal || job.detached || job.ownerId !== ownerId || identity.submissionId !== job.submissionId || identity.catalogVersion !== job.catalogVersion) throw new Error("실행 제안이 없거나 현재 대화와 일치하지 않습니다.");
    const commandText = job.proposal.command.text;
    const activeSubmissionId = job.submissionId;
    planJob = null;
    job.proposal = null;
    job.catalogVersion = null;
    try {
      return await job.reservation.runControl(() => runControl(commandText, activeSubmissionId));
    } finally {
      if (!job.released) {
        job.released = true;
        job.reservation.release();
      }
    }
  }

  function reject(ownerId, identity) {
    assertOwner(ownerId);
    exact(identity, ["submissionId", "catalogVersion"], "ChatGPT 실행 거절");
    const job = planJob;
    if (!job?.proposal || job.detached || job.ownerId !== ownerId || identity.submissionId !== job.submissionId || identity.catalogVersion !== job.catalogVersion) throw new Error("실행 제안이 없거나 현재 대화와 일치하지 않습니다.");
    job.proposal = null;
    job.catalogVersion = null;
    releasePlanJob(job);
    return snapshot();
  }

  return Object.freeze({ snapshot, bindRuntime, invalidateRuntime, attachOwner, detachOwner, refreshStatus, start, select, startPlan, poll, cancelCurrent, confirm, reject });
}

export function routeProviderPanelMessage(message, coordinator) {
  if (!message || typeof message !== "object" || Array.isArray(message)) throw new TypeError("ChatGPT 패널 요청 형식이 올바르지 않습니다.");
  const ownerOnly = () => exact(message, ["type", "ownerId"], "ChatGPT 패널 요청");
  switch (message.type) {
    case "panel.provider.status": ownerOnly(); return coordinator.refreshStatus(message.ownerId);
    case "panel.provider.connect": ownerOnly(); return coordinator.start(message.ownerId, "connect");
    case "panel.provider.models": ownerOnly(); return coordinator.start(message.ownerId, "models");
    case "panel.provider.disconnect": ownerOnly(); return coordinator.start(message.ownerId, "disconnect");
    case "panel.provider.reset": ownerOnly(); return coordinator.start(message.ownerId, "account-reset");
    case "panel.provider.get": ownerOnly(); return coordinator.poll(message.ownerId);
    case "panel.provider.cancel": ownerOnly(); return coordinator.cancelCurrent(message.ownerId);
    case "panel.provider.select":
      exact(message, ["type", "ownerId", "slug"], "ChatGPT 모델 선택 요청");
      return coordinator.select(message.ownerId, message.slug);
    case "panel.provider.confirm":
    case "panel.provider.reject": {
      exact(message, ["type", "ownerId", "submissionId", "catalogVersion"], "ChatGPT 실행 제안 요청");
      const identity = { submissionId: message.submissionId, catalogVersion: message.catalogVersion };
      return message.type.endsWith("confirm") ? coordinator.confirm(message.ownerId, identity) : coordinator.reject(message.ownerId, identity);
    }
    default: throw new Error("지원하지 않는 ChatGPT 패널 요청입니다.");
  }
}

import { compileFinancialFormDefinition, renderFinancialForm } from "./financial-form.mjs";
import { renderFinancialCard } from "./financial-cards.mjs";

const JOB_RUNNING = new Set(["queued", "running", "cancelling"]);
const MUTATION_RUNNING = new Set(["queued", "running"]);
const SAFE_ERROR_MESSAGES = Object.freeze({
  REQUEST_INVALID: "조회 입력값이 기능 계약과 맞지 않습니다.",
  LOCAL_AUTH_FAILED: "로컬 실행기 인증을 확인하지 못했습니다.",
  RESOURCE_NOT_FOUND: "요청한 조회 기능이나 프로필을 찾지 못했습니다.",
  STATE_CONFLICT: "현재 상태에서는 이 요청을 처리할 수 없습니다.",
  BUSY: "다른 금융 조회 작업이 진행 중입니다.",
  PAYLOAD_TOO_LARGE: "조회 요청 크기가 허용 범위를 넘었습니다.",
  UPSTREAM_UNAVAILABLE: "선택한 환경에서 키움 조회를 사용할 수 없습니다.",
  OPERATION_TIMEOUT: "조회 제한 시간을 넘었습니다.",
  INTERNAL_ERROR: "로컬 금융 조회 처리 중 오류가 발생했습니다.",
  FINANCIAL_BACKEND_STARTING: "로컬 금융 조회 기능을 시작하는 중입니다.",
  CREDENTIAL_MUTATION_NOT_FOUND: "자격 증명 변경 상태를 찾지 못했습니다.",
  IDEMPOTENCY_CONFLICT: "같은 요청 식별자가 다른 입력에 사용되었습니다.",
  TOKEN_REFRESHING: "키움 인증을 확인하는 중입니다.",
  TOKEN_REJECTED: "키움 인증이 거부되었습니다. 키를 다시 확인해 주세요.",
  NETWORK_UNAVAILABLE: "키움 인증 서버에 연결할 수 없습니다.",
  LOCK_CONFLICT: "다른 ATHENA 실행기가 이 프로필을 사용 중입니다.",
  VAULT_UNAVAILABLE: "Windows 보안 저장소를 사용할 수 없습니다.",
  DELETING: "선택한 자격 증명 프로필을 삭제하는 중입니다.",
  QUERY_CANCELLED: "조회가 취소되었습니다.",
  QUERY_JOB_NOT_FOUND: "이전 조회 상태를 찾지 못했습니다. 자동으로 다시 조회하지 않습니다.",
  QUERY_RESULT_ITEM_TOO_LARGE: "조회 결과 항목 하나가 표시 한도를 넘었습니다.",
  QUERY_RESULT_TOO_LARGE: "조회 결과가 표시 한도를 넘었습니다.",
  QUERY_RESULT_UNSUPPORTED_VALUE: "조회 결과에 표시할 수 없는 값이 포함되어 있습니다.",
  CONTINUATION_ALREADY_USED: "이미 사용한 다음 조회 요청입니다. 상태를 다시 확인해 주세요.",
});

function errorMessage(code) {
  return SAFE_ERROR_MESSAGES[code] || "로컬 금융 조회를 완료하지 못했습니다.";
}

function queryFailureMessage(code) {
  return `${errorMessage(code)} 자동으로 다시 요청하지 않습니다.`;
}

function text(node, value) {
  if (node) node.textContent = value;
}

export function createFinancialPanelController({
  document,
  send,
  createId = () => crypto.randomUUID(),
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
  chartRenderer,
}) {
  if (!document?.querySelector || typeof send !== "function") {
    throw new TypeError("document and send are required");
  }
  const elements = {
    section: document.querySelector("#financial-section"),
    readiness: document.querySelector("#financial-readiness"),
    refresh: document.querySelector("#financial-refresh"),
    profile: document.querySelector("#financial-profile"),
    credentials: document.querySelector("#financial-credentials"),
    credentialsForm: document.querySelector("#financial-credentials-form"),
    profileId: document.querySelector("#financial-profile-id"),
    profileLabel: document.querySelector("#financial-profile-label"),
    environment: document.querySelector("#financial-environment"),
    appKey: document.querySelector("#financial-app-key"),
    secretKey: document.querySelector("#financial-secret-key"),
    credentialSave: document.querySelector("#financial-credential-save"),
    credentialDelete: document.querySelector("#financial-credential-delete"),
    form: document.querySelector("#financial-query-form"),
    status: document.querySelector("#financial-query-status"),
    stop: document.querySelector("#financial-query-stop"),
    card: document.querySelector("#financial-card"),
  };
  let connected = false;
  let configured = false;
  let profiles = [];
  let currentDefinition = null;
  let currentJob = null;
  let timer = null;
  let generation = 0;
  let warmed = false;
  let statusReady = false;
  let formView = null;
  let cancelInFlight = false;
  let queryStartInFlight = false;
  let credentialMutationInFlight = false;
  let credentialUnknown = false;

  function stopPolling() {
    generation += 1;
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  }

  function clearSecrets() {
    elements.appKey.value = "";
    elements.secretKey.value = "";
  }

  function selectedProfile() {
    return profiles.find((profile) => profile.profileId === elements.profile.value) || null;
  }

  function renderProfiles() {
    const selected = elements.profile.value;
    elements.profile.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = profiles.length ? "프로필을 선택하세요" : "등록된 프로필 없음";
    elements.profile.append(empty);
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.profileId;
      option.textContent = `${profile.label} · ${profile.environment === "real" ? "실전" : "모의"} · ${profile.state}`;
      elements.profile.append(option);
    }
    if (profiles.some((profile) => profile.profileId === selected)) elements.profile.value = selected;
    elements.credentialDelete.disabled = !statusReady || !selectedProfile();
  }

  function profileReadinessMessage() {
    if (profiles.some((profile) => profile.state === "ready")) return "금융 조회 준비가 완료되었습니다.";
    const blocked = profiles.find((profile) => profile.reasonCode || profile.state !== "ready");
    if (blocked?.reasonCode) return errorMessage(blocked.reasonCode);
    if (blocked?.state === "refreshing") return errorMessage("TOKEN_REFRESHING");
    if (blocked?.state === "deleting") return errorMessage("DELETING");
    if (blocked?.state === "locked") return errorMessage("LOCK_CONFLICT");
    return "조회 프로필을 등록해 주세요.";
  }

  function renderState(message) {
    text(elements.readiness, message);
    elements.refresh.disabled = !connected || !configured;
    elements.credentialsForm.hidden = !connected || !configured;
    elements.profile.disabled = !connected || !configured || !statusReady || profiles.length === 0;
    for (const control of [elements.profileId, elements.profileLabel, elements.environment, elements.appKey, elements.secretKey]) {
      control.disabled = !connected || !configured || !statusReady;
    }
    elements.credentialSave.disabled = credentialMutationInFlight || !connected || !configured || !statusReady;
    elements.credentialDelete.disabled = credentialMutationInFlight || !connected || !configured || !statusReady || !selectedProfile();
    if (formView) formView.submit.disabled = queryStartInFlight || !statusReady || selectedProfile()?.state !== "ready";
    elements.stop.disabled = cancelInFlight || !currentJob || !JOB_RUNNING.has(currentJob.state);
  }

  async function status(mutationId = null) {
    const requestGeneration = generation;
    const result = await send("panel.financial.credentials.status", { mutationId });
    if (requestGeneration !== generation) return { profiles: [], mutation: null, stale: true };
    statusReady = true;
    profiles = result.profiles;
    renderProfiles();
    if (credentialUnknown) {
      renderState("설정 결과 확인 불가");
      return result;
    }
    if (result.mutation && MUTATION_RUNNING.has(result.mutation.state)) {
      const pastRunDeadline = result.mutation.state === "running" && result.mutation.runDeadlineAt &&
        Date.parse(result.mutation.runDeadlineAt) <= Date.now();
      renderState(pastRunDeadline
        ? "로컬 보안 저장 결과 확인 중"
        : "자격 증명을 Windows 보안 저장소에서 확인하는 중입니다.");
    } else if (result.mutation?.state === "failed") {
      renderState(errorMessage(result.mutation.errorCode));
    } else if (result.mutation?.state === "succeeded") {
      renderState("자격 증명 변경이 완료되었습니다.");
    } else {
      renderState(profileReadinessMessage());
    }
    return result;
  }

  function warmStatus(expectedGeneration, checks = 0) {
    if (checks >= 240 || expectedGeneration !== generation) {
      renderState("금융 조회 준비 상태를 확인하지 못했습니다.");
      return;
    }
    void status().catch((error) => {
      if (expectedGeneration !== generation) return;
      if (error?.code === "FINANCIAL_BACKEND_STARTING") {
        statusReady = false;
        renderState("로컬 금융 조회 기능을 시작하는 중입니다.");
        timer = schedule(() => {
          timer = null;
          warmStatus(expectedGeneration, checks + 1);
        }, 500);
        return;
      }
      statusReady = false;
      renderState(credentialUnknown ? "설정 결과 확인 불가" : errorMessage(error?.code));
    });
  }

  function pollMutation(mutationId, expectedGeneration, checks = 0) {
    if (checks >= 240) {
      renderState("자격 증명 상태 확인을 멈췄습니다. 상태 확인 버튼으로 결과만 다시 확인할 수 있습니다.");
      return;
    }
    timer = schedule(async () => {
      timer = null;
      if (expectedGeneration !== generation) return;
      try {
        const result = await status(mutationId);
        if (expectedGeneration !== generation) return;
        if (result.mutation && MUTATION_RUNNING.has(result.mutation.state)) {
          pollMutation(mutationId, expectedGeneration, checks + 1);
        }
      } catch (error) {
        if (expectedGeneration !== generation) return;
        credentialUnknown = error?.code === "CREDENTIAL_MUTATION_NOT_FOUND";
        renderState(error?.code === "CREDENTIAL_MUTATION_NOT_FOUND"
          ? "설정 결과 확인 불가"
          : errorMessage(error?.code));
      }
    }, 500);
  }

  function renderJob(job) {
    currentJob = job;
    elements.stop.disabled = !JOB_RUNNING.has(job.state);
    if (job.state === "completed") {
      text(elements.status, "조회가 완료되었습니다.");
      if (job.card) renderCard(job.card);
    } else if (job.state === "failed" || job.state === "cancelled") {
      text(elements.status, errorMessage(job.errorCode));
    } else {
      const labels = { queued: "조회 대기 중", running: "조회 중", cancelling: "취소 확인 중" };
      text(elements.status, labels[job.state] || "조회 상태 확인 중");
    }
  }

  function pollJob(jobId, expectedGeneration, checks = 0) {
    if (checks >= 240) {
      currentJob = null;
      elements.stop.disabled = true;
      text(elements.status, "조회 상태 확인을 멈췄습니다. 자동으로 다시 조회하지 않습니다.");
      return;
    }
    timer = schedule(async () => {
      timer = null;
      if (expectedGeneration !== generation) return;
      try {
        const result = await send("panel.financial.query.status", { jobId });
        if (expectedGeneration !== generation) return;
        renderJob(result.job);
        if (JOB_RUNNING.has(result.job.state)) pollJob(jobId, expectedGeneration, checks + 1);
      } catch (error) {
        if (expectedGeneration !== generation) return;
        currentJob = null;
        elements.stop.disabled = true;
        text(elements.status, queryFailureMessage(error?.code));
      }
    }, 500);
  }

  function renderCard(card) {
    const callbackGeneration = generation;
    const callbackJobId = currentJob?.jobId ?? card.jobId ?? null;
    let renderedView;
    try {
      renderedView = renderFinancialCard({
        document,
        container: elements.card,
        card,
        chartRenderer,
        onPage: async ({ direction, ...params }) => {
          if (callbackGeneration !== generation || currentJob?.jobId !== callbackJobId) return;
          try {
            const result = await send("panel.financial.query.page", { params });
            if (callbackGeneration !== generation || currentJob?.jobId !== callbackJobId) return;
            // Chart page indexes are chronological. The initial card is the
            // newest (last) page, so its previous token loads older candles.
            if (card.renderKind === "chart" && direction === "previous") {
              await chartRenderer.prepend(result.card);
              if (callbackGeneration !== generation || currentJob?.jobId !== callbackJobId) return;
              renderedView.updatePaging(result.card);
            } else renderCard(result.card);
          } catch (error) {
            if (callbackGeneration !== generation) return;
            text(elements.status, queryFailureMessage(error?.code));
          }
        },
        onContinue: async ({ parentJobId, continuationToken }) => {
          if (callbackGeneration !== generation || currentJob?.jobId !== callbackJobId) return;
          stopPolling();
          const expectedGeneration = generation;
          try {
            const result = await send("panel.financial.query.continue", {
              params: { submissionId: createId(), parentJobId, continuationToken },
            });
            if (expectedGeneration !== generation) return;
            renderJob(result.job);
            if (JOB_RUNNING.has(result.job.state)) pollJob(result.job.jobId, expectedGeneration);
          } catch (error) {
            if (expectedGeneration !== generation) return;
            text(elements.status, queryFailureMessage(error?.code));
          }
        },
      });
    } catch (error) {
      text(elements.status, error?.code === "FINANCIAL_RENDERER_UNAVAILABLE"
        ? "금융 카드 렌더러를 사용할 수 없습니다."
        : errorMessage(error?.code));
    }
  }

  function showOperation(detail) {
    if (detail?.kind !== "capability-detail") return false;
    try {
      currentDefinition = compileFinancialFormDefinition(detail);
    } catch (error) {
      currentDefinition = null;
      formView = null;
      const warning = document.createElement("p");
      warning.className = "financial-card-error";
      warning.textContent = error instanceof Error ? error.message : String(error);
      elements.form.replaceChildren(warning);
      return false;
    }
    formView = renderFinancialForm({
      document,
      container: elements.form,
      definition: currentDefinition,
      async onSubmit(argumentsObject) {
        if (queryStartInFlight) return;
        const profile = selectedProfile();
        if (!profile || profile.state !== "ready") {
          text(elements.status, "준비 완료된 조회 프로필을 선택해 주세요.");
          return;
        }
        stopPolling();
        const expectedGeneration = generation;
        queryStartInFlight = true;
        renderState(elements.readiness.textContent);
        text(elements.status, "조회 요청을 로컬 실행기에 전달하는 중입니다.");
        try {
          const result = await send("panel.financial.query.start", {
            params: {
              submissionId: createId(),
              profileId: profile.profileId,
              operationRef: currentDefinition.operationRef,
              arguments: argumentsObject,
            },
          });
          if (expectedGeneration !== generation) return;
          renderJob(result.job);
          if (JOB_RUNNING.has(result.job.state)) pollJob(result.job.jobId, expectedGeneration);
        } catch (error) {
          if (expectedGeneration !== generation) return;
          text(elements.status, queryFailureMessage(error?.code));
        } finally {
          queryStartInFlight = false;
          if (expectedGeneration === generation) renderState(elements.readiness.textContent);
        }
      },
    });
    renderState(elements.readiness.textContent);
    return true;
  }

  async function applyConnection(health) {
    const wasConnected = connected;
    const wasConfigured = configured;
    connected = health?.connected === true;
    configured = health?.runtime?.financial?.configured ?? health?.financial?.configured ?? false;
    if (Array.isArray(health?.financial?.profiles)) {
      profiles = health.financial.profiles;
      renderProfiles();
    }
    if (!connected || !configured) {
      stopPolling();
      profiles = [];
      warmed = false;
      statusReady = false;
      currentJob = null;
      chartRenderer?.destroy?.();
      elements.card.replaceChildren();
      renderProfiles();
      const unknown = health?.financial?.unknown;
      renderState(unknown
        ? "연결이 종료되어 마지막 요청 결과를 확인할 수 없습니다. 자동으로 다시 실행하지 않습니다."
        : connected ? "금융 조회 로컬 프로필이 구성되어 있지 않습니다." : "로컬 실행기에 연결해 주세요.");
      return;
    }
    const financialUnknown = health?.financial?.unknown;
    credentialUnknown = financialUnknown?.kind === "mutation" &&
      financialUnknown.reasonCode === "CREDENTIAL_MUTATION_NOT_FOUND";
    if (credentialUnknown) {
      warmed = true;
      statusReady = false;
      renderState("설정 결과 확인 불가");
      return;
    }
    if (financialUnknown) {
      text(elements.status, "이전 요청 결과를 확인할 수 없습니다. 자동으로 다시 실행하지 않으며 새 조회는 조회 버튼을 눌러야 합니다.");
    }
    if (warmed && wasConnected === connected && wasConfigured === configured) return;
    warmed = true;
    statusReady = false;
    renderState("로컬 금융 조회 상태를 확인하는 중입니다.");
    warmStatus(generation);
  }

  elements.refresh.addEventListener("click", () => {
    stopPolling();
    statusReady = false;
    renderState("로컬 금융 조회 상태를 확인하는 중입니다.");
    warmStatus(generation);
  });
  elements.profile.addEventListener("change", () => {
    renderState(elements.readiness.textContent);
  });
  elements.credentialsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (credentialMutationInFlight) return;
    const existing = selectedProfile();
    const params = {
      mutationId: createId(),
      profileId: existing?.profileId || elements.profileId.value || createId(),
      expectedRevision: existing?.revision ?? null,
      label: elements.profileLabel.value,
      environment: elements.environment.value,
      appKey: elements.appKey.value,
      secretKey: elements.secretKey.value,
    };
    stopPolling();
    const expectedGeneration = generation;
    credentialMutationInFlight = true;
    renderState(elements.readiness.textContent);
    try {
      const result = await send("panel.financial.credentials.configure", { params });
      if (expectedGeneration !== generation) return;
      credentialUnknown = false;
      renderState("자격 증명 확인 요청을 접수했습니다.");
      pollMutation(result.mutation.mutationId, expectedGeneration);
    } catch (error) {
      if (expectedGeneration !== generation) return;
      renderState(errorMessage(error?.code));
    } finally {
      clearSecrets();
      credentialMutationInFlight = false;
      if (expectedGeneration === generation) renderState(elements.readiness.textContent);
    }
  });
  elements.credentialDelete.addEventListener("click", async () => {
    if (credentialMutationInFlight) return;
    const profile = selectedProfile();
    if (!profile) return;
    stopPolling();
    const expectedGeneration = generation;
    credentialMutationInFlight = true;
    renderState(elements.readiness.textContent);
    try {
      const result = await send("panel.financial.credentials.delete", {
        params: { mutationId: createId(), profileId: profile.profileId, expectedRevision: profile.revision },
      });
      if (expectedGeneration !== generation) return;
      credentialUnknown = false;
      renderState("프로필 삭제 요청을 접수했습니다.");
      pollMutation(result.mutation.mutationId, expectedGeneration);
    } catch (error) {
      if (expectedGeneration !== generation) return;
      renderState(errorMessage(error?.code));
    } finally {
      credentialMutationInFlight = false;
      if (expectedGeneration === generation) renderState(elements.readiness.textContent);
    }
  });
  elements.stop.addEventListener("click", async () => {
    if (cancelInFlight || !currentJob || !JOB_RUNNING.has(currentJob.state)) return;
    const cancellingJobId = currentJob.jobId;
    stopPolling();
    const expectedGeneration = generation;
    cancelInFlight = true;
    elements.stop.disabled = true;
    try {
      const result = await send("panel.financial.query.cancel", {
        params: { jobId: cancellingJobId, cancellationId: createId() },
      });
      if (expectedGeneration !== generation || currentJob?.jobId !== cancellingJobId) return;
      renderJob(result.job);
    } catch (error) {
      if (expectedGeneration !== generation) return;
      text(elements.status, queryFailureMessage(error?.code));
    } finally {
      if (expectedGeneration === generation) {
        cancelInFlight = false;
        elements.stop.disabled = !currentJob || !JOB_RUNNING.has(currentJob.state);
      }
    }
  });

  renderProfiles();
  renderState("로컬 실행기에 연결해 주세요.");
  return Object.freeze({ applyConnection, showOperation, status, snapshot: () => ({ connected, configured, profiles, currentJob }) });
}

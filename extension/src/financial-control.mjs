export const FINANCIAL_PROFILE = "wts-financial-read-v1";
export const API_VERSION = "selector-financial-read-v1";
export const CARD_VERSION = "wts-financial-card-1";
export const MAX_PAGE_BYTES = 98_304;
export const METHODS = Object.freeze([
  "source.credentials.status", "source.credentials.configure", "source.credentials.delete",
  "source.query.start", "source.query.status", "source.query.page",
  "source.query.continue", "source.query.cancel",
]);
export const RENDER_KINDS = Object.freeze(["facts", "table", "compound", "chart"]);
export const ERROR_CODES = Object.freeze([
  "REQUEST_INVALID", "LOCAL_AUTH_FAILED", "RESOURCE_NOT_FOUND", "STATE_CONFLICT", "BUSY",
  "PAYLOAD_TOO_LARGE", "UPSTREAM_UNAVAILABLE", "OPERATION_TIMEOUT", "INTERNAL_ERROR",
  "FINANCIAL_BACKEND_STARTING", "CREDENTIAL_MUTATION_NOT_FOUND", "IDEMPOTENCY_CONFLICT",
  "QUERY_JOB_NOT_FOUND", "QUERY_CANCELLED", "QUERY_RESULT_ITEM_TOO_LARGE", "QUERY_RESULT_TOO_LARGE",
  "QUERY_RESULT_UNSUPPORTED_VALUE", "CONTINUATION_ALREADY_USED", "LOCK_CONFLICT", "TOKEN_REFRESHING",
  "TOKEN_REJECTED", "NETWORK_UNAVAILABLE", "VAULT_UNAVAILABLE", "DELETING",
]);

const TERMINAL_JOB_STATES = new Set(["completed", "failed", "cancelled"]);
const TERMINAL_MUTATION_STATES = new Set(["succeeded", "failed"]);
const EMPTY_JOURNAL = Object.freeze({ version: 1, pendingJob: null, pendingMutation: null, unknown: null });

function unwrap(response) {
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "로컬 금융 조회 요청을 완료하지 못했습니다.");
    error.code = response?.error?.code || "FINANCIAL_REQUEST_FAILED";
    throw error;
  }
  return response.result;
}

function copy(value) {
  return value == null ? value : structuredClone(value);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value;
}

function assertRevisionedSnapshot(value, identityKeys, label) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.revision) || value.revision < 0) {
    throw new Error(`${label} 상태 형식이 올바르지 않습니다.`);
  }
  for (const key of identityKeys) requiredString(value[key], `${label} 식별자`);
}

function sameIdentity(left, right, identityKeys) {
  return identityKeys.every((key) => left?.[key] === right?.[key]);
}

function jobRecord(value) {
  if (!value || TERMINAL_JOB_STATES.has(value.state)) return null;
  return Object.freeze({
    jobId: requiredString(value.jobId, "작업 식별자"),
    submissionId: requiredString(value.submissionId, "제출 식별자"),
    profileId: requiredString(value.profileId, "프로필 식별자"),
    operationRef: requiredString(value.operationRef, "기능 식별자"),
    revision: value.revision,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt.slice(0, 64) : null,
  });
}

function mutationRecord(value) {
  if (!value || TERMINAL_MUTATION_STATES.has(value.state)) return null;
  return Object.freeze({
    mutationId: requiredString(value.mutationId, "변경 식별자"),
    kind: requiredString(value.kind, "변경 종류"),
    profileId: requiredString(value.profileId, "프로필 식별자"),
    revision: value.revision,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt.slice(0, 64) : null,
  });
}

function safeUnknown(value) {
  if (!value || typeof value !== "object") return null;
  const kind = value.kind === "job" || value.kind === "mutation" || value.kind === "connection" ? value.kind : null;
  if (!kind) return null;
  return Object.freeze({
    kind,
    reasonCode: typeof value.reasonCode === "string" ? value.reasonCode.slice(0, 64) : "RESULT_UNKNOWN",
    jobId: typeof value.jobId === "string" ? value.jobId.slice(0, 256) : null,
    submissionId: typeof value.submissionId === "string" ? value.submissionId.slice(0, 256) : null,
    mutationId: typeof value.mutationId === "string" ? value.mutationId.slice(0, 256) : null,
    recordedAt: typeof value.recordedAt === "string" ? value.recordedAt.slice(0, 64) : new Date().toISOString(),
  });
}

function normalizeJournal(value) {
  if (!value || value.version !== 1) return copy(EMPTY_JOURNAL);
  const pendingJob = value.pendingJob && Number.isInteger(value.pendingJob.revision) && value.pendingJob.revision >= 0
    ? jobRecord({ ...value.pendingJob, state: "running" }) : null;
  const pendingMutation = value.pendingMutation && Number.isInteger(value.pendingMutation.revision) && value.pendingMutation.revision >= 0
    ? mutationRecord({ ...value.pendingMutation, state: "running" }) : null;
  return { version: 1, pendingJob, pendingMutation, unknown: safeUnknown(value.unknown) };
}

export function createFinancialControlCoordinator({
  request,
  onStateChange = () => {},
  loadJournal = async () => null,
  saveJournal = async () => {},
}) {
  if (typeof request !== "function" || typeof onStateChange !== "function" ||
      typeof loadJournal !== "function" || typeof saveJournal !== "function") {
    throw new TypeError("request, onStateChange, loadJournal and saveJournal are required");
  }
  let configured = false;
  let connected = false;
  let profiles = [];
  let mutation = null;
  let job = null;
  let card = null;
  let unknown = null;
  let generation = 0;
  let reconciledGeneration = -1;
  let statusSequence = 0;
  let appliedStatusSequence = 0;
  let pending = 0;
  let journal = copy(EMPTY_JOURNAL);
  let journalWrite = Promise.resolve();
  const inFlight = new Set();

  function snapshot() {
    return Object.freeze({
      configured, connected, profiles: copy(profiles), mutation: copy(mutation), job: copy(job),
      card: copy(card), unknown: copy(unknown), pending,
      running: pending > 0 || Boolean(job && !TERMINAL_JOB_STATES.has(job.state)),
    });
  }

  function publish() {
    const value = snapshot();
    onStateChange(value);
    return value;
  }

  function mergeProfiles(nextProfiles) {
    if (!Array.isArray(nextProfiles)) throw new Error("자격 증명 프로필 상태 형식이 올바르지 않습니다.");
    const currentById = new Map(profiles.map((profile) => [profile.profileId, profile]));
    return nextProfiles.map((profile) => {
      if (!profile || typeof profile.profileId !== "string" || !Number.isInteger(profile.revision) || profile.revision < 0) {
        throw new Error("자격 증명 프로필 상태 형식이 올바르지 않습니다.");
      }
      const current = currentById.get(profile.profileId);
      return copy(current && current.revision > profile.revision ? current : profile);
    });
  }

  function persistJournal() {
    const next = copy(journal);
    journalWrite = journalWrite.catch(() => {}).then(() => saveJournal(next));
    return journalWrite;
  }

  function setJournalUnknown(value) {
    unknown = safeUnknown(value);
    journal = { ...journal, pendingJob: null, pendingMutation: null, unknown };
    void persistJournal();
    publish();
  }

  async function invoke(method, params) {
    if (!connected) throw new Error("먼저 로컬 실행기에 연결해 주세요.");
    if (!configured) throw new Error("이 로컬 실행기에는 금융 조회 프로필이 구성되어 있지 않습니다.");
    const expectedGeneration = generation;
    const call = { method, params: copy(params) };
    inFlight.add(call);
    pending += 1;
    publish();
    try {
      const result = unwrap(await request(method, params));
      if (expectedGeneration !== generation) {
        throw new Error("연결이 변경되어 요청 결과를 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다.");
      }
      return result;
    } finally {
      inFlight.delete(call);
      pending = Math.max(0, pending - 1);
      publish();
    }
  }

  async function acceptJob(next, { replace = false } = {}) {
    const identityKeys = ["jobId", "submissionId", "profileId", "operationRef"];
    assertRevisionedSnapshot(next, identityKeys, "금융 조회 작업");
    if (job && !replace) {
      if (!sameIdentity(job, next, identityKeys)) throw new Error("금융 조회 작업 식별자가 현재 작업과 일치하지 않습니다.");
      if (next.revision < job.revision || TERMINAL_JOB_STATES.has(job.state)) return copy(job);
    }
    job = copy(next);
    if (next.card) card = copy(next.card);
    unknown = null;
    journal = { ...journal, pendingJob: jobRecord(next), unknown: null };
    await persistJournal();
    publish();
    return copy(job);
  }

  async function acceptMutation(next, { expected = null } = {}) {
    if (next === null) return null;
    const identityKeys = ["mutationId", "kind", "profileId"];
    assertRevisionedSnapshot(next, identityKeys, "자격 증명 변경");
    if (expected && !sameIdentity(expected, next, identityKeys)) throw new Error("자격 증명 변경 식별자가 요청과 일치하지 않습니다.");
    if (mutation) {
      if (!sameIdentity(mutation, next, identityKeys)) {
        if (!TERMINAL_MUTATION_STATES.has(mutation.state)) throw new Error("자격 증명 변경 식별자가 현재 상태와 일치하지 않습니다.");
      } else if (next.revision < mutation.revision || TERMINAL_MUTATION_STATES.has(mutation.state)) return copy(mutation);
    }
    mutation = copy(next);
    unknown = null;
    journal = { ...journal, pendingMutation: mutationRecord(next), unknown: null };
    await persistJournal();
    publish();
    return copy(mutation);
  }

  async function reconcile() {
    if (!connected || !configured || reconciledGeneration === generation) return snapshot();
    reconciledGeneration = generation;
    journal = normalizeJournal(await loadJournal());
    unknown = journal.unknown;
    publish();
    if (unknown) return snapshot();
    if (journal.pendingMutation) {
      const expected = journal.pendingMutation;
      try {
        const result = await invoke("source.credentials.status", { mutationId: expected.mutationId });
        profiles = mergeProfiles(result.profiles || []);
        if (!result.mutation) throw Object.assign(new Error("tracked mutation not found"), { code: "CREDENTIAL_MUTATION_NOT_FOUND" });
        await acceptMutation(result.mutation, { expected });
      } catch (error) {
        if (error?.code !== "CREDENTIAL_MUTATION_NOT_FOUND") throw error;
        mutation = null;
        setJournalUnknown({ kind: "mutation", reasonCode: error.code, mutationId: expected.mutationId });
      }
      return snapshot();
    }
    if (journal.pendingJob) {
      const expected = journal.pendingJob;
      try {
        const result = await invoke("source.query.status", { jobId: expected.jobId });
        if (!sameIdentity(expected, result.job, ["jobId", "submissionId", "profileId", "operationRef"])) {
          throw new Error("금융 조회 작업 식별자가 저장된 작업과 일치하지 않습니다.");
        }
        await acceptJob(result.job, { replace: true });
      } catch (error) {
        if (error?.code !== "QUERY_JOB_NOT_FOUND") throw error;
        job = null;
        card = null;
        setJournalUnknown({ kind: "job", reasonCode: error.code, jobId: expected.jobId, submissionId: expected.submissionId });
      }
    }
    return snapshot();
  }

  return Object.freeze({
    connect(capability) {
      connected = true;
      configured = capability?.configured === true;
      generation += 1;
      return publish();
    },
    disconnect(reason = "연결이 종료되어 마지막 금융 요청의 결과를 확인할 수 없습니다.") {
      generation += 1;
      connected = false;
      configured = false;
      const unresolved = inFlight.values().next().value;
      if (inFlight.size > 0) {
        setJournalUnknown({
          kind: "connection", reasonCode: "NATIVE_DISCONNECTED",
          jobId: job?.jobId ?? unresolved?.params?.jobId ?? unresolved?.params?.parentJobId ?? journal.pendingJob?.jobId ?? null,
          submissionId: job?.submissionId ?? unresolved?.params?.submissionId ?? journal.pendingJob?.submissionId ?? null,
          mutationId: mutation?.mutationId ?? unresolved?.params?.mutationId ?? journal.pendingMutation?.mutationId ?? null,
        });
        unknown = { ...unknown, reason };
      } else if (journal.pendingJob || journal.pendingMutation) {
        unknown = {
          ...safeUnknown({
            kind: "connection", reasonCode: "NATIVE_DISCONNECTED",
            jobId: journal.pendingJob?.jobId ?? null,
            submissionId: journal.pendingJob?.submissionId ?? null,
            mutationId: journal.pendingMutation?.mutationId ?? null,
          }),
          reason,
        };
      }
      pending = 0;
      profiles = [];
      mutation = null;
      job = null;
      card = null;
      return publish();
    },
    snapshot,
    reconcile,
    flushJournal: () => journalWrite,
    async credentialsStatus(mutationId = null) {
      const requestSequence = ++statusSequence;
      try {
        const result = await invoke("source.credentials.status", { mutationId });
        if (requestSequence >= appliedStatusSequence) {
          profiles = mergeProfiles(result.profiles || []);
          appliedStatusSequence = requestSequence;
        }
        const acceptedMutation = await acceptMutation(result.mutation, {
          expected: mutationId && mutation ? mutation : null,
        });
        if (result.mutation === null) publish();
        return { ...copy(result), profiles: copy(profiles), mutation: acceptedMutation };
      } catch (error) {
        if (mutationId && mutation?.mutationId === mutationId && !TERMINAL_MUTATION_STATES.has(mutation.state) &&
            error?.code === "CREDENTIAL_MUTATION_NOT_FOUND") {
          mutation = null;
          setJournalUnknown({ kind: "mutation", reasonCode: error.code, mutationId });
        }
        throw error;
      }
    },
    async configure(params) {
      const result = await invoke("source.credentials.configure", params);
      return { ...copy(result), mutation: await acceptMutation(result.mutation, {
        expected: { mutationId: params.mutationId, kind: "configure", profileId: params.profileId },
      }) };
    },
    async deleteProfile(params) {
      const result = await invoke("source.credentials.delete", params);
      return { ...copy(result), mutation: await acceptMutation(result.mutation, {
        expected: { mutationId: params.mutationId, kind: "delete", profileId: params.profileId },
      }) };
    },
    async start(params) {
      if (job && !TERMINAL_JOB_STATES.has(job.state)) throw new Error("이미 금융 조회 작업이 진행 중입니다.");
      card = null;
      unknown = null;
      const result = await invoke("source.query.start", params);
      if (result.job?.submissionId !== params.submissionId || result.job?.profileId !== params.profileId ||
          result.job?.operationRef !== params.operationRef) throw new Error("금융 조회 작업 식별자가 요청과 일치하지 않습니다.");
      return { job: await acceptJob(result.job, { replace: true }) };
    },
    async status(jobId) {
      const result = await invoke("source.query.status", { jobId });
      if (result.job?.jobId !== jobId) throw new Error("금융 조회 작업 식별자가 요청과 일치하지 않습니다.");
      return { job: await acceptJob(result.job) };
    },
    async page(params) {
      const result = await invoke("source.query.page", params);
      if (!job || result.jobId !== job.jobId || !Number.isInteger(result.jobRevision) || result.jobRevision < 0) {
        throw new Error("금융 조회 페이지가 현재 작업과 일치하지 않습니다.");
      }
      if (result.jobRevision < job.revision) return copy({ ...result, card });
      card = copy(result.card);
      job = { ...job, revision: result.jobRevision };
      journal = { ...journal, pendingJob: jobRecord(job) };
      await persistJournal();
      publish();
      return copy(result);
    },
    async continueQuery(params) {
      if (job && !TERMINAL_JOB_STATES.has(job.state)) throw new Error("현재 금융 조회 작업이 끝난 뒤 다음 페이지를 조회해 주세요.");
      const result = await invoke("source.query.continue", params);
      if (result.job?.submissionId !== params.submissionId || result.job?.parentJobId !== params.parentJobId ||
          result.job?.profileId !== job?.profileId || result.job?.operationRef !== job?.operationRef) {
        throw new Error("다음 금융 조회 작업 식별자가 요청과 일치하지 않습니다.");
      }
      card = null;
      return { job: await acceptJob(result.job, { replace: true }) };
    },
    async cancel(params) {
      const result = await invoke("source.query.cancel", params);
      if (result.job?.jobId !== params.jobId) throw new Error("취소 결과가 현재 금융 조회 작업과 일치하지 않습니다.");
      return { ...copy(result), job: await acceptJob(result.job) };
    },
  });
}

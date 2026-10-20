import test from "node:test";
import assert from "node:assert/strict";
import {
  API_VERSION,
  CARD_VERSION,
  ERROR_CODES,
  FINANCIAL_PROFILE,
  MAX_PAGE_BYTES,
  METHODS,
  RENDER_KINDS,
  createFinancialControlCoordinator,
} from "../src/financial-control.mjs";
import {
  FINANCIAL_PROFILE as CONTRACT_PROFILE,
  FINANCIAL_API_VERSION as CONTRACT_API_VERSION,
  FINANCIAL_CARD_VERSION as CONTRACT_CARD_VERSION,
  FINANCIAL_MAX_PAGE_BYTES as CONTRACT_MAX_PAGE_BYTES,
  FINANCIAL_METHODS as CONTRACT_METHODS,
  FINANCIAL_RENDER_KINDS as CONTRACT_RENDER_KINDS,
  FINANCIAL_ERROR_CODES as CONTRACT_ERROR_CODES,
} from "../../contracts/wts-foundation.mjs";

const profileId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const submissionId = "00000000-0000-4000-8000-000000000003";

function job(state, card = null, overrides = {}) {
  return {
    jobId, submissionId, parentJobId: null, profileId, operationRef: "base:stockinfo",
    state, revision: 1, createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z", queueDeadlineAt: "2026-10-19T00:01:00.000Z",
    runDeadlineAt: state === "queued" ? null : "2026-10-19T00:01:00.000Z",
    terminalAt: state === "completed" ? "2026-10-19T00:00:01.000Z" : null,
    errorCode: null, card, ...overrides,
  };
}

function mutation(state, revision = 1, overrides = {}) {
  return {
    mutationId: "00000000-0000-4000-8000-000000000004", kind: "configure", profileId,
    state, revision, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:01.000Z",
    queueDeadlineAt: "2026-10-19T00:01:00.000Z", runDeadlineAt: "2026-10-19T00:01:00.000Z",
    terminalAt: state === "succeeded" || state === "failed" ? "2026-10-19T00:00:02.000Z" : null,
    errorCode: null, ...overrides,
  };
}

test("financial extension constants match the frozen v7 vocabulary", () => {
  assert.equal(FINANCIAL_PROFILE, CONTRACT_PROFILE);
  assert.equal(API_VERSION, CONTRACT_API_VERSION);
  assert.equal(CARD_VERSION, CONTRACT_CARD_VERSION);
  assert.equal(MAX_PAGE_BYTES, CONTRACT_MAX_PAGE_BYTES);
  assert.deepEqual(METHODS, CONTRACT_METHODS);
  assert.deepEqual(RENDER_KINDS, CONTRACT_RENDER_KINDS);
  assert.deepEqual(ERROR_CODES, CONTRACT_ERROR_CODES);
});

test("one explicit start is never replayed and reconnect reconciles its accepted pending job once", async () => {
  const calls = [];
  let stored = null;
  const coordinator = createFinancialControlCoordinator({
    async request(method, params) {
      calls.push({ method, params: structuredClone(params) });
      if (method === "source.query.start") return { ok: true, result: { job: job("queued") } };
      if (method === "source.query.status") return { ok: true, result: { job: job("cancelled", null, { revision: 2, errorCode: "QUERY_CANCELLED", terminalAt: "2026-10-19T00:00:02.000Z" }) } };
      throw new Error("unexpected method");
    },
    loadJournal: async () => stored,
    saveJournal: async (value) => { stored = structuredClone(value); },
  });
  coordinator.connect({ configured: true });
  const result = await coordinator.start({ submissionId, profileId, operationRef: "base:stockinfo", arguments: {} });
  assert.equal(result.job.state, "queued");
  await assert.rejects(
    coordinator.start({ submissionId, profileId, operationRef: "base:stockinfo", arguments: {} }),
    /이미 금융 조회 작업/,
  );
  assert.equal(calls.length, 1);
  const disconnected = coordinator.disconnect();
  assert.equal(disconnected.job, null);
  assert.equal(disconnected.unknown.jobId, jobId);
  coordinator.connect({ configured: true });
  await coordinator.reconcile();
  await coordinator.reconcile();
  assert.deepEqual(calls.map((call) => call.method), ["source.query.start", "source.query.status"]);
  assert.equal(coordinator.snapshot().job.state, "cancelled");
});

test("credential secrets are forwarded once and are not retained in coordinator state", async () => {
  const params = {
    mutationId: "00000000-0000-4000-8000-000000000004",
    profileId,
    expectedRevision: null,
    label: "모의",
    environment: "mock",
    appKey: "app-secret-canary",
    secretKey: "secret-secret-canary",
  };
  let captured;
  const coordinator = createFinancialControlCoordinator({
    async request(method, value) {
      captured = { method, value };
      return { ok: true, result: { mutation: {
        mutationId: params.mutationId, kind: "configure", profileId, state: "queued", revision: 0,
        createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z",
        queueDeadlineAt: "2026-10-19T00:01:00.000Z", runDeadlineAt: null, terminalAt: null, errorCode: null,
      } } };
    },
  });
  coordinator.connect({ configured: true });
  await coordinator.configure(params);
  assert.equal(captured.method, "source.credentials.configure");
  assert.equal(captured.value.appKey, params.appKey);
  assert.doesNotMatch(JSON.stringify(coordinator.snapshot()), /secret-canary/);
});

test("disconnect marks an unresolved Native call unknown and rejects its late result", async () => {
  let resolveRequest;
  const response = new Promise((resolve) => { resolveRequest = resolve; });
  const coordinator = createFinancialControlCoordinator({ request: () => response });
  coordinator.connect({ configured: true });
  const start = coordinator.start({ submissionId, profileId, operationRef: "base:stockinfo", arguments: {} });
  const disconnected = coordinator.disconnect();
  assert.equal(disconnected.unknown.kind, "connection");
  assert.equal(disconnected.unknown.reasonCode, "NATIVE_DISCONNECTED");
  assert.equal(disconnected.unknown.reason, "연결이 종료되어 마지막 금융 요청의 결과를 확인할 수 없습니다.");
  assert.equal(disconnected.unknown.submissionId, submissionId);
  resolveRequest({ ok: true, result: { job: job("completed", { cardVersion: CARD_VERSION }) } });
  await assert.rejects(start, /연결이 변경/);
  assert.equal(coordinator.snapshot().job, null);
});

test("job and mutation snapshots never regress revision or terminal state", async () => {
  let jobStatus = 0;
  let mutationStatus = 0;
  const coordinator = createFinancialControlCoordinator({
    async request(method) {
      if (method === "source.query.start") return { ok: true, result: { job: job("queued", null, { revision: 1 }) } };
      if (method === "source.query.status") {
        jobStatus += 1;
        return { ok: true, result: { job: job(jobStatus === 1 ? "completed" : "running", null, { revision: jobStatus === 1 ? 5 : 4 }) } };
      }
      if (method === "source.credentials.configure") return { ok: true, result: { mutation: mutation("running", 3) } };
      if (method === "source.credentials.status") {
        mutationStatus += 1;
        return { ok: true, result: { profiles: [], mutation: mutation(mutationStatus === 1 ? "succeeded" : "running", mutationStatus === 1 ? 5 : 4) } };
      }
      throw new Error(`unexpected ${method}`);
    },
  });
  coordinator.connect({ configured: true });
  await coordinator.start({ submissionId, profileId, operationRef: "base:stockinfo", arguments: {} });
  assert.equal((await coordinator.status(jobId)).job.revision, 5);
  assert.equal((await coordinator.status(jobId)).job.state, "completed");
  await coordinator.configure({ mutationId: mutation("queued").mutationId, profileId, expectedRevision: null, label: "x", environment: "mock", appKey: "a", secretKey: "b" });
  assert.equal((await coordinator.credentialsStatus(mutation("queued").mutationId)).mutation.revision, 5);
  assert.equal((await coordinator.credentialsStatus(mutation("queued").mutationId)).mutation.state, "succeeded");
});

test("job and mutation responses must retain the tracked identity", async () => {
  const coordinator = createFinancialControlCoordinator({
    async request(method) {
      if (method === "source.query.start") return { ok: true, result: { job: job("queued") } };
      if (method === "source.query.status") return { ok: true, result: { job: job("running", null, { submissionId: "wrong" }) } };
      if (method === "source.credentials.configure") return { ok: true, result: { mutation: mutation("running") } };
      if (method === "source.credentials.status") return { ok: true, result: { profiles: [], mutation: mutation("running", 2, { profileId: "wrong" }) } };
      throw new Error(`unexpected ${method}`);
    },
  });
  coordinator.connect({ configured: true });
  await coordinator.start({ submissionId, profileId, operationRef: "base:stockinfo", arguments: {} });
  await assert.rejects(coordinator.status(jobId), /식별자가 현재 작업과 일치하지 않습니다/);
  await coordinator.configure({ mutationId: mutation("queued").mutationId, profileId, expectedRevision: null, label: "x", environment: "mock", appKey: "a", secretKey: "b" });
  await assert.rejects(coordinator.credentialsStatus(mutation("queued").mutationId), /식별자가 요청과 일치하지 않습니다/);
});

test("MV3 restart reconciles one non-secret mutation journal exactly once without replay", async () => {
  let stored = null;
  const first = createFinancialControlCoordinator({
    request: async () => ({ ok: true, result: { mutation: mutation("running", 2) } }),
    loadJournal: async () => stored,
    saveJournal: async (value) => { stored = structuredClone(value); },
  });
  first.connect({ configured: true });
  await first.configure({ mutationId: mutation("queued").mutationId, profileId, expectedRevision: null, label: "secret-label", environment: "mock", appKey: "app-secret", secretKey: "key-secret" });
  assert.doesNotMatch(JSON.stringify(stored), /secret-label|app-secret|key-secret/);

  const calls = [];
  const second = createFinancialControlCoordinator({
    request: async (method, params) => {
      calls.push({ method, params });
      return { ok: true, result: { profiles: [], mutation: mutation("succeeded", 3) } };
    },
    loadJournal: async () => stored,
    saveJournal: async (value) => { stored = structuredClone(value); },
  });
  second.connect({ configured: true });
  await second.reconcile();
  await second.reconcile();
  assert.deepEqual(calls, [{ method: "source.credentials.status", params: { mutationId: mutation("queued").mutationId } }]);
  assert.equal(second.snapshot().mutation.state, "succeeded");
  assert.equal(stored.pendingMutation, null);
});

test("lost tracked mutation becomes journaled unknown without a terminal revision or replay", async () => {
  let stored = {
    version: 1, pendingJob: null,
    pendingMutation: { mutationId: mutation("queued").mutationId, kind: "configure", profileId, revision: 2, updatedAt: "2026-10-19T00:00:01.000Z" },
    unknown: null,
  };
  const calls = [];
  const coordinator = createFinancialControlCoordinator({
    request: async (method, params) => {
      calls.push({ method, params });
      return { ok: false, error: { code: "CREDENTIAL_MUTATION_NOT_FOUND", message: "lost" } };
    },
    loadJournal: async () => stored,
    saveJournal: async (value) => { stored = structuredClone(value); },
  });
  coordinator.connect({ configured: true });
  await coordinator.reconcile();
  await coordinator.flushJournal();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "source.credentials.status");
  assert.equal(coordinator.snapshot().mutation, null);
  assert.equal(coordinator.snapshot().unknown.reasonCode, "CREDENTIAL_MUTATION_NOT_FOUND");
  assert.equal(stored.pendingMutation, null);
  assert.equal(stored.unknown.reasonCode, "CREDENTIAL_MUTATION_NOT_FOUND");
});

test("lost journaled query becomes unknown after one status call without replay", async () => {
  let stored = {
    version: 1,
    pendingJob: { jobId, submissionId, profileId, operationRef: "base:stockinfo", revision: 3, updatedAt: "2026-10-19T00:00:01.000Z" },
    pendingMutation: null, unknown: null,
  };
  const calls = [];
  const coordinator = createFinancialControlCoordinator({
    request: async (method, params) => {
      calls.push({ method, params });
      return { ok: false, error: { code: "QUERY_JOB_NOT_FOUND", message: "lost" } };
    },
    loadJournal: async () => stored,
    saveJournal: async (value) => { stored = structuredClone(value); },
  });
  coordinator.connect({ configured: true });
  await coordinator.reconcile();
  await coordinator.flushJournal();
  assert.deepEqual(calls, [{ method: "source.query.status", params: { jobId } }]);
  assert.equal(coordinator.snapshot().job, null);
  assert.equal(coordinator.snapshot().unknown.reasonCode, "QUERY_JOB_NOT_FOUND");
  assert.equal(stored.pendingJob, null);
});

test("concurrent credential status responses cannot regress a newer profile snapshot", async () => {
  const pending = [];
  const coordinator = createFinancialControlCoordinator({
    request: async (method) => {
      assert.equal(method, "source.credentials.status");
      return new Promise((resolve) => pending.push(resolve));
    },
  });
  coordinator.connect({ configured: true });
  const older = coordinator.credentialsStatus();
  const newer = coordinator.credentialsStatus();
  pending[1]({ ok: true, result: {
    profiles: [{ profileId, label: "최신", environment: "mock", revision: 5, state: "ready", reasonCode: null }],
    mutation: null,
  } });
  await newer;
  pending[0]({ ok: true, result: {
    profiles: [{ profileId, label: "과거", environment: "mock", revision: 4, state: "refreshing", reasonCode: "TOKEN_REFRESHING" }],
    mutation: null,
  } });
  const late = await older;
  assert.equal(late.profiles[0].revision, 5);
  assert.equal(coordinator.snapshot().profiles[0].state, "ready");
  assert.equal(coordinator.snapshot().profiles[0].label, "최신");
});

test("continuation child must preserve its parent profile and operation identity", async () => {
  for (const overrides of [{ profileId: "wrong-profile" }, { operationRef: "base:other" }]) {
    const coordinator = createFinancialControlCoordinator({
      async request(method, params) {
        if (method === "source.query.start") return { ok: true, result: { job: job("completed", null, { revision: 2 }) } };
        if (method === "source.query.continue") return { ok: true, result: { job: job("queued", null, {
          jobId: "00000000-0000-4000-8000-000000000099",
          submissionId: params.submissionId, parentJobId: params.parentJobId, ...overrides,
        }) } };
        throw new Error(`unexpected ${method}`);
      },
    });
    coordinator.connect({ configured: true });
    await coordinator.start({ submissionId, profileId, operationRef: "base:stockinfo", arguments: {} });
    await assert.rejects(coordinator.continueQuery({
      submissionId: "00000000-0000-4000-8000-000000000098", parentJobId: jobId, continuationToken: "token",
    }), /식별자가 요청과 일치하지 않습니다/);
    assert.equal(coordinator.snapshot().job.jobId, jobId);
  }
});

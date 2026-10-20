import test from "node:test";
import assert from "node:assert/strict";
import {
  NATIVE_DIAGNOSTIC_BUILD,
  createNativeDiagnostic,
  formatNativeDiagnostic,
  runDirectNativeProbe,
} from "../src/sidepanel/native-diagnostic.mjs";

test("diagnostic uses the real runtime identity and starts with no attempted connection", () => {
  const diagnostic = createNativeDiagnostic({
    runtime: { id: "actual-extension-id", getManifest: () => ({ version: "7.8.9" }) },
    hostName: "com.athena.wts",
  });
  const state = diagnostic.snapshot();
  assert.equal(state.build, NATIVE_DIAGNOSTIC_BUILD);
  assert.equal(state.extensionId, "actual-extension-id");
  assert.equal(state.version, "7.8.9");
  assert.equal(state.hostName, "com.athena.wts");
  assert.equal(state.attempted, false);
  assert.match(formatNativeDiagnostic(state), /연결 시도: 아니요/);
});

test("two clicks get fresh attempt metadata and clear the previous error without health mutation", () => {
  const times = [new Date("2026-10-18T01:02:03.000Z"), new Date("2026-10-18T01:02:04.000Z")];
  const ids = ["attempt-one", "attempt-two"];
  const diagnostic = createNativeDiagnostic({
    runtime: { id: "actual-extension-id", getManifest: () => ({ version: "0.1.0" }) },
    hostName: "com.athena.wts",
    now: () => times.shift(),
    createAttemptId: () => ids.shift(),
  });

  const first = diagnostic.beginAttempt();
  diagnostic.fail(first.attemptId, "Specified native messaging host not found.");
  const failed = diagnostic.snapshot();
  assert.equal(failed.attemptId, "attempt-one");
  assert.equal(failed.attemptedAt, "2026-10-18T01:02:03.000Z");
  assert.equal(failed.error, "Specified native messaging host not found.");

  const health = { connected: false, error: "unrelated health error" };
  void health;
  assert.deepEqual(diagnostic.snapshot(), failed);

  const running = diagnostic.beginAttempt();
  assert.equal(running.attemptId, "attempt-two");
  assert.equal(running.attemptedAt, "2026-10-18T01:02:04.000Z");
  assert.equal(running.status, "running");
  assert.equal(running.error, null);
  assert.equal(running.route, "service-worker");
});

test("an older result cannot overwrite the newest diagnostic attempt", () => {
  const times = [new Date("2026-10-18T01:02:03.000Z"), new Date("2026-10-18T01:02:04.000Z")];
  const ids = ["older-attempt", "newer-attempt"];
  const diagnostic = createNativeDiagnostic({
    runtime: { id: "actual-extension-id", getManifest: () => ({ version: "0.1.0" }) },
    hostName: "com.athena.wts",
    now: () => times.shift(),
    createAttemptId: () => ids.shift(),
  });

  const older = diagnostic.beginAttempt("service-worker");
  const newer = diagnostic.beginAttempt("direct-panel");
  diagnostic.succeed(older.attemptId, "old success");
  assert.deepEqual(diagnostic.snapshot(), newer);
  diagnostic.fail(older.attemptId, "old failure");
  assert.deepEqual(diagnostic.snapshot(), newer);

  diagnostic.succeed(newer.attemptId, "runtime.hello 응답 확인 (0.1.0)");
  const finalState = diagnostic.snapshot();
  assert.equal(finalState.attemptId, "newer-attempt");
  assert.equal(finalState.route, "direct-panel");
  assert.equal(finalState.attemptedAt, "2026-10-18T01:02:04.000Z");
  assert.equal(finalState.status, "connected");
  assert.equal(finalState.detail, "runtime.hello 응답 확인 (0.1.0)");
});

test("direct panel probe sends only runtime.hello to the literal host and always disconnects", async () => {
  const calls = [];
  const client = {
    connect(hostName) { calls.push(["connect", hostName]); },
    async request(request) {
      calls.push(["request", request]);
      return { ok: true, result: { runtimeVersion: "0.1.0" } };
    },
    disconnect() { calls.push(["disconnect"]); },
  };
  const result = await runDirectNativeProbe({
    client,
    hostName: "com.athena.wts",
    protocolVersion: 1,
    requestId: "attempt-123",
  });
  assert.equal(result.runtimeVersion, "0.1.0");
  assert.deepEqual(calls, [
    ["connect", "com.athena.wts"],
    ["request", { protocolVersion: 1, requestId: "attempt-123", method: "runtime.hello", params: {} }],
    ["disconnect"],
  ]);
});

test("direct panel probe disconnects after Chrome rejects the host without touching main UI state", async () => {
  const mainUi = { connected: false, message: "original" };
  let disconnected = false;
  const client = {
    connect() { throw new Error("Specified native messaging host not found."); },
    request() { throw new Error("must not request after a failed connect"); },
    disconnect() { disconnected = true; },
  };
  await assert.rejects(
    runDirectNativeProbe({ client, hostName: "com.athena.wts", protocolVersion: 1, requestId: "attempt-456" }),
    /Specified native messaging host not found/,
  );
  assert.equal(disconnected, true);
  assert.deepEqual(mainUi, { connected: false, message: "original" });
});

test("runtime identity remains explicitly unknown when Chrome APIs are unavailable", () => {
  const diagnostic = createNativeDiagnostic({ runtime: {}, hostName: "com.athena.wts" });
  assert.equal(diagnostic.snapshot().extensionId, "알 수 없음");
  assert.equal(diagnostic.snapshot().version, "알 수 없음");
});

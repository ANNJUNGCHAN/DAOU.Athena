import test from "node:test";
import assert from "node:assert/strict";
import { buildCapture, createCaptureCoordinator } from "../src/capture-core.mjs";

const capturedAt = "2026-10-18T10:00:00.000Z";
const tab = { id: 7, windowId: 3, url: "https://wts.kiwoom.com/main#screen" };
let idCounter = 0;
const createId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, "0")}`;

function injection(frameId, overrides = {}) {
  return {
    frameId,
    documentId: `document-${frameId}`,
    result: {
      excluded: false,
      source: { origin: "https://wts.kiwoom.com", path: frameId === 0 ? "/main" : `/frame-${frameId}` },
      title: "키움 WTS",
      headings: [],
      controls: [],
      frames: [],
      canvasCount: 0,
      truncated: false,
    },
    ...overrides,
  };
}

function build(injections, overrides = {}) {
  return buildCapture({
    tab,
    reboundTab: { ...tab },
    injections,
    capturedAt,
    createId,
    validateObservation: (value) => value,
    ...overrides,
  });
}

test("an invalid Nth frame prevents creating or sending any capture", async () => {
  let sends = 0;
  let saves = 0;
  const coordinator = createCaptureCoordinator({
    loadPending: async () => null,
    savePending: async () => { saves += 1; },
    clearPending: async () => {},
    collectCapture: async () => build([injection(0), injection(1, { documentId: "" })]),
    sendCapture: async () => { sends += 1; },
  });
  await assert.rejects(coordinator.collectOrRetry(), /불완전/);
  assert.equal(saves, 0);
  assert.equal(sends, 0);
});

test("native failure retains one immutable capture and retry resends the same payload", async () => {
  let pending = null;
  let collections = 0;
  const sent = [];
  const coordinator = createCaptureCoordinator({
    loadPending: async () => pending,
    savePending: async (value) => { pending = value; },
    clearPending: async () => { pending = null; },
    collectCapture: async () => { collections += 1; return build([injection(0), injection(1)]); },
    sendCapture: async (capture) => {
      sent.push(JSON.stringify(capture));
      if (sent.length === 1) throw new Error("native unavailable");
      return { captureId: capture.id, observationCount: capture.observations.length, stored: true };
    },
  });

  await assert.rejects(coordinator.collectOrRetry(), /native unavailable/);
  assert.equal(await coordinator.hasPending(), true);
  const retried = await coordinator.collectOrRetry();
  assert.equal(retried.retried, true);
  assert.equal(collections, 1);
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1]);
  assert.equal(await coordinator.hasPending(), false);
});

test("capture retains the main frame, bounds frame count, and truncates to the byte budget", () => {
  const largeControls = Array.from({ length: 120 }, (_, index) => ({
    ref: `control-${index}`,
    tag: "button",
    role: "button",
    name: "가".repeat(160),
    type: "",
    disabled: false,
    visible: true,
  }));
  const injections = Array.from({ length: 18 }, (_, frameId) => injection(frameId));
  for (const item of injections) item.result.controls = structuredClone(largeControls);
  const capture = build(injections, { maxCaptureBytes: 16_000 });
  assert.equal(capture.observations.length, 16);
  assert.equal(capture.observations[0].source.frameId, 0);
  assert.equal(new TextEncoder().encode(JSON.stringify(capture)).byteLength <= 16_000, true);
  assert.equal(capture.observations.some((item) => item.truncated), true);
});

test("capture rejects a tab navigation or window identity change", () => {
  assert.throws(() => buildCapture({
    tab,
    reboundTab: { ...tab, url: "https://wts.kiwoom.com/other" },
    injections: [injection(0)],
    capturedAt,
    createId,
    validateObservation: (value) => value,
  }), /탭이 변경/);
  assert.throws(() => buildCapture({
    tab,
    reboundTab: { ...tab, windowId: 4 },
    injections: [injection(0)],
    capturedAt,
    createId,
    validateObservation: (value) => value,
  }), /탭이 변경/);
});

test("capture rejects duplicate frame IDs even when document IDs differ", () => {
  assert.throws(() => build([
    injection(0),
    injection(1),
    injection(1, { documentId: "new-document-for-frame-1" }),
  ]), /같은 WTS 프레임/);
});

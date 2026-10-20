import test from "node:test";
import assert from "node:assert/strict";
import { createNativeClient } from "../src/native-client.mjs";

function event() {
  let listener;
  return { addListener(next) { listener = next; }, fire(value) { listener?.(value); } };
}

function fixture() {
  const onMessage = event();
  const onDisconnect = event();
  const posted = [];
  const port = { onMessage, onDisconnect, posted, postMessage(value) { posted.push(value); }, disconnect() { onDisconnect.fire(); } };
  const client = createNativeClient({
    connectNative: () => port,
    validateRequest: (value) => value,
    validateResponse: (value) => value,
    maxMessageBytes: 131072,
    timeoutMs: 100,
    getLastError: () => null,
  });
  return { client, port };
}

test("native client correlates response ID and method", async () => {
  const { client, port } = fixture();
  client.connect("com.athena.wts");
  const pending = client.request({ requestId: "request-1", method: "runtime.hello" });
  assert.equal(port.posted.length, 1);
  port.onMessage.fire({ requestId: "request-1", method: "runtime.hello", ok: true });
  assert.equal((await pending).ok, true);
});

test("native client rejects pending requests when the port disconnects", async () => {
  const { client, port } = fixture();
  client.connect("com.athena.wts");
  const pending = client.request({ requestId: "request-2", method: "inventory.summary" });
  port.onDisconnect.fire();
  await assert.rejects(pending, /연결이 종료/);
  assert.equal(client.status().connected, false);
});

test("native client times out without silently retrying", async () => {
  const { client, port } = fixture();
  client.connect("com.athena.wts");
  const pending = client.request({ requestId: "request-3", method: "inventory.record" });
  await assert.rejects(pending, /자동 재시도하지 않습니다/);
  assert.equal(port.posted.length, 1);
});

test("native client reports an idle host disconnect to status listeners", () => {
  const onMessage = event();
  const onDisconnect = event();
  const statuses = [];
  const port = { onMessage, onDisconnect, postMessage() {}, disconnect() {} };
  const client = createNativeClient({
    connectNative: () => port,
    validateRequest: (value) => value,
    validateResponse: (value) => value,
    maxMessageBytes: 131072,
    getLastError: () => "native host exited",
    onStatusChange: (status) => statuses.push(status),
  });
  client.connect("com.athena.wts");
  onDisconnect.fire();
  assert.deepEqual(statuses, [
    { connected: true, error: null },
    { connected: false, error: "native host exited" },
  ]);
  assert.equal(client.status().connected, false);
});

test("native client applies a bounded local per-call timeout without adding it to the wire message", async () => {
  const onMessage = event();
  const onDisconnect = event();
  const posted = [];
  const timers = [];
  const port = { onMessage, onDisconnect, postMessage: (value) => posted.push(value), disconnect() {} };
  const client = createNativeClient({
    connectNative: () => port,
    validateRequest: (value) => value,
    validateResponse: (value) => value,
    maxMessageBytes: 131072,
    setTimer(callback, timeoutMs) { timers.push({ callback, timeoutMs }); return timers.length; },
    clearTimer() {},
  });
  client.connect("com.athena.wts");
  const message = { requestId: "source-1", method: "source.search", params: { query: "종목" } };
  const pending = client.request(message, { timeoutMs: 45_000 });
  assert.equal(timers[0].timeoutMs, 45_000);
  assert.deepEqual(posted, [message]);
  assert.equal(Object.hasOwn(posted[0], "timeoutMs"), false);
  onMessage.fire({ requestId: "source-1", method: "source.search", ok: true });
  assert.equal((await pending).ok, true);
});

test("native client rejects invalid timeout options before posting", async () => {
  const { client, port } = fixture();
  client.connect("com.athena.wts");
  await assert.rejects(client.request({ requestId: "bad-timeout", method: "source.search" }, { timeoutMs: 60_001 }), /100~60000/);
  await assert.rejects(client.request({ requestId: "bad-option", method: "source.search" }, { retry: true }), /지원하지 않는/);
  assert.equal(port.posted.length, 0);
});

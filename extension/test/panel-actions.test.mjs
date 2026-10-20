import test from "node:test";
import assert from "node:assert/strict";
import { performDisconnect } from "../src/sidepanel/panel-actions.mjs";

test("disconnect rejection preserves connected UI state and reports the error", async () => {
  let disconnected = false;
  let rejected = null;
  const result = await performDisconnect({
    send: async () => { throw new Error("명령 진행 중"); },
    onDisconnected: async () => { disconnected = true; },
    onRejected: async (error) => { rejected = error.message; },
  });
  assert.equal(result, false);
  assert.equal(disconnected, false);
  assert.equal(rejected, "명령 진행 중");
});

test("disconnect success updates UI only after the service accepts it", async () => {
  const order = [];
  const result = await performDisconnect({
    send: async () => { order.push("accepted"); },
    onDisconnected: async () => { order.push("ui-disconnected"); },
    onRejected: async () => { order.push("rejected"); },
  });
  assert.equal(result, true);
  assert.deepEqual(order, ["accepted", "ui-disconnected"]);
});

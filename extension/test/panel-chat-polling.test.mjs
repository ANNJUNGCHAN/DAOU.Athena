import test from "node:test";
import assert from "node:assert/strict";
import { createTaskPollingController } from "../src/sidepanel/panel-chat-polling.mjs";

function task(revision = 1, status = "ready", id = "8f329fda-e8a5-4cc4-8900-cde067590e13") {
  return { id, revision, status };
}

function createFakeClock() {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => time,
    setTimer(callback, delay) {
      const id = nextId++;
      timers.set(id, { at: time + delay, callback });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    async advance(milliseconds) {
      const target = time + milliseconds;
      while (true) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((left, right) => left[1].at - right[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        time = timer.at;
        await timer.callback();
      }
      time = target;
    },
    pending: () => timers.size,
  };
}

function controllerFixture(fetchTask, options = {}) {
  const clock = createFakeClock();
  const tasks = [];
  const errors = [];
  let stalls = 0;
  const controller = createTaskPollingController({
    fetchTask,
    onTask(value) { tasks.push(value); },
    onError(error, retry) { errors.push({ message: error.message, ...retry }); },
    onStalled() { stalls += 1; },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    initialDelay: 500,
    maxDelay: 2_000,
    stallAfter: 3_000,
    ...options,
  });
  return { clock, controller, tasks, errors, stalls: () => stalls };
}

test("a transient first get error backs off and later reaches a terminal task", async () => {
  let calls = 0;
  const value = controllerFixture(async () => {
    calls += 1;
    if (calls < 3) throw new Error(`temporary-${calls}`);
    return task(2, "completed");
  }, { stallAfter: 10_000 });

  value.controller.start(task());
  await value.clock.advance(500);
  assert.equal(calls, 1);
  assert.deepEqual(value.errors.map(({ message, delay }) => ({ message, delay })), [
    { message: "temporary-1", delay: 1_000 },
  ]);
  await value.clock.advance(999);
  assert.equal(calls, 1);
  await value.clock.advance(1);
  assert.equal(calls, 2);
  await value.clock.advance(2_000);
  assert.equal(calls, 3);
  assert.equal(value.tasks.at(-1).status, "completed");
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("an initial status refresh failure can enter bounded unknown-task polling", async () => {
  let calls = 0;
  const value = controllerFixture(async () => {
    calls += 1;
    if (calls === 1) throw new Error("first get failed");
    return task(2, "completed");
  });

  const first = await value.controller.refreshOnce();
  assert.equal(first.ok, false);
  assert.equal(value.controller.running(), false);
  value.controller.startUnknown();
  await value.clock.advance(500);
  assert.equal(calls, 2);
  assert.equal(value.tasks.at(-1).status, "completed");
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("persistent get errors stop at the stall boundary and manual refresh does not restart polling", async () => {
  let calls = 0;
  let recover = false;
  const value = controllerFixture(async () => {
    calls += 1;
    if (!recover) throw new Error("still unavailable");
    return task(2, "ready");
  });

  value.controller.start(task());
  await value.clock.advance(3_000);
  assert.equal(calls, 2);
  assert.equal(value.errors.length, 2);
  assert.equal(value.stalls(), 1);
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);

  recover = true;
  const refreshed = await value.controller.refreshOnce();
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.task.status, "ready");
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
  const refreshedAgain = await value.controller.refreshOnce();
  assert.equal(refreshedAgain.ok, true);
  assert.equal(refreshedAgain.task.status, "ready");
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("unchanged successful responses back off and eventually report a stalled task", async () => {
  let calls = 0;
  const value = controllerFixture(async () => {
    calls += 1;
    return task();
  });

  value.controller.start(task());
  await value.clock.advance(3_000);
  assert.equal(calls, 2);
  assert.equal(value.errors.length, 0);
  assert.equal(value.stalls(), 1);
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("a pushed task event resets backoff and a terminal event cancels the timer", async () => {
  const value = controllerFixture(async () => task(1, "ready"));
  value.controller.start(task());
  await value.clock.advance(500);
  value.controller.accept(task(2, "awaiting_receipt"));
  assert.equal(value.clock.pending(), 1);
  value.controller.accept(task(3, "completed"));
  assert.equal(value.tasks.at(-1).status, "completed");
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("a stale in-flight response cannot overwrite a newer terminal push", async () => {
  let resolveFetch;
  const fetchResult = new Promise((resolve) => { resolveFetch = resolve; });
  const value = controllerFixture(() => fetchResult);
  value.controller.start(task(1, "ready"));

  const advancing = value.clock.advance(500);
  await Promise.resolve();
  value.controller.accept(task(2, "completed"));
  resolveFetch(task(1, "ready"));
  await advancing;

  assert.deepEqual(value.tasks.map((entry) => `${entry.revision}:${entry.status}`), [
    "1:ready",
    "2:completed",
  ]);
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("identical pushed tasks during every get do not defeat the stall boundary", async () => {
  let calls = 0;
  let value;
  value = controllerFixture(async () => {
    calls += 1;
    value.controller.accept(task(1, "ready"));
    return task(1, "ready");
  });

  value.controller.start(task(1, "ready"));
  await value.clock.advance(3_000);
  assert.equal(calls, 2);
  assert.equal(value.stalls(), 1);
  assert.equal(value.controller.running(), false);
  assert.equal(value.clock.pending(), 0);
});

test("an older start response cannot overwrite a newer pushed revision", () => {
  const terminal = controllerFixture(async () => task());
  terminal.controller.accept(task(2, "completed"));
  terminal.controller.start(task(1, "ready"));
  assert.deepEqual(terminal.tasks.map((entry) => `${entry.revision}:${entry.status}`), ["2:completed"]);
  assert.equal(terminal.controller.running(), false);
  assert.equal(terminal.clock.pending(), 0);

  const running = controllerFixture(async () => task());
  running.controller.accept(task(2, "awaiting_receipt"));
  running.controller.start(task(1, "ready"));
  assert.deepEqual(running.tasks.map((entry) => `${entry.revision}:${entry.status}`), ["2:awaiting_receipt"]);
  assert.equal(running.controller.running(), true);
  assert.equal(running.clock.pending(), 1);
});

test("starting a genuine new task retires late pushes from the previous task", () => {
  const previousId = "8f329fda-e8a5-4cc4-8900-cde067590e13";
  const nextId = "2c989388-9c50-438d-8e63-110d396bd25e";
  const value = controllerFixture(async () => task(1, "ready", nextId));
  value.controller.start(task(4, "completed", previousId));
  value.controller.start(task(1, "ready", nextId));
  value.controller.accept(task(5, "completed", previousId));

  assert.deepEqual(value.tasks.map((entry) => `${entry.id}:${entry.revision}:${entry.status}`), [
    `${previousId}:4:completed`,
    `${nextId}:1:ready`,
  ]);
  assert.equal(value.controller.running(), true);
  assert.equal(value.clock.pending(), 1);
});

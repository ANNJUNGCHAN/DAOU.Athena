import { isTaskRunning } from "./panel-chat.mjs";

function taskPosition(task) {
  return task ? `${task.id}:${task.revision}` : "none";
}

export function createTaskPollingController({
  fetchTask,
  onTask,
  onError,
  onStalled,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = Date.now,
  initialDelay = 500,
  maxDelay = 8_000,
  stallAfter = 45_000,
}) {
  let timer = null;
  let active = false;
  let delay = initialDelay;
  let lastProgressAt = 0;
  let latestTask = null;
  let generation = 0;
  const retiredTaskIds = new Set();

  function retireTaskId(taskId) {
    if (!taskId) return;
    retiredTaskIds.add(taskId);
    if (retiredTaskIds.size > 8) retiredTaskIds.delete(retiredTaskIds.values().next().value);
  }

  function stop() {
    generation += 1;
    active = false;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function stall() {
    stop();
    onStalled();
  }

  function schedule() {
    if (!active || timer !== null) return;
    const remaining = stallAfter - (now() - lastProgressAt);
    if (remaining <= 0) {
      stall();
      return;
    }
    timer = setTimer(tick, Math.min(delay, remaining));
  }

  function acceptTask(task) {
    if (!task) {
      if (!latestTask) return { accepted: false, running: false };
      retireTaskId(latestTask.id);
      latestTask = null;
      onTask(null);
      stop();
      return { accepted: true, running: false };
    }

    if (retiredTaskIds.has(task.id)) {
      return { accepted: false, running: isTaskRunning(latestTask) };
    }

    if (latestTask?.id === task.id && task.revision <= latestTask.revision) {
      return { accepted: false, running: isTaskRunning(latestTask) };
    }

    if (latestTask?.id && latestTask.id !== task.id) retireTaskId(latestTask.id);
    latestTask = task;
    onTask(task);
    if (!isTaskRunning(task)) {
      stop();
      return { accepted: true, running: false };
    }
    return { accepted: true, running: true };
  }

  function unchangedSince(position) {
    return taskPosition(latestTask) === position;
  }

  async function tick() {
    timer = null;
    if (!active) return;
    if (now() - lastProgressAt >= stallAfter) {
      stall();
      return;
    }
    const runGeneration = generation;
    const startingPosition = taskPosition(latestTask);
    try {
      const task = await fetchTask();
      if (!active || generation !== runGeneration || !unchangedSince(startingPosition)) return;
      const accepted = acceptTask(task);
      if (accepted.accepted && accepted.running) {
        lastProgressAt = now();
        delay = initialDelay;
      } else if (active) {
        delay = Math.min(maxDelay, Math.max(initialDelay, delay * 2));
      }
    } catch (error) {
      if (!active || generation !== runGeneration || !unchangedSince(startingPosition)) return;
      delay = Math.min(maxDelay, Math.max(initialDelay, delay * 2));
      onError(error, { willRetry: true, delay });
    }
    schedule();
  }

  return Object.freeze({
    start(task) {
      stop();
      if (!task) {
        latestTask = null;
        retiredTaskIds.clear();
        onTask(null);
        return;
      }
      if (latestTask?.id !== task.id || task.revision > latestTask.revision) {
        if (latestTask?.id && latestTask.id !== task.id) retireTaskId(latestTask.id);
        retiredTaskIds.delete(task.id);
        latestTask = task;
        onTask(task);
      }
      if (!isTaskRunning(latestTask)) return;
      active = true;
      lastProgressAt = now();
      delay = initialDelay;
      schedule();
    },
    startUnknown() {
      stop();
      active = true;
      lastProgressAt = now();
      delay = initialDelay;
      schedule();
    },
    accept(task) {
      const accepted = acceptTask(task);
      if (!accepted.accepted || !accepted.running) return accepted.accepted;
      if (timer !== null) clearTimer(timer);
      timer = null;
      if (!active) active = true;
      lastProgressAt = now();
      delay = initialDelay;
      schedule();
      return true;
    },
    async refreshOnce() {
      const runGeneration = generation;
      const startingPosition = taskPosition(latestTask);
      try {
        const task = await fetchTask();
        if (generation !== runGeneration || !unchangedSince(startingPosition)) {
          return { ok: true, task: latestTask, accepted: false, stale: true };
        }
        const accepted = acceptTask(task);
        return { ok: true, task: latestTask, accepted: accepted.accepted, stale: false };
      } catch (error) {
        if (generation !== runGeneration || !unchangedSince(startingPosition)) {
          return { ok: true, task: latestTask, accepted: false, stale: true };
        }
        onError(error, { willRetry: false, delay: null });
        return { ok: false, error };
      }
    },
    stop,
    running() {
      return active;
    },
  });
}

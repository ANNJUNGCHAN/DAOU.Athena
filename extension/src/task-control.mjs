import { assertFreshProposal, controlPostconditionMet } from "./control-core.mjs";

const TASK_STATE_VERSION = 1;
const TERMINAL_TASK_STATUSES = new Set([
  "blocked",
  "completed",
  "cancelled",
  "unsupported",
  "unverified",
]);

function exactJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function responseResult(response) {
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "로컬 실행기 요청이 실패했습니다.");
    if (typeof response?.error?.code === "string") error.code = response.error.code;
    throw error;
  }
  return response.result;
}

export function validateTaskJournal(value) {
  if (value === undefined) return { version: TASK_STATE_VERSION, activeTaskId: null, dispatch: null };
  if (
    value?.version !== TASK_STATE_VERSION
    || !(value.activeTaskId === null || typeof value.activeTaskId === "string")
    || !(value.dispatch === null || typeof value.dispatch === "object")
  ) {
    throw new Error("WTS 대화 작업 저장소 형식이 올바르지 않습니다.");
  }
  if (value.dispatch?.state === "armed") {
    if (
      typeof value.dispatch.taskId !== "string"
      || typeof value.dispatch.stepId !== "string"
      || !Number.isInteger(value.dispatch.expectedRevision)
      || !value.dispatch.proposal
    ) throw new Error("WTS 대화 작업의 실행 준비 기록이 손상되었습니다.");
  } else if (value.dispatch?.state === "receipt_pending") {
    if (
      value.dispatch.wrapper?.method !== "control.task.step.commit"
      || !value.dispatch.wrapper.params
      || typeof value.dispatch.wrapper.params !== "object"
    ) throw new Error("WTS 대화 작업의 영수증 기록이 손상되었습니다.");
  } else if (value.dispatch !== null) {
    throw new Error("WTS 대화 작업의 실행 상태가 올바르지 않습니다.");
  }
  return value;
}

export function createTaskControlCoordinator({
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  createId = () => crypto.randomUUID(),
  request,
  observeCurrent,
  executeOnce,
  observeSameDocument,
  loadState,
  saveState,
  validateControlTask,
  validateControlObservation,
  validateControlProposal,
  validateControlReceipt,
  catalogVersion,
  retiredCatalogVersions,
  actionIds,
  chartOpenActionId,
  periodSetActionId,
  sitemapOpenActionId,
  marketNavigateActionId,
  postconditionTimeoutMs = 1_500,
  marketPostconditionTimeoutMs = 3_000,
  pollIntervalMs = 100,
  cancelReconcileAttempts = 40,
  cancelReconcileIntervalMs = 100,
  onTaskChange = () => {},
  onTaskError = () => {},
}) {
  let drivePromise = null;
  let startPromise = null;
  let startText = null;
  let cancelPromise = null;
  let reconcilePromise = null;
  let stopRequested = false;
  let latestTask = null;
  const retiredCatalogs = new Set(retiredCatalogVersions);

  const readJournal = async () => validateTaskJournal(await loadState());

  async function writeJournal(next) {
    const exact = validateTaskJournal(next);
    await saveState(exact);
    return exact;
  }

  async function setActiveTaskId(taskId) {
    const current = await readJournal();
    await writeJournal({ ...current, activeTaskId: taskId });
  }

  async function setDispatch(dispatch) {
    const current = await readJournal();
    await writeJournal({ ...current, dispatch });
  }

  async function clearDispatch(expected) {
    const current = await readJournal();
    if (!exactJson(current.dispatch, expected)) {
      throw new Error("WTS 대화 작업의 저장된 실행 기록이 예상과 다릅니다.");
    }
    await writeJournal({ ...current, dispatch: null });
  }

  function publish(task) {
    latestTask = validateControlTask(task);
    onTaskChange(latestTask);
    return latestTask;
  }

  async function call(method, params) {
    return responseResult(await request(method, params));
  }

  function makeReceipt({ proposal, after, status, reason }) {
    return validateControlReceipt({
      id: createId(),
      proposalId: proposal.id,
      catalogVersion: proposal.catalogVersion,
      actionId: proposal.actionId,
      args: proposal.args,
      before: proposal.observation,
      after,
      status,
      reason,
      completedAt: new Date(now()).toISOString(),
    });
  }

  async function executeProposal(task, proposal) {
    if (
      task.catalogVersion !== catalogVersion
      || proposal.catalogVersion !== catalogVersion
      || !task.activeProposal
      || !exactJson(task.activeProposal, proposal)
    ) {
      throw new Error("현재 작업과 실행 제안의 WTS 제어 계약이 일치하지 않습니다.");
    }
    const before = validateControlObservation(proposal.observation);
    const exact = assertFreshProposal({
      proposal: validateControlProposal(proposal),
      before,
      now,
      catalogVersion,
      actionIds,
    });
    let execution;
    try {
      execution = await executeOnce(exact);
    } catch (error) {
      const reason = error?.controlReason === "DOCUMENT_CHANGED" ? "DOCUMENT_CHANGED" : "EXECUTION_ERROR";
      return makeReceipt({
        proposal: exact,
        after: null,
        status: error?.actionMayHaveRun === true ? "unverified" : "blocked",
        reason,
      });
    }

    const immediate = validateControlObservation(execution.observation);
    if (execution.reason === "PRECONDITION_CHANGED" || execution.acted !== true) {
      const reason = execution.reason === "PRECONDITION_CHANGED" ? "PRECONDITION_CHANGED" : "EXECUTION_ERROR";
      return makeReceipt({
        proposal: exact,
        after: immediate,
        status: reason === "PRECONDITION_CHANGED" ? "blocked" : "unverified",
        reason,
      });
    }

    const instrumentToken = before.state.instrumentToken;
    if (immediate.state.instrumentToken !== instrumentToken) {
      return makeReceipt({ proposal: exact, after: immediate, status: "unverified", reason: "PRECONDITION_CHANGED" });
    }

    let after = immediate;
    const marketAction = [sitemapOpenActionId, marketNavigateActionId].includes(exact.actionId);
    const deadline = now() + (marketAction ? marketPostconditionTimeoutMs : postconditionTimeoutMs);
    while (!controlPostconditionMet(
      exact.actionId,
      exact.args,
      after,
      instrumentToken,
      chartOpenActionId,
      periodSetActionId,
      sitemapOpenActionId,
      marketNavigateActionId,
    )) {
      if (stopRequested) {
        return makeReceipt({
          proposal: exact,
          after,
          status: "unverified",
          reason: "POSTCONDITION_TIMEOUT",
        });
      }
      if (now() >= deadline) break;
      await wait(pollIntervalMs);
      if (stopRequested) {
        return makeReceipt({
          proposal: exact,
          after,
          status: "unverified",
          reason: "POSTCONDITION_TIMEOUT",
        });
      }
      try {
        after = validateControlObservation(await observeSameDocument(
          exact.observation.source,
          { actionId: exact.actionId, args: exact.args },
        ));
      } catch (error) {
        return makeReceipt({
          proposal: exact,
          after: null,
          status: "unverified",
          reason: error?.controlReason === "DOCUMENT_CHANGED" ? "DOCUMENT_CHANGED" : "EXECUTION_ERROR",
        });
      }
      if (stopRequested) {
        return makeReceipt({
          proposal: exact,
          after,
          status: "unverified",
          reason: "POSTCONDITION_TIMEOUT",
        });
      }
      if (after.state.instrumentToken !== instrumentToken) {
        return makeReceipt({ proposal: exact, after, status: "unverified", reason: "PRECONDITION_CHANGED" });
      }
    }

    const verified = controlPostconditionMet(
      exact.actionId,
      exact.args,
      after,
      instrumentToken,
      chartOpenActionId,
      periodSetActionId,
      sitemapOpenActionId,
      marketNavigateActionId,
    );
    return makeReceipt({
      proposal: exact,
      after,
      status: verified ? "verified" : "unverified",
      reason: verified ? "POSTCONDITION_MET" : "POSTCONDITION_TIMEOUT",
    });
  }

  function stepForProposal(task, proposal) {
    const step = task.steps.find((item) => item.proposalId === proposal.id);
    if (!step || step.status !== "awaiting_receipt") {
      throw new Error("로컬 실행기의 현재 작업 단계가 실행 제안과 일치하지 않습니다.");
    }
    return step;
  }

  function sameTaskContext(initial, current) {
    return initial.source.origin === current.source.origin
      && initial.source.path === current.source.path
      && initial.source.tabId === current.source.tabId
      && initial.source.windowId === current.source.windowId
      && initial.source.frameId === current.source.frameId
      && initial.source.documentId === current.source.documentId
      && initial.state.instrumentToken === current.state.instrumentToken;
  }

  function commitWrapper(task, step, receipt) {
    return {
      method: "control.task.step.commit",
      params: {
        taskId: task.id,
        stepId: step.id,
        expectedRevision: task.revision,
        receipt,
      },
    };
  }

  async function commitPending(dispatch) {
    const result = await call(dispatch.wrapper.method, dispatch.wrapper.params);
    const task = publish(result.task);
    await clearDispatch(dispatch);
    return task;
  }

  async function persistAndCommit(task, step, receipt) {
    const dispatch = { state: "receipt_pending", wrapper: commitWrapper(task, step, receipt) };
    await setDispatch(dispatch);
    return commitPending(dispatch);
  }

  async function cancelFromTask(task, cancellationId) {
    if (TERMINAL_TASK_STATUSES.has(task.status)) return task;
    const result = await call("control.task.cancel", {
      taskId: task.id,
      expectedRevision: task.revision,
      cancellationId,
    });
    return publish(result.task);
  }

  function cancellationAccepted(task) {
    return TERMINAL_TASK_STATUSES.has(task.status)
      || task.status === "cancel_requested"
      || task.cancelRequested === true;
  }

  async function getTask(taskId) {
    const result = await call("control.task.get", { taskId });
    return publish(result.task);
  }

  async function tryExactCancellation(params) {
    let firstError;
    try {
      const result = await call("control.task.cancel", params);
      return { task: publish(result.task), firstError: null, retryError: null };
    } catch (error) {
      firstError = error;
    }
    try {
      const result = await call("control.task.cancel", params);
      return { task: publish(result.task), firstError, retryError: null };
    } catch (retryError) {
      return { task: null, firstError, retryError };
    }
  }

  async function cancelTaskWithReconciliation(initialTask, cancellationId) {
    if (!initialTask || TERMINAL_TASK_STATUSES.has(initialTask.status)) return initialTask;
    const params = {
      taskId: initialTask.id,
      expectedRevision: initialTask.revision,
      cancellationId,
    };
    const original = await tryExactCancellation(params);
    if (original.task) return original.task;

    const sawPendingCommit = original.firstError?.code === "TASK_COMMIT_PENDING"
      || original.retryError?.code === "TASK_COMMIT_PENDING";
    let task = await getTask(initialTask.id);
    if (cancellationAccepted(task)) return task;
    if (!sawPendingCommit) throw original.firstError;

    task = await reconcilePendingCommit(initialTask.id);
    if (cancellationAccepted(task)) return task;
    if (task.status !== "ready" || task.cancelRequested === true) {
      throw original.firstError;
    }

    const followup = await tryExactCancellation({
      taskId: task.id,
      expectedRevision: task.revision,
      cancellationId: createId(),
    });
    if (followup.task) return followup.task;
    const observed = await getTask(task.id);
    if (cancellationAccepted(observed)) return observed;
    throw followup.firstError;
  }

  function beginCancellation(resolveTask) {
    if (cancelPromise) return cancelPromise;
    cancelPromise = (async () => {
      const task = await resolveTask();
      if (!task || TERMINAL_TASK_STATUSES.has(task.status)) return { task };
      return { task: await cancelTaskWithReconciliation(task, createId()) };
    })().finally(() => { cancelPromise = null; });
    return cancelPromise;
  }

  async function reconcilePendingCommit(taskId) {
    let task = await getTask(taskId);
    for (let attempt = 0; attempt < cancelReconcileAttempts; attempt += 1) {
      if (cancellationAccepted(task) || task.status === "ready") return task;
      if (attempt + 1 < cancelReconcileAttempts) await wait(cancelReconcileIntervalMs);
      task = await getTask(taskId);
    }
    const error = new Error("현재 단계의 영수증 커밋이 끝나지 않아 중단 요청을 보류했습니다. 후속 단계는 실행하지 않습니다.");
    error.code = "TASK_COMMIT_PENDING";
    throw error;
  }

  async function settleCancellation(task) {
    if (cancelPromise) {
      const result = await cancelPromise;
      return result.task || task;
    }
    const current = await currentTask();
    if (!current || TERMINAL_TASK_STATUSES.has(current.status)) return current || task;
    if (current.status === "cancel_requested" || current.cancelRequested === true) return current;
    return cancelFromTask(current, createId());
  }

  async function drive(initialTask) {
    let task = publish(initialTask);
    let initialObservation = null;
    while (!TERMINAL_TASK_STATUSES.has(task.status)) {
      if (stopRequested && task.status === "ready") {
        task = await settleCancellation(task);
        break;
      }
      if (task.status !== "ready") break;

      const readyStep = task.steps[task.cursor];
      if (
        !readyStep
        || readyStep.index !== task.cursor
        || readyStep.status !== "pending"
        || typeof readyStep.actionId !== "string"
        || !readyStep.args
        || typeof readyStep.args !== "object"
        || Array.isArray(readyStep.args)
      ) {
        throw new Error("로컬 실행기의 준비 작업 단계가 현재 커서와 일치하지 않습니다.");
      }
      const observation = validateControlObservation(await observeCurrent({
        actionId: readyStep.actionId,
        args: readyStep.args,
      }));
      if (!initialObservation) initialObservation = observation;
      else if (!sameTaskContext(initialObservation, observation)) {
        task = await cancelFromTask(task, createId());
        onTaskError(new Error("복합 명령 중 WTS 탭, 문서 또는 종목이 바뀌어 남은 단계를 중단했습니다."));
        break;
      }
      if (stopRequested) {
        task = await settleCancellation(task);
        break;
      }
      const priorTask = task;
      const next = await call("control.task.next", {
        taskId: task.id,
        expectedRevision: task.revision,
        observation,
      });
      task = publish(next.task);
      if (next.outcome.status !== "proposed") {
        if (["ready", "completed"].includes(next.outcome.status)) {
          const advancedStep = task.steps[priorTask.cursor];
          if (
            task.id !== priorTask.id
            || priorTask.catalogVersion !== catalogVersion
            || task.catalogVersion !== catalogVersion
            || task.catalogVersion !== priorTask.catalogVersion
            || task.revision !== priorTask.revision + 1
            || task.cursor !== priorTask.cursor + 1
            || advancedStep?.id !== readyStep.id
            || advancedStep?.status !== "satisfied"
            || task.activeProposal !== null
            || (next.outcome.status === "ready" && task.status !== "ready")
            || (next.outcome.status === "completed" && task.status !== "completed")
          ) {
            throw new Error("로컬 실행기의 준비 작업 진행 상태가 정확히 한 단계 전진하지 않았습니다.");
          }
          if (task.status === "ready") continue;
        }
        break;
      }

      const proposal = validateControlProposal(next.outcome.proposal);
      if (
        task.id !== priorTask.id
        || priorTask.catalogVersion !== catalogVersion
        || task.catalogVersion !== catalogVersion
        || task.catalogVersion !== priorTask.catalogVersion
        || task.revision !== priorTask.revision + 1
        || task.cursor !== priorTask.cursor
        || task.status !== "awaiting_receipt"
        || !task.activeProposal
        || !exactJson(task.activeProposal, proposal)
      ) {
        throw new Error("로컬 실행기의 실행 제안 진행 상태가 현재 준비 단계와 일치하지 않습니다.");
      }
      const step = stepForProposal(task, proposal);
      const armed = {
        state: "armed",
        taskId: task.id,
        stepId: step.id,
        expectedRevision: task.revision,
        proposal,
      };
      await setDispatch(armed);

      let receipt;
      if (stopRequested) {
        task = await settleCancellation(task);
        receipt = makeReceipt({ proposal, after: null, status: "cancelled", reason: "CANCELLED" });
      } else {
        receipt = await executeProposal(task, proposal);
      }
      const pending = {
        state: "receipt_pending",
        wrapper: commitWrapper(
          { ...task, revision: armed.expectedRevision },
          step,
          receipt,
        ),
      };
      await setDispatch(pending);
      task = await commitPending(pending);
      if (stopRequested && task.status === "ready") {
        task = await settleCancellation(task);
        break;
      }
    }
    return task;
  }

  async function reconcileDispatch() {
    if (drivePromise) return latestTask;
    if (reconcilePromise) return reconcilePromise;
    reconcilePromise = (async () => {
      const journal = await readJournal();
      if (!journal.dispatch) return null;
      if (journal.dispatch.state === "receipt_pending") {
        return commitPending(journal.dispatch);
      }
      const armed = journal.dispatch;
      const receipt = makeReceipt({
        proposal: validateControlProposal(armed.proposal),
        after: null,
        status: "unverified",
        reason: "EXECUTION_ERROR",
      });
      const pending = {
        state: "receipt_pending",
        wrapper: {
          method: "control.task.step.commit",
          params: {
            taskId: armed.taskId,
            stepId: armed.stepId,
            expectedRevision: armed.expectedRevision,
            receipt,
          },
        },
      };
      await setDispatch(pending);
      return commitPending(pending);
    })().finally(() => { reconcilePromise = null; });
    return reconcilePromise;
  }

  async function reconcileUnjournaledProposal(task) {
    if (!task.activeProposal || !["awaiting_receipt", "cancel_requested"].includes(task.status)) {
      return task;
    }
    const proposal = validateControlProposal(task.activeProposal);
    const step = stepForProposal(task, proposal);
    const receipt = makeReceipt({
      proposal,
      after: null,
      status: "unverified",
      reason: "EXECUTION_ERROR",
    });
    const pending = {
      state: "receipt_pending",
      wrapper: {
        method: "control.task.step.commit",
        params: {
          taskId: task.id,
          stepId: step.id,
          expectedRevision: task.status === "cancel_requested" ? task.revision - 1 : task.revision,
          receipt,
        },
      },
    };
    await setDispatch(pending);
    return commitPending(pending);
  }

  async function currentTask() {
    await reconcileDispatch();
    const journal = await readJournal();
    if (!journal.activeTaskId) return null;
    const result = await call("control.task.get", { taskId: journal.activeTaskId });
    const task = publish(result.task);
    if (!drivePromise && journal.dispatch === null) {
      return reconcileUnjournaledProposal(task);
    }
    return task;
  }

  return Object.freeze({
    send(text, submissionId = createId()) {
      if (startPromise) {
        if (text === startText) return startPromise;
        return Promise.reject(new Error("다른 WTS 대화 작업을 시작하는 중입니다."));
      }
      startText = text;
      startPromise = (async () => {
        stopRequested = false;
        let existing = await currentTask();
        if (stopRequested) {
          if (cancelPromise) return cancelPromise;
          throw new Error("사용자가 새 WTS 대화 작업 시작을 취소했습니다.");
        }
        if (
          existing
          && existing.status === "ready"
          && retiredCatalogs.has(existing.catalogVersion)
        ) {
          const retiredCatalogVersion = existing.catalogVersion;
          const legacyTaskId = existing.id;
          const retired = await beginCancellation(async () => existing);
          existing = retired.task;
          if (
            !existing
            || existing.id !== legacyTaskId
            || existing.catalogVersion !== retiredCatalogVersion
            || existing.status !== "cancelled"
          ) {
            throw new Error("이전 차트 제어 계약 작업을 안전하게 종료하지 못했습니다.");
          }
          if (stopRequested) return { task: existing };
        }
        if (existing && !TERMINAL_TASK_STATUSES.has(existing.status)) {
          throw new Error("이미 진행 중인 WTS 대화 작업이 있습니다.");
        }
        if (stopRequested) {
          if (cancelPromise) return cancelPromise;
          throw new Error("사용자가 새 WTS 대화 작업 시작을 취소했습니다.");
        }
        const result = await call("control.task.start", { submissionId, text });
        const task = publish(result.task);
        await setActiveTaskId(task.id);
        if (stopRequested) return beginCancellation(async () => task);
        drivePromise = Promise.resolve()
          .then(() => drive(task))
          .catch((error) => {
            onTaskError(error);
            return null;
          })
          .finally(() => { drivePromise = null; });
        return { task };
      })().finally(() => {
        startPromise = null;
        startText = null;
      });
      return startPromise;
    },
    async get() {
      return { task: await currentTask() };
    },
    cancel() {
      stopRequested = true;
      if (cancelPromise) return cancelPromise;
      return beginCancellation(() => currentTask());
    },
    async reconcile() {
      await reconcileDispatch();
      return { task: await currentTask() };
    },
    running() {
      return Boolean(startPromise || drivePromise || reconcilePromise || cancelPromise);
    },
  });
}

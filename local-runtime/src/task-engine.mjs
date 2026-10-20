import { randomUUID } from 'node:crypto';

import { CONTROL_CATALOG_VERSION } from '../../contracts/wts-foundation.mjs';
import { HostError } from './errors.mjs';
import { compileTaskInput, TASK_COMPILER } from './task-compiler.mjs';

const TERMINAL_STATUSES = new Set([
  'blocked', 'completed', 'cancelled', 'unsupported', 'unverified',
]);

function clone(value) {
  return structuredClone(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertRevision(task, expectedRevision) {
  if (task.revision !== expectedRevision) {
    throw new HostError('TASK_REVISION_CONFLICT', 'Control task revision changed.');
  }
}

function outcome(task) {
  return {
    status: task.activeProposal ? 'proposed' : task.status,
    message: task.message,
    proposal: task.activeProposal,
  };
}

function assertProposalReceipt(proposal, receipt) {
  if (
    receipt.proposalId !== proposal.id ||
    receipt.catalogVersion !== proposal.catalogVersion ||
    receipt.actionId !== proposal.actionId ||
    !sameJson(receipt.args, proposal.args) ||
    !sameJson(receipt.before, proposal.observation)
  ) {
    throw new HostError('RECEIPT_PROPOSAL_MISMATCH', 'Receipt does not match the persisted task proposal.');
  }
}

function assertReceiptOutcome(receipt) {
  const hasAfter = receipt.after !== null;
  const valid =
    (receipt.status === 'verified' && receipt.reason === 'POSTCONDITION_MET' && hasAfter) ||
    (receipt.status === 'cancelled' && receipt.reason === 'CANCELLED' && !hasAfter) ||
    (receipt.status === 'blocked' && (
      (receipt.reason === 'PRECONDITION_CHANGED' && hasAfter) ||
      (['DOCUMENT_CHANGED', 'EXECUTION_ERROR'].includes(receipt.reason) && !hasAfter)
    )) ||
    (receipt.status === 'unverified' && (
      (['DOCUMENT_CHANGED', 'EXECUTION_ERROR'].includes(receipt.reason) && !hasAfter) ||
      (['PRECONDITION_CHANGED', 'POSTCONDITION_TIMEOUT', 'EXECUTION_ERROR'].includes(receipt.reason) && hasAfter)
    ));
  if (!valid) {
    throw new HostError('RECEIPT_OUTCOME_INVALID', 'Receipt status, reason, and observation are inconsistent.');
  }
}

function cancelledRemainingSteps(task) {
  for (const step of task.steps) {
    if (step.status === 'pending') step.status = 'cancelled';
  }
}

function observationBinding(observation) {
  return {
    tabId: observation.source.tabId,
    windowId: observation.source.windowId,
    documentId: observation.source.documentId,
    instrumentToken: observation.state.instrumentToken,
  };
}

export class TaskEngine {
  constructor({
    planner,
    taskStore,
    receiptStore,
    validateTask,
    validateReceipt,
    now = Date.now,
    createId = randomUUID,
  }) {
    this.planner = planner;
    this.taskStore = taskStore;
    this.receiptStore = receiptStore;
    this.validateTask = validateTask;
    this.validateReceipt = validateReceipt;
    this.now = now;
    this.createId = createId;
    this.locks = new Map();
  }

  #time() {
    return new Date(this.now()).toISOString();
  }

  async start(submissionId, text) {
    let existing;
    try {
      existing = await this.taskStore.get(submissionId);
    } catch (error) {
      if (error?.code !== 'TASK_NOT_FOUND') throw error;
    }
    if (existing) {
      if (existing.task.submissionId !== submissionId || existing.task.input.text !== text) {
        throw new HostError('TASK_SUBMISSION_CONFLICT', 'Submission id already belongs to different input.');
      }
      return clone(existing.task);
    }

    const compiled = compileTaskInput(text);
    const timestamp = this.#time();
    const task = {
      schemaVersion: 1,
      id: submissionId,
      submissionId,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      catalogVersion: CONTROL_CATALOG_VERSION,
      compiler: clone(TASK_COMPILER),
      status: compiled ? 'ready' : 'unsupported',
      input: { text },
      cursor: 0,
      steps: (compiled ?? []).map(({ actionId, args }, index) => ({
        id: this.createId(),
        index,
        actionId,
        args,
        status: 'pending',
        proposalId: null,
        receiptId: null,
      })),
      activeProposal: null,
      cancelRequested: false,
      message: compiled
        ? `${compiled.length}개 WTS 화면 작업을 로컬 규칙으로 확인했습니다.`
        : '지원되는 차트 또는 시장 메뉴 명령 전체와 일치하지 않아 실행하지 않았습니다.',
    };
    this.validateTask(task);
    const created = await this.taskStore.create({
      schemaVersion: 1,
      task,
      binding: null,
      commits: [],
      cancellations: [],
      pendingCommit: null,
    });
    if (created.task.input.text !== text) {
      throw new HostError('TASK_SUBMISSION_CONFLICT', 'Submission id already belongs to different input.');
    }
    return clone(created.task);
  }

  async get(taskId) {
    return clone((await this.taskStore.get(taskId)).task);
  }

  async next(taskId, expectedRevision, observation) {
    return this.#serialized(taskId, () => this.#next(taskId, expectedRevision, observation));
  }

  async #next(taskId, expectedRevision, observation) {
    const record = await this.taskStore.get(taskId);
    if (record.pendingCommit) {
      throw new HostError('TASK_COMMIT_PENDING', 'Control task must finish its pending receipt commit first.');
    }
    const task = record.task;
    assertRevision(task, expectedRevision);
    if (TERMINAL_STATUSES.has(task.status)) return { task: clone(task), outcome: outcome(task) };
    if (task.status !== 'ready') {
      throw new HostError('TASK_AWAITING_RECEIPT', 'Control task must reconcile its current proposal first.');
    }
    if (task.catalogVersion !== CONTROL_CATALOG_VERSION) {
      throw new HostError(
        'TASK_CATALOG_CHANGED',
        'Control task uses an older action catalog and must be cancelled before starting a new task.',
      );
    }

    const storedRevision = task.revision;
    const currentBinding = observationBinding(observation);
    if (record.binding === null) {
      record.binding = currentBinding;
    } else if (!sameJson(record.binding, currentBinding)) {
      const step = task.steps[task.cursor];
      if (step) step.status = 'blocked';
      task.status = 'blocked';
      task.message = '처음 확인한 WTS 탭과 종목이 달라져 작업을 중단했습니다.';
      task.revision += 1;
      task.updatedAt = this.#time();
      this.validateTask(task);
      const persisted = await this.taskStore.update(record, storedRevision);
      return { task: clone(persisted.task), outcome: outcome(persisted.task) };
    }
    if (task.cursor < task.steps.length) {
      const step = task.steps[task.cursor];
      const planned = this.planner.planAction(step.actionId, step.args, observation);
      if (planned.status === 'satisfied') {
        step.status = 'satisfied';
        task.cursor += 1;
        if (task.cursor === task.steps.length) {
          task.status = 'completed';
          task.message = '요청한 WTS 화면 작업이 모두 확인되었습니다.';
        } else {
          task.status = 'ready';
          task.message = '다음 작업을 실행하려면 화면을 다시 확인합니다.';
        }
      }
      else if (planned.status === 'proposed') {
        step.status = 'awaiting_receipt';
        step.proposalId = planned.proposal.id;
        task.activeProposal = clone(planned.proposal);
        task.status = 'awaiting_receipt';
        task.message = planned.message;
      } else {
        step.status = planned.status === 'blocked' ? 'blocked' : 'unverified';
        task.status = planned.status === 'blocked' ? 'blocked' : 'unsupported';
        task.message = planned.message;
      }
    }

    if (task.cursor === task.steps.length) {
      task.status = 'completed';
      task.message = '요청한 WTS 화면 작업이 모두 확인되었습니다.';
    }
    task.revision += 1;
    task.updatedAt = this.#time();
    this.validateTask(task);
    const persisted = await this.taskStore.update(record, storedRevision);
    return { task: clone(persisted.task), outcome: outcome(persisted.task) };
  }

  async commit(taskId, stepId, expectedRevision, receipt) {
    return this.#serialized(
      taskId,
      () => this.#commit(taskId, stepId, expectedRevision, receipt),
    );
  }

  async #commit(taskId, stepId, expectedRevision, receipt) {
    this.validateReceipt(receipt);
    assertReceiptOutcome(receipt);
    const record = await this.taskStore.get(taskId);
    const exactCommit = record.commits.find((value) => value.stepId === stepId);
    if (exactCommit) {
      if (exactCommit.expectedRevision !== expectedRevision || !sameJson(exactCommit.receipt, receipt)) {
        throw new HostError('TASK_COMMIT_CONFLICT', 'Task step already has a different commit binding.');
      }
      await this.receiptStore.record(receipt);
      return { task: clone(record.task), receiptId: receipt.id, stored: true };
    }

    if (record.pendingCommit) {
      const pending = record.pendingCommit;
      if (pending.stepId !== stepId || pending.expectedRevision !== expectedRevision ||
          !sameJson(pending.receipt, receipt)) {
        throw new HostError('TASK_COMMIT_CONFLICT', 'Another receipt commit is already pending.');
      }
      return this.#finishCommit(record);
    }

    const task = record.task;
    const cancellation = [...record.cancellations].reverse().find(
      (value) => value.awaitingRevision === expectedRevision,
    );
    if (task.revision !== expectedRevision && !(task.status === 'cancel_requested' && cancellation)) {
      throw new HostError('TASK_REVISION_CONFLICT', 'Control task revision changed.');
    }
    if (!['awaiting_receipt', 'cancel_requested'].includes(task.status) || !task.activeProposal) {
      throw new HostError('TASK_PROPOSAL_NOT_ACTIVE', 'Control task has no active proposal to commit.');
    }
    const step = task.steps.find((value) => value.id === stepId);
    if (!step || step.index !== task.cursor || step.status !== 'awaiting_receipt' ||
        step.proposalId !== task.activeProposal.id) {
      throw new HostError('TASK_STEP_MISMATCH', 'Receipt does not belong to the active task step.');
    }
    assertProposalReceipt(task.activeProposal, receipt);

    const claimRevision = task.revision;
    record.pendingCommit = { stepId, expectedRevision, receipt: clone(receipt) };
    task.revision += 1;
    task.updatedAt = this.#time();
    this.validateTask(task);
    const claimed = await this.taskStore.update(record, claimRevision);
    return this.#finishCommit(claimed);
  }

  async #finishCommit(record) {
    const pending = record.pendingCommit;
    if (!pending) {
      throw new HostError('TASK_COMMIT_CONFLICT', 'Pending receipt commit was not found.');
    }
    const { stepId, expectedRevision, receipt } = pending;
    await this.receiptStore.record(receipt);

    const task = record.task;
    const storedRevision = task.revision;
    const step = task.steps.find((value) => value.id === stepId);
    if (!step || step.index !== task.cursor || step.status !== 'awaiting_receipt' ||
        !task.activeProposal || step.proposalId !== task.activeProposal.id) {
      throw new HostError('TASK_STEP_MISMATCH', 'Pending receipt no longer belongs to the active task step.');
    }
    step.receiptId = receipt.id;
    task.activeProposal = null;
    if (receipt.status === 'verified') {
      step.status = 'verified';
      task.cursor += 1;
      if (task.cancelRequested) {
        cancelledRemainingSteps(task);
        task.status = 'cancelled';
        task.message = '현재 동작 결과를 확인한 뒤 남은 작업을 취소했습니다.';
      } else if (task.cursor === task.steps.length) {
        task.status = 'completed';
        task.message = '요청한 WTS 화면 작업이 모두 완료되었습니다.';
      } else {
        task.status = 'ready';
        task.message = '다음 작업을 실행하려면 화면을 다시 확인합니다.';
      }
    } else if (receipt.status === 'cancelled') {
      step.status = 'cancelled';
      cancelledRemainingSteps(task);
      task.status = 'cancelled';
      task.message = '현재 동작을 실행하지 않고 작업을 취소했습니다.';
    } else if (receipt.status === 'blocked') {
      step.status = 'blocked';
      task.status = 'blocked';
      task.message = '화면 상태가 달라져 작업을 중단했습니다.';
    } else {
      step.status = 'unverified';
      task.status = 'unverified';
      task.message = '동작 결과를 확인할 수 없어 작업을 중단했습니다.';
    }
    task.revision += 1;
    task.updatedAt = this.#time();
    record.commits.push({ stepId, expectedRevision, receipt: clone(receipt) });
    record.pendingCommit = null;
    this.validateTask(task);
    const persisted = await this.taskStore.update(record, storedRevision);
    return { task: clone(persisted.task), receiptId: receipt.id, stored: true };
  }

  async cancel(taskId, expectedRevision, cancellationId) {
    return this.#serialized(
      taskId,
      () => this.#cancel(taskId, expectedRevision, cancellationId),
    );
  }

  async #cancel(taskId, expectedRevision, cancellationId) {
    const record = await this.taskStore.get(taskId);
    if (record.pendingCommit) {
      throw new HostError('TASK_COMMIT_PENDING', 'Control task must finish its pending receipt commit first.');
    }
    const prior = record.cancellations.find((value) => value.cancellationId === cancellationId);
    if (prior) {
      if (prior.expectedRevision !== expectedRevision) {
        throw new HostError('TASK_CANCELLATION_CONFLICT', 'Cancellation id already has different metadata.');
      }
      return clone(record.task);
    }
    const task = record.task;
    assertRevision(task, expectedRevision);
    if (TERMINAL_STATUSES.has(task.status)) {
      throw new HostError('TASK_TERMINAL', 'Completed control task cannot be cancelled.');
    }

    const storedRevision = task.revision;
    const awaitingRevision = task.status === 'awaiting_receipt' ? task.revision : null;
    if (task.status === 'awaiting_receipt') {
      task.status = 'cancel_requested';
      task.cancelRequested = true;
      task.message = '현재 동작의 결과를 확인한 뒤 남은 작업을 취소합니다.';
    } else if (task.status === 'ready') {
      cancelledRemainingSteps(task);
      task.status = 'cancelled';
      task.cancelRequested = true;
      task.message = '실행 전 작업을 취소했습니다.';
    } else {
      throw new HostError('TASK_CANCELLATION_CONFLICT', 'Control task cannot accept this cancellation.');
    }
    task.revision += 1;
    task.updatedAt = this.#time();
    record.cancellations.push({ cancellationId, expectedRevision, awaitingRevision });
    this.validateTask(task);
    const persisted = await this.taskStore.update(record, storedRevision);
    return clone(persisted.task);
  }

  async #serialized(taskId, action) {
    const previous = this.locks.get(taskId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.locks.set(taskId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(taskId) === current) this.locks.delete(taskId);
    }
  }
}

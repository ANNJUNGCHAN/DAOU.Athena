import { randomBytes } from 'node:crypto';
import {
  link, lstat, mkdir, open, readFile, readdir, unlink,
} from 'node:fs/promises';
import path from 'node:path';

import { ProtocolValidationError } from '../../contracts/wts-foundation.mjs';
import { StorageError } from './errors.mjs';

const MAX_TASKS = 1_000;
const MAX_REVISIONS_PER_TASK = 64;
const MAX_TASK_BYTES = 128 * 1024;
const MAX_OWNED_TEMP_FILES = 128;
const UUID_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const TASK_FILE_PATTERN = new RegExp(`^(${UUID_SOURCE})\\.([1-9][0-9]?)\\.json$`, 'iu');
const OWNED_TEMP_PATTERN = new RegExp(`^\\.(${UUID_SOURCE})\\.\\d+-\\d+-[0-9a-f]{12}\\.tmp$`, 'iu');

function clone(value) {
  return structuredClone(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validReceiptOutcome(receipt) {
  const hasAfter = receipt.after !== null;
  return (
    (receipt.status === 'verified' && receipt.reason === 'POSTCONDITION_MET' && hasAfter) ||
    (receipt.status === 'cancelled' && receipt.reason === 'CANCELLED' && !hasAfter) ||
    (receipt.status === 'blocked' && (
      (receipt.reason === 'PRECONDITION_CHANGED' && hasAfter) ||
      (['DOCUMENT_CHANGED', 'EXECUTION_ERROR'].includes(receipt.reason) && !hasAfter)
    )) ||
    (receipt.status === 'unverified' && (
      (['DOCUMENT_CHANGED', 'EXECUTION_ERROR'].includes(receipt.reason) && !hasAfter) ||
      (['PRECONDITION_CHANGED', 'POSTCONDITION_TIMEOUT', 'EXECUTION_ERROR'].includes(receipt.reason) && hasAfter)
    ))
  );
}

function observationMatchesBinding(observation, binding) {
  return binding !== null &&
    observation.source.tabId === binding.tabId &&
    observation.source.windowId === binding.windowId &&
    observation.source.documentId === binding.documentId &&
    observation.state.instrumentToken === binding.instrumentToken;
}

function validateRecordShape(record, validateTask, validateReceipt) {
  if (!record || typeof record !== 'object' || Array.isArray(record) ||
      Object.keys(record).sort().join(',') !==
        'binding,cancellations,commits,pendingCommit,schemaVersion,task' ||
      record.schemaVersion !== 1 || !record.task || !Object.hasOwn(record, 'binding') ||
      !Array.isArray(record.commits) || !Array.isArray(record.cancellations) ||
      record.commits.length > 12 || record.cancellations.length > 12) {
    throw new StorageError('TASK_STORAGE_CORRUPT', 'Task storage has an unsupported record shape.');
  }
  validateTask(record.task);
  if (record.task.revision > MAX_REVISIONS_PER_TASK) {
    throw new StorageError('TASK_STORAGE_CORRUPT', 'Task revision exceeds its bounded limit.');
  }
  if (record.binding !== null && (
    typeof record.binding !== 'object' || Array.isArray(record.binding) ||
    Object.keys(record.binding).sort().join(',') !== 'documentId,instrumentToken,tabId,windowId' ||
    !Number.isSafeInteger(record.binding.tabId) || record.binding.tabId < 0 ||
    !Number.isSafeInteger(record.binding.windowId) || record.binding.windowId < 0 ||
    typeof record.binding.documentId !== 'string' || record.binding.documentId.length < 1 ||
    record.binding.documentId.length > 256 ||
    !/^[0-9a-f]{64}$/u.test(record.binding.instrumentToken)
  )) {
    throw new StorageError('TASK_STORAGE_CORRUPT', 'Task context binding is invalid.');
  }
  const cancelledBeforeObservation = record.task.status === 'cancelled' &&
    record.task.cursor === 0 && record.task.steps.every((step) => step.proposalId === null);
  if (record.binding === null && record.task.revision > 1 && !cancelledBeforeObservation) {
    throw new StorageError('TASK_STORAGE_CORRUPT', 'Observed task is missing its context binding.');
  }
  if (record.task.activeProposal) {
    const activeStep = record.task.steps[record.task.cursor];
    if (!activeStep || activeStep.proposalId !== record.task.activeProposal.id ||
        activeStep.actionId !== record.task.activeProposal.actionId ||
        !sameJson(activeStep.args, record.task.activeProposal.args) ||
        record.task.activeProposal.catalogVersion !== record.task.catalogVersion ||
        !observationMatchesBinding(record.task.activeProposal.observation, record.binding)) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Active proposal does not match the task binding.');
    }
  }

  const commitKeys = new Set();
  for (const commit of record.commits) {
    if (!commit || typeof commit !== 'object' || Array.isArray(commit) ||
        Object.keys(commit).sort().join(',') !== 'expectedRevision,receipt,stepId' ||
        typeof commit.stepId !== 'string' || !Number.isSafeInteger(commit.expectedRevision) ||
        commit.expectedRevision < 1) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Task commit binding is invalid.');
    }
    validateReceipt(commit.receipt);
    const step = record.task.steps.find((value) => value.id === commit.stepId);
    if (!step || step.proposalId !== commit.receipt.proposalId ||
        step.receiptId !== commit.receipt.id ||
        step.actionId !== commit.receipt.actionId ||
        !sameJson(step.args, commit.receipt.args) ||
        record.task.catalogVersion !== commit.receipt.catalogVersion ||
        !observationMatchesBinding(commit.receipt.before, record.binding) ||
        !validReceiptOutcome(commit.receipt)) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Task commit does not match its persisted step.');
    }
    if (commitKeys.has(commit.stepId)) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Task storage repeats a committed step.');
    }
    commitKeys.add(commit.stepId);
  }

  const pendingCommit = record.pendingCommit ?? null;
  if (pendingCommit !== null) {
    if (!pendingCommit || typeof pendingCommit !== 'object' || Array.isArray(pendingCommit) ||
        Object.keys(pendingCommit).sort().join(',') !== 'expectedRevision,receipt,stepId' ||
        typeof pendingCommit.stepId !== 'string' ||
        !Number.isSafeInteger(pendingCommit.expectedRevision) || pendingCommit.expectedRevision < 1) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Pending task commit binding is invalid.');
    }
    validateReceipt(pendingCommit.receipt);
    const pendingStep = record.task.steps.find((value) => value.id === pendingCommit.stepId);
    if (!pendingStep || !record.task.activeProposal ||
        pendingStep.status !== 'awaiting_receipt' ||
        pendingStep.proposalId !== pendingCommit.receipt.proposalId ||
        record.task.activeProposal.id !== pendingCommit.receipt.proposalId ||
        pendingStep.actionId !== pendingCommit.receipt.actionId ||
        !sameJson(pendingStep.args, pendingCommit.receipt.args) ||
        record.task.catalogVersion !== pendingCommit.receipt.catalogVersion ||
        record.task.activeProposal.catalogVersion !== pendingCommit.receipt.catalogVersion ||
        record.task.activeProposal.actionId !== pendingCommit.receipt.actionId ||
        !sameJson(record.task.activeProposal.args, pendingCommit.receipt.args) ||
        !sameJson(record.task.activeProposal.observation, pendingCommit.receipt.before) ||
        !observationMatchesBinding(pendingCommit.receipt.before, record.binding) ||
        !validReceiptOutcome(pendingCommit.receipt)) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Pending task commit does not match its active proposal.');
    }
  }

  const cancellationIds = new Set();
  for (const cancellation of record.cancellations) {
    if (!cancellation || typeof cancellation !== 'object' || Array.isArray(cancellation) ||
        Object.keys(cancellation).sort().join(',') !== 'awaitingRevision,cancellationId,expectedRevision' ||
        typeof cancellation.cancellationId !== 'string' ||
        !Number.isSafeInteger(cancellation.expectedRevision) || cancellation.expectedRevision < 1 ||
        !(cancellation.awaitingRevision === null ||
          (Number.isSafeInteger(cancellation.awaitingRevision) && cancellation.awaitingRevision >= 1))) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Task cancellation binding is invalid.');
    }
    if (cancellationIds.has(cancellation.cancellationId)) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Task storage repeats a cancellation id.');
    }
    cancellationIds.add(cancellation.cancellationId);
  }
}

export class TaskStore {
  constructor(dataDir, validateTask, validateReceipt, fileSystem = {
    link, lstat, mkdir, open, readFile, readdir, unlink,
  }) {
    this.dataDir = path.resolve(dataDir);
    this.tasksDir = path.join(this.dataDir, 'tasks');
    this.validateTask = validateTask;
    this.validateReceipt = validateReceipt;
    this.fileSystem = fileSystem;
  }

  #taskPath(taskId, revision) {
    return path.join(this.tasksDir, `${taskId.toLowerCase()}.${revision}.json`);
  }

  async #assertPhysicalDirectory(directory, code, message) {
    const value = await this.fileSystem.lstat(directory);
    if (!value.isDirectory() || value.isSymbolicLink()) throw new StorageError(code, message);
  }

  async #ensureDataRoot() {
    try {
      await this.#assertPhysicalDirectory(this.dataDir, 'TASK_STORAGE_CORRUPT', 'Task data root is not a physical directory.');
      return;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error?.code !== 'ENOENT') {
        throw new StorageError('TASK_STORAGE_READ_FAILED', 'Task data root could not be inspected.', { cause: error });
      }
    }
    const parent = path.dirname(this.dataDir);
    try {
      await this.#assertPhysicalDirectory(parent, 'TASK_STORAGE_CORRUPT', 'Task data parent is not a physical directory.');
      await this.fileSystem.mkdir(this.dataDir);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        if (error instanceof StorageError) throw error;
        throw new StorageError('TASK_STORAGE_WRITE_FAILED', 'Task data root could not be created.', { cause: error });
      }
    }
    await this.#assertPhysicalDirectory(this.dataDir, 'TASK_STORAGE_CORRUPT', 'Task data root is not a physical directory.');
  }

  async #ensureOwnedDirectory(directory, label) {
    await this.#ensureDataRoot();
    try {
      await this.fileSystem.mkdir(directory);
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw new StorageError('TASK_STORAGE_WRITE_FAILED', `${label} could not be created.`, { cause: error });
      }
    }
    await this.#assertPhysicalDirectory(this.dataDir, 'TASK_STORAGE_CORRUPT', 'Task data root is not a physical directory.');
    await this.#assertPhysicalDirectory(directory, 'TASK_STORAGE_CORRUPT', `${label} is not a physical directory.`);
  }

  async #taskFiles(taskId = null) {
    await this.#ensureOwnedDirectory(this.tasksDir, 'Task storage directory');
    let entries;
    try {
      entries = await this.fileSystem.readdir(this.tasksDir, { withFileTypes: true });
    } catch (error) {
      throw new StorageError('TASK_STORAGE_READ_FAILED', 'Task directory could not be listed.', { cause: error });
    }
    const tasks = new Map();
    let temporaryCount = 0;
    for (const entry of entries) {
      const match = entry.isFile() ? entry.name.match(TASK_FILE_PATTERN) : null;
      if (match) {
        const id = match[1].toLowerCase();
        const revision = Number(match[2]);
        if (revision > MAX_REVISIONS_PER_TASK) {
          throw new StorageError('TASK_STORAGE_CORRUPT', 'Task revision file exceeds its bounded limit.');
        }
        const revisions = tasks.get(id) ?? [];
        revisions.push(revision);
        tasks.set(id, revisions);
      } else if (entry.isFile() && OWNED_TEMP_PATTERN.test(entry.name)) {
        temporaryCount += 1;
      } else {
        throw new StorageError('TASK_STORAGE_CORRUPT', 'Task directory contains unexpected files.');
      }
    }
    if (tasks.size > MAX_TASKS || temporaryCount > MAX_OWNED_TEMP_FILES ||
        [...tasks.values()].some((revisions) => revisions.length > MAX_REVISIONS_PER_TASK)) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'Task directory exceeds its bounded limit.');
    }
    if (taskId === null) return tasks;
    return tasks.get(taskId.toLowerCase()) ?? [];
  }

  async #readRevision(taskId, revision) {
    try {
      const filePath = this.#taskPath(taskId, revision);
      const fileStat = await this.fileSystem.lstat(filePath);
      if (!fileStat.isFile() || fileStat.isSymbolicLink() || fileStat.size > MAX_TASK_BYTES) {
        throw new StorageError('TASK_STORAGE_CORRUPT', 'Task storage is not a bounded regular file.');
      }
      const record = JSON.parse(await this.fileSystem.readFile(filePath, 'utf8'));
      validateRecordShape(record, this.validateTask, this.validateReceipt);
      if (record.task.id.toLowerCase() !== taskId.toLowerCase() || record.task.revision !== revision) {
        throw new StorageError('TASK_STORAGE_CORRUPT', 'Task file identity does not match its name.');
      }
      return record;
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if (error instanceof ProtocolValidationError || error instanceof SyntaxError) {
        throw new StorageError('TASK_STORAGE_CORRUPT', 'Task storage failed validation.', { cause: error });
      }
      throw new StorageError('TASK_STORAGE_READ_FAILED', 'Task storage could not be read.', { cause: error });
    }
  }

  async #readLatest(taskId) {
    const revisions = await this.#taskFiles(taskId);
    if (revisions.length === 0) return null;
    return this.#readRevision(taskId, Math.max(...revisions));
  }

  async #temporary(record) {
    const serialized = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_TASK_BYTES) {
      throw new StorageError('TASK_STORAGE_LIMIT', 'Task storage size limit reached.');
    }
    await this.#ensureOwnedDirectory(this.tasksDir, 'Task storage directory');
    const suffix = `${process.pid}-${Date.now()}-${randomBytes(6).toString('hex')}`;
    const temporaryPath = path.join(this.tasksDir, `.${record.task.id}.${suffix}.tmp`);
    let handle;
    try {
      handle = await this.fileSystem.open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(serialized, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      return temporaryPath;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await this.fileSystem.unlink(temporaryPath).catch(() => {});
      throw new StorageError('TASK_STORAGE_WRITE_FAILED', 'Task storage could not be written.', { cause: error });
    }
  }

  async #publish(record) {
    const temporaryPath = await this.#temporary(record);
    try {
      await this.#assertPhysicalDirectory(this.dataDir, 'TASK_STORAGE_CORRUPT', 'Task data root is not a physical directory.');
      await this.#assertPhysicalDirectory(this.tasksDir, 'TASK_STORAGE_CORRUPT', 'Task storage directory is not a physical directory.');
      await this.fileSystem.link(temporaryPath, this.#taskPath(record.task.id, record.task.revision));
      await this.fileSystem.unlink(temporaryPath);
    } catch (error) {
      await this.fileSystem.unlink(temporaryPath).catch(() => {});
      if (error instanceof StorageError) throw error;
      if (error?.code === 'EEXIST') return false;
      throw new StorageError('TASK_STORAGE_WRITE_FAILED', 'Task storage could not be published.', { cause: error });
    }
    return true;
  }

  async get(taskId) {
    const record = await this.#readLatest(taskId);
    if (!record) throw new StorageError('TASK_NOT_FOUND', 'Control task was not found.');
    return clone(record);
  }

  async create(record) {
    validateRecordShape(record, this.validateTask, this.validateReceipt);
    if (record.task.revision !== 1) {
      throw new StorageError('TASK_STORAGE_CORRUPT', 'New task must start at revision one.');
    }
    const existing = await this.#readLatest(record.task.id);
    if (existing) return clone(existing);
    if ((await this.#taskFiles()).size >= MAX_TASKS) {
      throw new StorageError('TASK_STORAGE_LIMIT', 'Task storage limit reached.');
    }
    if (await this.#publish(record)) return clone(record);
    const concurrent = await this.#readLatest(record.task.id);
    if (!concurrent) throw new StorageError('TASK_ID_CONFLICT', 'Task was created concurrently.');
    return clone(concurrent);
  }

  async update(record, expectedRevision) {
    validateRecordShape(record, this.validateTask, this.validateReceipt);
    if (record.task.revision !== expectedRevision + 1) {
      throw new StorageError('TASK_REVISION_CONFLICT', 'Task update must publish the next revision.');
    }
    const existing = await this.get(record.task.id);
    if (existing.task.revision !== expectedRevision) {
      if (sameJson(existing, record)) return clone(existing);
      throw new StorageError('TASK_REVISION_CONFLICT', 'Control task revision changed.');
    }
    if (await this.#publish(record)) return clone(record);
    const concurrent = await this.get(record.task.id);
    if (sameJson(concurrent, record)) return clone(concurrent);
    throw new StorageError('TASK_REVISION_CONFLICT', 'Control task revision changed concurrently.');
  }

}

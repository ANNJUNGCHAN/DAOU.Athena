import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CHART_OPEN_ACTION_ID,
  CHART_PERIOD_SET_ACTION_ID,
  CONTROL_CATALOG_VERSION,
  LEGACY_CONTROL_CATALOG_VERSION,
  MARKET_MENU_TARGETS,
  MARKET_NAVIGATE_ACTION_ID,
  PREVIOUS_CONTROL_CATALOG_VERSION,
  SITEMAP_OPEN_ACTION_ID,
  createProtocolValidator,
} from '../../contracts/wts-foundation.mjs';
import { ControlPlanner } from '../src/control-planner.mjs';
import { ReceiptStore } from '../src/receipt-store.mjs';
import { compileTaskInput, TASK_COMPILER } from '../src/task-compiler.mjs';
import { TaskEngine } from '../src/task-engine.mjs';
import { TaskStore } from '../src/task-store.mjs';

const schema = JSON.parse(await readFile(
  new URL('../../contracts/wts-foundation.protocol.schema.json', import.meta.url),
  'utf8',
));
const validator = createProtocolValidator(schema);
const BASE_TIME = Date.parse('2026-10-19T01:00:00.000Z');

function ids() {
  let value = 1;
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}`;
}

function observation(overrides = {}) {
  const state = {
    screenId: 'main-other',
    activeTab: 'quote',
    period: 'none',
    blocked: false,
    chartOpenEnabled: true,
    periodEnabled: false,
    instrumentToken: 'a'.repeat(64),
    contextToken: 'b'.repeat(64),
    ...(overrides.state ?? {}),
  };
  return {
    id: overrides.id ?? '10000000-0000-4000-8000-000000000001',
    capturedAt: overrides.capturedAt ?? new Date(BASE_TIME).toISOString(),
    source: {
      origin: 'https://wts.kiwoom.com',
      path: '/',
      tabId: 1,
      windowId: 2,
      frameId: 0,
      documentId: 'task-document',
    },
    state,
  };
}

function marketObservation(targetId, overrides = {}) {
  return observation({
    ...overrides,
    state: {
      stateKind: 'market-navigation',
      screenId: 'main-market-navigation',
      targetId,
      blocked: false,
      sitemapVisible: false,
      sitemapOpenEnabled: true,
      targetAvailable: false,
      activeTargetId: null,
      instrumentToken: 'a'.repeat(64),
      contextToken: 'b'.repeat(64),
      ...(overrides.state ?? {}),
    },
  });
}

function verifiedReceipt(proposal, id, after) {
  return {
    id,
    proposalId: proposal.id,
    catalogVersion: proposal.catalogVersion,
    actionId: proposal.actionId,
    args: structuredClone(proposal.args),
    before: structuredClone(proposal.observation),
    after,
    status: 'verified',
    reason: 'POSTCONDITION_MET',
    completedAt: new Date(BASE_TIME + 1_000).toISOString(),
  };
}

function createRuntime(root, { taskStore, receiptStore, createId = ids() } = {}) {
  const planner = new ControlPlanner({ now: () => BASE_TIME, createId });
  const actualReceiptStore = receiptStore ?? new ReceiptStore(root, validator.validateControlReceipt);
  const actualTaskStore = taskStore ?? new TaskStore(
    root,
    validator.validateControlTask,
    validator.validateControlReceipt,
  );
  return {
    taskStore: actualTaskStore,
    receiptStore: actualReceiptStore,
    engine: new TaskEngine({
      planner,
      taskStore: actualTaskStore,
      receiptStore: actualReceiptStore,
      validateTask: validator.validateControlTask,
      validateReceipt: validator.validateControlReceipt,
      now: () => BASE_TIME,
      createId,
    }),
  };
}

function legacyReadyRecord() {
  const taskId = '22000000-0000-4000-8000-000000000001';
  return {
    schemaVersion: 1,
    task: {
      schemaVersion: 1,
      id: taskId,
      submissionId: taskId,
      revision: 1,
      createdAt: '2026-10-19T01:00:00.000Z',
      updatedAt: '2026-10-19T01:00:00.000Z',
      catalogVersion: LEGACY_CONTROL_CATALOG_VERSION,
      compiler: {
        kind: 'deterministic',
        id: 'deterministic-korean-chart-v1',
        version: '1',
        generative: false,
        bundleHash: null,
      },
      status: 'ready',
      input: { text: '주봉으로' },
      cursor: 0,
      steps: [{
        id: '22000000-0000-4000-8000-000000000002',
        index: 0,
        actionId: CHART_PERIOD_SET_ACTION_ID,
        args: { period: 'week' },
        status: 'pending',
        proposalId: null,
        receiptId: null,
      }],
      activeProposal: null,
      cancelRequested: false,
      message: '1개 차트 작업을 로컬 규칙으로 확인했습니다.',
    },
    binding: null,
    commits: [],
    cancellations: [],
    pendingCommit: null,
  };
}

function previousReadyRecord() {
  const record = legacyReadyRecord();
  record.task.id = '22500000-0000-4000-8000-000000000001';
  record.task.submissionId = record.task.id;
  record.task.catalogVersion = PREVIOUS_CONTROL_CATALOG_VERSION;
  record.task.compiler.id = 'deterministic-korean-chart-v2';
  record.task.compiler.version = '2';
  record.task.input.text = '월봉으로';
  record.task.steps[0].id = '22500000-0000-4000-8000-000000000002';
  record.task.steps[0].args = { period: 'month' };
  return record;
}

test('compiler accepts bounded Korean compounds and rejects partial, negative, and residual input', () => {
  assert.deepEqual(compileTaskInput('차트 열고 주봉으로'), [
    { actionId: CHART_OPEN_ACTION_ID, args: {} },
    { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'week' } },
  ]);
  assert.equal(compileTaskInput('차트 열어줘 그리고 일봉으로').length, 2);
  assert.deepEqual(compileTaskInput('차트 열고 월봉으로 바꾸고 년봉으로'), [
    { actionId: CHART_OPEN_ACTION_ID, args: {} },
    { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'month' } },
    { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'year' } },
  ]);
  assert.deepEqual(compileTaskInput('월봉으로, 년봉으로 바꿔줘'), [
    { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'month' } },
    { actionId: CHART_PERIOD_SET_ACTION_ID, args: { period: 'year' } },
  ]);
  assert.equal(compileTaskInput('차트 열지 마'), null);
  assert.equal(compileTaskInput('차트 열어줘 빨리'), null);
  assert.equal(compileTaskInput('월봉으로 바꿔줘 그리고 매수'), null);
  assert.equal(compileTaskInput('년봉으로 바꾸지 마'), null);
  assert.equal(compileTaskInput('005930 차트 열어줘'), null);
  assert.equal(compileTaskInput(Array(13).fill('주봉으로').join(' 그리고 ')), null);
});

test('compiler expands all 25 exact market phrases to two fixed target actions', () => {
  for (const target of MARKET_MENU_TARGETS) {
    assert.deepEqual(
      compileTaskInput(`시장 메뉴 열어줘: ${target.sitemapGroup} > ${target.buttonLabel}`),
      [
        { actionId: SITEMAP_OPEN_ACTION_ID, args: { targetId: target.id } },
        { actionId: MARKET_NAVIGATE_ACTION_ID, args: { targetId: target.id } },
      ],
    );
  }
  assert.equal(compileTaskInput('시장 메뉴 열어줘: 시세분석 > 종목별투자자'), null);
  assert.equal(compileTaskInput('시장 메뉴 열어줘: 투자자별/프로그램 > 종목별투자자 #x'), null);
  assert.equal(compileTaskInput(Array(7).fill(
    '시장 메뉴 열어줘: 시세분석 > 급등락',
  ).join(' 그리고 ')), null);
});

test('next advances at most one satisfied market step and requires a fresh target observation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-market-satisfied-'));
  const runtime = createRuntime(root);
  const taskId = '21500000-0000-4000-8000-000000000001';
  await runtime.engine.start(taskId, '시장 메뉴 열어줘: 시세분석 > 급등락');
  const active = marketObservation('market-menu-001', {
    state: { activeTargetId: 'market-menu-001' },
  });
  const first = await runtime.engine.next(taskId, 1, active);
  assert.equal(first.task.status, 'ready');
  assert.equal(first.task.cursor, 1);
  assert.equal(first.task.steps[0].status, 'satisfied');
  assert.equal(first.task.steps[1].status, 'pending');
  const second = await runtime.engine.next(taskId, 2, active);
  assert.equal(second.task.status, 'completed');
  assert.equal(second.task.cursor, 2);
  assert.equal(second.task.steps[1].status, 'satisfied');
});

test('new tasks bind only the current catalog and compiler', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-current-'));
  const runtime = createRuntime(root);
  const task = await runtime.engine.start(
    '21000000-0000-4000-8000-000000000001',
    '월봉으로 그리고 년봉으로',
  );
  assert.equal(task.catalogVersion, CONTROL_CATALOG_VERSION);
  assert.deepEqual(task.compiler, TASK_COMPILER);
  assert.deepEqual(task.steps.map((step) => step.args.period), ['month', 'year']);
});

test('legacy ready task rejects dispatch before observation or planner access and cancels by append-only revision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-legacy-'));
  const runtime = createRuntime(root);
  const record = legacyReadyRecord();
  await runtime.taskStore.create(record);
  let plannerCalls = 0;
  runtime.engine.planner.planAction = () => {
    plannerCalls += 1;
    throw new Error('legacy planner must not run');
  };

  await assert.rejects(
    runtime.engine.next(record.task.id, 1, null),
    { code: 'TASK_CATALOG_CHANGED' },
  );
  assert.equal(plannerCalls, 0);
  const persistentStore = runtime.engine.taskStore;
  runtime.engine.taskStore = {
    get: async () => ({ ...structuredClone(record), pendingCommit: { stepId: 'pending' } }),
  };
  await assert.rejects(
    runtime.engine.next(record.task.id, 1, null),
    { code: 'TASK_COMMIT_PENDING' },
  );
  runtime.engine.taskStore = persistentStore;
  const revisionPath = path.join(root, 'tasks', `${record.task.id}.1.json`);
  const originalBytes = await readFile(revisionPath);
  const originalSha = createHash('sha256').update(originalBytes).digest('hex');
  assert.equal(originalSha, '4c4603f3e506ef478f4fe421827c157fd9ee9cc8fc0bd46a215adfa7227cb90a');
  assert.equal((await runtime.taskStore.get(record.task.id)).task.revision, 1);
  assert.deepEqual(await readdir(path.join(root, 'tasks')), [`${record.task.id}.1.json`]);

  const cancelled = await runtime.engine.cancel(
    record.task.id,
    1,
    '22000000-0000-4000-8000-000000000003',
  );
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.revision, 2);
  assert.equal(cancelled.catalogVersion, LEGACY_CONTROL_CATALOG_VERSION);
  assert.equal(cancelled.steps[0].status, 'cancelled');
  assert.deepEqual(await readFile(revisionPath), originalBytes);
  assert.equal(
    createHash('sha256').update(await readFile(revisionPath)).digest('hex'),
    originalSha,
  );
  assert.deepEqual((await readdir(path.join(root, 'tasks'))).sort(), [
    `${record.task.id}.1.json`,
    `${record.task.id}.2.json`,
  ]);
});

test('previous catalog ready task remains byte-stable and rejects current dispatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-previous-'));
  const runtime = createRuntime(root);
  const record = previousReadyRecord();
  await runtime.taskStore.create(record);
  const revisionPath = path.join(root, 'tasks', `${record.task.id}.1.json`);
  const original = await readFile(revisionPath);
  await assert.rejects(
    runtime.engine.next(record.task.id, 1, null),
    { code: 'TASK_CATALOG_CHANGED' },
  );
  assert.deepEqual(await readFile(revisionPath), original);
  assert.deepEqual(await readdir(path.join(root, 'tasks')), [`${record.task.id}.1.json`]);
});

test('compound task survives restart, reobserves each step, and reconciles cancel with the original commit revision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-'));
  const submissionId = '20000000-0000-4000-8000-000000000001';
  const first = createRuntime(root);
  const started = await first.engine.start(submissionId, '차트 열고 주봉으로');
  assert.equal(started.status, 'ready');
  assert.equal(started.steps.length, 2);

  const proposedOpen = await first.engine.next(submissionId, 1, observation());
  assert.equal(proposedOpen.outcome.status, 'proposed');
  assert.equal(proposedOpen.task.revision, 2);
  const openReceipt = verifiedReceipt(
    proposedOpen.outcome.proposal,
    '30000000-0000-4000-8000-000000000001',
    observation({
      id: '10000000-0000-4000-8000-000000000002',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  const committedOpen = await first.engine.commit(
    submissionId,
    proposedOpen.task.steps[0].id,
    2,
    openReceipt,
  );
  assert.equal(committedOpen.task.status, 'ready');
  assert.equal(committedOpen.task.cursor, 1);

  const restarted = createRuntime(root);
  const proposedWeek = await restarted.engine.next(
    submissionId,
    committedOpen.task.revision,
    observation({
      id: '10000000-0000-4000-8000-000000000003',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  assert.equal(proposedWeek.outcome.proposal.actionId, CHART_PERIOD_SET_ACTION_ID);
  assert.equal(proposedWeek.outcome.proposal.args.period, 'week');
  const originalCommitRevision = proposedWeek.task.revision;
  const cancelled = await restarted.engine.cancel(
    submissionId,
    originalCommitRevision,
    '40000000-0000-4000-8000-000000000001',
  );
  assert.equal(cancelled.status, 'cancel_requested');
  assert.equal(cancelled.activeProposal.id, proposedWeek.outcome.proposal.id);

  const weekReceipt = verifiedReceipt(
    proposedWeek.outcome.proposal,
    '30000000-0000-4000-8000-000000000002',
    observation({
      id: '10000000-0000-4000-8000-000000000004',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'week',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  const reconciled = await restarted.engine.commit(
    submissionId,
    proposedWeek.task.steps[1].id,
    originalCommitRevision,
    weekReceipt,
  );
  assert.equal(reconciled.task.status, 'cancelled');
  assert.equal(reconciled.task.cursor, 2);
  const retried = await restarted.engine.commit(
    submissionId,
    proposedWeek.task.steps[1].id,
    originalCommitRevision,
    structuredClone(weekReceipt),
  );
  assert.deepEqual(retried, reconciled);

  await assert.rejects(
    restarted.engine.next(submissionId, originalCommitRevision, observation()),
    { code: 'TASK_REVISION_CONFLICT' },
  );
});

test('a receipt stored before a task write failure can be committed exactly after restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-recovery-'));
  const base = createRuntime(root);
  const taskId = '50000000-0000-4000-8000-000000000001';
  await base.engine.start(taskId, '차트 열어줘');
  const proposed = await base.engine.next(taskId, 1, observation());

  let failUpdate = true;
  const failingStore = {
    get: (...args) => base.taskStore.get(...args),
    create: (...args) => base.taskStore.create(...args),
    update: async (...args) => {
      if (failUpdate) {
        failUpdate = false;
        const error = new Error('simulated task publish failure');
        error.code = 'TASK_STORAGE_WRITE_FAILED';
        throw error;
      }
      return base.taskStore.update(...args);
    },
  };
  const failing = createRuntime(root, {
    taskStore: failingStore,
    receiptStore: base.receiptStore,
  });
  const receipt = verifiedReceipt(
    proposed.outcome.proposal,
    '60000000-0000-4000-8000-000000000001',
    observation({
      id: '10000000-0000-4000-8000-000000000005',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  await assert.rejects(
    failing.engine.commit(taskId, proposed.task.steps[0].id, 2, receipt),
    { code: 'TASK_STORAGE_WRITE_FAILED' },
  );
  assert.equal((await base.taskStore.get(taskId)).task.status, 'awaiting_receipt');
  assert.equal((await base.receiptStore.record(receipt)).stored, true);

  const restarted = createRuntime(root);
  const recovered = await restarted.engine.commit(taskId, proposed.task.steps[0].id, 2, receipt);
  assert.equal(recovered.task.status, 'completed');
  assert.equal(recovered.receiptId, receipt.id);
});

test('failed proposal storage leaves the persisted task ready and never advances it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-failed-next-'));
  const base = createRuntime(root);
  const taskId = '70000000-0000-4000-8000-000000000001';
  await base.engine.start(taskId, '차트 열어줘');
  const failingStore = {
    get: (...args) => base.taskStore.get(...args),
    create: (...args) => base.taskStore.create(...args),
    update: async () => {
      const error = new Error('simulated task publish failure');
      error.code = 'TASK_STORAGE_WRITE_FAILED';
      throw error;
    },
  };
  const failing = createRuntime(root, { taskStore: failingStore, receiptStore: base.receiptStore });
  await assert.rejects(failing.engine.next(taskId, 1, observation()), {
    code: 'TASK_STORAGE_WRITE_FAILED',
  });
  const unchanged = await base.engine.get(taskId);
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.status, 'ready');
  assert.equal(unchanged.activeProposal, null);
});

test('receipt failure leaves a claimed task awaiting the same proposal and exact retry repairs it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-receipt-wal-'));
  const base = createRuntime(root);
  const taskId = '70500000-0000-4000-8000-000000000001';
  await base.engine.start(taskId, '차트 열어줘');
  const proposed = await base.engine.next(taskId, 1, observation());
  const receipt = verifiedReceipt(
    proposed.outcome.proposal,
    '70500000-0000-4000-8000-000000000002',
    observation({
      id: '70500000-0000-4000-8000-000000000003',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  let failReceipt = true;
  const failingReceiptStore = {
    record: async (...args) => {
      if (failReceipt) {
        failReceipt = false;
        const error = new Error('simulated receipt publish failure');
        error.code = 'RECEIPT_STORAGE_WRITE_FAILED';
        throw error;
      }
      return base.receiptStore.record(...args);
    },
  };
  const failing = createRuntime(root, {
    taskStore: new TaskStore(root, validator.validateControlTask, validator.validateControlReceipt),
    receiptStore: failingReceiptStore,
  });

  await assert.rejects(
    failing.engine.commit(taskId, proposed.task.steps[0].id, 2, receipt),
    { code: 'RECEIPT_STORAGE_WRITE_FAILED' },
  );
  const claimed = await base.taskStore.get(taskId);
  assert.equal(claimed.task.status, 'awaiting_receipt');
  assert.equal(claimed.task.cursor, 0);
  assert.equal(claimed.task.steps[0].status, 'awaiting_receipt');
  assert.equal(claimed.task.activeProposal.id, proposed.outcome.proposal.id);
  assert.deepEqual(claimed.pendingCommit, {
    stepId: proposed.task.steps[0].id,
    expectedRevision: 2,
    receipt,
  });
  await assert.rejects(base.engine.next(taskId, claimed.task.revision, observation()), {
    code: 'TASK_COMMIT_PENDING',
  });

  const restarted = createRuntime(root);
  const recovered = await restarted.engine.commit(
    taskId,
    proposed.task.steps[0].id,
    2,
    receipt,
  );
  assert.equal(recovered.task.status, 'completed');
  assert.equal(recovered.task.cursor, 1);
  assert.equal(recovered.receiptId, receipt.id);
  assert.equal((await restarted.taskStore.get(taskId)).pendingCommit, null);
  assert.deepEqual(
    await restarted.engine.commit(taskId, proposed.task.steps[0].id, 2, receipt),
    recovered,
  );
});

test('restart rejects active, pending, and committed records with broken semantic bindings', async () => {
  const activeRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-corrupt-active-'));
  const activeId = '70510000-0000-4000-8000-000000000001';
  const activeRuntime = createRuntime(activeRoot);
  await activeRuntime.engine.start(activeId, '차트 열어줘');
  await activeRuntime.engine.next(activeId, 1, observation());
  const activePath = path.join(activeRoot, 'tasks', `${activeId}.2.json`);
  const activeRecord = JSON.parse(await readFile(activePath, 'utf8'));
  activeRecord.task.activeProposal.observation.source.tabId = 99;
  await writeFile(activePath, `${JSON.stringify(activeRecord)}\n`, 'utf8');
  await assert.rejects(createRuntime(activeRoot).engine.get(activeId), {
    code: 'TASK_STORAGE_CORRUPT',
  });

  const pendingRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-corrupt-pending-'));
  const pendingId = '70510000-0000-4000-8000-000000000002';
  const pendingRuntime = createRuntime(pendingRoot);
  await pendingRuntime.engine.start(pendingId, '차트 열어줘');
  const pendingProposal = await pendingRuntime.engine.next(pendingId, 1, observation());
  const pendingReceipt = verifiedReceipt(
    pendingProposal.outcome.proposal,
    '70510000-0000-4000-8000-000000000003',
    observation({
      id: '70510000-0000-4000-8000-000000000004',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  const failedReceiptStore = {
    record: async () => {
      const error = new Error('simulated pending receipt');
      error.code = 'RECEIPT_STORAGE_WRITE_FAILED';
      throw error;
    },
  };
  const pendingFailure = createRuntime(pendingRoot, {
    taskStore: pendingRuntime.taskStore,
    receiptStore: failedReceiptStore,
  });
  await assert.rejects(
    pendingFailure.engine.commit(
      pendingId,
      pendingProposal.task.steps[0].id,
      2,
      pendingReceipt,
    ),
    { code: 'RECEIPT_STORAGE_WRITE_FAILED' },
  );
  const pendingPath = path.join(pendingRoot, 'tasks', `${pendingId}.3.json`);
  const pendingRecord = JSON.parse(await readFile(pendingPath, 'utf8'));
  pendingRecord.pendingCommit.receipt.before.source.documentId = 'wrong-document';
  await writeFile(pendingPath, `${JSON.stringify(pendingRecord)}\n`, 'utf8');
  await assert.rejects(createRuntime(pendingRoot).engine.get(pendingId), {
    code: 'TASK_STORAGE_CORRUPT',
  });

  const committedRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-corrupt-commit-'));
  const committedId = '70510000-0000-4000-8000-000000000005';
  const committedRuntime = createRuntime(committedRoot);
  await committedRuntime.engine.start(committedId, '차트 열어줘');
  const committedProposal = await committedRuntime.engine.next(committedId, 1, observation());
  const committedReceipt = verifiedReceipt(
    committedProposal.outcome.proposal,
    '70510000-0000-4000-8000-000000000006',
    observation({
      id: '70510000-0000-4000-8000-000000000007',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  const committed = await committedRuntime.engine.commit(
    committedId,
    committedProposal.task.steps[0].id,
    2,
    committedReceipt,
  );
  const committedPath = path.join(
    committedRoot,
    'tasks',
    `${committedId}.${committed.task.revision}.json`,
  );
  const committedRecord = JSON.parse(await readFile(committedPath, 'utf8'));
  committedRecord.commits[0].receipt.actionId = CHART_PERIOD_SET_ACTION_ID;
  committedRecord.commits[0].receipt.args = { period: 'week' };
  await writeFile(committedPath, `${JSON.stringify(committedRecord)}\n`, 'utf8');
  await assert.rejects(createRuntime(committedRoot).engine.get(committedId), {
    code: 'TASK_STORAGE_CORRUPT',
  });
});

test('independent engines use revision CAS so next and cancel have exactly one durable winner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-cas-race-'));
  const taskId = '70600000-0000-4000-8000-000000000001';
  const base = createRuntime(root);
  await base.engine.start(taskId, '차트 열어줘');
  const nextRuntime = createRuntime(root, { createId: ids() });
  const cancelRuntime = createRuntime(root, { createId: ids() });

  const results = await Promise.allSettled([
    nextRuntime.engine.next(taskId, 1, observation()),
    cancelRuntime.engine.cancel(taskId, 1, '70600000-0000-4000-8000-000000000002'),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejected = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, 'TASK_REVISION_CONFLICT');

  const persisted = await base.taskStore.get(taskId);
  const winnerTask = fulfilled[0].value.task ?? fulfilled[0].value;
  assert.deepEqual(persisted.task, winnerTask);
  assert.equal(persisted.task.revision, 2);
  assert.deepEqual((await readdir(path.join(root, 'tasks'))).sort(), [
    `${taskId}.1.json`,
    `${taskId}.2.json`,
  ]);
});

test('compound task blocks when a later observation switches tab, document, or instrument', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-binding-'));
  const runtime = createRuntime(root);
  const taskId = '71000000-0000-4000-8000-000000000001';
  await runtime.engine.start(taskId, '차트 열고 주봉으로');
  const proposed = await runtime.engine.next(taskId, 1, observation());
  const receipt = verifiedReceipt(
    proposed.outcome.proposal,
    '72000000-0000-4000-8000-000000000001',
    observation({
      id: '10000000-0000-4000-8000-000000000006',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  const committed = await runtime.engine.commit(taskId, proposed.task.steps[0].id, 2, receipt);
  const switched = observation({
    id: '10000000-0000-4000-8000-000000000007',
    state: {
      screenId: 'main-chart', activeTab: 'chart', period: 'day',
      chartOpenEnabled: false, periodEnabled: true,
      instrumentToken: 'c'.repeat(64),
    },
  });
  const blocked = await runtime.engine.next(taskId, committed.task.revision, switched);
  assert.equal(blocked.task.status, 'blocked');
  assert.equal(blocked.outcome.status, 'blocked');
  assert.equal(blocked.task.activeProposal, null);
});

test('submission id is idempotent for exact text and conflicts for changed input', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-start-'));
  const runtime = createRuntime(root);
  const taskId = '80000000-0000-4000-8000-000000000001';
  const [left, right] = await Promise.all([
    runtime.engine.start(taskId, '주봉으로'),
    runtime.engine.start(taskId, '주봉으로'),
  ]);
  assert.deepEqual(left, right);
  await assert.rejects(runtime.engine.start(taskId, '일봉으로'), {
    code: 'TASK_SUBMISSION_CONFLICT',
  });
});

test('ready cancellation stops between steps and concurrent stale cancellation conflicts', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-stop-'));
  const runtime = createRuntime(root);
  const taskId = '81000000-0000-4000-8000-000000000001';
  await runtime.engine.start(taskId, '차트 열고 주봉으로');
  const proposed = await runtime.engine.next(taskId, 1, observation());
  const receipt = verifiedReceipt(
    proposed.outcome.proposal,
    '82000000-0000-4000-8000-000000000001',
    observation({
      id: '10000000-0000-4000-8000-000000000008',
      state: {
        screenId: 'main-chart', activeTab: 'chart', period: 'day',
        chartOpenEnabled: false, periodEnabled: true,
      },
    }),
  );
  const committed = await runtime.engine.commit(taskId, proposed.task.steps[0].id, 2, receipt);
  assert.equal(committed.task.status, 'ready');

  const cancelA = runtime.engine.cancel(
    taskId,
    committed.task.revision,
    '83000000-0000-4000-8000-000000000001',
  );
  const cancelB = runtime.engine.cancel(
    taskId,
    committed.task.revision,
    '83000000-0000-4000-8000-000000000002',
  );
  const settled = await Promise.allSettled([cancelA, cancelB]);
  assert.equal(settled.filter((value) => value.status === 'fulfilled').length, 1);
  const rejected = settled.find((value) => value.status === 'rejected');
  assert.equal(rejected.reason.code, 'TASK_REVISION_CONFLICT');
  const stopped = await runtime.engine.get(taskId);
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.steps[1].status, 'cancelled');
});

test('task storage rejects linked directories and unexpected entries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-storage-'));
  const target = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-target-'));
  try {
    await symlink(target, path.join(root, 'tasks'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip('symlink creation is unavailable');
      return;
    }
    throw error;
  }
  const runtime = createRuntime(root);
  await assert.rejects(
    runtime.engine.start('90000000-0000-4000-8000-000000000001', '차트 열어줘'),
    { code: 'TASK_STORAGE_CORRUPT' },
  );

  const cleanRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-unknown-'));
  await mkdir(path.join(cleanRoot, 'tasks'));
  await writeFile(path.join(cleanRoot, 'tasks', 'unexpected.txt'), 'x');
  const cleanRuntime = createRuntime(cleanRoot);
  await assert.rejects(
    cleanRuntime.engine.start('a0000000-0000-4000-8000-000000000001', '차트 열어줘'),
    { code: 'TASK_STORAGE_CORRUPT' },
  );
});

test('task storage rejects a junction data root without touching its external target', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows junction behavior is platform-specific.');
    return;
  }
  const parent = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-root-junction-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-task-root-external-'));
  const dataRoot = path.join(parent, 'WtsData');
  await writeFile(path.join(external, 'sentinel.txt'), 'unchanged', 'utf8');
  try {
    await symlink(external, dataRoot, 'junction');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`junction creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const runtime = createRuntime(dataRoot);
  await assert.rejects(
    runtime.engine.start('70700000-0000-4000-8000-000000000001', '차트 열어줘'),
    { code: 'TASK_STORAGE_CORRUPT' },
  );
  assert.deepEqual(await readdir(external), ['sentinel.txt']);
  assert.equal(await readFile(path.join(external, 'sentinel.txt'), 'utf8'), 'unchanged');
});

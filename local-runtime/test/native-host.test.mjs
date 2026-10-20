import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';

import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '../../contracts/wts-foundation.mjs';
import { FinancialBackendSupervisorError } from '../src/financial-backend-supervisor.mjs';
import { encodeNativeMessage, NativeMessageDecoder } from '../src/framing.mjs';
import { InventoryStore } from '../src/inventory-store.mjs';
import { createRequestHandler } from '../src/host.mjs';
import { runNativeHost } from '../src/main.mjs';

const HOST_PATH = fileURLToPath(new URL('../src/main.mjs', import.meta.url));
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

function request(requestId, method, params = {}) {
  return { protocolVersion: PROTOCOL_VERSION, requestId, method, params };
}

function observation(
  id = '11111111-1111-4111-8111-111111111111',
  { frameId = 0, documentId = `document-${frameId}`, tabId = 1, windowId = 2 } = {},
) {
  return {
    id,
    capturedAt: '2026-10-18T01:02:03.000Z',
    source: {
      origin: 'https://wts.kiwoom.com',
      path: '/dashboard',
      tabId,
      windowId,
      frameId,
      documentId,
    },
    title: 'WTS',
    headings: ['시장'],
    controls: [
      {
        ref: 'control-1',
        tag: 'button',
        role: 'button',
        name: '조회',
        type: 'button',
        disabled: false,
        visible: true,
      },
    ],
    frames: [{ origin: 'https://wts.kiwoom.com', path: '/frame' }],
    canvasCount: 0,
    truncated: false,
  };
}

function capture(
  id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  observations = [observation()],
) {
  return { id, capturedAt: '2026-10-18T01:02:03.000Z', observations };
}

async function createConfig(root, dataDir = path.join(root, 'data')) {
  const configPath = path.join(root, 'host-config.json');
  await writeFile(
    configPath,
    JSON.stringify({ hostName: 'com.athena.wts', allowedOrigin: ORIGIN, dataDir }),
    'utf8',
  );
  return { configPath, dataDir };
}

function decodeOutput(buffer) {
  const decoder = new NativeMessageDecoder(MAX_MESSAGE_BYTES);
  const messages = decoder.push(buffer).map((payload) => JSON.parse(payload.toString('utf8')));
  decoder.finish();
  return messages;
}

test('provider consume validates the exact response before committing operationId and revision', async () => {
  const terminal = {
    operationId: '11111111-1111-4111-8111-111111111111',
    kind: 'plan',
    state: 'succeeded',
    revision: 2,
    cancellable: false,
    result: {
      submissionId: '22222222-2222-4222-8222-222222222222',
      catalogVersion: 'wts-main-control-3',
      assistantText: '완료',
      proposal: null,
    },
    error: null,
  };
  const commits = [];
  let rejectResponse = true;
  const validator = {
    validateRequest: (value) => value,
    validateResponse: (value) => {
      if (rejectResponse) throw new Error('synthetic response validation failure');
      return value;
    },
  };
  const providerCoordinator = {
    operationGet: () => terminal,
    operationCommitConsumption: (identity) => commits.push(identity),
  };
  const handleRequest = createRequestHandler({
    validator,
    runtimeVersion: '0.8.0',
    providerCoordinator,
  });
  const consumeRequest = request('provider-consume-001', 'provider.operation.get', {
    operationId: terminal.operationId,
    consume: true,
  });

  await assert.rejects(handleRequest(consumeRequest), /synthetic response validation failure/u);
  assert.deepEqual(commits, []);

  rejectResponse = false;
  const response = await handleRequest(consumeRequest);
  assert.deepEqual(commits, [{ operationId: terminal.operationId, revision: terminal.revision }]);
  assert.deepEqual(response.result, terminal);
});

test('failed Native response write destroys the port and shuts down provider state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-write-failure-'));
  const { configPath } = await createConfig(root);
  const stdin = new PassThrough();
  const writeFailure = new Error('simulated native write failure');
  const stdout = {
    destroyed: false,
    write() { throw writeFailure; },
    destroy() { this.destroyed = true; },
  };
  let shutdownCalls = 0;
  const running = runNativeHost({
    stdin,
    stdout,
    callerOrigin: ORIGIN,
    configPath,
    createProviderCoordinator: () => ({
      status: () => null,
      shutdown: () => { shutdownCalls += 1; },
    }),
  });

  stdin.write(encodeNativeMessage(
    request('provider-write-failure', 'runtime.hello'),
    MAX_MESSAGE_BYTES,
  ));

  await assert.rejects(running, /simulated native write failure/u);
  assert.equal(stdin.destroyed, true);
  assert.equal(stdout.destroyed, true);
  assert.equal(shutdownCalls, 1);
});

test('decoder accepts coalesced near-limit frames across a partial header boundary', () => {
  const firstPayload = Buffer.alloc(MAX_MESSAGE_BYTES - 16, 0x61);
  const secondPayload = Buffer.alloc(MAX_MESSAGE_BYTES - 32, 0x62);
  const firstFrame = Buffer.alloc(4 + firstPayload.length);
  firstFrame.writeUInt32LE(firstPayload.length, 0);
  firstPayload.copy(firstFrame, 4);
  const secondFrame = Buffer.alloc(4 + secondPayload.length);
  secondFrame.writeUInt32LE(secondPayload.length, 0);
  secondPayload.copy(secondFrame, 4);
  const combined = Buffer.concat([firstFrame, secondFrame]);
  const boundary = firstFrame.length + 2;
  const decoder = new NativeMessageDecoder(MAX_MESSAGE_BYTES);

  const firstMessages = decoder.push(combined.subarray(0, boundary));
  assert.equal(firstMessages.length, 1);
  assert.deepEqual(firstMessages[0], firstPayload);
  const secondMessages = decoder.push(combined.subarray(boundary));
  assert.equal(secondMessages.length, 1);
  assert.deepEqual(secondMessages[0], secondPayload);
  decoder.finish();
});

test('stdin EOF aborts an active source request and awaits owned supervisor cleanup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-eof-'));
  const { configPath } = await createConfig(root);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.backendRoot = path.join(root, 'backend');
  config.pythonExecutable = path.join(root, 'python.exe');
  await writeFile(configPath, JSON.stringify(config), 'utf8');

  let stopCalls = 0;
  let executeCalls = 0;
  const supervisor = {
    stop: async () => { stopCalls += 1; },
  };
  const bridge = {
    execute: async (_operation, _input, { signal }) => {
      executeCalls += 1;
      await new Promise((resolve) => setImmediate(resolve));
      if (signal.aborted) {
        throw Object.assign(new Error('secret endpoint http://127.0.0.1:54321'), {
          code: 'BACKEND_REQUEST_ABORTED',
        });
      }
      return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('secret'), {
          code: 'BACKEND_REQUEST_ABORTED',
        })), { once: true });
      });
    },
  };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const output = [];
  stdout.on('data', (chunk) => output.push(chunk));
  const running = runNativeHost({
    stdin,
    stdout,
    callerOrigin: ORIGIN,
    configPath,
    createSupervisor: () => supervisor,
    createSourceBridge: () => bridge,
    createId: () => '77777777-7777-4777-8777-777777777777',
  });
  stdin.end(encodeNativeMessage(
    request('request-eof-source', 'source.manifest'),
    MAX_MESSAGE_BYTES,
  ));
  await running;
  assert.equal(executeCalls, 1);
  assert.equal(stopCalls, 1);
  const responses = decodeOutput(Buffer.concat(output));
  assert.equal(responses.length, 1);
  assert.deepEqual(responses[0].error, {
    code: 'BACKEND_REQUEST_ABORTED',
    message: 'Local read-only backend request failed.',
  });
  assert.doesNotMatch(JSON.stringify(responses), /secret|127\.0\.0\.1|54321/u);
});

test('financial startup failure is immediate, serial-loop safe, and both owned children stop', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-financial-host-'));
  const { configPath } = await createConfig(root);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.backendRoot = path.join(root, 'backend');
  config.pythonExecutable = path.join(root, 'python.exe');
  await writeFile(configPath, JSON.stringify(config), 'utf8');

  let metadataStops = 0;
  let financialStops = 0;
  let financialCalls = 0;
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const output = [];
  stdout.on('data', (chunk) => output.push(chunk));
  const running = runNativeHost({
    stdin,
    stdout,
    callerOrigin: ORIGIN,
    configPath,
    createSupervisor: () => ({ stop: async () => { metadataStops += 1; } }),
    createSourceBridge: () => ({ execute: async () => ({}) }),
    createFinancialSupervisor: () => ({ stop: async () => { financialStops += 1; } }),
    createFinancialSourceBridge: () => ({
      execute: async () => {
        financialCalls += 1;
        throw new FinancialBackendSupervisorError('FINANCIAL_BACKEND_STARTING');
      },
    }),
  });
  stdin.end(Buffer.concat([
    encodeNativeMessage(request('financial-invalid-001', 'source.credentials.status', {
      mutationId: null,
      arbitraryPath: '/not-allowed',
    }), MAX_MESSAGE_BYTES),
    encodeNativeMessage(request('financial-status-0001', 'source.credentials.status', {
      mutationId: null,
    }), MAX_MESSAGE_BYTES),
    encodeNativeMessage(request('financial-hello-00001', 'runtime.hello'), MAX_MESSAGE_BYTES),
  ]));
  await running;
  const responses = decodeOutput(Buffer.concat(output));
  assert.deepEqual(responses[0].error, {
    code: 'REQUEST_INVALID',
    message: 'Request is invalid.',
  });
  assert.deepEqual(responses[1].error, {
    code: 'FINANCIAL_BACKEND_STARTING',
    message: 'Local financial runtime is starting.',
  });
  assert.equal(responses[2].ok, true);
  assert.equal(responses[2].result.financial.configured, true);
  assert.equal(financialCalls, 1);
  assert.equal(metadataStops, 1);
  assert.equal(financialStops, 1);
});

async function runHost({ configPath, origin = ORIGIN, chunks }) {
  const child = spawn(process.execPath, [HOST_PATH, origin], {
    env: { ...process.env, ATHENA_WTS_HOST_CONFIG: configPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  for (const chunk of chunks) {
    child.stdin.write(chunk);
  }
  child.stdin.end();
  const [exitCode] = await once(child, 'close');
  return {
    exitCode,
    stdout: Buffer.concat(stdout),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
}

test('real host routes conversation text without starting a backend or task', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-host-conversation-'));
  const { configPath, dataDir } = await createConfig(root);
  const submissionId = '77777777-7777-4777-8777-777777777777';
  const result = await runHost({
    configPath,
    chunks: [encodeNativeMessage(request('request-route-0001', 'conversation.route', {
      submissionId,
      text: '조회 기능 찾아줘: 종목 조회',
    }), MAX_MESSAGE_BYTES)],
  });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(decodeOutput(result.stdout)[0].result, {
    submissionId,
    kind: 'source-search',
    query: '종목 조회',
  });
  await assert.rejects(readdir(dataDir), { code: 'ENOENT' });
});

test('real host process handles partial/coalesced frames and persists idempotently across restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-host-'));
  const { configPath } = await createConfig(root);
  const frames = Buffer.concat([
    encodeNativeMessage(request('request-hello-01', 'runtime.hello'), MAX_MESSAGE_BYTES),
    encodeNativeMessage(
      request('request-record-01', 'inventory.record', { capture: capture() }),
      MAX_MESSAGE_BYTES,
    ),
    encodeNativeMessage(
      request('request-record-02', 'inventory.record', { capture: capture() }),
      MAX_MESSAGE_BYTES,
    ),
    encodeNativeMessage(
      request('request-record-02b', 'inventory.record', {
        capture: capture('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', [
          observation('22222222-2222-4222-8222-222222222222'),
          observation('33333333-3333-4333-8333-333333333333', { frameId: 1 }),
        ]),
      }),
      MAX_MESSAGE_BYTES,
    ),
    encodeNativeMessage(request('request-summary-01', 'inventory.summary'), MAX_MESSAGE_BYTES),
  ]);

  const first = await runHost({
    configPath,
    chunks: [frames.subarray(0, 2), frames.subarray(2, 11), frames.subarray(11)],
  });
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(first.stderr, '');
  const responses = decodeOutput(first.stdout);
  assert.equal(responses.length, 5);
  assert.deepEqual(responses[0].result.capabilities, {
    observationStorage: true,
    screenControl: true,
    laya: false,
    localPlanner: false,
  });
  assert.deepEqual(responses[0].result.control, {
    catalogVersion: 'wts-main-control-3',
    actions: [
      'wts.main.p3.chart.open',
      'wts.main.p3.chart.period.set',
      'wts.main.sitemap.open',
      'wts.main.p1.market.navigate',
    ],
    commandMode: 'bounded-korean-v3',
    taskMode: 'bounded-compound-v1',
    maxTaskSteps: 12,
    planner: {
      kind: 'deterministic',
      id: 'deterministic-korean-wts-v3',
      version: '3',
      bundleHash: null,
      generative: false,
      localModelReady: false,
    },
    market: { id: 'market-menu-navigation-20261019', targetCount: 25 },
  });
  assert.deepEqual(responses[0].result.conversation, {
    routerId: 'deterministic-wts-conversation-v1',
    generative: false,
    routes: ['wts-control', 'source-search'],
  });
  assert.deepEqual(responses[0].result.financial, {
    configured: false,
    profile: 'wts-financial-read-v1',
    apiVersion: 'selector-financial-read-v1',
    cardVersion: 'wts-financial-card-1',
    methods: [
      'source.credentials.status',
      'source.credentials.configure',
      'source.credentials.delete',
      'source.query.start',
      'source.query.status',
      'source.query.page',
      'source.query.continue',
      'source.query.cancel',
    ],
    renderKinds: ['facts', 'table', 'compound', 'chart'],
    queryOnly: true,
    credentialSetup: true,
    order: false,
    websocket: false,
    externalAi: false,
  });
  assert.equal(responses[1].result.stored, true);
  assert.equal(responses[2].result.stored, true);
  assert.equal(responses[3].result.stored, true);
  assert.equal(responses[4].result.captureCount, 2);
  assert.equal(responses[4].result.observationCount, 3);
  assert.equal(responses[4].result.coverage, 'partial');

  const restarted = await runHost({
    configPath,
    chunks: [
      encodeNativeMessage(request('request-summary-02', 'inventory.summary'), MAX_MESSAGE_BYTES),
    ],
  });
  assert.equal(restarted.exitCode, 0, restarted.stderr);
  assert.equal(decodeOutput(restarted.stdout)[0].result.captureCount, 2);
  assert.equal(decodeOutput(restarted.stdout)[0].result.observationCount, 3);
});

test('real host process persists a task proposal and reconciles it after restart without reissuing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-host-task-'));
  const { configPath } = await createConfig(root);
  const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const capturedAt = new Date().toISOString();
  const controlObservation = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    capturedAt,
    source: {
      origin: 'https://wts.kiwoom.com',
      path: '/',
      tabId: 10,
      windowId: 20,
      frameId: 0,
      documentId: 'task-document',
    },
    state: {
      screenId: 'main-other',
      activeTab: 'quote',
      period: 'none',
      blocked: false,
      chartOpenEnabled: true,
      periodEnabled: false,
      instrumentToken: 'd'.repeat(64),
      contextToken: 'e'.repeat(64),
    },
  };
  const first = await runHost({
    configPath,
    chunks: [Buffer.concat([
      encodeNativeMessage(request('task-start-0001', 'control.task.start', {
        submissionId: taskId,
        text: '차트 열어줘',
      }), MAX_MESSAGE_BYTES),
      encodeNativeMessage(request('task-next-00001', 'control.task.next', {
        taskId,
        expectedRevision: 1,
        observation: controlObservation,
      }), MAX_MESSAGE_BYTES),
    ])],
  });
  assert.equal(first.exitCode, 0, first.stderr);
  assert.equal(first.stderr, '');
  const responses = decodeOutput(first.stdout);
  assert.equal(responses[0].result.task.status, 'ready');
  assert.equal(responses[1].result.task.status, 'awaiting_receipt');
  const proposal = responses[1].result.outcome.proposal;
  const stepId = responses[1].result.task.steps[0].id;

  const receipt = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    proposalId: proposal.id,
    catalogVersion: proposal.catalogVersion,
    actionId: proposal.actionId,
    args: proposal.args,
    before: proposal.observation,
    after: null,
    status: 'unverified',
    reason: 'EXECUTION_ERROR',
    completedAt: new Date().toISOString(),
  };
  const restarted = await runHost({
    configPath,
    chunks: [Buffer.concat([
      encodeNativeMessage(request('task-get-000001', 'control.task.get', { taskId }), MAX_MESSAGE_BYTES),
      encodeNativeMessage(request('task-commit-001', 'control.task.step.commit', {
        taskId,
        stepId,
        expectedRevision: 2,
        receipt,
      }), MAX_MESSAGE_BYTES),
    ])],
  });
  assert.equal(restarted.exitCode, 0, restarted.stderr);
  assert.equal(restarted.stderr, '');
  const restartedResponses = decodeOutput(restarted.stdout);
  assert.equal(restartedResponses[0].result.task.activeProposal.id, proposal.id);
  assert.equal(restartedResponses[1].result.task.status, 'unverified');
  assert.equal(restartedResponses[1].result.receiptId, receipt.id);
});

test('two real host processes racing next and cancel publish exactly one task revision', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-host-task-race-'));
  const { configPath, dataDir } = await createConfig(root);
  const taskId = 'bebebebe-bebe-4ebe-8ebe-bebebebebebe';
  const start = await runHost({
    configPath,
    chunks: [encodeNativeMessage(request('task-race-start1', 'control.task.start', {
      submissionId: taskId,
      text: '차트 열어줘',
    }), MAX_MESSAGE_BYTES)],
  });
  assert.equal(start.exitCode, 0, start.stderr);
  assert.equal(decodeOutput(start.stdout)[0].ok, true);
  const controlObservation = {
    id: 'cececece-cece-4ece-8ece-cececececece',
    capturedAt: new Date().toISOString(),
    source: {
      origin: 'https://wts.kiwoom.com',
      path: '/',
      tabId: 10,
      windowId: 20,
      frameId: 0,
      documentId: 'race-document',
    },
    state: {
      screenId: 'main-other',
      activeTab: 'quote',
      period: 'none',
      blocked: false,
      chartOpenEnabled: true,
      periodEnabled: false,
      instrumentToken: 'd'.repeat(64),
      contextToken: 'e'.repeat(64),
    },
  };
  const [nextProcess, cancelProcess] = await Promise.all([
    runHost({
      configPath,
      chunks: [encodeNativeMessage(request('task-race-next01', 'control.task.next', {
        taskId,
        expectedRevision: 1,
        observation: controlObservation,
      }), MAX_MESSAGE_BYTES)],
    }),
    runHost({
      configPath,
      chunks: [encodeNativeMessage(request('task-race-cancel', 'control.task.cancel', {
        taskId,
        expectedRevision: 1,
        cancellationId: 'dededede-dede-4ede-8ede-dededededede',
      }), MAX_MESSAGE_BYTES)],
    }),
  ]);
  assert.equal(nextProcess.exitCode, 0, nextProcess.stderr);
  assert.equal(cancelProcess.exitCode, 0, cancelProcess.stderr);
  const responses = [
    decodeOutput(nextProcess.stdout)[0],
    decodeOutput(cancelProcess.stdout)[0],
  ];
  assert.equal(responses.filter((response) => response.ok).length, 1);
  const loser = responses.find((response) => !response.ok);
  assert.equal(loser.error.code, 'TASK_REVISION_CONFLICT');
  assert.deepEqual((await readdir(path.join(dataDir, 'tasks'))).sort(), [
    `${taskId}.1.json`,
    `${taskId}.2.json`,
  ]);
  const get = await runHost({
    configPath,
    chunks: [encodeNativeMessage(request('task-race-get001', 'control.task.get', { taskId }), MAX_MESSAGE_BYTES)],
  });
  const persisted = decodeOutput(get.stdout)[0].result.task;
  assert.deepEqual(persisted, responses.find((response) => response.ok).result.task);
});

test('host rejects unauthorized or missing caller origins before reading messages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-origin-'));
  const { configPath } = await createConfig(root);
  const frame = encodeNativeMessage(request('request-hello-02', 'runtime.hello'), MAX_MESSAGE_BYTES);

  for (const origin of ['chrome-extension://pppppppppppppppppppppppppppppppp/', '']) {
    const result = await runHost({ configPath, origin, chunks: [frame] });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, /CALLER_ORIGIN_(DENIED|REQUIRED)/u);
  }
});

test('host returns a strict protocol failure for an addressable version mismatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-version-'));
  const { configPath } = await createConfig(root);
  const invalid = {
    protocolVersion: 1,
    requestId: 'request-version-01',
    method: 'runtime.hello',
    params: {},
  };
  const result = await runHost({
    configPath,
    chunks: [encodeNativeMessage(invalid, MAX_MESSAGE_BYTES)],
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(decodeOutput(result.stdout)[0].error, {
    code: 'INVALID_PROTOCOL_MESSAGE',
    message: 'Request does not match the installed WTS protocol.',
  });
});

test('host fails closed for invalid JSON, oversize frames, and truncated frames', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-framing-'));
  const { configPath } = await createConfig(root);
  const badJson = Buffer.alloc(5);
  badJson.writeUInt32LE(1, 0);
  badJson[4] = 0x7b;
  const oversize = Buffer.alloc(4);
  oversize.writeUInt32LE(MAX_MESSAGE_BYTES + 1, 0);
  const valid = encodeNativeMessage(request('request-hello-03', 'runtime.hello'), MAX_MESSAGE_BYTES);

  const cases = [
    { chunks: [badJson], code: 'INVALID_JSON' },
    { chunks: [oversize], code: 'MESSAGE_TOO_LARGE' },
    { chunks: [valid.subarray(0, valid.length - 1)], code: 'TRUNCATED_MESSAGE' },
  ];
  for (const item of cases) {
    const result = await runHost({ configPath, chunks: item.chunks });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout.length, 0);
    assert.match(result.stderr, new RegExp(item.code, 'u'));
  }
});

test('host reports corrupt storage and an unwritable data path without claiming success', async () => {
  const corruptRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-corrupt-'));
  const corruptConfig = await createConfig(corruptRoot);
  const corruptCaptures = path.join(corruptConfig.dataDir, 'captures');
  await mkdir(corruptCaptures, { recursive: true });
  await writeFile(
    path.join(corruptCaptures, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'),
    '{broken',
    'utf8',
  );
  const corrupt = await runHost({
    configPath: corruptConfig.configPath,
    chunks: [
      encodeNativeMessage(request('request-summary-03', 'inventory.summary'), MAX_MESSAGE_BYTES),
    ],
  });
  assert.equal(corrupt.exitCode, 0, corrupt.stderr);
  assert.equal(decodeOutput(corrupt.stdout)[0].error.code, 'STORAGE_CORRUPT');

  const blockedRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-readonly-'));
  const blockingFile = path.join(blockedRoot, 'not-a-directory');
  await writeFile(blockingFile, 'read only boundary', 'utf8');
  const blockedConfig = await createConfig(blockedRoot, path.join(blockingFile, 'data'));
  const blocked = await runHost({
    configPath: blockedConfig.configPath,
    chunks: [
      encodeNativeMessage(
        request('request-record-03', 'inventory.record', { capture: capture() }),
        MAX_MESSAGE_BYTES,
      ),
    ],
  });
  assert.equal(blocked.exitCode, 0, blocked.stderr);
  assert.match(decodeOutput(blocked.stdout)[0].error.code, /^STORAGE_(?:READ|WRITE)_FAILED$/u);
});

test('same capture id with different metadata is rejected', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-conflict-'));
  const { configPath } = await createConfig(root);
  const changedObservation = observation();
  changedObservation.title = 'Changed';
  const changed = capture(undefined, [changedObservation]);
  const result = await runHost({
    configPath,
    chunks: [
      encodeNativeMessage(
        request('request-record-04', 'inventory.record', { capture: capture() }),
        MAX_MESSAGE_BYTES,
      ),
      encodeNativeMessage(
        request('request-record-05', 'inventory.record', { capture: changed }),
        MAX_MESSAGE_BYTES,
      ),
    ],
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const responses = decodeOutput(result.stdout);
  assert.equal(responses[0].ok, true);
  assert.equal(responses[1].error.code, 'CAPTURE_ID_CONFLICT');
});

test('stored inventory contains only the validated observation metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-sanitize-'));
  const { configPath, dataDir } = await createConfig(root);
  const result = await runHost({
    configPath,
    chunks: [
      encodeNativeMessage(
        request('request-record-06', 'inventory.record', { capture: capture() }),
        MAX_MESSAGE_BYTES,
      ),
    ],
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const stored = JSON.parse(await readFile(
    path.join(dataDir, 'captures', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json'),
    'utf8',
  ));
  assert.deepEqual(stored, capture());
  assert.doesNotMatch(JSON.stringify(stored), /password|cookie|account|inputValue|rawHtml/iu);
});

test('protocol rejects credential-like or arbitrary observation fields before storage', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-private-field-'));
  const { configPath } = await createConfig(root);
  const unsafe = { ...observation(), accountValue: 'must-not-store' };
  const result = await runHost({
    configPath,
    chunks: [
      encodeNativeMessage(
        request('request-record-07', 'inventory.record', {
          capture: capture(undefined, [unsafe]),
        }),
        MAX_MESSAGE_BYTES,
      ),
      encodeNativeMessage(request('request-summary-04', 'inventory.summary'), MAX_MESSAGE_BYTES),
    ],
  });
  assert.equal(result.exitCode, 0, result.stderr);
  const responses = decodeOutput(result.stdout);
  assert.equal(responses[0].error.code, 'INVALID_PROTOCOL_MESSAGE');
  assert.equal(responses[1].result.captureCount, 0);
  assert.equal(responses[1].result.observationCount, 0);
});

test('capture invariants reject partial batches and permit an idempotent retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-capture-'));
  const { configPath } = await createConfig(root);
  const retryId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const duplicate = capture(retryId, [
    observation(),
    observation('44444444-4444-4444-8444-444444444444', {
      documentId: 'new-document-same-frame',
    }),
  ]);
  const mixedTab = capture('dddddddd-dddd-4ddd-8ddd-dddddddddddd', [
    observation(),
    observation('55555555-5555-4555-8555-555555555555', { frameId: 1, tabId: 9 }),
  ]);
  const noTop = capture('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', [
    observation('66666666-6666-4666-8666-666666666666', { frameId: 1 }),
  ]);
  const validRetry = capture(retryId, [
    observation(),
    observation('77777777-7777-4777-8777-777777777777', { frameId: 1 }),
  ]);
  const requests = [duplicate, mixedTab, noTop, validRetry, validRetry]
    .map((item, index) => encodeNativeMessage(
      request(`request-capture-${index}`, 'inventory.record', { capture: item }),
      MAX_MESSAGE_BYTES,
    ));
  requests.push(
    encodeNativeMessage(request('request-capture-summary', 'inventory.summary'), MAX_MESSAGE_BYTES),
  );

  const result = await runHost({ configPath, chunks: requests });
  assert.equal(result.exitCode, 0, result.stderr);
  const responses = decodeOutput(result.stdout);
  assert.equal(responses[0].error.code, 'CAPTURE_INVALID');
  assert.equal(responses[1].error.code, 'CAPTURE_INVALID');
  assert.equal(responses[2].error.code, 'CAPTURE_INVALID');
  assert.equal(responses[3].result.observationCount, 2);
  assert.equal(responses[4].result.observationCount, 2);
  assert.equal(responses[5].result.captureCount, 1);
  assert.equal(responses[5].result.observationCount, 2);
});

test('temporary files are removed on write, sync, and close failures without masking the cause', async () => {
  for (const failurePoint of ['write', 'sync', 'close']) {
    const primary = Object.assign(new Error(`${failurePoint} failed`), { code: 'EIO' });
    const secondaryClose = Object.assign(new Error('secondary close failure'), { code: 'EIO' });
    const unlinked = [];
    const fileSystem = {
      async stat() {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      async readFile() {
        throw new Error('unexpected read');
      },
      async mkdir() {},
      async readdir() {
        return [];
      },
      async open() {
        return {
          async writeFile() {
            if (failurePoint === 'write') throw primary;
          },
          async sync() {
            if (failurePoint === 'sync') throw primary;
          },
          async close() {
            if (failurePoint === 'close') throw primary;
            if (failurePoint === 'write') throw secondaryClose;
          },
        };
      },
      async link() {
        throw new Error('link must not run after a file operation failure');
      },
      async unlink(filePath) {
        unlinked.push(filePath);
      },
    };
    const store = new InventoryStore('C:\\test-data', (value) => value, fileSystem);
    await assert.rejects(
      store.record(capture()),
      (error) => error.code === 'STORAGE_WRITE_FAILED' && error.cause === primary,
    );
    assert.equal(unlinked.length, 1, failurePoint);
    assert.match(unlinked[0], /\.tmp$/u);
  }
});

test('concurrent stores never overwrite different bodies under the same capture id', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-concurrent-conflict-'));
  const validateCapture = (value) => value;
  const firstStore = new InventoryStore(dataDir, validateCapture);
  const secondStore = new InventoryStore(dataDir, validateCapture);
  const captureId = '99999999-9999-4999-8999-999999999999';
  const first = capture(captureId);
  const changedObservation = observation();
  changedObservation.title = 'Different body';
  const second = capture(captureId, [changedObservation]);

  const settled = await Promise.allSettled([
    firstStore.record(first),
    secondStore.record(second),
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejection = settled.find((item) => item.status === 'rejected');
  assert.equal(rejection.reason.code, 'CAPTURE_ID_CONFLICT');

  const stored = JSON.parse(await readFile(
    path.join(dataDir, 'captures', `${captureId}.json`),
    'utf8',
  ));
  const successfulIndex = settled.findIndex((item) => item.status === 'fulfilled');
  assert.deepEqual(stored, successfulIndex === 0 ? first : second);
});

test('concurrent stores treat the same capture body as one idempotent success', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-concurrent-same-'));
  const validateCapture = (value) => value;
  const firstStore = new InventoryStore(dataDir, validateCapture);
  const secondStore = new InventoryStore(dataDir, validateCapture);
  const body = capture('88888888-8888-4888-8888-888888888888');

  const results = await Promise.all([
    firstStore.record(structuredClone(body)),
    secondStore.record(structuredClone(body)),
  ]);
  assert.deepEqual(results, [
    { captureId: body.id, observationCount: 1, stored: true },
    { captureId: body.id, observationCount: 1, stored: true },
  ]);
  const summary = await firstStore.summary();
  assert.equal(summary.captureCount, 1);
  assert.equal(summary.observationCount, 1);
});

test('owned pre-link and post-link temporary residue never becomes a capture or bricks inventory', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-temp-residue-'));
  const store = new InventoryStore(dataDir, (value) => value);
  const first = capture('12121212-1212-4212-8212-121212121212');
  const second = capture('34343434-3434-4434-8434-343434343434');
  await store.record(first);

  const capturesDir = path.join(dataDir, 'captures');
  const preLinkResidue = path.join(
    capturesDir,
    '.56565656-5656-4656-8656-565656565656.123-1700000000000-abcdef123456.tmp',
  );
  await writeFile(preLinkResidue, JSON.stringify(capture(
    '56565656-5656-4656-8656-565656565656',
  )), 'utf8');
  assert.deepEqual(await store.summary(), {
    captureCount: 1,
    observationCount: 1,
    lastObservedAt: first.capturedAt,
    coverage: 'partial',
    controlEnabled: true,
    layaReady: false,
  });

  await store.record(second);
  const postLinkResidue = path.join(
    capturesDir,
    `.${second.id}.456-1700000000001-fedcba654321.tmp`,
  );
  await writeFile(postLinkResidue, `${JSON.stringify(second)}\n`, 'utf8');
  assert.equal((await store.summary()).captureCount, 2);
  assert.deepEqual(await store.record(structuredClone(second)), {
    captureId: second.id,
    observationCount: 1,
    stored: true,
  });
  assert.equal((await store.summary()).captureCount, 2);
});


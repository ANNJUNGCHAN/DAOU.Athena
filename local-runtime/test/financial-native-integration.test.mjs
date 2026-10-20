import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FINANCIAL_API_VERSION,
  FINANCIAL_CARD_VERSION,
  FINANCIAL_ERROR_MESSAGES,
  FINANCIAL_METHODS,
  FINANCIAL_PROFILE,
  FINANCIAL_RENDER_KINDS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '../../contracts/wts-foundation.mjs';
import { BackendSupervisor } from '../src/backend-supervisor.mjs';
import { FinancialBackendSupervisor } from '../src/financial-backend-supervisor.mjs';
import { encodeNativeMessage, NativeMessageDecoder } from '../src/framing.mjs';
import { runNativeHost } from '../src/main.mjs';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';
const BACKEND_ROOT = fileURLToPath(new URL('../../backend/', import.meta.url));
const PYTHON_EXECUTABLE = path.join(BACKEND_ROOT, '.venv', 'Scripts', 'python.exe');
const TEMP_PREFIX = 'athena-wts-financial-native-';

function request(requestId, method, params = {}) {
  return { protocolVersion: PROTOCOL_VERSION, requestId, method, params };
}

function chartObservation() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    capturedAt: new Date().toISOString(),
    source: {
      origin: 'https://wts.kiwoom.com',
      path: '/',
      tabId: 1,
      windowId: 2,
      frameId: 0,
      documentId: 'document-0',
    },
    state: {
      screenId: 'main-other',
      activeTab: 'quote',
      period: 'none',
      blocked: false,
      chartOpenEnabled: true,
      periodEnabled: false,
      instrumentToken: 'f'.repeat(64),
      contextToken: 'a'.repeat(64),
    },
  };
}

function createResponseReader(stream) {
  const decoder = new NativeMessageDecoder(MAX_MESSAGE_BYTES);
  const queued = [];
  const waiting = [];
  let terminalError = null;

  const deliver = (value) => {
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(value);
    else queued.push(value);
  };
  const fail = (error) => {
    terminalError = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  };
  stream.on('data', (chunk) => {
    try {
      for (const payload of decoder.push(chunk)) {
        deliver(JSON.parse(payload.toString('utf8')));
      }
    } catch (error) {
      fail(error);
    }
  });
  stream.once('error', fail);

  return function nextResponse(timeoutMs = 40_000) {
    if (queued.length > 0) return Promise.resolve(queued.shift());
    if (terminalError) return Promise.reject(terminalError);
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(new Error('Timed out waiting for a native host response.'));
      }, timeoutMs);
      waiting.push(entry);
    });
  };
}

async function sendRequest(stdin, nextResponse, value) {
  if (!stdin.write(encodeNativeMessage(value, MAX_MESSAGE_BYTES))) {
    await once(stdin, 'drain');
  }
  return nextResponse();
}

async function waitForFinancialStatus(stdin, nextResponse) {
  const deadline = Date.now() + 40_000;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const response = await sendRequest(stdin, nextResponse, request(
      `financial-status-poll-${String(attempt).padStart(3, '0')}`,
      'source.credentials.status',
      { mutationId: null },
    ));
    if (response.ok) return response;
    assert.deepEqual(response.error, {
      code: 'FINANCIAL_BACKEND_STARTING',
      message: FINANCIAL_ERROR_MESSAGES.FINANCIAL_BACKEND_STARTING,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('Financial backend did not become ready within the bounded polling window.');
}

async function listRelativeFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)));
}

async function removeOwnedTemporaryRoot(root, tempBase) {
  const value = await lstat(root);
  const physicalRoot = await realpath(root);
  const physicalBase = await realpath(tempBase);
  const insideBase = physicalRoot.startsWith(`${physicalBase}${path.sep}`);
  if (!value.isDirectory() || value.isSymbolicLink() || !insideBase ||
      !path.basename(physicalRoot).startsWith(TEMP_PREFIX)) {
    return false;
  }
  await rm(physicalRoot, { recursive: true, maxRetries: 5, retryDelay: 100 });
  await assert.rejects(access(physicalRoot), { code: 'ENOENT' });
  return true;
}

test('real native host lazily starts isolated financial runtime and stops both owned children', {
  timeout: 120_000,
}, async () => {
  const tempBase = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(tempBase, TEMP_PREFIX));
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  const configPath = path.join(configDir, 'host-config.json');
  await mkdir(configDir);
  await mkdir(dataDir);
  assert.deepEqual(await readdir(dataDir), []);
  await writeFile(configPath, JSON.stringify({
    hostName: 'com.athena.wts',
    allowedOrigin: ORIGIN,
    dataDir,
    backendRoot: BACKEND_ROOT,
    pythonExecutable: PYTHON_EXECUTABLE,
  }), 'utf8');

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const nextResponse = createResponseReader(stdout);
  let metadataSupervisor = null;
  let financialSupervisor = null;
  let running = null;
  let cleanupSafe = false;
  try {
    running = runNativeHost({
      stdin,
      stdout,
      callerOrigin: ORIGIN,
      configPath,
      createSupervisor: (options) => {
        metadataSupervisor = new BackendSupervisor(options);
        return metadataSupervisor;
      },
      createFinancialSupervisor: (options) => {
        financialSupervisor = new FinancialBackendSupervisor(options);
        return financialSupervisor;
      },
    });

    const hello = await sendRequest(
      stdin,
      nextResponse,
      request('financial-native-hello', 'runtime.hello'),
    );
    assert.equal(hello.ok, true);
    assert.deepEqual(hello.result.financial, {
      configured: true,
      profile: FINANCIAL_PROFILE,
      apiVersion: FINANCIAL_API_VERSION,
      cardVersion: FINANCIAL_CARD_VERSION,
      methods: FINANCIAL_METHODS,
      renderKinds: FINANCIAL_RENDER_KINDS,
      queryOnly: true,
      credentialSetup: true,
      order: false,
      websocket: false,
      externalAi: false,
    });
    assert.deepEqual(metadataSupervisor.status(), {
      state: 'stopped',
      profile: 'wts-readonly-v1',
      apiVersion: null,
      catalogVersion: null,
      ownedChild: false,
    });
    assert.deepEqual(financialSupervisor.status(), {
      state: 'stopped',
      profile: FINANCIAL_PROFILE,
      apiVersion: null,
      catalogVersion: null,
      ownedChild: false,
    });

    const firstFinancial = await sendRequest(stdin, nextResponse, request(
      'financial-native-first-status',
      'source.credentials.status',
      { mutationId: null },
    ));
    assert.equal(firstFinancial.ok, false);
    assert.deepEqual(firstFinancial.error, {
      code: 'FINANCIAL_BACKEND_STARTING',
      message: FINANCIAL_ERROR_MESSAGES.FINANCIAL_BACKEND_STARTING,
    });
    assert.equal(metadataSupervisor.status().ownedChild, false);

    const status = await waitForFinancialStatus(stdin, nextResponse);
    assert.deepEqual(status.result, {
      profile: FINANCIAL_PROFILE,
      apiVersion: FINANCIAL_API_VERSION,
      catalogVersion: financialSupervisor.status().catalogVersion,
      profiles: [],
      mutation: null,
    });
    assert.match(status.result.catalogVersion, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(financialSupervisor.status(), {
      state: 'ready',
      profile: FINANCIAL_PROFILE,
      apiVersion: FINANCIAL_API_VERSION,
      catalogVersion: status.result.catalogVersion,
      ownedChild: true,
    });
    assert.equal(metadataSupervisor.status().ownedChild, false);

    const manifest = await sendRequest(
      stdin,
      nextResponse,
      request('financial-native-manifest', 'source.manifest'),
    );
    assert.equal(manifest.ok, true);
    assert.equal(manifest.result.profile, 'wts-readonly-v1');
    assert.equal(metadataSupervisor.status().state, 'ready');
    assert.equal(metadataSupervisor.status().ownedChild, true);
    assert.equal(financialSupervisor.status().ownedChild, true);

    const fixtureFiles = await listRelativeFiles(root);
    assert.equal(fixtureFiles.some((name) => path.basename(name) === 'credentials.dpapi'), false);
    assert.equal(fixtureFiles.some((name) => /app.?key|secret.?key|access.?token/iu.test(name)), false);

    stdin.end();
    await running;
    running = null;
    assert.equal(metadataSupervisor.status().state, 'stopped');
    assert.equal(metadataSupervisor.status().ownedChild, false);
    assert.equal(financialSupervisor.status().state, 'stopped');
    assert.equal(financialSupervisor.status().ownedChild, false);
  } finally {
    if (!stdin.destroyed && !stdin.writableEnded) stdin.end();
    if (running) await running.catch(() => {});
    await metadataSupervisor?.stop().catch(() => {});
    await financialSupervisor?.stop().catch(() => {});
    cleanupSafe = await removeOwnedTemporaryRoot(root, tempBase).catch(() => false);
    if (!cleanupSafe) {
      process.stderr.write(`Owned native integration temp directory was preserved: ${root}\n`);
    }
  }
  assert.equal(cleanupSafe, true);
});

test('pending financial recovery evidence leaves metadata and control native paths available', {
  timeout: 120_000,
}, async () => {
  const tempBase = await realpath(os.tmpdir());
  const root = await mkdtemp(path.join(tempBase, TEMP_PREFIX));
  const configDir = path.join(root, 'config');
  const dataDir = path.join(root, 'data');
  const vaultDir = path.join(dataDir, 'financial-read-v1');
  const configPath = path.join(configDir, 'host-config.json');
  await mkdir(configDir);
  await mkdir(vaultDir, { recursive: true });
  await writeFile(path.join(vaultDir, '.credentials.dpapi.pending'), 'opaque evidence', 'utf8');
  await writeFile(configPath, JSON.stringify({
    hostName: 'com.athena.wts',
    allowedOrigin: ORIGIN,
    dataDir,
    backendRoot: BACKEND_ROOT,
    pythonExecutable: PYTHON_EXECUTABLE,
  }), 'utf8');

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const nextResponse = createResponseReader(stdout);
  let financialSupervisor = null;
  let running = null;
  let cleanupSafe = false;
  try {
    running = runNativeHost({
      stdin,
      stdout,
      callerOrigin: ORIGIN,
      configPath,
      createFinancialSupervisor: (options) => {
        financialSupervisor = new FinancialBackendSupervisor(options);
        return financialSupervisor;
      },
    });

    const first = await sendRequest(stdin, nextResponse, request(
      'financial-recovery-first',
      'source.credentials.status',
      { mutationId: null },
    ));
    assert.deepEqual(first.error, {
      code: 'FINANCIAL_BACKEND_STARTING',
      message: FINANCIAL_ERROR_MESSAGES.FINANCIAL_BACKEND_STARTING,
    });

    let unavailable = null;
    for (let attempt = 1; attempt <= 20 && unavailable === null; attempt += 1) {
      const response = await sendRequest(stdin, nextResponse, request(
        `financial-recovery-poll-${String(attempt).padStart(2, '0')}`,
        'source.credentials.status',
        { mutationId: null },
      ));
      if (response.error?.code === 'VAULT_UNAVAILABLE') unavailable = response;
      else assert.equal(response.error?.code, 'FINANCIAL_BACKEND_STARTING');
      if (unavailable === null) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.notEqual(unavailable, null);
    assert.equal(financialSupervisor.status().ownedChild, false);

    const tracked = await sendRequest(stdin, nextResponse, request(
      'financial-recovery-tracked',
      'source.credentials.status',
      { mutationId: '44444444-4444-4444-8444-444444444444' },
    ));
    assert.deepEqual(tracked.error, {
      code: 'CREDENTIAL_MUTATION_NOT_FOUND',
      message: FINANCIAL_ERROR_MESSAGES.CREDENTIAL_MUTATION_NOT_FOUND,
    });

    const hello = await sendRequest(
      stdin,
      nextResponse,
      request('financial-recovery-hello', 'runtime.hello'),
    );
    assert.equal(hello.ok, true);
    const manifest = await sendRequest(
      stdin,
      nextResponse,
      request('financial-recovery-manifest', 'source.manifest'),
    );
    assert.equal(manifest.ok, true);
    const control = await sendRequest(stdin, nextResponse, request(
      'financial-recovery-control',
      'control.plan',
      { command: '차트 열어줘', observation: chartObservation() },
    ));
    assert.equal(control.ok, true, JSON.stringify(control.error ?? null));
    assert.equal(financialSupervisor.status().ownedChild, false);

    stdin.end();
    await running;
    running = null;
  } finally {
    if (!stdin.destroyed && !stdin.writableEnded) stdin.end();
    if (running) await running.catch(() => {});
    await financialSupervisor?.stop().catch(() => {});
    cleanupSafe = await removeOwnedTemporaryRoot(root, tempBase).catch(() => false);
    if (!cleanupSafe) {
      process.stderr.write(`Owned native integration temp directory was preserved: ${root}\n`);
    }
  }
  assert.equal(cleanupSafe, true);
});

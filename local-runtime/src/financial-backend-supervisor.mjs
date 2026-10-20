import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import {
  FINANCIAL_API_VERSION,
  FINANCIAL_CARD_VERSION,
  FINANCIAL_ERROR_CODES,
  FINANCIAL_ERROR_MESSAGES,
  FINANCIAL_METHODS,
  FINANCIAL_PROFILE,
  FINANCIAL_RENDER_KINDS,
} from '../../contracts/wts-foundation.mjs';

const ANNOUNCEMENT = 'ATHENA_BACKEND_URL=';
const MAX_STREAM_TAIL = 16 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const CATALOG_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const PENDING_MARKER_PARTS = Object.freeze([
  'financial-read-v1', '.credentials.dpapi.pending',
]);
const PYTHON_BOOTSTRAP = [
  'import runpy,sys',
  'sys.path.insert(0,sys.argv.pop(1))',
  "runpy.run_module('athena_api.launcher',run_name='__main__')",
].join(';');
const ENV_ALLOWLIST = Object.freeze({
  comspec: 'ComSpec',
  lang: 'LANG',
  lc_all: 'LC_ALL',
  path: 'PATH',
  pathext: 'PATHEXT',
  systemroot: 'SystemRoot',
  temp: 'TEMP',
  tmp: 'TMP',
  tmpdir: 'TMPDIR',
  windir: 'WINDIR',
});
const ROUTES = Object.freeze({
  'source.credentials.status': '/api/v1/financial/credentials/status',
  'source.credentials.configure': '/api/v1/financial/credentials/configure',
  'source.credentials.delete': '/api/v1/financial/credentials/delete',
  'source.query.start': '/api/v1/financial/query/start',
  'source.query.status': '/api/v1/financial/query/status',
  'source.query.page': '/api/v1/financial/query/page',
  'source.query.continue': '/api/v1/financial/query/continue',
  'source.query.cancel': '/api/v1/financial/query/cancel',
});
export class FinancialBackendSupervisorError extends Error {
  constructor(
    code,
    message = FINANCIAL_ERROR_MESSAGES[code] ?? FINANCIAL_ERROR_MESSAGES.INTERNAL_ERROR,
    options = {},
  ) {
    super(message, options);
    this.name = 'FinancialBackendSupervisorError';
    this.code = code;
  }
}

function safeError(code, options) {
  return new FinancialBackendSupervisorError(code, FINANCIAL_ERROR_MESSAGES[code], options);
}

function safeEnvironment(stateDir, token) {
  const environment = {};
  const inherited = new Map();
  for (const [name, value] of Object.entries(process.env)) {
    const lowerName = name.toLowerCase();
    if (typeof value === 'string' && Object.hasOwn(ENV_ALLOWLIST, lowerName)) {
      const current = inherited.get(lowerName);
      if (!current || name === ENV_ALLOWLIST[lowerName]) inherited.set(lowerName, { name, value });
    }
  }
  for (const [lowerName, entry] of inherited) environment[ENV_ALLOWLIST[lowerName]] = entry.value;
  Object.assign(environment, {
    ATHENA_LOCAL_BEARER_TOKEN: token,
    ATHENA_ENABLE_ORDER_API: 'false',
    ATHENA_BRAIN_ENABLED: 'false',
    ATHENA_ROUTINES_ENABLED: 'false',
    ATHENA_BACKTEST_ENABLED: 'false',
    ATHENA_BRAIN_USE_CLAUDE_CLI_EXTRACTION: 'false',
    ATHENA_LAYA_CATALOG_ENABLED: 'false',
    HOME: stateDir,
    USERPROFILE: stateDir,
    APPDATA: path.join(stateDir, 'appdata'),
    LOCALAPPDATA: path.join(stateDir, 'localappdata'),
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
  });
  return environment;
}

async function assertUnredirectedPath(target, label) {
  let physical;
  try {
    physical = await realpath(target);
  } catch (error) {
    throw safeError('INTERNAL_ERROR', { cause: error });
  }
  const requested = path.resolve(target);
  const matches = process.platform === 'win32'
    ? physical.toLowerCase() === requested.toLowerCase()
    : physical === requested;
  if (!matches) throw safeError('INTERNAL_ERROR');
  void label;
}

async function assertPhysical(target, kind, label) {
  let value;
  try {
    value = await lstat(target);
  } catch (error) {
    throw safeError('INTERNAL_ERROR', { cause: error });
  }
  const valid = kind === 'file' ? value.isFile() : value.isDirectory();
  if (!valid || value.isSymbolicLink()) throw safeError('INTERNAL_ERROR');
  await assertUnredirectedPath(target, label);
}

async function ensurePrivateDirectory(directory) {
  try {
    await assertPhysical(directory, 'directory', 'Financial backend state directory');
    return;
  } catch (error) {
    if (error.cause?.code !== 'ENOENT') throw error;
  }
  await assertPhysical(path.dirname(directory), 'directory', 'Financial backend state parent');
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw safeError('INTERNAL_ERROR', { cause: error });
  }
  await assertPhysical(directory, 'directory', 'Financial backend state directory');
}

function parseEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw safeError('INTERNAL_ERROR');
  }
  const port = Number(endpoint.port);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) || port < 1 || port > 65_535 || endpoint.username ||
      endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw safeError('INTERNAL_ERROR');
  }
  return endpoint.origin;
}

function strictCapabilities(value) {
  const expected = {
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
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !CATALOG_PATTERN.test(value.catalogVersion) ||
      Object.keys(value).sort().join(',') !== [...Object.keys(expected), 'catalogVersion'].sort().join(',') ||
      Object.entries(expected).some(([key, expectedValue]) =>
        JSON.stringify(value[key]) !== JSON.stringify(expectedValue))) {
    throw safeError('INTERNAL_ERROR');
  }
  return Object.freeze({
    apiVersion: FINANCIAL_API_VERSION,
    catalogVersion: value.catalogVersion,
  });
}

function cancellationError() {
  return safeError('QUERY_CANCELLED');
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw safeError('PAYLOAD_TOO_LARGE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw safeError('INTERNAL_ERROR');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw safeError('PAYLOAD_TOO_LARGE');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

function parseSafeBackendError(value) {
  const error = value?.error;
  if (!error || typeof error !== 'object' || Array.isArray(error) ||
      Object.keys(error).sort().join(',') !== 'code,message' ||
      !FINANCIAL_ERROR_CODES.includes(error.code) ||
      FINANCIAL_ERROR_MESSAGES[error.code] !== error.message) {
    return safeError('INTERNAL_ERROR');
  }
  return safeError(error.code);
}

export class FinancialBackendSupervisor {
  #backendRoot;
  #pythonExecutable;
  #dataDir;
  #stateDir;
  #startTimeoutMs;
  #requestTimeoutMs;
  #stopTimeoutMs;
  #child = null;
  #endpoint = null;
  #token = null;
  #state = 'stopped';
  #startPromise = null;
  #identity = null;
  #generation = 0;
  #recoveryRequired = false;
  #recoveryStopPromise = null;

  constructor({
    backendRoot,
    pythonExecutable,
    dataDir,
    stateDir,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  }) {
    if (![backendRoot, pythonExecutable, dataDir, stateDir].every((value) =>
      typeof value === 'string' && path.isAbsolute(value))) {
      throw safeError('INTERNAL_ERROR');
    }
    for (const value of [startTimeoutMs, requestTimeoutMs, stopTimeoutMs]) {
      if (!Number.isInteger(value) || value < 100 || value > 60_000) {
        throw safeError('INTERNAL_ERROR');
      }
    }
    this.#backendRoot = path.resolve(backendRoot);
    this.#pythonExecutable = path.resolve(pythonExecutable);
    this.#dataDir = path.resolve(dataDir);
    this.#stateDir = path.resolve(stateDir);
    this.#startTimeoutMs = startTimeoutMs;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#stopTimeoutMs = stopTimeoutMs;
  }

  status() {
    return Object.freeze({
      state: this.#state,
      profile: FINANCIAL_PROFILE,
      apiVersion: this.#identity?.apiVersion ?? null,
      catalogVersion: this.#identity?.catalogVersion ?? null,
      ownedChild: this.#child !== null,
    });
  }

  startInBackground() {
    if (this.#recoveryRequired) throw safeError('VAULT_UNAVAILABLE');
    if (this.#state === 'ready') return this.status();
    if (this.#state === 'failed') throw safeError('INTERNAL_ERROR');
    if (!this.#startPromise && this.#child) throw safeError('BUSY');
    if (!this.#startPromise) {
      const generation = this.#generation;
      this.#startPromise = this.#start(generation).finally(() => {
        this.#startPromise = null;
      });
      void this.#startPromise.catch(() => {});
    }
    return this.status();
  }

  #remainingStartupTime(generation, deadline) {
    if (generation !== this.#generation) throw cancellationError();
    const remaining = Math.ceil(deadline - Date.now());
    if (remaining < 100) throw safeError('OPERATION_TIMEOUT');
    return remaining;
  }

  #failLateProtocol(child) {
    if (this.#child !== child) return;
    this.#state = 'failed';
    void this.stop().then(() => { this.#state = 'failed'; }).catch(() => { this.#state = 'failed'; });
  }

  async #start(generation) {
    const deadline = Date.now() + this.#startTimeoutMs;
    this.#state = 'starting';
    try {
      await assertPhysical(this.#backendRoot, 'directory', 'Backend root');
      await assertPhysical(this.#pythonExecutable, 'file', 'Python executable');
      await assertPhysical(path.join(this.#backendRoot, 'athena_api', 'launcher.py'), 'file', 'Launcher');
      await assertPhysical(path.join(this.#backendRoot, 'athena_api', 'financial_read_app.py'), 'file', 'Financial app');
      await assertPhysical(this.#dataDir, 'directory', 'Native data directory');
      if (await this.#pendingMarkerExists()) {
        this.#recoveryRequired = true;
        throw safeError('VAULT_UNAVAILABLE');
      }
      await ensurePrivateDirectory(this.#stateDir);
      this.#remainingStartupTime(generation, deadline);
      const token = randomBytes(32).toString('base64url');
      const child = spawn(this.#pythonExecutable, [
        '-I', '-c', PYTHON_BOOTSTRAP, this.#backendRoot,
        '--profile', 'wts-financial-read',
        '--data-dir', this.#dataDir,
        '--host', '127.0.0.1',
        '--port', '0',
      ], {
        cwd: this.#stateDir,
        env: safeEnvironment(this.#stateDir, token),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: false,
      });
      this.#child = child;
      this.#token = token;
      this.#endpoint = await this.#awaitAnnouncement(
        child,
        this.#remainingStartupTime(generation, deadline),
      );
      child.once('exit', () => {
        if (this.#child === child) this.#clear('stopped');
      });
      const health = await this.#requestInternal(
        'GET', '/health', undefined,
        Math.min(this.#requestTimeoutMs, this.#remainingStartupTime(generation, deadline)),
      );
      if (!health || Object.keys(health).sort().join(',') !== 'profile,status' ||
          health.status !== 'ok' || health.profile !== FINANCIAL_PROFILE) {
        throw safeError('INTERNAL_ERROR');
      }
      const identity = strictCapabilities(await this.#requestInternal(
        'GET', '/api/v1/financial/capabilities', undefined,
        Math.min(this.#requestTimeoutMs, this.#remainingStartupTime(generation, deadline)),
      ));
      this.#remainingStartupTime(generation, deadline);
      this.#identity = identity;
      this.#state = 'ready';
      return this.status();
    } catch (error) {
      let failure = error;
      if (!this.#recoveryRequired && error instanceof FinancialBackendSupervisorError &&
          error.code === 'VAULT_UNAVAILABLE') {
        try {
          if (await this.#pendingMarkerExists()) this.#recoveryRequired = true;
        } catch (markerError) {
          failure = markerError;
        }
      }
      const cancelled = generation !== this.#generation;
      if (!cancelled) await this.stop().catch(() => {});
      this.#state = this.#recoveryRequired ? 'failed' : (cancelled ? 'stopped' : 'failed');
      if (failure instanceof FinancialBackendSupervisorError) throw failure;
      throw safeError('INTERNAL_ERROR', { cause: failure });
    }
  }

  #awaitAnnouncement(child, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let bufferedBytes = 0;
      let lineBuffer = '';
      let announcement = null;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) reject(error);
        else resolve(value);
      };
      const onError = (error) => finish(safeError('INTERNAL_ERROR', { cause: error }));
      const onExit = () => finish(safeError('INTERNAL_ERROR'));
      child.on('error', onError);
      child.on('exit', onExit);
      child.stderr.on('data', (chunk) => {
        bufferedBytes += Buffer.byteLength(chunk);
        if (bufferedBytes > MAX_STREAM_TAIL) {
          if (settled) this.#failLateProtocol(child);
          else finish(safeError('INTERNAL_ERROR'));
        }
      });
      child.stdout.on('data', (chunk) => {
        bufferedBytes += Buffer.byteLength(chunk);
        lineBuffer += Buffer.from(chunk).toString('utf8');
        if (bufferedBytes > MAX_STREAM_TAIL || Buffer.byteLength(lineBuffer, 'utf8') > MAX_STREAM_TAIL) {
          lineBuffer = '';
          if (settled) this.#failLateProtocol(child);
          else finish(safeError('INTERNAL_ERROR'));
          return;
        }
        const lines = lineBuffer.split(/\r?\n/u);
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith(ANNOUNCEMENT)) continue;
          if (announcement !== null) {
            if (settled) this.#failLateProtocol(child);
            else finish(safeError('INTERNAL_ERROR'));
            return;
          }
          try {
            announcement = parseEndpoint(line.slice(ANNOUNCEMENT.length));
          } catch (error) {
            finish(error);
            return;
          }
        }
        if (announcement !== null) finish(null, announcement);
      });
      timer = setTimeout(() => finish(safeError('OPERATION_TIMEOUT')), timeoutMs);
    });
  }

  async request(method, payload, { signal, timeoutMs = this.#requestTimeoutMs } = {}) {
    if (!Object.hasOwn(ROUTES, method)) throw safeError('REQUEST_INVALID');
    if (this.#recoveryRequired) throw this.#recoveryError(method, payload);
    if (this.#state !== 'ready' || !this.#child || !this.#endpoint || !this.#token) {
      this.startInBackground();
      throw safeError('FINANCIAL_BACKEND_STARTING');
    }
    const deadline = Date.now() + timeoutMs;
    try {
      return await this.#requestInternal('POST', ROUTES[method], payload, timeoutMs, signal);
    } catch (error) {
      const trackedStatusLost = error instanceof FinancialBackendSupervisorError &&
        error.code === 'CREDENTIAL_MUTATION_NOT_FOUND' &&
        method === 'source.credentials.status' &&
        payload && typeof payload === 'object' && !Array.isArray(payload) &&
        payload.mutationId !== null && payload.mutationId !== undefined;
      if (error instanceof FinancialBackendSupervisorError &&
          (error.code === 'VAULT_UNAVAILABLE' || trackedStatusLost) &&
          await this.#fatalVaultEvidence(deadline, signal)) {
        this.#latchRecoveryRequired();
        throw this.#recoveryError(method, payload);
      }
      throw error;
    }
  }

  #recoveryError(method, payload) {
    const trackedStatus = method === 'source.credentials.status' &&
      payload && typeof payload === 'object' && !Array.isArray(payload) &&
      payload.mutationId !== null && payload.mutationId !== undefined;
    return safeError(trackedStatus ? 'CREDENTIAL_MUTATION_NOT_FOUND' : 'VAULT_UNAVAILABLE');
  }

  async #pendingMarkerExists() {
    const marker = path.join(this.#dataDir, ...PENDING_MARKER_PARTS);
    try {
      await lstat(marker);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw safeError('INTERNAL_ERROR', { cause: error });
    }
  }

  async #fatalVaultEvidence(deadline, signal) {
    if (!await this.#pendingMarkerExists()) return false;
    const timeoutMs = Math.ceil(deadline - Date.now());
    if (timeoutMs < 100) return false;
    try {
      await this.#requestInternal('GET', '/health', undefined, timeoutMs, signal);
      return false;
    } catch (error) {
      return error instanceof FinancialBackendSupervisorError && error.code === 'VAULT_UNAVAILABLE';
    }
  }

  #latchRecoveryRequired() {
    this.#recoveryRequired = true;
    if (!this.#recoveryStopPromise) {
      this.#recoveryStopPromise = Promise.resolve()
        .then(() => this.stop())
        .catch(() => {})
        .finally(() => {
          this.#state = 'failed';
        });
    }
  }

  async #requestInternal(method, route, payload, timeoutMs, outerSignal) {
    if (!this.#endpoint || !this.#token || !this.#child ||
        !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw safeError('INTERNAL_ERROR');
    }
    if (outerSignal?.aborted) throw cancellationError();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(`${this.#endpoint}${route}`, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.#token}`,
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        body: method === 'POST' ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
      const bytes = await readBoundedResponse(response);
      let value;
      try {
        value = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw safeError('INTERNAL_ERROR', { cause: error });
      }
      if (!response.ok) throw parseSafeBackendError(value);
      return value;
    } catch (error) {
      if (error instanceof FinancialBackendSupervisorError) throw error;
      if (outerSignal?.aborted) throw cancellationError();
      if (timedOut) throw safeError('OPERATION_TIMEOUT');
      throw safeError('INTERNAL_ERROR', { cause: error });
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onAbort);
    }
  }

  async stop() {
    this.#generation += 1;
    const child = this.#child;
    if (!child) {
      this.#clear('stopped');
      return;
    }
    this.#state = 'stopping';
    const alreadyExited = child.exitCode !== null || child.signalCode !== null;
    const exited = alreadyExited ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve));
    if (!alreadyExited) child.kill();
    let timer;
    const graceful = alreadyExited || await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), this.#stopTimeoutMs); }),
    ]);
    clearTimeout(timer);
    if (!graceful && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([
        exited,
        new Promise((_, reject) => setTimeout(() => reject(safeError('INTERNAL_ERROR')), this.#stopTimeoutMs)),
      ]);
    }
    if (this.#child === child) this.#clear('stopped');
  }

  #clear(state) {
    this.#child = null;
    this.#endpoint = null;
    this.#token = null;
    this.#identity = null;
    this.#state = state;
  }
}

export const FINANCIAL_BACKEND_ROUTES = ROUTES;

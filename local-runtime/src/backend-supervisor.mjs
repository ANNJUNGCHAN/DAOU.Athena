import { randomBytes } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PROFILE = 'wts-readonly-v1';
const API_VERSION = 'selector-readonly-v1';
const ANNOUNCEMENT = 'ATHENA_BACKEND_URL=';
const MAX_STREAM_TAIL = 16 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_START_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
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
  health: { method: 'GET', path: '/health', body: false },
  capabilities: { method: 'GET', path: '/api/v1/readonly/capabilities', body: false },
  manifest: { method: 'GET', path: '/api/v1/readonly/manifest', body: false },
  search: { method: 'POST', path: '/api/v1/readonly/search', body: true },
  describe: { method: 'POST', path: '/api/v1/readonly/describe', body: true },
});

export class BackendSupervisorError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'BackendSupervisorError';
    this.code = code;
  }
}

function boundedTail(current, chunk) {
  const combined = Buffer.concat([current, Buffer.from(chunk)]);
  return combined.length <= MAX_STREAM_TAIL
    ? combined
    : combined.subarray(combined.length - MAX_STREAM_TAIL);
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

async function assertPhysicalFile(filePath, code, label) {
  let value;
  try {
    value = await lstat(filePath);
  } catch (error) {
    throw new BackendSupervisorError(code, `${label} is unavailable.`, { cause: error });
  }
  if (!value.isFile() || value.isSymbolicLink()) {
    throw new BackendSupervisorError(code, `${label} must be a physical file.`);
  }
  await assertUnredirectedPath(filePath, code, label);
}

async function assertPhysicalDirectory(directory, code, label) {
  let value;
  try {
    value = await lstat(directory);
  } catch (error) {
    throw new BackendSupervisorError(code, `${label} is unavailable.`, { cause: error });
  }
  if (!value.isDirectory() || value.isSymbolicLink()) {
    throw new BackendSupervisorError(code, `${label} must be a physical directory.`);
  }
  await assertUnredirectedPath(directory, code, label);
}

async function assertUnredirectedPath(target, code, label) {
  let physical;
  try {
    physical = await realpath(target);
  } catch (error) {
    throw new BackendSupervisorError(code, `${label} could not be resolved.`, { cause: error });
  }
  const requested = path.resolve(target);
  const matches = process.platform === 'win32'
    ? physical.toLowerCase() === requested.toLowerCase()
    : physical === requested;
  if (!matches) {
    throw new BackendSupervisorError(code, `${label} must not be redirected.`);
  }
}

async function ensurePrivateDirectory(directory) {
  try {
    await assertPhysicalDirectory(directory, 'BACKEND_CONFIG_INVALID', 'Backend state directory');
    return;
  } catch (error) {
    if (error?.cause?.code !== 'ENOENT') throw error;
  }
  await assertPhysicalDirectory(
    path.dirname(directory),
    'BACKEND_CONFIG_INVALID',
    'Backend state parent',
  );
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw new BackendSupervisorError(
        'BACKEND_CONFIG_INVALID',
        'Backend state directory could not be created.',
        { cause: error },
      );
    }
  }
  await assertPhysicalDirectory(directory, 'BACKEND_CONFIG_INVALID', 'Backend state directory');
}

function parseEndpoint(value) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw new BackendSupervisorError('BACKEND_PROTOCOL_INVALID', 'Backend announcement is invalid.');
  }
  const port = Number(endpoint.port);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !Number.isInteger(port) || port < 1 || port > 65_535 ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' ||
      endpoint.search || endpoint.hash) {
    throw new BackendSupervisorError('BACKEND_PROTOCOL_INVALID', 'Backend announcement is not loopback-only.');
  }
  return endpoint.origin;
}

function strictCapabilities(value) {
  const expected = {
    profile: PROFILE,
    apiVersion: API_VERSION,
    catalog: true,
    search: true,
    describe: true,
    financialQuery: false,
    credentials: false,
    externalAi: false,
    jobs: false,
    order: false,
    websocket: false,
    canvasKinds: ['capability-list.v1', 'capability-detail.v1'],
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== Object.keys(expected).sort().join(',') ||
      Object.entries(expected).some(([key, expectedValue]) =>
        JSON.stringify(value[key]) !== JSON.stringify(expectedValue))) {
    throw new BackendSupervisorError('BACKEND_CAPABILITY_MISMATCH', 'Backend capabilities are not read-only.');
  }
  return value;
}

function validateManifestIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.profile !== PROFILE || value.apiVersion !== API_VERSION ||
      typeof value.catalogVersion !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/u.test(value.catalogVersion) ||
      !Array.isArray(value.operations) || value.operations.length < 1) {
    throw new BackendSupervisorError('BACKEND_RESPONSE_INVALID', 'Backend manifest identity is invalid.');
  }
  return value.catalogVersion;
}

function cancellationError() {
  return new BackendSupervisorError('BACKEND_CANCELLED', 'Backend operation was cancelled.');
}

async function readBoundedResponse(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new BackendSupervisorError('BACKEND_RESPONSE_TOO_LARGE', 'Backend response is too large.');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new BackendSupervisorError('BACKEND_RESPONSE_INVALID', 'Backend response body is unavailable.');
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
        throw new BackendSupervisorError(
          'BACKEND_RESPONSE_TOO_LARGE',
          'Backend response is too large.',
        );
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export class BackendSupervisor {
  #backendRoot;
  #pythonExecutable;
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

  constructor({
    backendRoot,
    pythonExecutable,
    stateDir,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
  }) {
    if (![backendRoot, pythonExecutable, stateDir].every((value) =>
      typeof value === 'string' && path.isAbsolute(value))) {
      throw new BackendSupervisorError(
        'BACKEND_CONFIG_INVALID',
        'Backend root, Python executable, and state directory must be absolute paths.',
      );
    }
    for (const [name, value] of Object.entries({ startTimeoutMs, requestTimeoutMs, stopTimeoutMs })) {
      if (!Number.isInteger(value) || value < 100 || value > 60_000) {
        throw new BackendSupervisorError('BACKEND_CONFIG_INVALID', `${name} is outside its bounded range.`);
      }
    }
    this.#backendRoot = path.resolve(backendRoot);
    this.#pythonExecutable = path.resolve(pythonExecutable);
    this.#stateDir = path.resolve(stateDir);
    this.#startTimeoutMs = startTimeoutMs;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#stopTimeoutMs = stopTimeoutMs;
  }

  status() {
    return Object.freeze({
      state: this.#state,
      profile: PROFILE,
      apiVersion: this.#identity?.apiVersion ?? null,
      catalogVersion: this.#identity?.catalogVersion ?? null,
      ownedChild: this.#child !== null,
    });
  }

  async ensure({ signal } = {}) {
    if (signal?.aborted) throw cancellationError();
    if (this.#state === 'ready' && this.#child && this.#endpoint && this.#token) {
      return this.status();
    }
    if (!this.#startPromise && this.#child) {
      throw new BackendSupervisorError(
        'BACKEND_LIFECYCLE_BUSY',
        'Owned backend child is still stopping or requires cleanup.',
      );
    }
    if (!this.#startPromise) {
      const generation = this.#generation;
      this.#startPromise = this.#start(generation).finally(() => {
        this.#startPromise = null;
      });
    }
    if (!signal) return this.#startPromise;
    return Promise.race([
      this.#startPromise,
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(cancellationError()), { once: true });
      }),
    ]);
  }

  #assertGeneration(generation) {
    if (generation !== this.#generation) {
      throw new BackendSupervisorError(
        'BACKEND_START_CANCELLED',
        'Read-only backend startup was cancelled.',
      );
    }
  }

  #remainingStartupTime(generation, deadline) {
    this.#assertGeneration(generation);
    const remaining = Math.ceil(deadline - Date.now());
    if (remaining < 100) {
      throw new BackendSupervisorError(
        'BACKEND_START_TIMEOUT',
        'Read-only backend did not become ready in time.',
      );
    }
    return remaining;
  }

  #failLateProtocol(child) {
    if (this.#child !== child) return;
    this.#state = 'failed';
    void this.stop().then(() => {
      if (this.#state === 'stopped') this.#state = 'failed';
    }).catch(() => {
      this.#state = 'failed';
    });
  }

  async #start(generation) {
    const deadline = Date.now() + this.#startTimeoutMs;
    this.#state = 'starting';
    try {
      await assertPhysicalDirectory(this.#backendRoot, 'BACKEND_CONFIG_INVALID', 'Backend root');
      this.#remainingStartupTime(generation, deadline);
      await assertPhysicalFile(this.#pythonExecutable, 'BACKEND_CONFIG_INVALID', 'Python executable');
      this.#remainingStartupTime(generation, deadline);
      await assertPhysicalFile(
        path.join(this.#backendRoot, 'athena_api', 'launcher.py'),
        'BACKEND_CONFIG_INVALID',
        'Read-only backend launcher',
      );
      this.#remainingStartupTime(generation, deadline);
      await assertPhysicalFile(
        path.join(this.#backendRoot, 'athena_api', 'readonly_app.py'),
        'BACKEND_CONFIG_INVALID',
        'Read-only backend application',
      );
      this.#remainingStartupTime(generation, deadline);
      await ensurePrivateDirectory(this.#stateDir);
      this.#remainingStartupTime(generation, deadline);
      await Promise.all([
        assertPhysicalDirectory(this.#backendRoot, 'BACKEND_CONFIG_INVALID', 'Backend root'),
        assertPhysicalFile(this.#pythonExecutable, 'BACKEND_CONFIG_INVALID', 'Python executable'),
        assertPhysicalFile(
          path.join(this.#backendRoot, 'athena_api', 'launcher.py'),
          'BACKEND_CONFIG_INVALID',
          'Read-only backend launcher',
        ),
        assertPhysicalFile(
          path.join(this.#backendRoot, 'athena_api', 'readonly_app.py'),
          'BACKEND_CONFIG_INVALID',
          'Read-only backend application',
        ),
        assertPhysicalDirectory(this.#stateDir, 'BACKEND_CONFIG_INVALID', 'Backend state directory'),
      ]);
      this.#remainingStartupTime(generation, deadline);
      const token = randomBytes(32).toString('base64url');
      const child = spawn(this.#pythonExecutable, [
        '-I', '-c', PYTHON_BOOTSTRAP, this.#backendRoot,
        '--profile', 'wts-readonly',
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
      this.#remainingStartupTime(generation, deadline);
      child.once('exit', () => {
        if (this.#child === child) this.#clear('stopped');
      });
      const health = await this.#request(
        'health', undefined, Math.min(
          this.#requestTimeoutMs,
          this.#remainingStartupTime(generation, deadline),
        ),
      );
      this.#remainingStartupTime(generation, deadline);
      if (!health || health.status !== 'ok' || health.profile !== PROFILE) {
        throw new BackendSupervisorError('BACKEND_RESPONSE_INVALID', 'Backend health response is invalid.');
      }
      strictCapabilities(await this.#request(
        'capabilities', undefined, Math.min(
          this.#requestTimeoutMs,
          this.#remainingStartupTime(generation, deadline),
        ),
      ));
      this.#remainingStartupTime(generation, deadline);
      const catalogVersion = validateManifestIdentity(
        await this.#request(
          'manifest', undefined, Math.min(
            this.#requestTimeoutMs,
            this.#remainingStartupTime(generation, deadline),
          ),
        ),
      );
      this.#remainingStartupTime(generation, deadline);
      this.#identity = { apiVersion: API_VERSION, catalogVersion };
      this.#state = 'ready';
      return this.status();
    } catch (error) {
      const cancelled = generation !== this.#generation;
      let cleanupError = null;
      if (!cancelled) {
        try {
          await this.stop();
        } catch (stopError) {
          cleanupError = stopError;
        }
      }
      this.#state = cancelled ? 'stopped' : 'failed';
      if (cleanupError) {
        throw new BackendSupervisorError(
          'BACKEND_CLEANUP_FAILED',
          'Read-only backend failed and its owned child could not be confirmed stopped.',
        );
      }
      if (error instanceof BackendSupervisorError) throw error;
      throw new BackendSupervisorError('BACKEND_START_FAILED', 'Read-only backend could not start.', {
        cause: error,
      });
    }
  }

  #awaitAnnouncement(child, timeoutMs) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdoutTail = Buffer.alloc(0);
      let stderrTail = Buffer.alloc(0);
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
      const onError = (error) => finish(new BackendSupervisorError(
        'BACKEND_START_FAILED', 'Read-only backend process could not be created.', { cause: error },
      ));
      const onExit = () => finish(new BackendSupervisorError(
        'BACKEND_EXITED', 'Read-only backend exited before becoming ready.',
      ));
      child.on('error', onError);
      child.on('exit', onExit);
      child.stderr.on('data', (chunk) => {
        stderrTail = boundedTail(stderrTail, chunk);
      });
      child.stdout.on('data', (chunk) => {
        stdoutTail = boundedTail(stdoutTail, chunk);
        lineBuffer += Buffer.from(chunk).toString('utf8');
        if (Buffer.byteLength(lineBuffer, 'utf8') > MAX_STREAM_TAIL) {
          lineBuffer = '';
          const error = new BackendSupervisorError(
            'BACKEND_PROTOCOL_INVALID',
            'Backend startup output is too large.',
          );
          if (settled) this.#failLateProtocol(child);
          else finish(error);
          return;
        }
        const lines = lineBuffer.split(/\r?\n/u);
        lineBuffer = lines.pop() ?? '';
        let chunkAnnouncement = null;
        for (const line of lines) {
          if (!line.startsWith(ANNOUNCEMENT)) continue;
          if (announcement !== null || chunkAnnouncement !== null) {
            const error = new BackendSupervisorError(
              'BACKEND_PROTOCOL_INVALID',
              'Backend announced more than once.',
            );
            if (settled) {
              this.#failLateProtocol(child);
            } else {
              finish(error);
            }
            return;
          }
          try {
            chunkAnnouncement = parseEndpoint(line.slice(ANNOUNCEMENT.length));
          } catch (error) {
            finish(error);
            return;
          }
        }
        if (chunkAnnouncement !== null) {
          announcement = chunkAnnouncement;
          finish(null, announcement);
        }
      });
      timer = setTimeout(() => finish(new BackendSupervisorError(
        'BACKEND_START_TIMEOUT', 'Read-only backend did not become ready in time.',
      )), timeoutMs);
      void stdoutTail;
      void stderrTail;
    });
  }

  async request(operation, payload, { signal, timeoutMs = this.#requestTimeoutMs } = {}) {
    if (!Object.hasOwn(ROUTES, operation)) {
      throw new BackendSupervisorError('BACKEND_OPERATION_NOT_ALLOWED', 'Backend operation is not allowed.');
    }
    await this.ensure({ signal });
    return this.#request(operation, payload, timeoutMs, signal);
  }

  async #request(operation, payload, timeoutMs, outerSignal) {
    const route = ROUTES[operation];
    if (!route || !this.#endpoint || !this.#token || !this.#child) {
      throw new BackendSupervisorError('BACKEND_NOT_READY', 'Read-only backend is not ready.');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
      throw new BackendSupervisorError('BACKEND_REQUEST_INVALID', 'Backend timeout is outside its bounded range.');
    }
    if (route.body !== (payload !== undefined)) {
      throw new BackendSupervisorError('BACKEND_REQUEST_INVALID', 'Backend operation payload is invalid.');
    }
    if (outerSignal?.aborted) throw cancellationError();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onAbort = () => controller.abort();
    outerSignal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetch(`${this.#endpoint}${route.path}`, {
        method: route.method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${this.#token}`,
          ...(route.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: route.body ? JSON.stringify(payload) : undefined,
        signal: controller.signal,
      });
      const bytes = await readBoundedResponse(response);
      let value;
      try {
        value = JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        throw new BackendSupervisorError('BACKEND_RESPONSE_INVALID', 'Backend returned invalid JSON.', {
          cause: error,
        });
      }
      if (!response.ok) {
        const code = response.status === 401
          ? 'BACKEND_AUTH_FAILED'
          : response.status === 404
            ? 'BACKEND_NOT_FOUND'
            : response.status === 422
              ? 'BACKEND_REQUEST_REJECTED'
              : 'BACKEND_REQUEST_FAILED';
        throw new BackendSupervisorError(code, 'Read-only backend rejected the request.');
      }
      return value;
    } catch (error) {
      if (error instanceof BackendSupervisorError) throw error;
      if (outerSignal?.aborted) throw cancellationError();
      if (timedOut) {
        throw new BackendSupervisorError('BACKEND_REQUEST_TIMEOUT', 'Read-only backend request timed out.');
      }
      throw new BackendSupervisorError('BACKEND_REQUEST_FAILED', 'Read-only backend request failed.', {
        cause: error,
      });
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
    const exited = alreadyExited
      ? Promise.resolve()
      : new Promise((resolve) => child.once('exit', resolve));
    if (!alreadyExited) child.kill();
    let timer;
    const graceful = alreadyExited || await Promise.race([
      exited.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), this.#stopTimeoutMs);
      }),
    ]);
    clearTimeout(timer);
    if (!graceful && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([
        exited,
        new Promise((_, reject) => setTimeout(() => reject(new BackendSupervisorError(
          'BACKEND_STOP_FAILED', 'Owned backend child did not stop in time.',
        )), this.#stopTimeoutMs)),
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

export const BACKEND_PROFILE = PROFILE;
export const BACKEND_API_VERSION = API_VERSION;

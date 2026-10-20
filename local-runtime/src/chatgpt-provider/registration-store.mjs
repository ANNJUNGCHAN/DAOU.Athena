import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const HELPER = fileURLToPath(new URL('../../scripts/openai-registration-store.ps1', import.meta.url));
const MAX_IO_BYTES = 4 * 1024;
const PROCESS_DEADLINE_MS = 10_000;
const HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEGACY_HOST_ID = /^[A-Za-z0-9_-]{43}$/u;
const ISSUED_CLIENT_ID = /^oaiapp_[A-Za-z0-9._~-]{1,249}$/u;
const BINDING = /^[0-9a-f]{64}$/u;
const HELPER_CODES = new Set([
  'OPENAI_REGISTRATION_ACL_UNSAFE',
  'OPENAI_REGISTRATION_BINDING_CONFLICT',
  'OPENAI_REGISTRATION_CORRUPT',
  'OPENAI_REGISTRATION_IO_FAILED',
  'OPENAI_REGISTRATION_HOST_ID_UNSUPPORTED',
  'OPENAI_REGISTRATION_LOCK_TIMEOUT',
  'OPENAI_REGISTRATION_NOT_FOUND',
  'OPENAI_REGISTRATION_PATH_UNSAFE',
  'OPENAI_REGISTRATION_REQUEST_INVALID',
  'OPENAI_REGISTRATION_RESET_CONFLICT',
]);

class RegistrationStoreError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RegistrationStoreError';
    this.code = code;
  }
}

function fail(code) {
  throw new RegistrationStoreError(code);
}

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}

function validateSignalOptions(options) {
  let signal;
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    }
    const keys = Object.keys(options);
    if (keys.length > 1 || (keys.length === 1 && keys[0] !== 'signal')) {
      fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    }
    signal = keys.length === 0 ? undefined : options.signal;
  } catch (error) {
    if (error instanceof RegistrationStoreError) throw error;
    fail('OPENAI_REGISTRATION_REQUEST_INVALID');
  }
  if (signal !== undefined && (signal === null || typeof signal !== 'object')) {
    fail('OPENAI_REGISTRATION_REQUEST_INVALID');
  }
  if (signalAborted(signal)) fail('OPENAI_REGISTRATION_CANCELLED');
  return signal;
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try {
    const aborted = signal.aborted;
    if (typeof aborted !== 'boolean') fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    return aborted;
  } catch (error) {
    if (error instanceof RegistrationStoreError) throw error;
    fail('OPENAI_REGISTRATION_REQUEST_INVALID');
  }
}

function canonicalHostId(value) {
  return typeof value === 'string' && HOST_ID.test(value);
}

function isLegacyHostId(value) {
  if (typeof value !== 'string' || !LEGACY_HOST_ID.test(value)) return false;
  try {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === value;
  } catch {
    return false;
  }
}

function freezeDocument(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
      && isLegacyHostId(value.hostId)) {
    fail('OPENAI_REGISTRATION_HOST_ID_UNSUPPORTED');
  }
  if (!exactKeys(value, ['version', 'hostId', 'issuedClientId', 'accountBindingSha256'])
      || value.version !== 1 || !canonicalHostId(value.hostId)) {
    fail('OPENAI_REGISTRATION_OUTPUT_INVALID');
  }
  const unregistered = value.issuedClientId === null && value.accountBindingSha256 === null;
  const registered = typeof value.issuedClientId === 'string'
    && ISSUED_CLIENT_ID.test(value.issuedClientId)
    && typeof value.accountBindingSha256 === 'string'
    && BINDING.test(value.accountBindingSha256);
  if (!unregistered && !registered) fail('OPENAI_REGISTRATION_OUTPUT_INVALID');
  return Object.freeze({
    version: 1,
    hostId: value.hostId,
    issuedClientId: value.issuedClientId,
    accountBindingSha256: value.accountBindingSha256,
  });
}

async function assertTrustedPhysicalFile(target) {
  let item;
  let physical;
  try {
    [item, physical] = await Promise.all([lstat(target), realpath(target)]);
  } catch {
    fail('OPENAI_REGISTRATION_HELPER_UNAVAILABLE');
  }
  const same = process.platform === 'win32'
    ? physical.toLowerCase() === path.resolve(target).toLowerCase()
    : physical === path.resolve(target);
  if (!item.isFile() || item.isSymbolicLink() || !same) {
    fail('OPENAI_REGISTRATION_HELPER_UNAVAILABLE');
  }
}

function parseHelperError(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (exactKeys(parsed, ['code']) && HELPER_CODES.has(parsed.code)) {
      return new RegistrationStoreError(parsed.code);
    }
  } catch {
    // A malformed helper failure is intentionally collapsed to one safe code.
  }
  return new RegistrationStoreError('OPENAI_REGISTRATION_HELPER_FAILED');
}

function runChild(spawnImpl, operation, dataRoot, input) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(POWERSHELL, [
        '-NoLogo', '-NoProfile', '-NonInteractive',
        '-File', HELPER,
        '-Operation', operation,
        '-DataRoot', dataRoot,
      ], {
        shell: false,
        windowsHide: true,
        env: {
          SystemRoot: 'C:\\Windows',
          windir: 'C:\\Windows',
          PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      reject(new RegistrationStoreError('OPENAI_REGISTRATION_HELPER_UNAVAILABLE'));
      return;
    }
    if (!child?.stdin || !child.stdout || !child.stderr
        || typeof child.once !== 'function' || typeof child.kill !== 'function') {
      reject(new RegistrationStoreError('OPENAI_REGISTRATION_HELPER_UNAVAILABLE'));
      return;
    }

    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout = [];
    let overflow = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const append = (target, chunk, isStdout) => {
      const bytes = Buffer.from(chunk);
      if (isStdout) stdoutBytes += bytes.length;
      else stderrBytes += bytes.length;
      if (stdoutBytes > MAX_IO_BYTES || stderrBytes > MAX_IO_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      if (isStdout) target.push(bytes);
    };
    child.stdout.on('data', (chunk) => append(stdout, chunk, true));
    child.stderr.on('data', (chunk) => append([], chunk, false));
    child.once('error', () => finish(
      new RegistrationStoreError('OPENAI_REGISTRATION_HELPER_UNAVAILABLE'),
    ));
    child.once('close', (code, signal) => {
      if (overflow) {
        finish(new RegistrationStoreError('OPENAI_REGISTRATION_OUTPUT_INVALID'));
        return;
      }
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout));
      } catch {
        finish(new RegistrationStoreError('OPENAI_REGISTRATION_OUTPUT_INVALID'));
        return;
      }
      if (code !== 0 || signal !== null) {
        finish(parseHelperError(text));
        return;
      }
      if (stderrBytes !== 0) {
        finish(new RegistrationStoreError('OPENAI_REGISTRATION_OUTPUT_INVALID'));
        return;
      }
      try {
        finish(null, freezeDocument(JSON.parse(text)));
      } catch (error) {
        finish(error instanceof RegistrationStoreError
          ? error : new RegistrationStoreError('OPENAI_REGISTRATION_OUTPUT_INVALID'));
      }
    });
    const timer = setTimeout(() => {
      child.kill();
      finish(new RegistrationStoreError('OPENAI_REGISTRATION_TIMEOUT'));
    }, PROCESS_DEADLINE_MS);
    try {
      child.stdin.end(input);
    } catch {
      child.kill();
      finish(new RegistrationStoreError('OPENAI_REGISTRATION_HELPER_FAILED'));
    }
  });
}

export class RegistrationStore {
  #dataRoot;
  #spawn;

  constructor({ dataRoot, spawnImpl = spawn } = {}) {
    if (process.platform !== 'win32' || typeof dataRoot !== 'string'
        || !/^[A-Za-z]:[\\/]/u.test(dataRoot) || !path.isAbsolute(dataRoot)
        || dataRoot.includes('\0')
        || typeof spawnImpl !== 'function') {
      fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    }
    this.#dataRoot = path.resolve(dataRoot);
    this.#spawn = spawnImpl;
  }

  ensureHost(options = {}) {
    return this.#invoke('ensure-host', undefined, options);
  }

  read(options = {}) {
    return this.#invoke('read', undefined, options);
  }

  bind(value, options = {}) {
    if (!exactKeys(value, ['issuedClientId', 'accountBindingSha256'])
        || typeof value.issuedClientId !== 'string'
        || !ISSUED_CLIENT_ID.test(value.issuedClientId)
        || typeof value.accountBindingSha256 !== 'string'
        || !BINDING.test(value.accountBindingSha256)) {
      fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    }
    return this.#invoke('bind', {
      issuedClientId: value.issuedClientId,
      accountBindingSha256: value.accountBindingSha256,
    }, options);
  }

  reset(value, options = {}) {
    if (!exactKeys(value, ['expectedIssuedClientId', 'expectedAccountBindingSha256'])
        || typeof value.expectedIssuedClientId !== 'string'
        || !ISSUED_CLIENT_ID.test(value.expectedIssuedClientId)
        || typeof value.expectedAccountBindingSha256 !== 'string'
        || !BINDING.test(value.expectedAccountBindingSha256)) {
      fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    }
    return this.#invoke('reset', {
      expectedIssuedClientId: value.expectedIssuedClientId,
      expectedAccountBindingSha256: value.expectedAccountBindingSha256,
    }, options);
  }

  async #invoke(operation, value, options) {
    const signal = validateSignalOptions(options);
    const input = value === undefined ? '' : JSON.stringify(value);
    if (Buffer.byteLength(input, 'utf8') > MAX_IO_BYTES) {
      fail('OPENAI_REGISTRATION_REQUEST_INVALID');
    }
    await Promise.all([
      assertTrustedPhysicalFile(POWERSHELL),
      assertTrustedPhysicalFile(HELPER),
    ]);
    if (signalAborted(signal)) fail('OPENAI_REGISTRATION_CANCELLED');
    let result;
    let failure;
    try {
      result = await runChild(this.#spawn, operation, this.#dataRoot, input);
    } catch (error) {
      failure = error;
    }
    if (signalAborted(signal)) fail('OPENAI_REGISTRATION_CANCELLED');
    if (failure) throw failure;
    return result;
  }
}

export const REGISTRATION_STORE_EXECUTABLE = POWERSHELL;
export const REGISTRATION_STORE_HELPER = HELPER;

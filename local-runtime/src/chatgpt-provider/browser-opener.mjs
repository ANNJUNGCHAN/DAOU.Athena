import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const HELPER = fileURLToPath(new URL('../../scripts/open-openai-authorization.ps1', import.meta.url));
const MAX_IO_BYTES = 4 * 1024;
const PROCESS_DEADLINE_MS = 10_000;
const URL_MAX_BYTES = 8 * 1024;

const BASE64URL_32 = /^[A-Za-z0-9_-]{43}$/u;
const HOST_ID = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const OAIA_CLIENT_ID = /^oaiapp_[A-Za-z0-9._~-]{1,249}$/u;
const REDIRECT_URI_PATTERN = /^http:\/\/127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])\/auth\/callback$/u;
const SCOPE_VALUE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const RESOURCE_VALUE = 'https://api.openai.com/v1';

export class BrowserOpenerError extends Error {
  constructor(code) {
    super(code);
    this.name = 'BrowserOpenerError';
    this.code = code;
  }
}

function fail(code) {
  throw new BrowserOpenerError(code);
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try {
    const aborted = signal.aborted;
    if (typeof aborted !== 'boolean') fail('OPENAI_OPENER_REQUEST_INVALID');
    return aborted;
  } catch (error) {
    if (error instanceof BrowserOpenerError) throw error;
    fail('OPENAI_OPENER_REQUEST_INVALID');
  }
}

function isCanonicalBase64Url32(value) {
  if (typeof value !== 'string' || !BASE64URL_32.test(value)) return false;
  try {
    const buf = Buffer.from(value, 'base64url');
    return buf.length === 32 && buf.toString('base64url') === value;
  } catch {
    return false;
  }
}

export function validateAuthorizationUrl(rawUrl) {
  if (typeof rawUrl !== 'string') fail('OPENAI_OPENER_REQUEST_INVALID');
  const buf = Buffer.from(rawUrl, 'utf8');
  if (buf.length === 0 || buf.length > URL_MAX_BYTES) fail('OPENAI_OPENER_REQUEST_INVALID');
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a || buf[i] === 0x0d) fail('OPENAI_OPENER_REQUEST_INVALID');
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    fail('OPENAI_OPENER_REQUEST_INVALID');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'auth.openai.com'
    || parsed.port !== '' || parsed.pathname !== '/api/accounts/authorize'
    || parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
    fail('OPENAI_OPENER_REQUEST_INVALID');
  }

  const searchParams = parsed.searchParams;
  const clientId = searchParams.get('client_id');
  if (!clientId) fail('OPENAI_OPENER_REQUEST_INVALID');

  const isDynamic = clientId === 'dynamic_agent_client';
  const isOaiApp = OAIA_CLIENT_ID.test(clientId);
  if (!isDynamic && !isOaiApp) fail('OPENAI_OPENER_REQUEST_INVALID');

  const paramKeys = [];
  for (const key of searchParams.keys()) {
    paramKeys.push(key);
  }
  const keySet = new Set(paramKeys);
  if (paramKeys.length !== keySet.size) fail('OPENAI_OPENER_REQUEST_INVALID');

  if (isDynamic) {
    if (keySet.size !== 11) fail('OPENAI_OPENER_REQUEST_INVALID');
    if (searchParams.get('agent_name_hint') !== 'ATHENA') fail('OPENAI_OPENER_REQUEST_INVALID');
  } else {
    if (keySet.size !== 10) fail('OPENAI_OPENER_REQUEST_INVALID');
    if (searchParams.has('agent_name_hint')) fail('OPENAI_OPENER_REQUEST_INVALID');
  }

  if (searchParams.get('response_type') !== 'code') fail('OPENAI_OPENER_REQUEST_INVALID');
  if (searchParams.get('code_challenge_method') !== 'S256') fail('OPENAI_OPENER_REQUEST_INVALID');
  if (searchParams.get('resource') !== RESOURCE_VALUE) fail('OPENAI_OPENER_REQUEST_INVALID');
  if (searchParams.get('scope') !== SCOPE_VALUE) fail('OPENAI_OPENER_REQUEST_INVALID');

  const redirectUri = searchParams.get('redirect_uri');
  if (!redirectUri || !REDIRECT_URI_PATTERN.test(redirectUri)) fail('OPENAI_OPENER_REQUEST_INVALID');

  if (!isCanonicalBase64Url32(searchParams.get('state'))) fail('OPENAI_OPENER_REQUEST_INVALID');
  if (!isCanonicalBase64Url32(searchParams.get('nonce'))) fail('OPENAI_OPENER_REQUEST_INVALID');
  if (!isCanonicalBase64Url32(searchParams.get('code_challenge'))) fail('OPENAI_OPENER_REQUEST_INVALID');
  if (!HOST_ID.test(searchParams.get('ext_agent_host_id') ?? '')) fail('OPENAI_OPENER_REQUEST_INVALID');

  return rawUrl;
}

async function assertTrustedPhysicalFile(target) {
  let item;
  let physical;
  try {
    [item, physical] = await Promise.all([lstat(target), realpath(target)]);
  } catch {
    fail('OPENAI_OPENER_HELPER_UNAVAILABLE');
  }
  const same = process.platform === 'win32'
    ? physical.toLowerCase() === path.resolve(target).toLowerCase()
    : physical === path.resolve(target);
  if (!item.isFile() || item.isSymbolicLink() || !same) {
    fail('OPENAI_OPENER_HELPER_UNAVAILABLE');
  }
}

export function createAuthorizationBrowserOpener({ spawnImpl = spawn } = {}) {
  if (typeof spawnImpl !== 'function') {
    fail('OPENAI_OPENER_REQUEST_INVALID');
  }

  return async function openBrowser(url, options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      fail('OPENAI_OPENER_REQUEST_INVALID');
    }
    const optionKeys = Object.keys(options);
    if (optionKeys.length > 1 || (optionKeys.length === 1 && optionKeys[0] !== 'signal')) {
      fail('OPENAI_OPENER_REQUEST_INVALID');
    }
    let signal;
    try {
      signal = options.signal;
    } catch {
      fail('OPENAI_OPENER_REQUEST_INVALID');
    }
    if (signal !== undefined && (signal === null || typeof signal !== 'object')) {
      fail('OPENAI_OPENER_REQUEST_INVALID');
    }
    if (signalAborted(signal)) {
      fail('OPENAI_OPENER_CANCELLED');
    }

    validateAuthorizationUrl(url);

    if (spawnImpl === spawn) {
      await assertTrustedPhysicalFile(POWERSHELL);
      await assertTrustedPhysicalFile(HELPER);
    }

    if (signalAborted(signal)) {
      fail('OPENAI_OPENER_CANCELLED');
    }

    return new Promise((resolve, reject) => {
      const deadlineAt = Date.now() + PROCESS_DEADLINE_MS;
      let settled = false;
      let deadlineTimer = null;
      let terminating = false;
      let terminalError = null;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks = [];
      let child;
      let childStdin;
      let signalAbortHandler = null;

      function settle(err, val) {
        if (settled) return;
        settled = true;
        if (deadlineTimer !== null) {
          clearTimeout(deadlineTimer);
          deadlineTimer = null;
        }
        if (signalAbortHandler && signal) {
          try {
            signal.removeEventListener('abort', signalAbortHandler);
          } catch {
            // Listener cleanup cannot replace the authoritative result.
          }
        }
        if (err) reject(err);
        else resolve(val);
      }

      function requestTermination(error) {
        if (settled || terminating) return;
        terminating = true;
        terminalError = error;
        try {
          child.kill();
        } catch {}
      }

      signalAbortHandler = () => {
        requestTermination(new BrowserOpenerError('OPENAI_OPENER_CANCELLED'));
      };

      const onStdout = (chunk) => {
        if (settled || terminating) return;
        let bytes;
        try {
          bytes = Buffer.from(chunk);
        } catch {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          return;
        }
        stdoutBytes += bytes.length;
        if (stdoutBytes > MAX_IO_BYTES) {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          return;
        }
        stdoutChunks.push(bytes);
      };

      const onStderr = (chunk) => {
        if (settled || terminating) return;
        let length;
        try {
          length = Buffer.from(chunk).length;
        } catch {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          return;
        }
        stderrBytes += length;
        if (stderrBytes > 0) {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
        }
      };

      const onError = () => {
        if (settled) return;
        if (terminating) return;
        settle(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
      };

      const onClose = (code, closeSignal) => {
        if (settled) return;
        if (terminating) {
          settle(terminalError);
          return;
        }
        if (code !== 0 || closeSignal !== null || stderrBytes !== 0) {
          settle(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          return;
        }
        const text = Buffer.concat(stdoutChunks).toString('utf8');
        if (text === 'ATHENA_OPENAI_LAUNCH_ACCEPTED\n') {
          settle(null, undefined);
        } else {
          settle(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
        }
      };

      const remaining = Math.max(0, deadlineAt - Date.now());
      deadlineTimer = setTimeout(() => {
        if (settled) return;
        if (!terminating) {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_TIMEOUT'));
        }
        if (!settled) settle(terminalError);
      }, remaining);

      try {
        child = spawnImpl(
          POWERSHELL,
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', HELPER],
          {
            shell: false,
            windowsHide: true,
            env: {
              SystemRoot: 'C:\\Windows',
              windir: 'C:\\Windows',
              PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        if (!child || typeof child !== 'object'
          || typeof child.kill !== 'function' || typeof child.on !== 'function') {
          settle(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          return;
        }
        child.on('error', onError);
        child.on('close', onClose);
        childStdin = child.stdin;
        const childStdout = child.stdout;
        const childStderr = child.stderr;
        if (!childStdin || typeof childStdin.end !== 'function'
          || !childStdout || typeof childStdout.on !== 'function'
          || !childStderr || typeof childStderr.on !== 'function') {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
        } else {
          childStdout.on('data', onStdout);
          childStderr.on('data', onStderr);
        }
        if (signal) signal.addEventListener('abort', signalAbortHandler, { once: true });
      } catch {
        try {
          if (child && typeof child.kill === 'function') {
            requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          } else {
            settle(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
          }
        } catch {
          settle(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
        }
        return;
      }

      try {
        if (signalAborted(signal)) {
          requestTermination(new BrowserOpenerError('OPENAI_OPENER_CANCELLED'));
        }
      } catch {
        requestTermination(new BrowserOpenerError('OPENAI_OPENER_REQUEST_INVALID'));
      }

      try {
        if (!terminating) childStdin.end(url + '\n', 'utf8');
      } catch {
        requestTermination(new BrowserOpenerError('OPENAI_OPENER_LAUNCH_FAILED'));
      }
    });
  };
}

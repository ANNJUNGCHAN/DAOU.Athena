import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { TokenSession } from './token-session.mjs';

const RESOURCE = 'https://api.openai.com/v1';
const DYNAMIC_CLIENT_ID = 'dynamic_agent_client';
const AGENT_NAME = 'ATHENA';
const CALLBACK_PATH = '/auth/callback';
const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const DEFAULT_ATTEMPT_DEADLINE_MS = 5 * 60 * 1_000;
const DEFAULT_EXCHANGE_DEADLINE_MS = 15_000;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1_024;
const ISSUED_CLIENT_PATTERN = /^oaiapp_[A-Za-z0-9._~-]{1,249}$/u;
const HOST_ID_PATTERN = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LEGACY_HOST_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export class OAuthSessionError extends Error {
  constructor(code, message = 'OpenAI 로그인을 안전하게 완료하지 못했습니다.') {
    super(message);
    this.name = 'OAuthSessionError';
    this.code = code;
  }
}

function failure(code, message) {
  return new OAuthSessionError(code, message);
}

function throwFailure(code, message) {
  throw failure(code, message);
}

function abortFailure(signal) {
  return signal.reason === 'deadline'
    ? failure('OPENAI_OAUTH_DEADLINE_EXCEEDED', 'OpenAI 로그인 제한 시간을 초과했습니다.')
    : failure('OPENAI_OAUTH_CANCELLED', 'OpenAI 로그인이 취소되었습니다.');
}

async function waitFor(value, signal) {
  if (signal.aborted) throw abortFailure(signal);
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(abortFailure(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(value), aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function base64url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function freshSecret(randomBytesImpl) {
  const value = randomBytesImpl(32);
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throwFailure('OPENAI_OAUTH_RANDOM_INVALID');
  }
  return base64url(value);
}

function constantTimeEqual(actual, expected) {
  const left = Buffer.from(actual, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

function exactHeaderCount(rawHeaders, wanted) {
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index]).toLowerCase() === wanted) count += 1;
  }
  return count;
}

function reply(response, statusCode) {
  const body = statusCode === 200
    ? 'OpenAI login received. You can close this window.'
    : 'OpenAI login request was not accepted.';
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    Connection: 'close',
  });
  response.end(body);
}

function callbackTuple(url, initial, expectedClientId) {
  const states = url.searchParams.getAll('state');
  if (states.length !== 1 || !/^[A-Za-z0-9_-]{43}$/u.test(states[0])) {
    return { authenticated: false };
  }
  const codes = url.searchParams.getAll('code');
  const errors = url.searchParams.getAll('error');
  const clientIds = url.searchParams.getAll('client_id');
  if (codes.length > 1 || errors.length > 1 || clientIds.length > 1
    || (codes.length === 1) === (errors.length === 1)) {
    return { authenticated: true, error: failure('OPENAI_OAUTH_CALLBACK_INVALID') };
  }
  if (errors.length === 1) {
    if (errors[0].length < 1 || errors[0].length > 1_024 || codes.length !== 0) {
      return { authenticated: true, error: failure('OPENAI_OAUTH_CALLBACK_INVALID') };
    }
    return { authenticated: true, error: failure('OPENAI_OAUTH_PROVIDER_DENIED') };
  }
  const code = codes[0];
  if (typeof code !== 'string' || code.length < 1 || code.length > 16_384
    || !/^[\x21-\x7e]+$/u.test(code)) {
    return { authenticated: true, error: failure('OPENAI_OAUTH_CALLBACK_INVALID') };
  }
  let issuedClientId = expectedClientId;
  if (initial) {
    if (clientIds.length !== 1 || !ISSUED_CLIENT_PATTERN.test(clientIds[0])) {
      return { authenticated: true, error: failure('OPENAI_OAUTH_CLIENT_ID_INVALID') };
    }
    [issuedClientId] = clientIds;
  } else if (clientIds.length === 1 && clientIds[0] !== expectedClientId) {
    return { authenticated: true, error: failure('OPENAI_OAUTH_CLIENT_ID_MISMATCH') };
  }
  return { authenticated: true, value: { code, issuedClientId } };
}

function validSecret(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 16_384
    && /^[\x21-\x7e]+$/u.test(value);
}

function validScope(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 2_048
    && /^[\x20-\x7e]+$/u.test(value)
    && value.split(/ +/u).includes(DIRECT_SCOPE);
}

async function readTokenResponse(response, signal) {
  if (!response || response.ok !== true) throwFailure('OPENAI_OAUTH_TOKEN_HTTP_ERROR');
  let text = '';
  let reader;
  try {
    reader = response.body?.getReader?.();
    if (!reader) throw new Error('invalid');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0;
    while (true) {
      const part = await waitFor(reader.read(), signal);
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error('invalid');
      total += part.value.byteLength;
      if (total > MAX_TOKEN_RESPONSE_BYTES) throw new Error('invalid');
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof OAuthSessionError) throw error;
    throwFailure('OPENAI_OAUTH_TOKEN_RESPONSE_INVALID');
  } finally {
    if (reader) {
      try {
        const cancelled = reader.cancel();
        cancelled?.catch?.(() => {});
      } catch {
        // Cleanup cannot replace the authoritative token response result.
      }
      try {
        reader.releaseLock();
      } catch {
        // Synthetic readers may not expose a releasable lock.
      }
    }
  }
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_TOKEN_RESPONSE_BYTES) {
    throwFailure('OPENAI_OAUTH_TOKEN_RESPONSE_INVALID');
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throwFailure('OPENAI_OAUTH_TOKEN_RESPONSE_INVALID');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !validSecret(payload.access_token) || !validSecret(payload.refresh_token)
    || typeof payload.id_token !== 'string' || payload.id_token.length < 1
    || Buffer.byteLength(payload.id_token, 'utf8') > 64 * 1_024
    || payload.token_type !== 'Bearer'
    || !Number.isSafeInteger(payload.expires_in)
    || payload.expires_in < 1 || payload.expires_in > 86_400
    || !validScope(payload.scope)) {
    throwFailure('OPENAI_OAUTH_TOKEN_RESPONSE_INVALID');
  }
  return payload;
}

function bindingHash(issuer, issuedClientId, subject) {
  return createHash('sha256')
    .update(JSON.stringify([issuer, issuedClientId, subject]), 'utf8')
    .digest('hex');
}

function isLegacyHostId(value) {
  if (typeof value !== 'string' || !LEGACY_HOST_ID_PATTERN.test(value)) return false;
  try {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.byteLength === 32 && bytes.toString('base64url') === value;
  } catch {
    return false;
  }
}

function validateMetadata(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)
    && isLegacyHostId(value.hostId)) {
    throwFailure(
      'OPENAI_OAUTH_REGISTRATION_HOST_ID_UNSUPPORTED',
      '저장된 이전 OpenAI 연결 식별자는 자동 변환할 수 없습니다. 기존 등록 파일을 안전하게 제거한 뒤 다시 연결해 주세요.',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join('\0') !== [
      'version', 'hostId', 'issuedClientId', 'accountBindingSha256',
    ].sort().join('\0')
    || value.version !== 1 || typeof value.hostId !== 'string'
    || !HOST_ID_PATTERN.test(value.hostId)) {
    throwFailure('OPENAI_OAUTH_REGISTRATION_INVALID');
  }
  const unregistered = value.issuedClientId === null && value.accountBindingSha256 === null;
  const registered = ISSUED_CLIENT_PATTERN.test(value.issuedClientId)
    && typeof value.accountBindingSha256 === 'string'
    && /^[a-f0-9]{64}$/u.test(value.accountBindingSha256);
  if (!unregistered && !registered) throwFailure('OPENAI_OAUTH_REGISTRATION_INVALID');
  return value;
}

export class OAuthSession {
  #store;
  #verifier;
  #fetch;
  #openBrowser;
  #tokenSessionFactory;
  #randomBytes;
  #now;
  #attemptDeadlineMs;
  #exchangeDeadlineMs;
  #setTimeout;
  #clearTimeout;
  #generation = 0;
  #active = null;

  constructor({
    registrationStore,
    openIdVerifier,
    fetchImpl = globalThis.fetch,
    openBrowser,
    tokenSessionFactory = (options) => new TokenSession(options),
    randomBytesImpl = randomBytes,
    now = Date.now,
    attemptDeadlineMs = DEFAULT_ATTEMPT_DEADLINE_MS,
    exchangeDeadlineMs = DEFAULT_EXCHANGE_DEADLINE_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    if (!registrationStore || typeof registrationStore.ensureHost !== 'function'
      || typeof registrationStore.bind !== 'function'
      || !openIdVerifier || typeof openIdVerifier.getConfiguration !== 'function'
      || typeof openIdVerifier.verify !== 'function'
      || typeof fetchImpl !== 'function' || typeof openBrowser !== 'function'
      || typeof tokenSessionFactory !== 'function' || typeof randomBytesImpl !== 'function'
      || typeof now !== 'function' || typeof setTimeoutImpl !== 'function'
      || typeof clearTimeoutImpl !== 'function'
      || !Number.isSafeInteger(attemptDeadlineMs) || attemptDeadlineMs < 1
      || attemptDeadlineMs > DEFAULT_ATTEMPT_DEADLINE_MS
      || !Number.isSafeInteger(exchangeDeadlineMs) || exchangeDeadlineMs < 1
      || exchangeDeadlineMs > 60_000) {
      throwFailure('OPENAI_OAUTH_SESSION_INVALID');
    }
    this.#store = registrationStore;
    this.#verifier = openIdVerifier;
    this.#fetch = fetchImpl;
    this.#openBrowser = openBrowser;
    this.#tokenSessionFactory = tokenSessionFactory;
    this.#randomBytes = randomBytesImpl;
    this.#now = now;
    this.#attemptDeadlineMs = attemptDeadlineMs;
    this.#exchangeDeadlineMs = exchangeDeadlineMs;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
  }

  get active() {
    return this.#active !== null;
  }

  cancel() {
    if (!this.#active) return false;
    if (!this.#active.controller.signal.aborted) this.#active.controller.abort('cancelled');
    return true;
  }

  async connect({ signal } = {}) {
    if (this.#active) throwFailure('OPENAI_OAUTH_BUSY', '다른 OpenAI 로그인이 진행 중입니다.');
    if (signal?.aborted) throw abortFailure(signal);
    const generation = ++this.#generation;
    const controller = new AbortController();
    const active = { generation, controller, listener: null };
    this.#active = active;
    const deadline = this.#setTimeout(() => controller.abort('deadline'), this.#attemptDeadlineMs);
    const cancelFromCaller = () => controller.abort('cancelled');
    signal?.addEventListener('abort', cancelFromCaller, { once: true });
    try {
      let metadata;
      let configuration;
      try {
        [metadata, configuration] = await Promise.all([
          waitFor(this.#store.ensureHost({ signal: controller.signal }), controller.signal),
          waitFor(this.#verifier.getConfiguration({ signal: controller.signal }), controller.signal),
        ]);
      } catch (error) {
        if (error instanceof OAuthSessionError) throw error;
        if (controller.signal.aborted) throw abortFailure(controller.signal);
        throwFailure('OPENAI_OAUTH_SETUP_FAILED');
      }
      this.#assertCurrent(active);
      metadata = validateMetadata(metadata);
      const initial = metadata.issuedClientId === null;
      const state = freshSecret(this.#randomBytes);
      const nonce = freshSecret(this.#randomBytes);
      const verifier = freshSecret(this.#randomBytes);
      const challenge = base64url(createHash('sha256').update(verifier, 'ascii').digest());
      const callback = await this.#listen(active, state, initial, metadata.issuedClientId);
      this.#assertCurrent(active);
      const redirectUri = `http://127.0.0.1:${callback.port}${CALLBACK_PATH}`;
      const clientId = initial ? DYNAMIC_CLIENT_ID : metadata.issuedClientId;
      const authorizationUrl = new URL(configuration.authorizationEndpoint);
      const params = authorizationUrl.searchParams;
      params.set('client_id', clientId);
      if (initial) params.set('agent_name_hint', AGENT_NAME);
      params.set('ext_agent_host_id', metadata.hostId);
      params.set('response_type', 'code');
      params.set('redirect_uri', redirectUri);
      params.set('resource', RESOURCE);
      params.set('scope', SCOPES);
      params.set('state', state);
      params.set('nonce', nonce);
      params.set('code_challenge', challenge);
      params.set('code_challenge_method', 'S256');
      try {
        await waitFor(this.#openBrowser(authorizationUrl.toString(), {
          signal: controller.signal,
        }), controller.signal);
      } catch (error) {
        if (error instanceof OAuthSessionError) throw error;
        if (controller.signal.aborted) throw abortFailure(controller.signal);
        throwFailure('OPENAI_OAUTH_BROWSER_FAILED');
      }
      const accepted = await waitFor(callback.result, controller.signal);
      this.#assertCurrent(active);
      const exchangeController = new AbortController();
      const onAttemptAbort = () => exchangeController.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', onAttemptAbort, { once: true });
      const exchangeTimer = this.#setTimeout(
        () => exchangeController.abort('deadline'),
        this.#exchangeDeadlineMs,
      );
      let tokenPayload;
      let tokenReceivedAt;
      try {
        const body = new URLSearchParams([
          ['grant_type', 'authorization_code'],
          ['client_id', accepted.issuedClientId],
          ['code', accepted.code],
          ['code_verifier', verifier],
          ['redirect_uri', redirectUri],
          ['resource', RESOURCE],
        ]).toString();
        const response = await waitFor(this.#fetch(configuration.tokenEndpoint, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: exchangeController.signal,
        }), exchangeController.signal);
        tokenPayload = await readTokenResponse(response, exchangeController.signal);
        tokenReceivedAt = this.#now();
      } catch (error) {
        if (controller.signal.aborted) throw abortFailure(controller.signal);
        if (exchangeController.signal.aborted) {
          throwFailure('OPENAI_OAUTH_EXCHANGE_DEADLINE_EXCEEDED');
        }
        if (error instanceof OAuthSessionError) throw error;
        throwFailure('OPENAI_OAUTH_EXCHANGE_FAILED');
      } finally {
        this.#clearTimeout(exchangeTimer);
        controller.signal.removeEventListener('abort', onAttemptAbort);
      }
      this.#assertCurrent(active);
      let identity;
      try {
        identity = await waitFor(this.#verifier.verify(tokenPayload.id_token, {
          clientId: accepted.issuedClientId,
          nonce,
          allowMissingNonce: false,
          signal: controller.signal,
        }), controller.signal);
      } catch (error) {
        if (error instanceof OAuthSessionError) throw error;
        if (controller.signal.aborted) throw abortFailure(controller.signal);
        throwFailure('OPENAI_OAUTH_IDENTITY_INVALID');
      }
      this.#assertCurrent(active);
      if (!identity || typeof identity.issuer !== 'string' || typeof identity.sub !== 'string') {
        throwFailure('OPENAI_OAUTH_IDENTITY_INVALID');
      }
      const accountBindingSha256 = bindingHash(
        identity.issuer,
        accepted.issuedClientId,
        identity.sub,
      );
      if (!initial && (accepted.issuedClientId !== metadata.issuedClientId
        || accountBindingSha256 !== metadata.accountBindingSha256)) {
        throwFailure('OPENAI_OAUTH_ACCOUNT_MISMATCH');
      }
      this.#assertCurrent(active);
      try {
        await this.#store.bind({
          issuedClientId: accepted.issuedClientId,
          accountBindingSha256,
        }, { signal: controller.signal });
      } catch {
        if (controller.signal.aborted) throw abortFailure(controller.signal);
        throwFailure('OPENAI_OAUTH_BIND_FAILED');
      }
      this.#assertCurrent(active);
      let tokenSession;
      try {
        tokenSession = this.#tokenSessionFactory({
          fetchImpl: this.#fetch,
          openIdVerifier: this.#verifier,
          configuration,
          issuedClientId: accepted.issuedClientId,
          issuer: identity.issuer,
          subject: identity.sub,
          accountBindingSha256,
          accessTokenValue: tokenPayload.access_token,
          refreshTokenValue: tokenPayload.refresh_token,
          scope: tokenPayload.scope,
          nonce,
          expiresAt: tokenReceivedAt + tokenPayload.expires_in * 1_000,
          now: this.#now,
          setTimeoutImpl: this.#setTimeout,
          clearTimeoutImpl: this.#clearTimeout,
        });
      } catch {
        throwFailure('OPENAI_OAUTH_TOKEN_ACTIVATION_FAILED');
      }
      this.#assertCurrent(active);
      return tokenSession;
    } finally {
      this.#clearTimeout(deadline);
      signal?.removeEventListener('abort', cancelFromCaller);
      if (!controller.signal.aborted) controller.abort('complete');
      this.#closeListener(active);
      if (this.#active === active) this.#active = null;
    }
  }

  #assertCurrent(active) {
    if (this.#active !== active || this.#generation !== active.generation
      || active.controller.signal.aborted) {
      throw abortFailure(active.controller.signal);
    }
  }

  async #listen(active, expectedState, initial, expectedClientId) {
    const sockets = new Set();
    let consumed = false;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    result.catch(() => {});
    const server = createServer({ maxHeaderSize: 8_192 }, (request, response) => {
      if (consumed) {
        reply(response, 400);
        return;
      }
      const remote = request.socket.remoteAddress;
      const localPeer = remote === '127.0.0.1' || remote === '::ffff:127.0.0.1';
      const rawUrl = request.url;
      const host = request.headers.host;
      const expectedHost = `127.0.0.1:${server.address()?.port}`;
      const transferEncodingPresent = exactHeaderCount(request.rawHeaders, 'transfer-encoding') !== 0;
      const contentLengthCount = exactHeaderCount(request.rawHeaders, 'content-length');
      const contentLength = request.headers['content-length'];
      if (!localPeer || request.method !== 'GET' || typeof rawUrl !== 'string'
        || Buffer.byteLength(rawUrl, 'utf8') > 8_192 || exactHeaderCount(request.rawHeaders, 'host') !== 1
        || host !== expectedHost || transferEncodingPresent || contentLengthCount > 1
        || (contentLengthCount === 1 && contentLength !== '0')) {
        reply(response, 400);
        return;
      }
      let url;
      try {
        url = new URL(rawUrl, `http://${expectedHost}`);
      } catch {
        reply(response, 400);
        return;
      }
      if (url.pathname !== CALLBACK_PATH) {
        reply(response, 404);
        return;
      }
      const states = url.searchParams.getAll('state');
      if (states.length !== 1 || !/^[A-Za-z0-9_-]{43}$/u.test(states[0])
        || !constantTimeEqual(states[0], expectedState)) {
        reply(response, 400);
        return;
      }
      const tuple = callbackTuple(url, initial, expectedClientId);
      consumed = true;
      reply(response, tuple.error ? 400 : 200);
      if (tuple.error) rejectResult(tuple.error);
      else resolveResult(tuple.value);
    });
    server.maxConnections = 8;
    server.requestTimeout = 5_000;
    server.headersTimeout = 5_000;
    server.on('connection', (socket) => {
      if (sockets.size >= 8) {
        socket.destroy();
        return;
      }
      sockets.add(socket);
      socket.setTimeout(5_000, () => socket.destroy());
      socket.once('close', () => sockets.delete(socket));
    });
    server.once('error', () => rejectResult(failure('OPENAI_OAUTH_LISTENER_FAILED')));
    active.listener = { server, sockets };
    try {
      await waitFor(new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port: 0, exclusive: true });
      }), active.controller.signal);
    } catch (error) {
      if (error instanceof OAuthSessionError) throw error;
      throwFailure('OPENAI_OAUTH_LISTENER_FAILED');
    }
    const address = server.address();
    if (!address || typeof address === 'string') throwFailure('OPENAI_OAUTH_LISTENER_FAILED');
    return { port: address.port, result };
  }

  #closeListener(active) {
    const listener = active.listener;
    if (!listener) return;
    active.listener = null;
    for (const socket of listener.sockets) socket.destroy();
    try {
      listener.server.close();
    } catch {
      // Listener cleanup cannot replace the authoritative terminal result.
    }
  }
}


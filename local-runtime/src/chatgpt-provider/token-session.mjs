const RESOURCE = 'https://api.openai.com/v1';
const DIRECT_SCOPE = 'chatgpt.tokens.use.direct';
const DEFAULT_REFRESH_DEADLINE_MS = 15_000;
const DEFAULT_REVOKE_DEADLINE_MS = 15_000;
const DEFAULT_REFRESH_LIFETIME_MS = 55 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 64 * 1_024;

export class TokenSessionError extends Error {
  constructor(code, message = 'OpenAI 연결 세션을 사용할 수 없습니다.') {
    super(message);
    this.name = 'TokenSessionError';
    this.code = code;
  }
}

function failure(code, message) {
  return new TokenSessionError(code, message);
}

function throwFailure(code, message) {
  throw failure(code, message);
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

function validEndpoint(value) {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === ''
      && parsed.hash === '';
  } catch {
    return false;
  }
}

function abortCode(signal, deadlineCode, cancelledCode) {
  return signal.reason === 'deadline' ? deadlineCode : cancelledCode;
}

function waitFor(value, signal, deadlineCode, cancelledCode) {
  if (signal?.aborted) return Promise.reject(failure(
    abortCode(signal, deadlineCode, cancelledCode),
  ));
  if (!signal) return Promise.resolve(value);
  let onAbort;
  const aborted = new Promise((resolve, reject) => {
    onAbort = () => reject(failure(abortCode(signal, deadlineCode, cancelledCode)));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return Promise.race([Promise.resolve(value), aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort);
  });
}

async function readBoundedJson(response, signal, deadlineCode) {
  if (!response || response.ok !== true) throwFailure('OPENAI_TOKEN_HTTP_ERROR');
  let text = '';
  let reader;
  try {
    reader = response.body?.getReader?.();
    if (!reader) throw new Error('invalid');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0;
    while (true) {
      const part = await waitFor(
        reader.read(), signal, deadlineCode, 'OPENAI_TOKEN_CANCELLED',
      );
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error('invalid');
      total += part.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('invalid');
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof TokenSessionError) throw error;
    throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
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
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('invalid');
    }
    return value;
  } catch {
    throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
  }
}

function validateConstruction(options) {
  const requiredStrings = [
    options.issuedClientId,
    options.issuer,
    options.subject,
    options.accountBindingSha256,
    options.nonce,
  ];
  if (typeof options.fetchImpl !== 'function'
    || !options.openIdVerifier || typeof options.openIdVerifier.verify !== 'function'
    || !options.configuration || !validEndpoint(options.configuration.tokenEndpoint)
    || !validEndpoint(options.configuration.revocationEndpoint)
    || requiredStrings.some((value) => typeof value !== 'string' || value.length === 0)
    || !validSecret(options.accessTokenValue) || !validSecret(options.refreshTokenValue)
    || !validScope(options.scope)
    || !Number.isSafeInteger(options.expiresAt) || options.expiresAt < 0
    || typeof options.now !== 'function'
    || typeof options.setTimeoutImpl !== 'function'
    || typeof options.clearTimeoutImpl !== 'function') {
    throwFailure('OPENAI_TOKEN_SESSION_INVALID');
  }
}

export class TokenSession {
  #fetch;
  #verifier;
  #configuration;
  #now;
  #setTimeout;
  #clearTimeout;
  #refreshDeadlineMs;
  #revokeDeadlineMs;
  #generation = 1;
  #credentials;
  #refreshWork = null;
  #disconnectWork = null;
  #revokeController = null;

  constructor({
    fetchImpl = globalThis.fetch,
    openIdVerifier,
    configuration,
    issuedClientId,
    issuer,
    subject,
    accountBindingSha256,
    accessTokenValue,
    refreshTokenValue,
    scope,
    nonce,
    expiresAt,
    now = Date.now,
    refreshDeadlineMs = DEFAULT_REFRESH_DEADLINE_MS,
    revokeDeadlineMs = DEFAULT_REVOKE_DEADLINE_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    const options = {
      fetchImpl,
      openIdVerifier,
      configuration,
      issuedClientId,
      issuer,
      subject,
      accountBindingSha256,
      accessTokenValue,
      refreshTokenValue,
      scope,
      nonce,
      expiresAt,
      now,
      setTimeoutImpl,
      clearTimeoutImpl,
    };
    validateConstruction(options);
    if (!Number.isSafeInteger(refreshDeadlineMs) || refreshDeadlineMs < 1 || refreshDeadlineMs > 60_000
      || !Number.isSafeInteger(revokeDeadlineMs) || revokeDeadlineMs < 1 || revokeDeadlineMs > 60_000) {
      throwFailure('OPENAI_TOKEN_SESSION_INVALID');
    }
    this.#fetch = fetchImpl;
    this.#verifier = openIdVerifier;
    this.#configuration = configuration;
    this.#now = now;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
    this.#refreshDeadlineMs = refreshDeadlineMs;
    this.#revokeDeadlineMs = revokeDeadlineMs;
    this.#credentials = {
      issuedClientId,
      issuer,
      subject,
      accountBindingSha256,
      accessToken: accessTokenValue,
      refreshToken: refreshTokenValue,
      scope,
      nonce,
      expiresAt,
    };
  }

  get active() {
    return this.#credentials !== null;
  }

  async accessToken({ signal } = {}) {
    if (signal?.aborted) throw failure('OPENAI_TOKEN_CANCELLED');
    const credentials = this.#credentials;
    if (!credentials) throwFailure('OPENAI_TOKEN_LOGIN_REQUIRED');
    if (credentials.expiresAt > this.#now()) return credentials.accessToken;
    if (!this.#refreshWork) this.#beginRefresh(credentials);
    return waitFor(
      this.#refreshWork.promise,
      signal,
      'OPENAI_TOKEN_CANCELLED',
      'OPENAI_TOKEN_CANCELLED',
    );
  }

  #beginRefresh(source) {
    const generation = this.#generation;
    const sourceRefreshToken = source.refreshToken;
    const controller = new AbortController();
    const timer = this.#setTimeout(() => controller.abort('deadline'), this.#refreshDeadlineMs);
    const work = { controller, promise: null };
    work.promise = this.#performRefresh(source, generation, sourceRefreshToken, controller.signal)
      .catch((error) => {
        if (this.#generation === generation && this.#credentials?.refreshToken === sourceRefreshToken) {
          this.#generation += 1;
          this.#credentials = null;
        }
        if (error instanceof TokenSessionError) throw error;
        throw failure('OPENAI_TOKEN_REFRESH_FAILED');
      })
      .finally(() => {
        this.#clearTimeout(timer);
        if (this.#refreshWork === work) this.#refreshWork = null;
      });
    this.#refreshWork = work;
  }

  async #performRefresh(source, generation, sourceRefreshToken, signal) {
    const body = new URLSearchParams([
      ['grant_type', 'refresh_token'],
      ['client_id', source.issuedClientId],
      ['refresh_token', sourceRefreshToken],
      ['resource', RESOURCE],
    ]).toString();
    let response;
    try {
      response = await waitFor(this.#fetch(this.#configuration.tokenEndpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal,
      }), signal, 'OPENAI_TOKEN_REFRESH_DEADLINE_EXCEEDED', 'OPENAI_TOKEN_REFRESH_FAILED');
    } catch (error) {
      if (error instanceof TokenSessionError) throw error;
      throwFailure('OPENAI_TOKEN_REFRESH_FAILED');
    }
    const receivedAt = this.#now();
    const payload = await readBoundedJson(response, signal, 'OPENAI_TOKEN_REFRESH_DEADLINE_EXCEEDED');
    if (!validSecret(payload.access_token) || !validSecret(payload.refresh_token)) {
      throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
    }
    if (Object.hasOwn(payload, 'token_type') && payload.token_type !== 'Bearer') {
      throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
    }
    let scope = source.scope;
    if (Object.hasOwn(payload, 'scope')) {
      if (!validScope(payload.scope)) throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
      scope = payload.scope;
    }
    let expiresAt = receivedAt + DEFAULT_REFRESH_LIFETIME_MS;
    if (Object.hasOwn(payload, 'expires_in')) {
      if (!Number.isSafeInteger(payload.expires_in)
        || payload.expires_in < 1 || payload.expires_in > 86_400) {
        throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
      }
      expiresAt = Math.min(expiresAt, receivedAt + payload.expires_in * 1_000);
    }
    if (Object.hasOwn(payload, 'id_token')) {
      if (typeof payload.id_token !== 'string' || payload.id_token.length < 1
        || Buffer.byteLength(payload.id_token, 'utf8') > 64 * 1_024) {
        throwFailure('OPENAI_TOKEN_RESPONSE_INVALID');
      }
      let identity;
      try {
        identity = await waitFor(this.#verifier.verify(payload.id_token, {
          clientId: source.issuedClientId,
          nonce: source.nonce,
          allowMissingNonce: true,
          signal,
        }), signal, 'OPENAI_TOKEN_REFRESH_DEADLINE_EXCEEDED', 'OPENAI_TOKEN_REFRESH_FAILED');
      } catch (error) {
        if (error instanceof TokenSessionError) throw error;
        throwFailure('OPENAI_TOKEN_IDENTITY_INVALID');
      }
      if (identity?.issuer !== source.issuer || identity?.sub !== source.subject) {
        throwFailure('OPENAI_TOKEN_IDENTITY_INVALID');
      }
    }
    if (signal.aborted) throw failure(abortCode(
      signal,
      'OPENAI_TOKEN_REFRESH_DEADLINE_EXCEEDED',
      'OPENAI_TOKEN_REFRESH_FAILED',
    ));
    if (this.#generation !== generation || this.#credentials?.refreshToken !== sourceRefreshToken) {
      throwFailure('OPENAI_TOKEN_LOGIN_REQUIRED');
    }
    this.#credentials = {
      ...source,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      scope,
      expiresAt,
    };
    return payload.access_token;
  }

  disconnect({ signal } = {}) {
    if (this.#disconnectWork) {
      return waitFor(this.#disconnectWork, signal,
        'OPENAI_TOKEN_CANCELLED', 'OPENAI_TOKEN_CANCELLED');
    }
    const credentials = this.#credentials;
    const refreshWork = this.#refreshWork;
    this.#generation += 1;
    this.#credentials = null;
    if (refreshWork) {
      if (!refreshWork.controller.signal.aborted) refreshWork.controller.abort('disconnect');
      this.#disconnectWork = Promise.resolve('revocation-unconfirmed');
    } else if (!credentials) {
      this.#disconnectWork = Promise.resolve('revocation-unconfirmed');
    } else {
      this.#disconnectWork = this.#revoke(credentials);
    }
    return waitFor(this.#disconnectWork, signal,
      'OPENAI_TOKEN_CANCELLED', 'OPENAI_TOKEN_CANCELLED');
  }

  async #revoke(credentials) {
    const controller = new AbortController();
    this.#revokeController = controller;
    const timer = this.#setTimeout(() => controller.abort('deadline'), this.#revokeDeadlineMs);
    try {
      const body = new URLSearchParams([
        ['token', credentials.refreshToken],
        ['token_type_hint', 'refresh_token'],
        ['client_id', credentials.issuedClientId],
      ]).toString();
      const response = await waitFor(this.#fetch(this.#configuration.revocationEndpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: controller.signal,
      }), controller.signal, 'OPENAI_TOKEN_REVOKE_DEADLINE_EXCEEDED', 'OPENAI_TOKEN_REVOKE_FAILED');
      return response?.ok === true ? 'revoked' : 'revocation-unconfirmed';
    } catch {
      return 'revocation-unconfirmed';
    } finally {
      this.#clearTimeout(timer);
      if (this.#revokeController === controller) this.#revokeController = null;
    }
  }

  shutdown() {
    this.#generation += 1;
    this.#credentials = null;
    if (this.#refreshWork && !this.#refreshWork.controller.signal.aborted) {
      this.#refreshWork.controller.abort('shutdown');
    }
    if (this.#revokeController && !this.#revokeController.signal.aborted) {
      this.#revokeController.abort('shutdown');
    }
  }
}


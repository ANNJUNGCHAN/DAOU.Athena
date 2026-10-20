import {
  constants as cryptoConstants,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto';

export const OPENAI_OIDC_DISCOVERY_URL = 'https://auth.openai.com/.well-known/openid-configuration';
export const OPENAI_OIDC_ISSUER = 'https://auth.openai.com';
export const OPENAI_OIDC_AUTHORIZATION_ENDPOINT = 'https://auth.openai.com/api/accounts/authorize';
export const OPENAI_OIDC_TOKEN_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/token';
export const OPENAI_OIDC_REVOCATION_ENDPOINT = 'https://auth.openai.com/api/accounts/oauth/revoke';
export const OPENAI_OIDC_JWKS_URI = 'https://auth.openai.com/.well-known/jwks.json';

export const MAX_OIDC_DISCOVERY_BYTES = 64 * 1024;
export const MAX_OIDC_JWKS_BYTES = 256 * 1024;
export const MAX_OIDC_JWT_BYTES = 64 * 1024;
export const MAX_OIDC_HEADER_BYTES = 4 * 1024;
export const MAX_OIDC_CLAIMS_BYTES = 32 * 1024;
export const MAX_OIDC_SIGNATURE_BYTES = 512;
export const DEFAULT_OIDC_DEADLINE_MS = 5_000;
export const DEFAULT_OIDC_CACHE_TTL_MS = 5 * 60_000;

const MAX_JSON_DEPTH = 16;
const MAX_JSON_KEYS = 128;
const MAX_JWKS_KEYS = 32;
const MAX_JWKS_JSON_KEYS = 1 + (MAX_JWKS_KEYS * 8);
const MAX_JWK_BYTES = 16 * 1024;
const MAX_JWK_X5C_ENTRIES = 5;
const MAX_JWK_X5C_BYTES = 8 * 1024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const KID_PATTERN = /^[\s\S]+$/u;
const FORBIDDEN_HEADER_KEYS = new Set(['crit', 'b64', 'jku', 'jwk', 'x5u', 'x5c']);
const PRIVATE_JWK_KEYS = new Set(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth']);
const PUBLIC_JWK_KEYS = new Set(['kty', 'kid', 'n', 'e', 'alg', 'use', 'key_ops', 'x5c']);
const JWK_OPERATIONS = new Set([
  'sign', 'verify', 'encrypt', 'decrypt', 'wrapKey', 'unwrapKey', 'deriveKey', 'deriveBits',
]);

export class OpenIdVerifierError extends Error {
  constructor(code, message = 'OpenAI ID 토큰을 안전하게 확인하지 못했습니다.') {
    super(message);
    this.name = 'OpenIdVerifierError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new OpenIdVerifierError(code, message);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = expected.slice().sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function includesString(value, wanted) {
  return Array.isArray(value) && value.includes(wanted);
}

function fatalUtf8(bytes, code) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    fail(code);
  }
}

function validateJsonLexically(text, invalidCode, maxKeys) {
  let index = 0;
  let keyCount = 0;

  const invalid = () => fail(invalidCode);
  const whitespace = () => {
    while (index < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[index])) index += 1;
  };
  const stringToken = () => {
    if (text[index] !== '"') invalid();
    const start = index;
    index += 1;
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        try {
          return JSON.parse(text.slice(start, index));
        } catch {
          invalid();
        }
      }
      if (code <= 0x1f) invalid();
      if (code === 0x5c) {
        index += 1;
        if (index >= text.length) invalid();
        const escape = text[index];
        if ('"\\/bfnrt'.includes(escape)) {
          index += 1;
          continue;
        }
        if (escape !== 'u' || !/^[0-9A-Fa-f]{4}$/u.test(text.slice(index + 1, index + 5))) invalid();
        index += 5;
        continue;
      }
      index += 1;
    }
    invalid();
  };
  const value = (depth) => {
    whitespace();
    const char = text[index];
    if (char === '"') {
      stringToken();
      return;
    }
    if (char === '{') {
      if (depth >= MAX_JSON_DEPTH) invalid();
      index += 1;
      whitespace();
      const names = new Set();
      if (text[index] === '}') {
        index += 1;
        return;
      }
      while (index < text.length) {
        whitespace();
        const name = stringToken();
        keyCount += 1;
        if (keyCount > maxKeys || names.has(name)) invalid();
        names.add(name);
        whitespace();
        if (text[index] !== ':') invalid();
        index += 1;
        value(depth + 1);
        whitespace();
        if (text[index] === '}') {
          index += 1;
          return;
        }
        if (text[index] !== ',') invalid();
        index += 1;
      }
      invalid();
    }
    if (char === '[') {
      if (depth >= MAX_JSON_DEPTH) invalid();
      index += 1;
      whitespace();
      if (text[index] === ']') {
        index += 1;
        return;
      }
      while (index < text.length) {
        value(depth + 1);
        whitespace();
        if (text[index] === ']') {
          index += 1;
          return;
        }
        if (text[index] !== ',') invalid();
        index += 1;
      }
      invalid();
    }
    const rest = text.slice(index);
    const token = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/u.exec(rest)?.[0];
    if (!token) invalid();
    index += token.length;
  };

  value(0);
  whitespace();
  if (index !== text.length) invalid();
}

function parseBoundedJson(bytes, {
  maxBytes, utf8Code, invalidCode, maxKeys = MAX_JSON_KEYS,
}) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) fail(invalidCode);
  const text = fatalUtf8(bytes, utf8Code);
  validateJsonLexically(text, invalidCode, maxKeys);
  try {
    return JSON.parse(text);
  } catch {
    fail(invalidCode);
  }
}

function decodeCanonicalBase64url(segment, maxBytes, code) {
  if (typeof segment !== 'string' || !BASE64URL_PATTERN.test(segment)) fail(code);
  let bytes;
  try {
    bytes = Buffer.from(segment, 'base64url');
  } catch {
    fail(code);
  }
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes
    || bytes.toString('base64url') !== segment) fail(code);
  return bytes;
}

function cancellationError(signal) {
  return new OpenIdVerifierError(
    signal.reason === 'deadline' ? 'OPENAI_OIDC_DEADLINE_EXCEEDED' : 'OPENAI_OIDC_CANCELLED',
    signal.reason === 'deadline'
      ? 'OpenAI 인증 확인 제한 시간을 초과했습니다.'
      : 'OpenAI 인증 확인이 취소되었습니다.',
  );
}

async function abortable(value, signal) {
  if (signal.aborted) throw cancellationError(signal);
  let rejectAbort;
  const aborted = new Promise((resolve, reject) => {
    rejectAbort = () => reject(cancellationError(signal));
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(value), aborted]);
  } catch (error) {
    if (signal.aborted) throw cancellationError(signal);
    throw error;
  } finally {
    signal.removeEventListener('abort', rejectAbort);
  }
}

function cancelUnconsumedBody(response) {
  try {
    const cancellation = response?.body?.cancel?.();
    if (cancellation && typeof cancellation.catch === 'function') cancellation.catch(() => {});
  } catch {
    // Cleanup is best effort and must not replace the fixed terminal error.
  }
}

async function readBoundedResponse(response, maxBytes, signal) {
  let reader;
  try {
    reader = response?.body?.getReader?.();
  } catch {
    cancelUnconsumedBody(response);
    fail('OPENAI_OIDC_RESPONSE_INVALID');
  }
  if (!reader) {
    cancelUnconsumedBody(response);
    fail('OPENAI_OIDC_RESPONSE_INVALID');
  }

  const chunks = [];
  let total = 0;
  try {
    while (true) {
      let part;
      try {
        part = await abortable(reader.read(), signal);
      } catch (error) {
        if (signal.aborted) throw cancellationError(signal);
        fail('OPENAI_OIDC_RESPONSE_INVALID');
      }
      if (!isRecord(part) || typeof part.done !== 'boolean') fail('OPENAI_OIDC_RESPONSE_INVALID');
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail('OPENAI_OIDC_RESPONSE_INVALID');
      total += part.value.byteLength;
      if (total > maxBytes) fail('OPENAI_OIDC_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
    return Buffer.concat(chunks, total);
  } finally {
    try {
      const result = reader.cancel?.();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // Cleanup must not replace the terminal verification result.
    }
    try {
      reader.releaseLock?.();
    } catch {
      // Synthetic offline readers may not expose a releasable lock.
    }
  }
}

function validateDiscovery(value) {
  if (!isRecord(value)
    || value.issuer !== OPENAI_OIDC_ISSUER
    || value.authorization_endpoint !== OPENAI_OIDC_AUTHORIZATION_ENDPOINT
    || value.token_endpoint !== OPENAI_OIDC_TOKEN_ENDPOINT
    || value.revocation_endpoint !== OPENAI_OIDC_REVOCATION_ENDPOINT
    || value.jwks_uri !== OPENAI_OIDC_JWKS_URI
    || !includesString(value.response_types_supported, 'code')
    || !includesString(value.code_challenge_methods_supported, 'S256')
    || !includesString(value.grant_types_supported, 'authorization_code')
    || !includesString(value.grant_types_supported, 'refresh_token')
    || !includesString(value.id_token_signing_alg_values_supported, 'RS256')) {
    fail('OPENAI_OIDC_DISCOVERY_INVALID');
  }
  return Object.freeze({
    issuer: OPENAI_OIDC_ISSUER,
    authorizationEndpoint: OPENAI_OIDC_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: OPENAI_OIDC_TOKEN_ENDPOINT,
    revocationEndpoint: OPENAI_OIDC_REVOCATION_ENDPOINT,
    jwksUri: OPENAI_OIDC_JWKS_URI,
  });
}

function bitLength(bytes) {
  let leading = 0;
  let value = bytes[0];
  while ((value & 0x80) === 0) {
    leading += 1;
    value <<= 1;
  }
  return (bytes.byteLength * 8) - leading;
}

function parsePublicJwk(jwk) {
  if (!isRecord(jwk) || Buffer.byteLength(JSON.stringify(jwk), 'utf8') > MAX_JWK_BYTES) {
    fail('OPENAI_OIDC_JWKS_INVALID');
  }
  for (const key of Object.keys(jwk)) {
    if (PRIVATE_JWK_KEYS.has(key) || !PUBLIC_JWK_KEYS.has(key)) fail('OPENAI_OIDC_JWKS_INVALID');
  }
  if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || !KID_PATTERN.test(jwk.kid)
    || Buffer.byteLength(jwk.kid, 'utf8') < 1 || Buffer.byteLength(jwk.kid, 'utf8') > 128
    || (jwk.alg !== undefined && jwk.alg !== 'RS256')
    || (jwk.use !== undefined && jwk.use !== 'sig')) {
    fail('OPENAI_OIDC_JWKS_INVALID');
  }
  if (jwk.key_ops !== undefined) {
    if (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify')
      || new Set(jwk.key_ops).size !== jwk.key_ops.length
      || jwk.key_ops.some((operation) => typeof operation !== 'string'
        || !JWK_OPERATIONS.has(operation)
        || ['sign', 'decrypt', 'unwrapKey', 'deriveKey', 'deriveBits'].includes(operation))) {
      fail('OPENAI_OIDC_JWKS_INVALID');
    }
  }
  if (jwk.x5c !== undefined) {
    if (!Array.isArray(jwk.x5c) || jwk.x5c.length === 0 || jwk.x5c.length > MAX_JWK_X5C_ENTRIES) {
      fail('OPENAI_OIDC_JWKS_INVALID');
    }
    for (const certificate of jwk.x5c) {
      if (typeof certificate !== 'string' || certificate.length === 0) fail('OPENAI_OIDC_JWKS_INVALID');
      const bytes = Buffer.from(certificate, 'base64');
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_JWK_X5C_BYTES || bytes.toString('base64') !== certificate) {
        fail('OPENAI_OIDC_JWKS_INVALID');
      }
    }
  }
  const modulus = decodeCanonicalBase64url(jwk.n, 512, 'OPENAI_OIDC_JWKS_INVALID');
  const exponent = decodeCanonicalBase64url(jwk.e, 8, 'OPENAI_OIDC_JWKS_INVALID');
  if (modulus[0] === 0 || exponent[0] === 0) fail('OPENAI_OIDC_JWKS_INVALID');
  const modulusBits = bitLength(modulus);
  let exponentValue = 0n;
  for (const byte of exponent) exponentValue = (exponentValue << 8n) | BigInt(byte);
  if (modulusBits < 2048 || modulusBits > 4096 || exponentValue < 3n || exponentValue % 2n === 0n) {
    fail('OPENAI_OIDC_JWKS_INVALID');
  }
  let key;
  try {
    // x5c is bounded metadata from the pinned JWKS; only n/e determine the verification key.
    key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  } catch {
    fail('OPENAI_OIDC_JWKS_INVALID');
  }
  if (key.asymmetricKeyType !== 'rsa'
    || key.asymmetricKeyDetails?.modulusLength < 2048
    || key.asymmetricKeyDetails?.modulusLength > 4096) {
    fail('OPENAI_OIDC_JWKS_INVALID');
  }
  return Object.freeze({ kid: jwk.kid, key });
}

function validateJwks(value) {
  if (!exactKeys(value, ['keys']) || !Array.isArray(value.keys)
    || value.keys.length === 0 || value.keys.length > MAX_JWKS_KEYS) {
    fail('OPENAI_OIDC_JWKS_INVALID');
  }
  const parsed = [];
  const kids = new Set();
  for (const jwk of value.keys) {
    const key = parsePublicJwk(jwk);
    if (kids.has(key.kid)) fail('OPENAI_OIDC_JWKS_INVALID');
    kids.add(key.kid);
    parsed.push(key);
  }
  return Object.freeze(parsed);
}

function scalarCount(value) {
  let count = 0;
  for (let index = 0; index < value.length;) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) return -1;
      index += 2;
    } else {
      if (first >= 0xdc00 && first <= 0xdfff) return -1;
      index += 1;
    }
    count += 1;
  }
  return count;
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  const comparedLength = Math.max(leftBytes.byteLength, rightBytes.byteLength);
  const paddedLeft = Buffer.alloc(comparedLength);
  const paddedRight = Buffer.alloc(comparedLength);
  leftBytes.copy(paddedLeft);
  rightBytes.copy(paddedRight);
  const sameBytes = timingSafeEqual(paddedLeft, paddedRight);
  return sameBytes && leftBytes.byteLength === rightBytes.byteLength;
}

function validateClaims(claims, { clientId, nonce, allowMissingNonce, nowSeconds }) {
  if (!isRecord(claims) || claims.iss !== OPENAI_OIDC_ISSUER) fail('OPENAI_OIDC_CLAIMS_INVALID');
  const audienceValid = claims.aud === clientId
    || (Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === clientId);
  if (!audienceValid || (claims.azp !== undefined && claims.azp !== clientId)) {
    fail('OPENAI_OIDC_CLAIMS_INVALID');
  }
  const subjectScalars = typeof claims.sub === 'string' ? scalarCount(claims.sub) : -1;
  if (subjectScalars < 1 || subjectScalars > 256 || Buffer.byteLength(claims.sub, 'utf8') > 1024) {
    fail('OPENAI_OIDC_CLAIMS_INVALID');
  }
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)
    || claims.iat > claims.exp || claims.iat > nowSeconds + 5 || claims.exp <= nowSeconds - 5
    || (claims.nbf !== undefined
      && (!Number.isSafeInteger(claims.nbf) || claims.nbf > nowSeconds + 5))) {
    fail('OPENAI_OIDC_CLAIMS_INVALID');
  }
  if (claims.nonce === undefined) {
    if (!allowMissingNonce) fail('OPENAI_OIDC_NONCE_INVALID');
  } else if (!constantTimeEqual(claims.nonce, nonce)) {
    fail('OPENAI_OIDC_NONCE_INVALID');
  }
  return Object.freeze({ issuer: OPENAI_OIDC_ISSUER, sub: claims.sub });
}

function validateVerifyOptions(options) {
  if (!isRecord(options)
    || typeof options.clientId !== 'string' || options.clientId.length < 1
    || Buffer.byteLength(options.clientId, 'utf8') > 256
    || typeof options.nonce !== 'string' || options.nonce.length < 1
    || Buffer.byteLength(options.nonce, 'utf8') > 1024
    || (options.allowMissingNonce !== undefined && typeof options.allowMissingNonce !== 'boolean')
    || (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
    fail('OPENAI_OIDC_REQUEST_INVALID');
  }
}

export class OpenIdVerifier {
  #fetch;
  #now;
  #setTimeout;
  #clearTimeout;
  #discoveryDeadlineMs;
  #jwksDeadlineMs;
  #cacheTtlMs;
  #configurationCache = null;
  #jwksCache = null;

  constructor(options = {}) {
    if (!isRecord(options)) fail('OPENAI_OIDC_VERIFIER_INVALID');
    const {
      fetchImpl = globalThis.fetch,
      now = Date.now,
      setTimeoutImpl = globalThis.setTimeout,
      clearTimeoutImpl = globalThis.clearTimeout,
      discoveryDeadlineMs = DEFAULT_OIDC_DEADLINE_MS,
      jwksDeadlineMs = DEFAULT_OIDC_DEADLINE_MS,
      cacheTtlMs = DEFAULT_OIDC_CACHE_TTL_MS,
    } = options;
    if (typeof fetchImpl !== 'function' || typeof now !== 'function'
      || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function'
      || !Number.isSafeInteger(discoveryDeadlineMs) || discoveryDeadlineMs < 1
      || discoveryDeadlineMs > DEFAULT_OIDC_DEADLINE_MS
      || !Number.isSafeInteger(jwksDeadlineMs) || jwksDeadlineMs < 1
      || jwksDeadlineMs > DEFAULT_OIDC_DEADLINE_MS
      || !Number.isSafeInteger(cacheTtlMs) || cacheTtlMs < 1 || cacheTtlMs > 60 * 60_000) {
      fail('OPENAI_OIDC_VERIFIER_INVALID');
    }
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
    this.#discoveryDeadlineMs = discoveryDeadlineMs;
    this.#jwksDeadlineMs = jwksDeadlineMs;
    this.#cacheTtlMs = cacheTtlMs;
  }

  #readNow() {
    let value;
    try {
      value = this.#now();
    } catch {
      fail('OPENAI_OIDC_VERIFIER_INVALID');
    }
    if (!Number.isFinite(value)) fail('OPENAI_OIDC_VERIFIER_INVALID');
    return value;
  }

  async #fetchJson(url, {
    maxBytes, deadlineMs, signal, kind, maxKeys = MAX_JSON_KEYS,
  }) {
    const controller = new AbortController();
    const onAbort = () => controller.abort('cancelled');
    if (signal?.aborted) controller.abort('cancelled');
    else signal?.addEventListener('abort', onAbort, { once: true });
    const timer = this.#setTimeout(() => controller.abort('deadline'), deadlineMs);
    try {
      let response;
      let fetchAccepted = false;
      let rawFetch;
      try {
        rawFetch = Promise.resolve().then(() => this.#fetch(url, {
            method: 'GET',
            redirect: 'error',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }));
        rawFetch.then((lateResponse) => {
          if (!fetchAccepted && controller.signal.aborted) cancelUnconsumedBody(lateResponse);
        }, () => {});
        response = await abortable(rawFetch, controller.signal);
        fetchAccepted = true;
      } catch (error) {
        if (controller.signal.aborted) throw cancellationError(controller.signal);
        fail('OPENAI_OIDC_NETWORK_ERROR');
      }
      let responseOk;
      let responseStatus;
      try {
        responseOk = response?.ok;
        responseStatus = response?.status;
      } catch {
        cancelUnconsumedBody(response);
        fail('OPENAI_OIDC_RESPONSE_INVALID');
      }
      if (!response || responseOk !== true || (responseStatus !== undefined && responseStatus !== 200)) {
        cancelUnconsumedBody(response);
        fail('OPENAI_OIDC_HTTP_ERROR');
      }
      let contentType;
      try {
        contentType = response.headers?.get?.('content-type');
      } catch {
        cancelUnconsumedBody(response);
        fail('OPENAI_OIDC_RESPONSE_INVALID');
      }
      if (typeof contentType !== 'string'
        || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        cancelUnconsumedBody(response);
        fail('OPENAI_OIDC_RESPONSE_INVALID');
      }
      const bytes = await readBoundedResponse(response, maxBytes, controller.signal);
      return parseBoundedJson(bytes, {
        maxBytes,
        utf8Code: `OPENAI_OIDC_${kind}_UTF8_INVALID`,
        invalidCode: `OPENAI_OIDC_${kind}_INVALID`,
        maxKeys,
      });
    } finally {
      this.#clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async getConfiguration(options = {}) {
    if (!isRecord(options) || Object.keys(options).some((key) => key !== 'signal')) {
      fail('OPENAI_OIDC_REQUEST_INVALID');
    }
    const { signal } = options;
    if (signal !== undefined && !(signal instanceof AbortSignal)) fail('OPENAI_OIDC_REQUEST_INVALID');
    if (signal?.aborted) throw cancellationError(signal);
    const now = this.#readNow();
    if (this.#configurationCache && this.#configurationCache.expiresAt > now) {
      return this.#configurationCache.value;
    }
    const raw = await this.#fetchJson(OPENAI_OIDC_DISCOVERY_URL, {
      maxBytes: MAX_OIDC_DISCOVERY_BYTES,
      deadlineMs: this.#discoveryDeadlineMs,
      signal,
      kind: 'DISCOVERY',
    });
    const value = validateDiscovery(raw);
    this.#configurationCache = { value, expiresAt: now + this.#cacheTtlMs };
    return value;
  }

  async #getJwks(signal, forceRefresh = false) {
    if (signal?.aborted) throw cancellationError(signal);
    const now = this.#readNow();
    if (!forceRefresh && this.#jwksCache && this.#jwksCache.expiresAt > now) {
      return this.#jwksCache.value;
    }
    const raw = await this.#fetchJson(OPENAI_OIDC_JWKS_URI, {
      maxBytes: MAX_OIDC_JWKS_BYTES,
      deadlineMs: this.#jwksDeadlineMs,
      signal,
      kind: 'JWKS',
      maxKeys: MAX_JWKS_JSON_KEYS,
    });
    const value = validateJwks(raw);
    this.#jwksCache = { value, expiresAt: now + this.#cacheTtlMs };
    return value;
  }

  async verify(idToken, options) {
    validateVerifyOptions(options);
    if (typeof idToken !== 'string' || Buffer.byteLength(idToken, 'utf8') > MAX_OIDC_JWT_BYTES) {
      fail('OPENAI_OIDC_JWT_INVALID');
    }
    const segments = idToken.split('.');
    if (segments.length !== 3) fail('OPENAI_OIDC_JWT_INVALID');
    const headerBytes = decodeCanonicalBase64url(segments[0], MAX_OIDC_HEADER_BYTES, 'OPENAI_OIDC_JWT_INVALID');
    const claimsBytes = decodeCanonicalBase64url(segments[1], MAX_OIDC_CLAIMS_BYTES, 'OPENAI_OIDC_JWT_INVALID');
    const signature = decodeCanonicalBase64url(segments[2], MAX_OIDC_SIGNATURE_BYTES, 'OPENAI_OIDC_JWT_INVALID');
    const header = parseBoundedJson(headerBytes, {
      maxBytes: MAX_OIDC_HEADER_BYTES,
      utf8Code: 'OPENAI_OIDC_HEADER_UTF8_INVALID',
      invalidCode: 'OPENAI_OIDC_HEADER_INVALID',
    });
    if (!isRecord(header) || header.alg !== 'RS256'
      || typeof header.kid !== 'string' || !KID_PATTERN.test(header.kid)
      || Buffer.byteLength(header.kid, 'utf8') < 1 || Buffer.byteLength(header.kid, 'utf8') > 128
      || (header.typ !== undefined && header.typ !== 'JWT')
      || Object.keys(header).some((key) => FORBIDDEN_HEADER_KEYS.has(key))) {
      fail('OPENAI_OIDC_HEADER_INVALID');
    }

    await this.getConfiguration({ signal: options.signal });
    let keys = await this.#getJwks(options.signal);
    let matches = keys.filter((entry) => entry.kid === header.kid);
    if (matches.length === 0) {
      keys = await this.#getJwks(options.signal, true);
      matches = keys.filter((entry) => entry.kid === header.kid);
    }
    if (matches.length !== 1) fail('OPENAI_OIDC_KEY_NOT_FOUND');
    if (options.signal?.aborted) throw cancellationError(options.signal);
    let validSignature = false;
    try {
      validSignature = verifySignature(
        'RSA-SHA256',
        Buffer.from(`${segments[0]}.${segments[1]}`, 'ascii'),
        { key: matches[0].key, padding: cryptoConstants.RSA_PKCS1_PADDING },
        signature,
      );
    } catch {
      fail('OPENAI_OIDC_SIGNATURE_INVALID');
    }
    if (!validSignature) fail('OPENAI_OIDC_SIGNATURE_INVALID');

    const claims = parseBoundedJson(claimsBytes, {
      maxBytes: MAX_OIDC_CLAIMS_BYTES,
      utf8Code: 'OPENAI_OIDC_CLAIMS_UTF8_INVALID',
      invalidCode: 'OPENAI_OIDC_CLAIMS_INVALID',
    });
    const now = this.#readNow();
    return validateClaims(claims, {
      clientId: options.clientId,
      nonce: options.nonce,
      allowMissingNonce: options.allowMissingNonce === true,
      nowSeconds: Math.floor(now / 1000),
    });
  }
}

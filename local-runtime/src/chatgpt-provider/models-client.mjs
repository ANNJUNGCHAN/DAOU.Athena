export const MODELS_URL = 'https://api.openai.com/v1/models';
export const DEFAULT_MODELS_DEADLINE_MS = 20_000;
export const MAX_MODELS_BODY_BYTES = 8 * 1_024 * 1_024;
export const MAX_MODELS = 100;

const MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const DISPLAY_NAME_FORBIDDEN_PATTERN = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}]/u;

export class ModelsClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ModelsClientError';
    this.code = code;
  }
}

function fail(code, message = 'OpenAI 모델 목록을 안전하게 처리하지 못했습니다.') {
  throw new ModelsClientError(code, message);
}

function abortError(signal) {
  const deadline = signal.reason === 'deadline';
  return new ModelsClientError(
    deadline ? 'OPENAI_MODELS_DEADLINE_EXCEEDED' : 'OPENAI_MODELS_CANCELLED',
    deadline ? 'OpenAI 모델 목록 제한 시간을 초과했습니다.' : 'OpenAI 모델 목록 요청이 취소되었습니다.',
  );
}

async function abortable(value, signal) {
  if (signal.aborted) throw abortError(signal);
  let rejectAbort;
  const aborted = new Promise((resolve, reject) => {
    rejectAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    return await Promise.race([Promise.resolve(value), aborted]);
  } catch (error) {
    if (signal.aborted) throw abortError(signal);
    throw error;
  } finally {
    signal.removeEventListener('abort', rejectAbort);
  }
}

function validDisplayName(value) {
  if (typeof value !== 'string' || value.length === 0
    || Buffer.byteLength(value, 'utf8') > 512 || DISPLAY_NAME_FORBIDDEN_PATTERN.test(value)) {
    return false;
  }
  let scalars = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return false;
    scalars += 1;
    if (scalars > 128) return false;
  }
  return true;
}

async function readBoundedBody(response, signal) {
  if (signal.aborted) throw abortError(signal);
  let reader;
  try {
    reader = response.body?.getReader?.();
  } catch {
    fail('OPENAI_MODELS_BODY_INVALID');
  }
  if (!reader) fail('OPENAI_MODELS_BODY_INVALID');

  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      let part;
      try {
        part = await abortable(reader.read(), signal);
      } catch (error) {
        if (signal.aborted) throw abortError(signal);
        fail('OPENAI_MODELS_BODY_READ_ERROR');
      }
      if (!part || typeof part !== 'object') fail('OPENAI_MODELS_BODY_INVALID');
      let done;
      let value;
      try {
        done = part.done;
        value = part.value;
      } catch {
        fail('OPENAI_MODELS_BODY_INVALID');
      }
      if (typeof done !== 'boolean') fail('OPENAI_MODELS_BODY_INVALID');
      if (done) break;
      let normalized;
      try {
        if (!(value instanceof Uint8Array)) fail('OPENAI_MODELS_BODY_INVALID');
        normalized = new Uint8Array(value);
      } catch {
        fail('OPENAI_MODELS_BODY_INVALID');
      }
      totalBytes += normalized.byteLength;
      if (totalBytes > MAX_MODELS_BODY_BYTES) fail('OPENAI_MODELS_BODY_TOO_LARGE');
      chunks.push(normalized);
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      fail('OPENAI_MODELS_UTF8_INVALID');
    }
  } finally {
    try {
      const cancelled = reader.cancel();
      if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => {});
    } catch {
      // Cleanup must not replace the authoritative terminal result.
    }
    try {
      reader.releaseLock();
    } catch {
      // Some synthetic readers do not expose a releasable lock.
    }
  }
}

function parseModels(text) {
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('OPENAI_MODELS_JSON_INVALID');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || !Array.isArray(payload.models)) {
    fail('OPENAI_MODELS_PAYLOAD_INVALID');
  }
  if (payload.models.length > MAX_MODELS) fail('OPENAI_MODELS_COUNT_EXCEEDED');

  const seen = new Set();
  const visible = [];
  for (const entry of payload.models) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      fail('OPENAI_MODELS_ENTRY_INVALID');
    }
    if (entry.visibility !== 'list') continue;
    if (typeof entry.slug !== 'string' || !MODEL_SLUG_PATTERN.test(entry.slug)
      || !validDisplayName(entry.display_name) || seen.has(entry.slug)) {
      fail('OPENAI_MODELS_ENTRY_INVALID');
    }
    seen.add(entry.slug);
    visible.push(Object.freeze({ slug: entry.slug, displayName: entry.display_name }));
  }
  return Object.freeze(visible);
}

export class ModelsClient {
  #fetch;
  #accessToken;
  #deadlineMs;
  #setTimeout;
  #clearTimeout;
  #active = null;

  constructor({
    fetchImpl = globalThis.fetch,
    accessToken,
    deadlineMs = DEFAULT_MODELS_DEADLINE_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    if (typeof fetchImpl !== 'function' || typeof accessToken !== 'function'
      || typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
      fail('OPENAI_MODELS_CLIENT_INVALID');
    }
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1
      || deadlineMs > DEFAULT_MODELS_DEADLINE_MS) {
      fail('OPENAI_MODELS_DEADLINE_INVALID');
    }
    this.#fetch = fetchImpl;
    this.#accessToken = accessToken;
    this.#deadlineMs = deadlineMs;
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

  async list(options = {}) {
    if (this.#active) fail('OPENAI_MODELS_BUSY', '다른 OpenAI 모델 목록 요청이 진행 중입니다.');
    let callerSignal;
    let signalAdd;
    let signalRemove;
    let optionsValid = false;
    try {
      callerSignal = options?.signal;
      optionsValid = Boolean(options && typeof options === 'object' && !Array.isArray(options)
        && Object.keys(options).every((key) => key === 'signal')
        && (callerSignal === undefined
          || (callerSignal && typeof callerSignal.addEventListener === 'function'
            && typeof callerSignal.removeEventListener === 'function'
            && typeof callerSignal.aborted === 'boolean')));
      if (callerSignal !== undefined) {
        signalAdd = callerSignal.addEventListener;
        signalRemove = callerSignal.removeEventListener;
      }
    } catch {
      optionsValid = false;
    }
    if (!optionsValid) {
      fail('OPENAI_MODELS_REQUEST_INVALID');
    }

    const controller = new AbortController();
    const active = { controller };
    this.#active = active;
    const abortFromCaller = () => controller.abort('cancelled');
    let callerListenerAttached = false;
    let timer;
    let timerStarted = false;

    try {
      if (callerSignal !== undefined) {
        try {
          if (callerSignal.aborted) abortFromCaller();
          else {
            callerListenerAttached = true;
            signalAdd.call(callerSignal, 'abort', abortFromCaller, { once: true });
          }
        } catch {
          fail('OPENAI_MODELS_REQUEST_INVALID');
        }
      }
      if (controller.signal.aborted) throw abortError(controller.signal);
      try {
        timer = this.#setTimeout(() => controller.abort('deadline'), this.#deadlineMs);
        timerStarted = true;
      } catch {
        fail('OPENAI_MODELS_CLIENT_INVALID');
      }
      if (controller.signal.aborted) throw abortError(controller.signal);

      let token;
      try {
        if (controller.signal.aborted) throw abortError(controller.signal);
        token = await abortable(this.#accessToken({ signal: controller.signal }), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        fail('OPENAI_MODELS_TOKEN_UNAVAILABLE', 'OpenAI 연결 토큰을 가져오지 못했습니다.');
      }
      if (typeof token !== 'string' || token.length === 0 || token.length > 65_536
        || /[\r\n]/u.test(token)) {
        fail('OPENAI_MODELS_TOKEN_INVALID', 'OpenAI 연결 토큰을 사용할 수 없습니다.');
      }

      let response;
      try {
        if (controller.signal.aborted) throw abortError(controller.signal);
        response = await abortable(this.#fetch(MODELS_URL, {
          method: 'GET',
          redirect: 'error',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        fail('OPENAI_MODELS_NETWORK_ERROR', 'OpenAI 모델 목록에 연결하지 못했습니다.');
      }
      if (!response || typeof response !== 'object') fail('OPENAI_MODELS_HTTP_ERROR');
      let ok;
      let status;
      let redirected;
      let responseType;
      try {
        ok = response.ok;
        status = response.status;
        redirected = response.redirected;
        responseType = response.type;
      } catch {
        fail('OPENAI_MODELS_HTTP_ERROR');
      }
      if (redirected === true || responseType === 'opaqueredirect'
        || (Number.isInteger(status) && status >= 300 && status < 400)) {
        fail('OPENAI_MODELS_REDIRECT_REJECTED');
      }
      if (ok !== true) {
        if (status === 401) {
          fail('OPENAI_MODELS_AUTH_REQUIRED', 'OpenAI 로그인이 필요합니다.');
        }
        if (status === 403) fail('OPENAI_MODELS_ACCESS_DENIED');
        if (status === 429) fail('OPENAI_MODELS_RATE_LIMITED');
        if (Number.isInteger(status) && status >= 500 && status < 600) {
          fail('OPENAI_MODELS_SERVICE_UNAVAILABLE');
        }
        fail('OPENAI_MODELS_HTTP_ERROR', 'OpenAI 모델 목록 요청이 완료되지 않았습니다.');
      }

      let contentType;
      try {
        contentType = response.headers?.get?.('content-type');
      } catch {
        fail('OPENAI_MODELS_CONTENT_TYPE_INVALID');
      }
      if (typeof contentType !== 'string'
        || contentType.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        fail('OPENAI_MODELS_CONTENT_TYPE_INVALID');
      }

      if (controller.signal.aborted) throw abortError(controller.signal);
      const text = await readBoundedBody(response, controller.signal);
      if (controller.signal.aborted) throw abortError(controller.signal);
      return parseModels(text);
    } finally {
      if (timerStarted) {
        try {
          this.#clearTimeout(timer);
        } catch {
          // Test hooks and host cleanup cannot replace the authoritative result.
        }
      }
      if (callerListenerAttached) {
        try {
          signalRemove.call(callerSignal, 'abort', abortFromCaller);
        } catch {
          // A malformed caller signal cannot strand the client in an active state.
        }
      }
      if (this.#active === active) this.#active = null;
    }
  }
}

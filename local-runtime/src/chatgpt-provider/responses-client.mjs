export const RESPONSES_URL = 'https://api.openai.com/v1/responses';
export const DEFAULT_RESPONSE_DEADLINE_MS = 60_000;
export const MAX_SSE_EVENT_BYTES = 256 * 1_024;
export const MAX_SSE_TOTAL_BYTES = 1_024 * 1_024;
export const MAX_COMPLETED_TEXT_BYTES = 8 * 1_024;
export const MAX_SSE_EVENT_NAME_BYTES = 256;

const MODEL_SLUG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PERMITTED_SSE_EVENTS = new Set([
  'response.queued',
  'response.created',
  'response.in_progress',
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.refusal.delta',
  'response.refusal.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.delta',
  'response.reasoning_text.done',
  'response.completed',
  'response.failed',
  'response.incomplete',
  'error',
]);

export class ResponsesClientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ResponsesClientError';
    this.code = code;
  }
}

function fail(code, message = 'OpenAI 응답을 안전하게 처리하지 못했습니다.') {
  throw new ResponsesClientError(code, message);
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = expected.slice().sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function abortError(signal) {
  const code = signal.reason === 'deadline'
    ? 'OPENAI_RESPONSE_DEADLINE_EXCEEDED'
    : 'OPENAI_RESPONSE_CANCELLED';
  return new ResponsesClientError(code, code === 'OPENAI_RESPONSE_DEADLINE_EXCEEDED'
    ? 'OpenAI 응답 제한 시간을 초과했습니다.'
    : 'OpenAI 응답 요청이 취소되었습니다.');
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

function validateCompletedResponse(payload, boundResponseId, boundAssistantItemId) {
  const response = payload?.response;
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || typeof response.id !== 'string' || response.id.length === 0
    || response.status !== 'completed' || !Array.isArray(response.output)) {
    fail('OPENAI_RESPONSE_COMPLETION_INVALID');
  }
  if (boundResponseId && response.id !== boundResponseId) {
    fail('OPENAI_RESPONSE_IDENTITY_CHANGED');
  }

  let assistantMessage = null;
  for (const item of response.output) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    }
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message' || item.role !== 'assistant' || assistantMessage) {
      fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    }
    assistantMessage = item;
  }
  if (!assistantMessage || !Array.isArray(assistantMessage.content)
    || assistantMessage.content.length !== 1) {
    fail('OPENAI_RESPONSE_OUTPUT_INVALID');
  }
  if (boundAssistantItemId
    && (typeof assistantMessage.id !== 'string' || assistantMessage.id !== boundAssistantItemId)) {
    fail('OPENAI_RESPONSE_OUTPUT_INVALID');
  }
  const content = assistantMessage.content[0];
  if (!content || typeof content !== 'object' || Array.isArray(content)
    || content.type !== 'output_text' || typeof content.text !== 'string') {
    fail('OPENAI_RESPONSE_OUTPUT_INVALID');
  }
  if (Buffer.byteLength(content.text, 'utf8') > MAX_COMPLETED_TEXT_BYTES) {
    fail('OPENAI_RESPONSE_TEXT_TOO_LARGE');
  }
  return { responseId: response.id, text: content.text };
}

function payloadResponseIds(payload) {
  const ids = [];
  if (typeof payload?.response_id === 'string' && payload.response_id) ids.push(payload.response_id);
  if (typeof payload?.response?.id === 'string' && payload.response.id) ids.push(payload.response.id);
  return ids;
}

function bindResponseIdentity(current, payload) {
  let bound = current;
  for (const id of payloadResponseIds(payload)) {
    if (bound && bound !== id) fail('OPENAI_RESPONSE_IDENTITY_CHANGED');
    bound = id;
  }
  return bound;
}

async function consumeSse(response, signal, onAccepted) {
  let reader;
  try {
    reader = response.body?.getReader?.();
  } catch {
    fail('OPENAI_RESPONSE_STREAM_INVALID');
  }
  if (!reader) fail('OPENAI_RESPONSE_STREAM_INVALID');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let lineBytes = [];
  let eventBytes = 0;
  let eventName = null;
  let dataLines = [];
  let responseId = null;
  let accepted = null;
  let assistantItemId = null;
  let outputTextPartKey = null;
  let assistantItemDone = false;
  let outputTextPartAdded = false;
  let outputTextPartDone = false;
  let outputTextDone = false;

  const bindAssistantItem = (id) => {
    if (typeof id !== 'string' || id.length === 0) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    if (assistantItemId && assistantItemId !== id) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    assistantItemId = id;
  };

  const bindOutputTextPart = (payload) => {
    bindAssistantItem(payload.item_id);
    if (!Number.isSafeInteger(payload.content_index) || payload.content_index !== 0) {
      fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    }
    const key = `${payload.item_id}:${payload.content_index}`;
    if (outputTextPartKey && outputTextPartKey !== key) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    outputTextPartKey = key;
  };

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventBytes = 0;
      eventName = null;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(dataLines.join('\n'));
    } catch {
      fail('OPENAI_RESPONSE_SSE_INVALID');
    }
    dataLines = [];
    eventBytes = 0;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.type !== 'string') {
      fail('OPENAI_RESPONSE_SSE_INVALID');
    }
    if (eventName !== null
      && (!PERMITTED_SSE_EVENTS.has(eventName) || eventName !== payload.type)) {
      fail('OPENAI_RESPONSE_EVENT_UNSUPPORTED');
    }
    eventName = null;
    if (!PERMITTED_SSE_EVENTS.has(payload.type)) {
      fail('OPENAI_RESPONSE_EVENT_UNSUPPORTED');
    }
    responseId = bindResponseIdentity(responseId, payload);
    if (payload.type === 'response.failed' || payload.type === 'response.incomplete'
      || payload.type === 'error') {
      fail('OPENAI_RESPONSE_NOT_COMPLETED');
    }
    if (payload.type === 'response.output_item.added'
      || payload.type === 'response.output_item.done') {
      const type = payload.item?.type;
      if (type !== 'message' && type !== 'reasoning') {
        fail('OPENAI_RESPONSE_OUTPUT_INVALID');
      }
      if (type === 'message') {
        if (payload.item.role !== 'assistant') fail('OPENAI_RESPONSE_OUTPUT_INVALID');
        bindAssistantItem(payload.item.id);
        if (payload.type === 'response.output_item.done') {
          if (assistantItemDone) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
          assistantItemDone = true;
        }
      }
    }
    if (payload.type === 'response.content_part.added'
      || payload.type === 'response.content_part.done') {
      const partType = payload.part?.type;
      if ((partType !== 'output_text' && partType !== 'reasoning_text')
        || typeof payload.part.text !== 'string') {
        fail('OPENAI_RESPONSE_OUTPUT_INVALID');
      }
      if (partType === 'output_text') {
        bindOutputTextPart(payload);
        if (payload.type === 'response.content_part.added') {
          if (outputTextPartAdded) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
          outputTextPartAdded = true;
        } else {
          if (outputTextPartDone) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
          outputTextPartDone = true;
        }
      }
    }
    if (payload.type === 'response.output_text.delta') {
      if (typeof payload.delta !== 'string') fail('OPENAI_RESPONSE_SSE_INVALID');
      bindOutputTextPart(payload);
    }
    if (payload.type === 'response.output_text.done') {
      if (typeof payload.text !== 'string') fail('OPENAI_RESPONSE_SSE_INVALID');
      bindOutputTextPart(payload);
      if (outputTextDone) fail('OPENAI_RESPONSE_OUTPUT_INVALID');
      outputTextDone = true;
    }
    if ((payload.type === 'response.reasoning_summary_text.delta'
        || payload.type === 'response.reasoning_text.delta')
      && typeof payload.delta !== 'string') {
      fail('OPENAI_RESPONSE_SSE_INVALID');
    }
    if ((payload.type === 'response.reasoning_summary_text.done'
        || payload.type === 'response.reasoning_text.done')
      && typeof payload.text !== 'string') {
      fail('OPENAI_RESPONSE_SSE_INVALID');
    }
    if ((payload.type === 'response.reasoning_summary_part.added'
        || payload.type === 'response.reasoning_summary_part.done')
      && (payload.part?.type !== 'summary_text' || typeof payload.part.text !== 'string')) {
      fail('OPENAI_RESPONSE_SSE_INVALID');
    }
    if (payload.type === 'response.refusal.delta' || payload.type === 'response.refusal.done') {
      fail('OPENAI_RESPONSE_OUTPUT_INVALID');
    }
    if (payload.type === 'response.completed') {
      if (accepted) fail('OPENAI_RESPONSE_DUPLICATE_COMPLETION');
      accepted = validateCompletedResponse(payload, responseId, assistantItemId);
      responseId = accepted.responseId;
      onAccepted();
    }
  };

  const processLine = (bytes) => {
    let line;
    try {
      line = decoder.decode(Uint8Array.from(bytes), { stream: false });
    } catch {
      fail('OPENAI_RESPONSE_UTF8_INVALID');
    }
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    if (line === 'event' || line.startsWith('event:')) {
      if (eventName !== null) fail('OPENAI_RESPONSE_SSE_INVALID');
      let value = line === 'event' ? '' : line.slice(6);
      if (value.startsWith(' ')) value = value.slice(1);
      if (value.length === 0 || Buffer.byteLength(value, 'utf8') > MAX_SSE_EVENT_NAME_BYTES) {
        fail('OPENAI_RESPONSE_SSE_INVALID');
      }
      eventName = value;
      return;
    }
    if (line === 'data' || line.startsWith('data:')) {
      let value = line === 'data' ? '' : line.slice(5);
      if (value.startsWith(' ')) value = value.slice(1);
      dataLines.push(value);
    }
  };

  try {
    while (!accepted) {
      if (signal.aborted) throw abortError(signal);
      let part;
      try {
        part = await abortable(reader.read(), signal);
      } catch (error) {
        if (signal.aborted) throw abortError(signal);
        fail('OPENAI_RESPONSE_STREAM_ERROR');
      }
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) fail('OPENAI_RESPONSE_STREAM_INVALID');
      totalBytes += part.value.byteLength;
      if (totalBytes > MAX_SSE_TOTAL_BYTES) fail('OPENAI_RESPONSE_STREAM_TOO_LARGE');
      for (const byte of part.value) {
        eventBytes += 1;
        if (eventBytes > MAX_SSE_EVENT_BYTES) fail('OPENAI_RESPONSE_EVENT_TOO_LARGE');
        if (byte === 0x0a) {
          processLine(lineBytes);
          lineBytes = [];
        } else {
          lineBytes.push(byte);
        }
      }
    }
    if (!accepted) fail('OPENAI_RESPONSE_NOT_COMPLETED');
    return accepted.text;
  } finally {
    try {
      const cancelled = reader.cancel();
      if (cancelled && typeof cancelled.catch === 'function') cancelled.catch(() => {});
    } catch {
      // Reader cleanup must not replace the authoritative terminal result.
    }
    try {
      reader.releaseLock();
    } catch {
      // Some synthetic readers do not expose a releasable lock.
    }
  }
}

export class ResponsesClient {
  #fetch;
  #accessToken;
  #model;
  #deadlineMs;
  #setTimeout;
  #clearTimeout;
  #active = null;

  constructor({
    fetchImpl = globalThis.fetch,
    accessToken,
    model,
    deadlineMs = DEFAULT_RESPONSE_DEADLINE_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  } = {}) {
    if (typeof fetchImpl !== 'function' || typeof accessToken !== 'function') {
      fail('OPENAI_RESPONSE_CLIENT_INVALID');
    }
    if (typeof model !== 'string' || !MODEL_SLUG_PATTERN.test(model)) {
      fail('OPENAI_RESPONSE_MODEL_INVALID');
    }
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 60_000) {
      fail('OPENAI_RESPONSE_DEADLINE_INVALID');
    }
    if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
      fail('OPENAI_RESPONSE_CLIENT_INVALID');
    }
    this.#fetch = fetchImpl;
    this.#accessToken = accessToken;
    this.#model = model;
    this.#deadlineMs = deadlineMs;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
  }

  get active() {
    return this.#active !== null;
  }

  cancel() {
    if (!this.#active || this.#active.accepted) return false;
    if (!this.#active.controller.signal.aborted) this.#active.controller.abort('cancelled');
    return true;
  }

  async complete(options) {
    if (this.#active) fail('OPENAI_RESPONSE_BUSY', '다른 OpenAI 요청이 진행 중입니다.');
    if (!exactKeys(options, ['inputText', 'instructions', 'schema'])
      || typeof options.inputText !== 'string' || typeof options.instructions !== 'string'
      || !options.schema || typeof options.schema !== 'object' || Array.isArray(options.schema)) {
      fail('OPENAI_RESPONSE_REQUEST_INVALID');
    }

    const controller = new AbortController();
    const active = { controller, accepted: false };
    this.#active = active;
    const timer = this.#setTimeout(() => controller.abort('deadline'), this.#deadlineMs);
    try {
      let token;
      try {
        token = await abortable(this.#accessToken({ signal: controller.signal }), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        fail('OPENAI_RESPONSE_TOKEN_UNAVAILABLE', 'OpenAI 연결 토큰을 가져오지 못했습니다.');
      }
      if (typeof token !== 'string' || token.length === 0 || token.length > 65_536
        || /[\r\n]/u.test(token)) {
        fail('OPENAI_RESPONSE_TOKEN_INVALID', 'OpenAI 연결 토큰을 사용할 수 없습니다.');
      }

      const body = {
        model: this.#model,
        instructions: options.instructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: options.inputText }] }],
        store: false,
        stream: true,
        text: {
          format: {
            type: 'json_schema',
            name: 'athena_wts_intent',
            strict: true,
            schema: options.schema,
          },
        },
      };

      let response;
      try {
        response = await abortable(this.#fetch(RESPONSES_URL, {
          method: 'POST',
          redirect: 'error',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }), controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw abortError(controller.signal);
        fail('OPENAI_RESPONSE_NETWORK_ERROR', 'OpenAI에 연결하지 못했습니다.');
      }
      if (!response || response.ok !== true) {
        fail('OPENAI_RESPONSE_HTTP_ERROR', 'OpenAI 요청이 완료되지 않았습니다.');
      }
      let contentType;
      try {
        contentType = response.headers?.get?.('content-type');
      } catch {
        fail('OPENAI_RESPONSE_CONTENT_TYPE_INVALID');
      }
      if (typeof contentType !== 'string'
        || contentType.split(';', 1)[0].trim().toLowerCase() !== 'text/event-stream') {
        fail('OPENAI_RESPONSE_CONTENT_TYPE_INVALID');
      }
      const text = await consumeSse(response, controller.signal, () => {
        active.accepted = true;
      });
      return text;
    } finally {
      this.#clearTimeout(timer);
      if (this.#active === active) this.#active = null;
    }
  }
}

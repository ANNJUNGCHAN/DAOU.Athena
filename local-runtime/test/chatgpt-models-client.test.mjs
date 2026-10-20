import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MODELS_DEADLINE_MS,
  MAX_MODELS,
  MAX_MODELS_BODY_BYTES,
  MODELS_URL,
  ModelsClient,
} from '../src/chatgpt-provider/models-client.mjs';

const encoder = new TextEncoder();

function jsonResponse(payload, {
  status = 200,
  contentType = 'application/json; charset=utf-8',
  redirected = false,
  chunks,
} = {}) {
  const bodyChunks = chunks ?? [encoder.encode(JSON.stringify(payload))];
  return {
    ok: status >= 200 && status < 300,
    status,
    redirected,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of bodyChunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

function client(fetchImpl, overrides = {}) {
  return new ModelsClient({
    fetchImpl,
    accessToken: async () => 'private-token-value',
    ...overrides,
  });
}

test('uses the fixed SIWC endpoint with only the Bearer header and no payload', async () => {
  let call;
  let suppliedSignal;
  const instance = client(async (...args) => {
    call = args;
    return jsonResponse({ models: [{ slug: 'gpt-test.1', display_name: 'GPT Test', visibility: 'list' }] });
  }, {
    accessToken: async ({ signal }) => { suppliedSignal = signal; return 'private-token-value'; },
  });

  assert.deepEqual(await instance.list(), [{ slug: 'gpt-test.1', displayName: 'GPT Test' }]);
  assert.equal(call[0], MODELS_URL);
  assert.deepEqual(Object.keys(call[1]).sort(), ['headers', 'method', 'redirect', 'signal']);
  assert.equal(call[1].method, 'GET');
  assert.equal(call[1].redirect, 'error');
  assert.deepEqual(call[1].headers, { Authorization: 'Bearer private-token-value' });
  assert.equal(call[1].signal, suppliedSignal);
  assert.equal(Object.hasOwn(call[1], 'body'), false);
});

test('accepts only the SIWC models shape and ignores unknown metadata', async () => {
  const result = await client(async () => jsonResponse({
    object: 'list',
    models: [{
      slug: 'gpt-si.1', display_name: '모델 하나', visibility: 'list', capability: 'unknown',
    }],
    extra: { canary: 'ignored' },
  })).list();
  assert.deepEqual(result, [{ slug: 'gpt-si.1', displayName: '모델 하나' }]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result[0]), true);

  await assert.rejects(
    client(async () => jsonResponse({ data: [{ id: 'gpt-generic' }] })).list(),
    { code: 'OPENAI_MODELS_PAYLOAD_INVALID' },
  );
});

test('preserves server order, filters hidden models and allows an empty visible capability', async () => {
  const payload = {
    models: [
      { slug: 'hidden-bad/slug', display_name: '', visibility: 'hidden' },
      { slug: 'model-b', display_name: 'B', visibility: 'list' },
      { slug: 'model-a', display_name: 'A', visibility: 'list' },
      { slug: 'internal', display_name: 'Internal', visibility: 'internal' },
    ],
  };
  assert.deepEqual(await client(async () => jsonResponse(payload)).list(), [
    { slug: 'model-b', displayName: 'B' },
    { slug: 'model-a', displayName: 'A' },
  ]);
  assert.deepEqual(await client(async () => jsonResponse({
    models: [{ slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' }],
  })).list(), []);
});

test('rejects invalid and duplicate visible model slugs', async () => {
  const cases = [
    [{ slug: '', display_name: 'A', visibility: 'list' }],
    [{ slug: 'bad/slug', display_name: 'A', visibility: 'list' }],
    [{ slug: `a${'b'.repeat(128)}`, display_name: 'A', visibility: 'list' }],
    [
      { slug: 'same', display_name: 'First', visibility: 'list' },
      { slug: 'same', display_name: 'Second', visibility: 'list' },
    ],
  ];
  for (const models of cases) {
    await assert.rejects(
      client(async () => jsonResponse({ models })).list(),
      { code: 'OPENAI_MODELS_ENTRY_INVALID' },
    );
  }
});

test('enforces display-name Unicode scalar, byte and invisible-character bounds', async () => {
  const boundary = '😀'.repeat(128);
  assert.equal(Buffer.byteLength(boundary, 'utf8'), 512);
  assert.deepEqual(await client(async () => jsonResponse({ models: [{
    slug: 'unicode-ok', display_name: boundary, visibility: 'list',
  }] })).list(), [{ slug: 'unicode-ok', displayName: boundary }]);

  const invalidNames = [
    '',
    'a'.repeat(129),
    '😀'.repeat(129),
    'bad\u0000name',
    'bad\u200bname',
    'bad\u2028name',
    'bad\u2029name',
    'bad\u034fname',
    'bad\ufdd0name',
    `bad${String.fromCharCode(0xd800)}name`,
  ];
  for (const display_name of invalidNames) {
    await assert.rejects(
      client(async () => jsonResponse({
        models: [{ slug: 'unicode-bad', display_name, visibility: 'list' }],
      })).list(),
      { code: 'OPENAI_MODELS_ENTRY_INVALID' },
    );
  }
});

test('bounds the models array and validates every array item as an object', async () => {
  await assert.rejects(
    client(async () => jsonResponse({
      models: Array.from({ length: MAX_MODELS + 1 }, (_, index) => ({
        slug: `hidden-${index}`, display_name: 'Hidden', visibility: 'hidden',
      })),
    })).list(),
    { code: 'OPENAI_MODELS_COUNT_EXCEEDED' },
  );
  for (const models of [[null], [[]], ['hidden']]) {
    await assert.rejects(
      client(async () => jsonResponse({ models })).list(),
      { code: 'OPENAI_MODELS_ENTRY_INVALID' },
    );
  }
});

test('classifies auth, other HTTP, redirect and content-type failures without retrying', async () => {
  const cases = [
    [jsonResponse({}, { status: 401 }), 'OPENAI_MODELS_AUTH_REQUIRED'],
    [jsonResponse({}, { status: 403 }), 'OPENAI_MODELS_ACCESS_DENIED'],
    [jsonResponse({}, { status: 429 }), 'OPENAI_MODELS_RATE_LIMITED'],
    [jsonResponse({}, { status: 500 }), 'OPENAI_MODELS_SERVICE_UNAVAILABLE'],
    [jsonResponse({}, { status: 503 }), 'OPENAI_MODELS_SERVICE_UNAVAILABLE'],
    [jsonResponse({}, { status: 400 }), 'OPENAI_MODELS_HTTP_ERROR'],
    [jsonResponse({}, { status: 302 }), 'OPENAI_MODELS_REDIRECT_REJECTED'],
    [jsonResponse({}, { redirected: true }), 'OPENAI_MODELS_REDIRECT_REJECTED'],
    [jsonResponse({}, { contentType: 'text/html' }), 'OPENAI_MODELS_CONTENT_TYPE_INVALID'],
  ];
  for (const [response, code] of cases) {
    let calls = 0;
    await assert.rejects(client(async () => { calls += 1; return response; }).list(), { code });
    assert.equal(calls, 1);
  }
});

test('HTTP model diagnostics never read or expose the error body', async () => {
  for (const status of [401, 403, 429, 500, 599, 400]) {
    let bodyReads = 0;
    const response = {
      ok: false, status,
      get body() { bodyReads += 1; throw new Error('private-error-body'); },
    };
    const error = await client(async () => response).list().catch((value) => value);
    assert.equal(bodyReads, 0);
    assert.doesNotMatch(error.message, /private-|https?:|Bearer/u);
    assert.equal(Object.hasOwn(error, 'cause'), false);
  }
});

test('rejects malformed JSON, fatal UTF-8 and oversized streaming bodies', async () => {
  const cases = [
    [jsonResponse(null, { chunks: [encoder.encode('{nope}')] }), 'OPENAI_MODELS_JSON_INVALID'],
    [jsonResponse(null, { chunks: [Uint8Array.of(0xc3, 0x28)] }), 'OPENAI_MODELS_UTF8_INVALID'],
    [jsonResponse(null, { chunks: [new Uint8Array(MAX_MODELS_BODY_BYTES + 1)] }), 'OPENAI_MODELS_BODY_TOO_LARGE'],
  ];
  for (const [response, code] of cases) {
    await assert.rejects(client(async () => response).list(), { code });
  }
});

test('accepts a SIWC catalog above 256 KiB while returning only bounded display fields', async () => {
  const payload = {
    models: [{
      slug: 'model-large-metadata', display_name: 'Large metadata model', visibility: 'list',
      unused_metadata: `private-metadata-canary${'x'.repeat(300 * 1_024)}`,
    }],
  };
  const bytes = encoder.encode(JSON.stringify(payload));
  assert.ok(bytes.byteLength > 256 * 1_024);
  const result = await client(async () => jsonResponse(payload)).list();
  assert.deepEqual(result, [{ slug: 'model-large-metadata', displayName: 'Large metadata model' }]);
  assert.doesNotMatch(JSON.stringify(result), /private-metadata-canary|unused_metadata/u);
});

test('accepts an exactly 8 MiB SIWC response with unused metadata', async () => {
  const limit = 8 * 1_024 * 1_024;
  const payload = {
    models: [{ slug: 'boundary-model', display_name: 'Boundary model', visibility: 'list' }],
    unused_metadata: '',
  };
  payload.unused_metadata = 'x'.repeat(limit - encoder.encode(JSON.stringify(payload)).byteLength);
  const bytes = encoder.encode(JSON.stringify(payload));
  assert.equal(bytes.byteLength, limit);
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 64 * 1_024) {
    chunks.push(bytes.subarray(offset, offset + 64 * 1_024));
  }
  const instance = client(async () => jsonResponse(null, { chunks }));
  assert.deepEqual(await instance.list(), [{ slug: 'boundary-model', displayName: 'Boundary model' }]);
  assert.equal(MAX_MODELS_BODY_BYTES, limit);
  assert.equal(instance.active, false);
});

test('rejects a split response beyond 8 MiB, stops reading and cleans the reader once', async () => {
  let reads = 0;
  let cancelCalls = 0;
  let releaseCalls = 0;
  const chunk = new Uint8Array(1_024 * 1_024).fill(0x20);
  const instance = client(async () => ({
    ok: true, status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => ({
      read: async () => {
        reads += 1;
        if (reads <= 8) return { done: false, value: chunk };
        if (reads === 9) return { done: false, value: Uint8Array.of(0x20) };
        throw new Error('private-unexpected-read');
      },
      cancel: () => { cancelCalls += 1; },
      releaseLock: () => { releaseCalls += 1; },
    }) },
  }));
  const error = await instance.list().catch((value) => value);
  assert.equal(error.code, 'OPENAI_MODELS_BODY_TOO_LARGE');
  assert.doesNotMatch(error.message, /private-|token|https?:/u);
  assert.equal(reads, 9);
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
  assert.equal(instance.active, false);
});

test('redacts tokens, response canaries and raw supplier, fetch and reader errors', async () => {
  const token = 'private-token-canary';
  const responseCanary = 'private-response-canary';
  const cases = [
    client(async () => { throw new Error('private-fetch-canary'); }, { accessToken: async () => token }),
    client(async () => jsonResponse({}), {
      accessToken: async () => { throw new Error('private-supplier-canary'); },
    }),
    client(async () => ({
      ok: true,
      headers: { get: () => 'application/json' },
      body: { getReader: () => ({
        read: async () => { throw new Error('private-reader-canary'); },
        cancel() {},
        releaseLock() {},
      }) },
    })),
    client(async () => Object.defineProperty({}, 'ok', {
      get() { throw new Error('private-response-getter-canary'); },
    })),
    client(async () => jsonResponse(null, { chunks: [encoder.encode(`{${responseCanary}}`)] })),
  ];
  for (const instance of cases) {
    const error = await instance.list().catch((value) => value);
    assert.equal(error instanceof Error, true);
    assert.equal(error.message.includes('private-'), false);
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(responseCanary), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
  }
});

test('normalizes throwing reader-result getters and still cleans the reader', async () => {
  for (const property of ['done', 'value']) {
    let cancelCalls = 0;
    let releaseCalls = 0;
    const part = {};
    if (property === 'value') part.done = false;
    Object.defineProperty(part, property, {
      get() { throw new Error('reader-result-private-canary'); },
    });
    const instance = client(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: { getReader: () => ({
        read: async () => part,
        cancel: () => { cancelCalls += 1; },
        releaseLock: () => { releaseCalls += 1; },
      }) },
    }));
    const error = await instance.list().catch((value) => value);
    assert.equal(error.code, 'OPENAI_MODELS_BODY_INVALID');
    assert.equal(error.message.includes('private-canary'), false);
    assert.equal(cancelCalls, 1);
    assert.equal(releaseCalls, 1);
    assert.equal(instance.active, false);
  }

  const bytes = encoder.encode(JSON.stringify({ models: [] }));
  Object.defineProperty(bytes, 'byteLength', {
    get() { throw new Error('reader-bytes-private-canary'); },
  });
  let reads = 0;
  assert.deepEqual(await client(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => ({
      read: async () => reads++ === 0 ? { done: false, value: bytes } : { done: true },
      cancel() {},
      releaseLock() {},
    }) },
  })).list(), []);
});

test('malformed signal and timer hooks cannot leak errors or strand active state', async () => {
  let tokenCalls = 0;
  const throwingSignal = {
    aborted: false,
    addEventListener() { throw new Error('signal-add-private-canary'); },
    removeEventListener() {},
  };
  const addFailure = client(async () => { throw new Error('must not fetch'); }, {
    accessToken: async () => { tokenCalls += 1; return 'token'; },
  });
  const addError = await addFailure.list({ signal: throwingSignal }).catch((value) => value);
  assert.equal(addError.code, 'OPENAI_MODELS_REQUEST_INVALID');
  assert.equal(addError.message.includes('private-canary'), false);
  assert.equal(addFailure.active, false);
  assert.equal(tokenCalls, 0);

  const timerFailure = client(async () => { throw new Error('must not fetch'); }, {
    accessToken: async () => { tokenCalls += 1; return 'token'; },
    setTimeoutImpl: () => { throw new Error('timer-private-canary'); },
  });
  const timerError = await timerFailure.list().catch((value) => value);
  assert.equal(timerError.code, 'OPENAI_MODELS_CLIENT_INVALID');
  assert.equal(timerError.message.includes('private-canary'), false);
  assert.equal(timerFailure.active, false);
  assert.equal(tokenCalls, 0);

  const cleanupSignal = {
    aborted: false,
    addEventListener() {},
    removeEventListener() { throw new Error('signal-remove-private-canary'); },
  };
  const cleanup = client(async () => jsonResponse({ models: [] }), {
    setTimeoutImpl: () => 23,
    clearTimeoutImpl: () => { throw new Error('timer-clear-private-canary'); },
  });
  assert.deepEqual(await cleanup.list({ signal: cleanupSignal }), []);
  assert.equal(cleanup.active, false);
});

test('pre-aborted input performs no token, fetch or reader side work', async () => {
  const caller = new AbortController();
  caller.abort('caller-private-reason');
  let tokenCalls = 0;
  let fetchCalls = 0;
  let readCalls = 0;
  const instance = client(async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      body: { getReader: () => { readCalls += 1; return null; } },
    };
  }, {
    accessToken: async () => { tokenCalls += 1; return 'private-token'; },
  });
  await assert.rejects(instance.list({ signal: caller.signal }), { code: 'OPENAI_MODELS_CANCELLED' });
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.equal(readCalls, 0);
  assert.equal(instance.active, false);
});

test('the 20 second deadline includes noncooperative token acquisition', async () => {
  let fire;
  let recordedDelay;
  let cleared = false;
  let fetchCalls = 0;
  const instance = client(async () => { fetchCalls += 1; }, {
    accessToken: async () => new Promise(() => {}),
    setTimeoutImpl: (callback, delay) => { fire = callback; recordedDelay = delay; return 17; },
    clearTimeoutImpl: (id) => { assert.equal(id, 17); cleared = true; },
  });
  const pending = instance.list();
  assert.equal(recordedDelay, DEFAULT_MODELS_DEADLINE_MS);
  fire();
  await assert.rejects(pending, { code: 'OPENAI_MODELS_DEADLINE_EXCEEDED' });
  assert.equal(fetchCalls, 0);
  assert.equal(cleared, true);
});

test('cancels a noncooperative fetch and prevents its late result from publishing', async () => {
  let resolveFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const instance = client(async () => new Promise((resolve) => {
    resolveFetch = resolve;
    markFetchStarted();
  }));
  const pending = instance.list();
  await fetchStarted;
  assert.equal(instance.active, true);
  assert.equal(instance.cancel(), true);
  assert.equal(instance.cancel(), true);
  await assert.rejects(pending, { code: 'OPENAI_MODELS_CANCELLED' });
  assert.equal(instance.active, false);
  assert.equal(instance.cancel(), false);
  resolveFetch(jsonResponse({ models: [{ slug: 'late', display_name: 'Late', visibility: 'list' }] }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instance.active, false);
});

test('caller cancellation bounds a noncooperative read and cleans its reader exactly once', async () => {
  const caller = new AbortController();
  let markReadStarted;
  const readStarted = new Promise((resolve) => { markReadStarted = resolve; });
  let cancelCalls = 0;
  let releaseCalls = 0;
  const instance = client(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => ({
      read: () => { markReadStarted(); return new Promise(() => {}); },
      cancel: () => { cancelCalls += 1; },
      releaseLock: () => { releaseCalls += 1; },
    }) },
  }));
  const pending = instance.list({ signal: caller.signal });
  await readStarted;
  caller.abort('caller-private-reason');
  await assert.rejects(pending, { code: 'OPENAI_MODELS_CANCELLED' });
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
});

test('releases and cancels the reader once after a successful list', async () => {
  let reads = 0;
  let cancelCalls = 0;
  let releaseCalls = 0;
  const bytes = encoder.encode(JSON.stringify({
    models: [{ slug: 'clean', display_name: 'Clean', visibility: 'list' }],
  }));
  const result = await client(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => ({
      read: async () => reads++ === 0 ? { done: false, value: bytes } : { done: true },
      cancel: () => { cancelCalls += 1; },
      releaseLock: () => { releaseCalls += 1; },
    }) },
  })).list();
  assert.deepEqual(result, [{ slug: 'clean', displayName: 'Clean' }]);
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
});

test('an abort triggered by reader cleanup blocks late model publication', async () => {
  const caller = new AbortController();
  let reads = 0;
  let releaseCalls = 0;
  const bytes = encoder.encode(JSON.stringify({
    models: [{ slug: 'stale', display_name: 'Stale', visibility: 'list' }],
  }));
  const instance = client(async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => ({
      read: async () => reads++ === 0 ? { done: false, value: bytes } : { done: true },
      cancel: () => { caller.abort('cleanup-cancelled'); },
      releaseLock: () => { releaseCalls += 1; },
    }) },
  }));
  await assert.rejects(instance.list({ signal: caller.signal }), {
    code: 'OPENAI_MODELS_CANCELLED',
  });
  assert.equal(caller.signal.aborted, true);
  assert.equal(releaseCalls, 1);
  assert.equal(instance.active, false);
});

test('single-flight rejects overlap and permits a fresh uncached request afterward', async () => {
  let resolveFirst;
  let markFirst;
  const firstStarted = new Promise((resolve) => { markFirst = resolve; });
  let calls = 0;
  const instance = client(async () => {
    calls += 1;
    if (calls === 1) return new Promise((resolve) => { resolveFirst = resolve; markFirst(); });
    return jsonResponse({ models: [] });
  });
  const pending = instance.list();
  await firstStarted;
  await assert.rejects(instance.list(), { code: 'OPENAI_MODELS_BUSY' });
  resolveFirst(jsonResponse({ models: [] }));
  assert.deepEqual(await pending, []);
  assert.deepEqual(await instance.list(), []);
  assert.equal(calls, 2);
});

test('rejects invalid options, token values and out-of-bound test deadlines before fetch', async () => {
  assert.throws(() => client(async () => {}, { deadlineMs: 0 }), { code: 'OPENAI_MODELS_DEADLINE_INVALID' });
  assert.throws(() => client(async () => {}, { deadlineMs: DEFAULT_MODELS_DEADLINE_MS + 1 }), {
    code: 'OPENAI_MODELS_DEADLINE_INVALID',
  });
  for (const token of ['', 'bad\r\ntoken', 12]) {
    await assert.rejects(client(async () => { throw new Error('must not fetch'); }, {
      accessToken: async () => token,
      deadlineMs: 1,
    }).list(), { code: 'OPENAI_MODELS_TOKEN_INVALID' });
  }
  await assert.rejects(client(async () => {}).list({ extra: true }), {
    code: 'OPENAI_MODELS_REQUEST_INVALID',
  });
});

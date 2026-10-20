import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_COMPLETED_TEXT_BYTES,
  MAX_SSE_EVENT_BYTES,
  MAX_SSE_TOTAL_BYTES,
  RESPONSES_URL,
  ResponsesClient,
} from '../src/chatgpt-provider/responses-client.mjs';

const encoder = new TextEncoder();
const REQUEST = Object.freeze({
  inputText: '한 주 단위 차트로 바꿔줘',
  instructions: '정해진 JSON만 반환하세요.',
  schema: { type: 'object', additionalProperties: false },
});

function completed(text, id = 'resp_athena_1', output) {
  return {
    type: 'response.completed',
    response: {
      id,
      status: 'completed',
      output: output ?? [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      }],
    },
  };
}

function sse(...payloads) {
  return payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join('');
}

function streamResponse(chunks, { status = 200, contentType = 'text/event-stream; charset=utf-8' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  };
}

function client(fetchImpl, overrides = {}) {
  return new ResponsesClient({
    fetchImpl,
    accessToken: async () => 'private-token-value',
    model: 'gpt-test.1',
    ...overrides,
  });
}

test('sends the exact allowlisted Responses request to the fixed endpoint', async () => {
  let call;
  const expected = '{"assistantText":"주봉 전환을 제안합니다.","proposal":{"kind":"wts-control","text":"주봉으로"}}';
  const result = await client(async (...args) => {
    call = args;
    return streamResponse([encoder.encode(sse(completed(expected)))]);
  }).complete(REQUEST);

  assert.equal(result, expected);
  assert.equal(call[0], RESPONSES_URL);
  assert.equal(call[1].method, 'POST');
  assert.equal(call[1].redirect, 'error');
  assert.equal(call[1].headers.Authorization, 'Bearer private-token-value');
  assert.equal(call[1].headers.Accept, 'text/event-stream');
  const body = JSON.parse(call[1].body);
  assert.deepEqual(Object.keys(body).sort(), [
    'input', 'instructions', 'model', 'store', 'stream', 'text',
  ]);
  assert.equal(body.model, 'gpt-test.1');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  assert.deepEqual(body.input, [{
    role: 'user', content: [{ type: 'input_text', text: REQUEST.inputText }],
  }]);
  assert.deepEqual(body.text.format, {
    type: 'json_schema', name: 'athena_wts_intent', strict: true, schema: REQUEST.schema,
  });
  for (const forbidden of [
    'tools', 'background', 'conversation', 'previous_response_id', 'max_output_tokens',
    'temperature', 'top_p',
  ]) assert.equal(Object.hasOwn(body, forbidden), false);
});

test('parses comments, CRLF, fragmented UTF-8 and arbitrary byte boundaries', async () => {
  const expected = '{"assistantText":"주봉 변경을 제안해요 📈","proposal":null}';
  const wire = encoder.encode(`: keepalive\r\ndata: ${JSON.stringify({
    type: 'response.created', response: { id: 'resp_fragmented' },
  })}\r\n\r\ndata: ${JSON.stringify(completed(expected, 'resp_fragmented'))}\r\n\r\n`);
  const chunks = Array.from(wire, (byte) => Uint8Array.of(byte));
  assert.equal(await client(async () => streamResponse(chunks)).complete(REQUEST), expected);
});

test('allows reasoning bookkeeping but requires one final assistant output_text message', async () => {
  const expected = '{"assistantText":"제안입니다.","proposal":null}';
  const output = [
    { type: 'reasoning', id: 'reasoning_1', summary: [] },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: expected }] },
  ];
  assert.equal(
    await client(async () => streamResponse([encoder.encode(sse(
      { type: 'response.output_item.added', response_id: 'resp_1', item: { type: 'reasoning', id: 'reason_1' } },
      { type: 'response.content_part.added', response_id: 'resp_1', part: { type: 'reasoning_text', text: '' } },
      { type: 'response.reasoning_text.delta', response_id: 'resp_1', delta: '생각' },
      { type: 'response.reasoning_text.done', response_id: 'resp_1', text: '생각' },
      { type: 'response.content_part.done', response_id: 'resp_1', part: { type: 'reasoning_text', text: '생각' } },
      { type: 'response.output_item.done', response_id: 'resp_1', item: { type: 'reasoning', id: 'reason_1' } },
      { type: 'response.reasoning_summary_part.added', response_id: 'resp_1', part: { type: 'summary_text', text: '' } },
      { type: 'response.reasoning_summary_text.delta', response_id: 'resp_1', delta: '요약' },
      { type: 'response.reasoning_summary_text.done', response_id: 'resp_1', text: '요약' },
      { type: 'response.reasoning_summary_part.done', response_id: 'resp_1', part: { type: 'summary_text', text: '요약' } },
      completed(expected, 'resp_1', output),
    ))])).complete(REQUEST),
    expected,
  );
});

test('rejects malformed reasoning bookkeeping before final completion', async () => {
  const final = completed('{"assistantText":"x","proposal":null}', 'resp_1');
  const cases = [
    { type: 'response.reasoning_text.delta', response_id: 'resp_1', delta: 1 },
    { type: 'response.reasoning_text.done', response_id: 'resp_1' },
    { type: 'response.reasoning_summary_text.delta', response_id: 'resp_1' },
    { type: 'response.reasoning_summary_text.done', response_id: 'resp_1', text: null },
    { type: 'response.reasoning_summary_part.added', response_id: 'resp_1', part: { type: 'other' } },
    { type: 'response.reasoning_summary_part.done', response_id: 'resp_1', part: { type: 'summary_text', text: {} } },
    { type: 'response.content_part.added', response_id: 'resp_1', part: { type: 'reasoning_text' } },
  ];
  for (const payload of cases) {
    await assert.rejects(
      client(async () => streamResponse([encoder.encode(sse(payload, final))])).complete(REQUEST),
      (error) => error.code === 'OPENAI_RESPONSE_SSE_INVALID'
        || error.code === 'OPENAI_RESPONSE_OUTPUT_INVALID',
    );
  }
});

test('rejects response identity changes and duplicate completions already consumed', async () => {
  const created = { type: 'response.created', response: { id: 'resp_first' } };
  await assert.rejects(
    client(async () => streamResponse([encoder.encode(sse(
      created,
      completed('{"assistantText":"x","proposal":null}', 'resp_second'),
    ))])).complete(REQUEST),
    { code: 'OPENAI_RESPONSE_IDENTITY_CHANGED' },
  );
  await assert.rejects(
    client(async () => streamResponse([encoder.encode(sse(
      completed('{"assistantText":"x","proposal":null}', 'resp_same'),
      completed('{"assistantText":"y","proposal":null}', 'resp_same'),
    ))])).complete(REQUEST),
    { code: 'OPENAI_RESPONSE_DUPLICATE_COMPLETION' },
  );
});

test('binds exactly one streamed assistant item and output-text lifecycle to final output', async () => {
  const finalFor = (id) => completed('x', 'resp_1', [{
    id,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text: 'x' }],
  }]);
  const added = (id) => ({
    type: 'response.output_item.added', response_id: 'resp_1', item: { id, type: 'message', role: 'assistant' },
  });
  const partDone = (id) => ({
    type: 'response.content_part.done', response_id: 'resp_1', item_id: id, content_index: 0,
    part: { type: 'output_text', text: 'x' },
  });
  const textDone = (id) => ({
    type: 'response.output_text.done', response_id: 'resp_1', item_id: id, content_index: 0, text: 'x',
  });
  const valid = [
    added('m1'),
    {
      type: 'response.content_part.added', response_id: 'resp_1', item_id: 'm1', content_index: 0,
      part: { type: 'output_text', text: '' },
    },
    { type: 'response.output_text.delta', response_id: 'resp_1', item_id: 'm1', content_index: 0, delta: 'x' },
    textDone('m1'),
    partDone('m1'),
    {
      type: 'response.output_item.done', response_id: 'resp_1',
      item: { id: 'm1', type: 'message', role: 'assistant' },
    },
    finalFor('m1'),
  ];
  assert.equal(
    await client(async () => streamResponse([encoder.encode(sse(...valid))])).complete(REQUEST),
    'x',
  );
  const cases = [
    [added('m1'), added('m2'), finalFor('m1')],
    [added('m1'), textDone('m1'), textDone('m1'), finalFor('m1')],
    [added('m1'), partDone('m1'), partDone('m1'), finalFor('m1')],
    [added('m1'), finalFor('m2')],
  ];
  for (const events of cases) {
    await assert.rejects(
      client(async () => streamResponse([encoder.encode(sse(...events))])).complete(REQUEST),
      { code: 'OPENAI_RESPONSE_OUTPUT_INVALID' },
    );
  }
});

test('rejects failed, incomplete, refusal, tool and multiple assistant outputs', async () => {
  const cases = [
    [{ type: 'response.failed', response: { id: 'resp_1' } }, 'OPENAI_RESPONSE_NOT_COMPLETED'],
    [{ type: 'response.incomplete', response: { id: 'resp_1' } }, 'OPENAI_RESPONSE_NOT_COMPLETED'],
    [{ type: 'response.refusal.done', response_id: 'resp_1' }, 'OPENAI_RESPONSE_OUTPUT_INVALID'],
    [{
      type: 'response.output_item.added', response_id: 'resp_1', item: { type: 'function_call' },
    }, 'OPENAI_RESPONSE_OUTPUT_INVALID'],
    [completed('x', 'resp_1', [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'x' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'y' }] },
    ]), 'OPENAI_RESPONSE_OUTPUT_INVALID'],
  ];
  for (const [payload, code] of cases) {
    await assert.rejects(
      client(async () => streamResponse([encoder.encode(sse(payload))])).complete(REQUEST),
      { code },
    );
  }
});

test('rejects direct tool events and malformed output lifecycle before a valid completion', async () => {
  const final = completed('{"assistantText":"x","proposal":null}', 'resp_1');
  const cases = [
    { type: 'response.function_call_arguments.delta', response_id: 'resp_1', delta: '{}' },
    { type: 'response.mcp_call_arguments.delta', response_id: 'resp_1', delta: '{}' },
    { type: 'response.mcp_call.completed', response_id: 'resp_1' },
    { type: 'response.file_search_call.searching', response_id: 'resp_1' },
    { type: 'response.code_interpreter_call_code.delta', response_id: 'resp_1', delta: 'x' },
    { type: 'response.computer_tool_call.in_progress', response_id: 'resp_1' },
    { type: 'response.shell_call.in_progress', response_id: 'resp_1' },
    { type: 'response.web_search_call.in_progress', response_id: 'resp_1' },
    { type: 'response.output_item.done', response_id: 'resp_1', item: { type: 'function_call' } },
    { type: 'response.output_item.added', response_id: 'resp_1' },
    { type: 'response.content_part.done', response_id: 'resp_1', part: { type: 'refusal' } },
    { type: 'response.content_part.added', response_id: 'resp_1' },
  ];
  for (const payload of cases) {
    await assert.rejects(
      client(async () => streamResponse([encoder.encode(sse(payload, final))])).complete(REQUEST),
      (error) => error.code === 'OPENAI_RESPONSE_EVENT_UNSUPPORTED'
        || error.code === 'OPENAI_RESPONSE_OUTPUT_INVALID',
    );
  }
});

test('binds one optional SSE event header exactly to the JSON event type', async () => {
  const final = completed('{"assistantText":"x","proposal":null}', 'resp_1');
  const matching = `event: response.completed\ndata: ${JSON.stringify(final)}\n\n`;
  assert.equal(await client(async () => streamResponse([encoder.encode(matching)])).complete(REQUEST),
    '{"assistantText":"x","proposal":null}');

  const toolHeader = `event: response.function_call_arguments.delta\ndata: ${JSON.stringify(final)}\n\n`;
  await assert.rejects(
    client(async () => streamResponse([encoder.encode(toolHeader)])).complete(REQUEST),
    { code: 'OPENAI_RESPONSE_EVENT_UNSUPPORTED' },
  );
  const duplicate = `event: response.completed\nevent: response.completed\ndata: ${JSON.stringify(final)}\n\n`;
  await assert.rejects(
    client(async () => streamResponse([encoder.encode(duplicate)])).complete(REQUEST),
    { code: 'OPENAI_RESPONSE_SSE_INVALID' },
  );
});

test('rejects malformed JSON, invalid UTF-8, wrong content type and oversized events', async () => {
  const cases = [
    [streamResponse([encoder.encode('data: {nope}\n\n')]), 'OPENAI_RESPONSE_SSE_INVALID'],
    [streamResponse([Uint8Array.of(0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xc3, 0x28, 0x0a, 0x0a)]), 'OPENAI_RESPONSE_UTF8_INVALID'],
    [streamResponse([encoder.encode(sse(completed('x')))], { contentType: 'application/json' }), 'OPENAI_RESPONSE_CONTENT_TYPE_INVALID'],
    [streamResponse([encoder.encode(`data: ${'x'.repeat(MAX_SSE_EVENT_BYTES)}\n\n`)]), 'OPENAI_RESPONSE_EVENT_TOO_LARGE'],
  ];
  for (const [response, code] of cases) {
    await assert.rejects(client(async () => response).complete(REQUEST), { code });
  }
});

test('enforces total stream and completed-text byte limits', async () => {
  const commentEvent = encoder.encode(`:${'x'.repeat(220_000)}\n\n`);
  const tooLargeStream = Array.from(
    { length: Math.ceil(MAX_SSE_TOTAL_BYTES / commentEvent.byteLength) + 1 },
    () => commentEvent,
  );
  await assert.rejects(
    client(async () => streamResponse(tooLargeStream)).complete(REQUEST),
    { code: 'OPENAI_RESPONSE_STREAM_TOO_LARGE' },
  );
  await assert.rejects(
    client(async () => streamResponse([encoder.encode(sse(completed('x'.repeat(MAX_COMPLETED_TEXT_BYTES + 1))))])).complete(REQUEST),
    { code: 'OPENAI_RESPONSE_TEXT_TOO_LARGE' },
  );
});

test('does not retry HTTP errors and redacts token, prompt and response details', async () => {
  let calls = 0;
  const prompt = 'secret prompt value';
  const token = 'secret-token-value';
  const instance = client(async () => {
    calls += 1;
    return streamResponse([], { status: 429 });
  }, { accessToken: async () => token });
  const error = await instance.complete({ ...REQUEST, inputText: prompt }).catch((value) => value);
  assert.equal(calls, 1);
  assert.equal(error.code, 'OPENAI_RESPONSE_HTTP_ERROR');
  assert.equal(error.message.includes(token), false);
  assert.equal(error.message.includes(prompt), false);
  assert.equal(error.message.includes('429'), false);
});

test('redacts raw token-supplier, fetch and reader failures', async () => {
  const cases = [
    client(async () => { throw new Error('fetch-private-detail'); }),
    client(async () => { throw new Error('unused'); }, {
      accessToken: async () => { throw new Error('token-private-detail'); },
    }),
    client(async () => ({
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: { getReader: () => ({
        read: async () => { throw new Error('reader-private-detail'); },
        cancel() {},
        releaseLock() {},
      }) },
    })),
  ];
  for (const instance of cases) {
    const error = await instance.complete(REQUEST).catch((value) => value);
    assert.equal(/private-detail/u.test(error.message), false);
  }
});

test('the deadline includes token acquisition and maps aborts to a bounded error', async () => {
  let fire;
  let cleared = false;
  let fetchCalls = 0;
  const instance = client(async () => {
    fetchCalls += 1;
    throw new Error('must not fetch');
  }, {
    accessToken: async () => new Promise(() => {}),
    setTimeoutImpl: (callback) => { fire = callback; return 7; },
    clearTimeoutImpl: (id) => { assert.equal(id, 7); cleared = true; },
  });
  const pending = instance.complete(REQUEST);
  fire();
  await assert.rejects(pending, { code: 'OPENAI_RESPONSE_DEADLINE_EXCEEDED' });
  assert.equal(fetchCalls, 0);
  assert.equal(cleared, true);
});

test('cancellation is idempotent, releases the reader and blocks late publication', async () => {
  let resolveRead;
  let markReaderReady;
  const readerReady = new Promise((resolve) => { markReaderReady = resolve; });
  let cancelCalls = 0;
  let releaseCalls = 0;
  const reader = {
    read: () => new Promise((resolve) => { resolveRead = resolve; markReaderReady(); }),
    cancel: () => { cancelCalls += 1; },
    releaseLock: () => { releaseCalls += 1; },
  };
  const instance = client(async () => ({
    ok: true,
    headers: { get: () => 'text/event-stream' },
    body: { getReader: () => reader },
  }));
  const pending = instance.complete(REQUEST);
  await readerReady;
  assert.equal(instance.cancel(), true);
  assert.equal(instance.cancel(), true);
  resolveRead({ done: true });
  await assert.rejects(pending, { code: 'OPENAI_RESPONSE_CANCELLED' });
  assert.equal(cancelCalls, 1);
  assert.equal(releaseCalls, 1);
});

test('validated completion wins before cleanup and single-flight rejects overlap', async () => {
  let resolveFirst;
  let markReaderReady;
  const readerReady = new Promise((resolve) => { markReaderReady = resolve; });
  let cleanupCancelResult;
  const first = client(async () => ({
    ok: true,
    headers: { get: () => 'text/event-stream' },
    body: {
      getReader: () => ({
        read: () => new Promise((resolve) => { resolveFirst = resolve; markReaderReady(); }),
        cancel: () => { cleanupCancelResult = first.cancel(); },
        releaseLock() {},
      }),
    },
  }));
  const pending = first.complete(REQUEST);
  await readerReady;
  await assert.rejects(first.complete(REQUEST), { code: 'OPENAI_RESPONSE_BUSY' });
  resolveFirst({ done: false, value: encoder.encode(sse(completed('accepted'))) });
  assert.equal(await pending, 'accepted');
  assert.equal(cleanupCancelResult, false);
  assert.equal(first.active, false);
});

test('rejects unsupported request fields and invalid model slugs before fetch', async () => {
  assert.throws(() => client(async () => {}, { model: 'bad/model' }), { code: 'OPENAI_RESPONSE_MODEL_INVALID' });
  await assert.rejects(
    client(async () => { throw new Error('must not fetch'); }).complete({ ...REQUEST, tools: [] }),
    { code: 'OPENAI_RESPONSE_REQUEST_INVALID' },
  );
});

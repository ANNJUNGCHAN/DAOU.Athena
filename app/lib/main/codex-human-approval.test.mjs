import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CodexAppServerProtocol } = require('./codex-app-server-protocol');
const { CodexAppServerSession, buildThreadStartParams, buildTurnStartParams } = require('./codex-app-server-session');
const { createCodexUserInputDialog } = require('./codex-user-input-dialog');

const params = () => ({ threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', isBlocking: true,
  questions: [{ id: 'approval', header: '도구 실행', question: 'athena_search 실행을 허용할까요?', options: [
    { label: 'Accept', description: '이 호출을 실행합니다.' },
    { label: 'Decline', description: '실행하지 않습니다.' },
  ] }],
});
const request = () => ({ id: 7, method: 'item/tool/requestUserInput', params: params() });
const tick = () => new Promise(resolve => setImmediate(resolve));

test('server requests have their own ID space and responses are sent at most once', async () => {
  const output = [];
  let serverRequest;
  const protocol = new CodexAppServerProtocol({ writeLine: line => output.push(JSON.parse(line)),
    onServerRequest: value => { serverRequest = value; } });
  const clientRequest = protocol.request('initialize', {});
  protocol.acceptStdoutChunk(JSON.stringify({ ...request(), id: 1 }) + '\n');
  assert.equal(serverRequest.method, 'item/tool/requestUserInput');
  assert.equal(protocol.respond(1, { answers: {} }), true);
  assert.equal(protocol.respond(1, { answers: {} }), false);
  protocol.acceptStdoutChunk('{"id":1,"result":{"ready":true}}\n');
  assert.deepEqual(await clientRequest, { ready: true });
  assert.equal(output.length, 2);
});

test('unhandled requests fail closed; duplicate pending requests are protocol errors', () => {
  const output = [];
  const protocol = new CodexAppServerProtocol({ writeLine: line => output.push(JSON.parse(line)) });
  protocol.acceptStdoutChunk(JSON.stringify(request()) + '\n');
  assert.equal(output[0].error.code, -32601);
  const pending = new CodexAppServerProtocol({ writeLine() {}, onServerRequest() {} });
  pending.acceptStdoutChunk(JSON.stringify(request()) + '\n');
  assert.throws(() => pending.acceptStdoutChunk(JSON.stringify(request()) + '\n'), { code: 'CODEX_DUPLICATE_SERVER_REQUEST' });
  pending.failPending('STOPPED', 'Stopped');
  assert.equal(pending.respond(7, { answers: {} }), false);
});

test('native prompt shows actual options and returns only the human-selected answer', async () => {
  let dialogOptions;
  const handler = createCodexUserInputDialog({ getWindow: () => ({ isDestroyed: () => false }),
    dialog: { async showMessageBox(_window, options) { dialogOptions = options; return { response: 1 }; } } });
  const result = await handler(params());
  assert.equal(result.answers.approval.answers[0], 'Decline');
  assert.equal(dialogOptions.message, params().questions[0].question);
  assert.deepEqual(dialogOptions.buttons, ['Accept', 'Decline', '요청 취소']);
  assert.equal(dialogOptions.defaultId, 2);
  assert.equal(dialogOptions.cancelId, 2);
});

test('native close, abort, unsupported secret/free text, and missing window never approve', async () => {
  const handler = createCodexUserInputDialog({ getWindow: () => ({ isDestroyed: () => false }),
    dialog: { async showMessageBox() { return { response: 2 }; } } });
  await assert.rejects(handler(params()), /cancelled/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(handler(params(), { signal: controller.signal }), /cancelled/);
  const secret = params(); secret.questions[0].isSecret = true;
  await assert.rejects(handler(secret), /Unsupported/);
  const freeText = params(); freeText.questions[0].options = null;
  await assert.rejects(handler(freeText), /Unsupported/);
  const noWindow = createCodexUserInputDialog({ getWindow: () => null, dialog: {} });
  await assert.rejects(noWindow(params()), /cancelled/);
});

function fixture(handler) {
  const session = new CodexAppServerSession({ runtime: { spawnGenerationAppServer() {} }, requestUserInput: handler });
  session._state = 'ready'; session._connectionSerial = 1;
  session._assertCurrent = () => {};
  const active = { threadId: 'thread-1', providerTurnId: 'turn-1', completed: false, turnContext: {} };
  session._activeByThread.set(active.threadId, active);
  const responses = [];
  const forgotten = [];
  session._protocol = { respond: (...args) => responses.push(args), forgetServerRequest: id => forgotten.push(id) };
  return { session, active, responses, forgotten };
}

test('session waits for a human callback before replying', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = f.session._handleServerRequest(request(), 1);
  assert.equal(f.responses.length, 0);
  const answer = { answers: { approval: { answers: ['Accept'] } } };
  finish(answer); await pending;
  assert.deepEqual(f.responses, [[7, answer]]);
});

test('unknown execution, file, permission requests and foreign turns never reach human approval', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return {}; });
  for (const method of ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'unknown']) {
    await f.session._handleServerRequest({ ...request(), method }, 1);
  }
  await f.session._handleServerRequest({ ...request(), params: { ...params(), turnId: 'other' } }, 1);
  assert.equal(calls, 0);
  assert.equal(f.responses.length, 5);
  assert.ok(f.responses.every(response => response[2].code === -32601));
});

test('resolved, cancelled, and stale generation prompts cannot send a late answer', async () => {
  for (const reason of ['resolved', 'cancelled', 'generation']) {
    let finish, signal;
    const f = fixture((_params, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); });
    const pending = f.session._handleServerRequest(request(), 1);
    if (reason === 'resolved') f.session._handleNotification({ method: 'serverRequest/resolved', params: { threadId: 'thread-1', requestId: 7 } }, 1);
    else if (reason === 'cancelled') f.session._cancelUserInputs(f.active);
    else f.session._connectionSerial++;
    finish({ answers: { approval: { answers: ['Accept'] } } }); await pending;
    assert.equal(f.responses.length, 0, reason);
    if (reason !== 'generation') assert.equal(signal.aborted, true);
  }
});

test('native cancellation or failure produces an error instead of an affirmative answer', async () => {
  const f = fixture(async () => { throw new Error('cancelled'); });
  await f.session._handleServerRequest(request(), 1);
  assert.equal(f.responses[0][1], null);
  assert.equal(f.responses[0][2].code, -32601);
});

test('an old connection cannot answer or cancel a request on the replacement connection', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return {}; });
  await f.session._handleServerRequest(request(), 0);
  assert.equal(calls, 0);
  assert.deepEqual(f.responses, []);
  assert.deepEqual(f.forgotten, []);
});

test('on-request is opt-in and read-only sandbox remains unchanged', () => {
  for (const enabled of [false, true]) {
    const desired = { cwd: 'fixture-cwd', humanApprovalEnabled: enabled };
    const thread = buildThreadStartParams(desired);
    const turn = buildTurnStartParams({ turnId: 'athena-turn', userText: 'hello' }, 'thread-1', desired, true);
    assert.equal(thread.approvalPolicy, enabled ? 'on-request' : 'never');
    assert.equal(turn.approvalPolicy, thread.approvalPolicy);
    assert.equal(thread.sandbox, 'read-only');
    assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  }
});

test('queued dialogs do not open after their original turn was cancelled', async () => {
  let finish;
  let calls = 0;
  const handler = createCodexUserInputDialog({ getWindow: () => ({ isDestroyed: () => false }), dialog: {
    showMessageBox() { calls++; return new Promise(resolve => { finish = resolve; }); },
  } });
  const first = handler(params());
  await tick();
  const controller = new AbortController();
  const second = handler(params(), { signal: controller.signal });
  const rejected = assert.rejects(second, /cancelled/);
  controller.abort(); finish({ response: 0 });
  await first; await rejected;
  assert.equal(calls, 1);
});

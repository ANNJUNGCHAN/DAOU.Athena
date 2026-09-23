import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createClaudeChatSession } = require('./claude-chat-session');

function sessionFor(t, overrides = {}) {
  const session = createClaudeChatSession({
    cwd: os.tmpdir(),
    envOverridesFn: () => ({}),
    killFn: () => {},
    respawnBaseDelayMs: 60_000,
    ...overrides,
  });
  t.after(() => session.stop());
  return session;
}

function assertMissingExecutable(result) {
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'ENOENT');
  assert.match(result.error, /Claude Code.*설치/);
  assert.match(result.error, /Athena.*다시 시작/);
  assert.match(result.error, /설정.*Claude.*연결/);
  assert.doesNotMatch(result.error, /ENOENT|spawn|ATHENA_CLAUDE_BIN/);
  assert.match(result.diagnostics.processError, /ENOENT/);
}

test('real asynchronous missing Claude executable returns recovery guidance and retains diagnostics', async (t) => {
  const session = sessionFor(t, {
    claudeBin: path.join(os.tmpdir(), `athena-missing-claude-${randomUUID()}.exe`),
  });
  const result = await session.run({ prompt: 'missing executable fixture' });
  assertMissingExecutable(result);
  assert.equal(result.aborted, false);
  assert.equal(result.timedOut, false);
  assert.equal(session.snapshot().state, 'down');
});

test('synchronous spawn ENOENT uses the same recovery guidance', async (t) => {
  const session = sessionFor(t, {
    spawnFn() { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); },
  });
  assertMissingExecutable(await session.run({ prompt: 'synchronous fixture' }));
});

for (const code of ['EACCES', 'EPIPE']) {
  test(`${code} transport errors are not misclassified as missing executable`, async (t) => {
    const message = `fixture ${code}`;
    const session = sessionFor(t, {
      spawnFn() {
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        queueMicrotask(() => child.emit('error', Object.assign(new Error(message), { code })));
        return child;
      },
    });
    const result = await session.run({ prompt: 'unrelated error fixture' });
    assert.equal(result.ok, false);
    assert.equal(result.error, message);
    assert.equal(result.errorCode, code);
    assert.equal(result.diagnostics.processError, message);
  });
}

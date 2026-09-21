import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CodexAppServerSession } = require('./codex-app-server-session');

function failTurn(error) {
  const emitted = [];
  const rejected = [];
  const active = {
    completed: false, started: true, threadId: 'fixture-thread', providerTurnId: 'fixture-turn',
    conversation: {}, providerStarted: { reject() {} }, terminal: { reject(value) { rejected.push(value); } },
  };
  const session = {
    _failActive: CodexAppServerSession.prototype._failActive,
    _emitActive(_active, type, payload) { emitted.push({ type, payload }); },
    _cleanupActive() {},
  };
  CodexAppServerSession.prototype._completeActive.call(session, active, 'failed', { turn: { error } });
  return { emitted, error: rejected[0], active };
}

test('upstream model-version failure reaches terminal and UI as an actionable safe explanation', () => {
  const result = failTurn({ message: JSON.stringify({ status: 400, error: {
    type: 'invalid_request_error',
    message: "The 'fixture-model' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
  } }) });
  assert.equal(result.error.code, 'CODEX_UPGRADE_REQUIRED');
  assert.equal(result.error.actionNeeded, true);
  assert.equal(result.error.retryable, false);
  assert.match(result.error.message, /Codex CLI.*업데이트/);
  assert.equal(result.emitted[0].type, 'turn_failed');
  assert.equal(result.emitted[0].payload.safeMessage, result.error.message);
  assert.equal(result.emitted[0].payload.actionNeeded, true);
  assert.equal(result.active.conversation.needsRecovery, true);
});

test('plain version error is classified without forwarding model names or private details', () => {
  const result = failTurn({ message: "The 'private-model' model requires a newer version of Codex. C:\\private\\auth.json token=fixture-secret" });
  assert.equal(result.error.code, 'CODEX_UPGRADE_REQUIRED');
  assert.doesNotMatch(JSON.stringify(result.emitted), /private-model|auth\.json|fixture-secret/);
});

test('unknown or malformed upstream errors remain generic and do not leak their text', () => {
  for (const message of ['{"broken": token=fixture-secret', 'C:\\private\\auth.json fixture-secret']) {
    const result = failTurn({ message });
    assert.equal(result.error.code, 'CODEX_TURN_FAILED');
    assert.equal(result.error.message, 'Codex turn failed');
    assert.equal(result.emitted[0].payload.safeMessage, 'Codex turn failed.');
    assert.doesNotMatch(JSON.stringify(result.emitted), /fixture-secret|auth\.json/);
  }
});

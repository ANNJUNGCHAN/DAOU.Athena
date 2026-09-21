import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { CodexAppServerSession } = require('./codex-app-server-session');

function fixture() {
  const events = [];
  let result;
  const session = new CodexAppServerSession({ runtime: { spawnGenerationAppServer() {} } });
  session._emitActive = (_active, type, payload) => events.push({ type, payload });
  session._cleanupActive = () => {};
  const active = { threadId: 'fixture-thread', providerTurnId: 'fixture-turn', conversation: {},
    finalText: 'Fixture model text', toolCalls: new Map(), toolOutcomes: new Map(),
    terminal: { resolve(value) { result = value; } } };
  return { events, active,
    item(item, completed = true) { session._emitItem(active, { item }, completed, 'fixture-turn'); },
    complete() { session._completeActive(active, 'completed'); return result; },
  };
}
const item = (overrides = {}) => ({ type: 'mcpToolCall', id: 'tool-1', server: 'athena', tool: 'athena_call',
  arguments: { endpoint: 'news', query: 'fixture' }, status: 'completed', result: { content: [{ type: 'text', text: 'fixture result' }] }, ...overrides });

test('official MCP server/tool fields produce named events and typed failed result', () => {
  const f = fixture();
  f.item(item({ status: 'inProgress' }), false);
  f.item(item({ status: 'failed', error: { message: 'fixture private error' } }));
  assert.equal(f.events[0].payload.providerToolName, 'mcp__athena__athena_call');
  assert.equal(f.events[1].payload.isError, true);
  const result = f.complete();
  assert.equal(result.status, 'completed');
  assert.equal(result.taskOutcome, 'blocked');
  assert.deepEqual(result.toolFailures, [{ toolName: 'athena_call', kind: 'tool-error' }]);
  assert.doesNotMatch(JSON.stringify(result), /private error|endpoint|query/);
});

test('MCP result isError and declined status prevent task completion without parsing assistant text', () => {
  for (const errorItem of [item({ result: { isError: true, content: [] } }), item({ status: 'declined' })]) {
    const f = fixture(); f.active.finalText = 'Everything completed successfully';
    f.item(errorItem);
    assert.equal(f.complete().taskOutcome, 'blocked');
  }
  const noTools = fixture(); noTools.active.finalText = 'I cannot complete this';
  assert.equal(noTools.complete().taskOutcome, 'completed');
});

test('same operation retry clears failure but another endpoint does not', () => {
  const f = fixture();
  f.item(item({ error: { message: 'failed' } }));
  f.item(item({ id: 'tool-2', arguments: { endpoint: 'company', query: 'fixture' } }));
  assert.equal(f.complete().taskOutcome, 'incomplete');
  const retry = fixture();
  retry.item(item({ error: { message: 'failed' } }));
  retry.item(item({ id: 'tool-2', arguments: { query: 'fixture', endpoint: 'news' } }));
  assert.equal(retry.complete().taskOutcome, 'completed');
});

test('unfinished tool calls produce incomplete outcome and failed canvas is not rendered', () => {
  const f = fixture(); f.item(item({ status: 'inProgress' }), false);
  assert.equal(f.complete().taskOutcome, 'incomplete');
  const canvas = fixture();
  canvas.item(item({ tool: 'render_canvas', result: { isError: true, content: [] } }));
  assert.ok(!canvas.events.some(event => event.type === 'canvas_result'));
});

test('missing completion arguments use the started operation, unknown operations do not clear failures', () => {
  const f = fixture();
  f.item(item({ status: 'inProgress' }), false);
  f.item(item({ arguments: undefined, status: 'failed' }));
  f.item(item({ id: 'tool-2', arguments: undefined }));
  assert.equal(f.complete().taskOutcome, 'incomplete');
});

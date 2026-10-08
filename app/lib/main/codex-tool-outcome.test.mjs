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

const chartResolveInput = (overrides = {}) => ({
  question: '삼성전자 주식일봉차트조회요청', intent: 'query', response_mode: 'full',
  arguments: { stk_cd: '005930', base_dt: '20261007', upd_stkpc_tp: '1' }, ...overrides,
});
const ambiguousResolve = (overrides = {}) => item({
  tool: 'athena_resolve', arguments: chartResolveInput(), status: 'failed',
  result: { isError: true, _meta: { 'athena/error_origin': 'upstream-failed' }, content: [{
    type: 'text', text: 'athena_resolve 실패 (HTTP 409): AMBIGUOUS_OPERATION: fixture ambiguity'
      + ' · {"candidates":["base:ka10079","base:ka10080","base:ka10081"],"reason":"fixture"}'
      + ' · 검색·스키마 근거로 조회 대상과 조건을 보완하라.',
  }] }, ...overrides,
});
const resolvedChart = (overrides = {}, body = {}) => item({
  id: 'tool-2', tool: 'athena_resolve',
  arguments: chartResolveInput({ preferred_ref: 'base:ka10081' }),
  result: { isError: false, content: [{ type: 'text', text: JSON.stringify({
    status: 'resolved', kind: 'query', operation_ref: 'base:ka10081',
    required_arguments_satisfied: true, response_mode: 'full', plan_token: 'fixture-plan', ...body,
  }) }] }, ...overrides,
});

test('a named candidate resolving the identical chart request recovers its earlier ambiguity', () => {
  const f = fixture();
  f.item(ambiguousResolve());
  f.item(resolvedChart({ arguments: chartResolveInput({
    preferred_ref: 'base:ka10081', candidate_refs: ['base:ka10081'],
  }) }));
  const result = f.complete();
  assert.equal(result.taskOutcome, 'completed');
  assert.deepEqual(result.toolFailures, []);
  assert.equal(f.events.filter(event => event.type === 'tool_completed')[0].payload.isError, true);
  assert.doesNotMatch(JSON.stringify(result), /fixture-plan|005930|20261007/);
});

test('ambiguity recovery cannot cross query, execution, namespace or canonical-result boundaries', () => {
  const changedInputs = [
    { question: '삼성전자 주식월봉차트조회요청' }, { intent: 'order' }, { response_mode: 'compact' },
    { detail_group: 'monthly' }, { continuation: { next_key: 'fixture-next' } },
    { arguments: { stk_cd: '000660', base_dt: '20261007', upd_stkpc_tp: '1' } },
    { arguments: { stk_cd: '005930', base_dt: '20260901', upd_stkpc_tp: '1' } },
    { arguments: { stk_cd: '005930', base_dt: '20261007', upd_stkpc_tp: '1', account: 'fixture-account' } },
    { preferred_ref: 'base:ka10083' },
  ];
  const successors = [
    ...changedInputs.map(change => resolvedChart({ arguments: chartResolveInput({ preferred_ref: 'base:ka10081', ...change }) })),
    resolvedChart({ server: 'other' }), resolvedChart({ tool: 'athena_describe' }),
    resolvedChart({}, { operation_ref: undefined }), resolvedChart({}, { operation_ref: 'base:ka10080' }),
    resolvedChart({}, { kind: 'order' }), resolvedChart({}, { status: 'failed' }),
    resolvedChart({}, { required_arguments_satisfied: false }), resolvedChart({}, { plan_token: '' }),
    resolvedChart({}, { error: 'fixture execution failure' }), resolvedChart({}, { ok: false }),
    resolvedChart({}, { auto_execute: { executed: false } }),
    resolvedChart({ result: { content: [{ type: 'text', text: 'not a resolved plan' }] } }),
  ];
  for (const successor of successors) {
    const f = fixture(); f.item(ambiguousResolve()); f.item(successor);
    assert.equal(f.complete().taskOutcome, 'incomplete', JSON.stringify(successor.arguments));
  }
});

test('only a trusted ambiguity with no prior preferred operation is eligible for semantic recovery', () => {
  const original = ambiguousResolve();
  const failures = [
    ambiguousResolve({ status: 'declined' }), ambiguousResolve({ status: 'cancelled' }),
    ambiguousResolve({ arguments: chartResolveInput({ preferred_ref: 'base:ka10080' }) }),
    ambiguousResolve({ result: { ...original.result, _meta: {} } }),
    ambiguousResolve({ result: { ...original.result, content: [{ type: 'text', text: original.result.content[0].text.replace('AMBIGUOUS_OPERATION', 'BACKEND_UNAVAILABLE') }] } }),
    ambiguousResolve({ result: { ...original.result, content: [{ type: 'text', text: 'athena_resolve 실패 (HTTP 409): AMBIGUOUS_OPERATION: fixture without candidates' }] } }),
    ambiguousResolve({ result: { ...original.result, content: [{ type: 'text', text: original.result.content[0].text.replace('base:ka10081', 'base:ka10083') }] } }),
  ];
  for (const failure of failures) {
    const f = fixture(); f.item(failure); f.item(resolvedChart());
    assert.equal(f.complete().taskOutcome, 'incomplete');
  }
});

test('recovering ambiguity preserves independent execution failures and pending calls', () => {
  const f = fixture();
  f.item(item({ id: 'independent', error: { message: 'fixture failed read' } }));
  f.item(ambiguousResolve()); f.item(resolvedChart());
  assert.deepEqual(f.complete().toolFailures, [{ toolName: 'athena_call', kind: 'tool-error' }]);
  const pending = fixture();
  pending.item(item({ id: 'pending', status: 'inProgress' }), false);
  pending.item(ambiguousResolve()); pending.item(resolvedChart());
  assert.equal(pending.complete().taskOutcome, 'incomplete');
});

test('the existing exact-argument retry remains valid after a declined call', () => {
  const f = fixture();
  f.item(item({ status: 'declined' }));
  f.item(item({ id: 'approved-retry' }));
  assert.equal(f.complete().taskOutcome, 'completed');
});

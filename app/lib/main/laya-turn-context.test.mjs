import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildLayaTurnContext } = require('./laya-turn-context');
test('general chat excludes inactive screen data while preserving semantic authority', () => {
  const inactive = { items: Array(50).fill({ description: 'fixture screen data'.repeat(100) }) };
  const activeCardContext = { selectedId: 'fixture-card' };
  assert.deepEqual(buildLayaTurnContext({ canvasMode: 'summary', graphContext: inactive,
    agentContext: inactive, pluginContext: inactive, activeCardContext, today: '20261006',
    app_clarified_question: '기존 조회 조건' }), {
    canvasMode: 'summary', activeCardContext, today: '20261006', app_clarified_question: '기존 조회 조건',
  });
});
test('each dedicated mode retains its complete relevant context and identifiers', () => {
  for (const [canvasMode, key] of [['graph','graphContext'],['agent','agentContext'],['plugin','pluginContext']]) {
    const input = { canvasMode, graphContext: { selected: 'g' }, agentContext: { selectedRoutineId: 'r' }, pluginContext: { registry: { status: 'pending' } } };
    const result = buildLayaTurnContext(input);
    assert.deepEqual(result, { canvasMode, [key]: input[key] });
    assert.equal(result[key], input[key]);
  }
});
test('backtest mode remains explicitly marked for the existing bypass', () => {
  assert.deepEqual(buildLayaTurnContext({ canvasMode: 'backtest', graphContext: {} }), { canvasMode: 'backtest' });
});

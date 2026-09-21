import test from 'node:test';
import assert from 'node:assert/strict';
import canvas from './backtest-canvas.js';

const { loadCompletedHistoryRun } = canvas;

test('detached history preview renders only the archived datasets, including empty stdout', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => ({
    tag, children: [], appendChild(child) { this.children.push(child); },
  }) };
  try {
    const archived = { runId: 'foreign-run', result: { status: 'done', stdout: '' }, trades: [] };
    const calls = {};
    const preview = canvas.renderCompletedHistoryRun(archived, {
      metrics: (metrics = 'current-metrics') => { calls.metrics = metrics; return {}; },
      equity: (result, trades) => { calls.equity = [result, trades]; return {}; },
      stdout: (text = 'stale restored log') => { calls.stdout = text; return {}; },
      trades: (trades) => { calls.trades = trades; return {}; },
      assumptions: (result) => { calls.assumptions = result; return {}; },
    });
    assert.match(preview.children[0].textContent, /foreign-run.*읽기 전용/);
    assert.equal(calls.metrics, null);
    assert.equal(calls.stdout, '');
    assert.deepEqual(calls.equity, [archived.result, archived.trades]);
    assert.equal(calls.trades, archived.trades);
    assert.equal(calls.assumptions, archived.result);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('history reopening reads saved equity and trades without launching a run', async () => {
  const result = { status: 'done', equity: [{ time: '2026-01-02', value: 100 }],
    benchmark: [{ time: '2026-01-02', value: 90 }], metrics: { total_return: 0.1 } };
  const trades = [{ side: 'buy', price: 50 }];
  const calls = [];
  const loaded = await loadCompletedHistoryRun('saved-run', {
    result: async (args) => { calls.push(['result', args]); return result; },
    trades: async (args) => { calls.push(['trades', args]); return trades; },
    run: () => { throw new Error('must not rerun'); },
  }, () => true);
  assert.deepEqual(loaded, { runId: 'saved-run', result, trades });
  assert.deepEqual(calls, [['result', { run_id: 'saved-run' }], ['trades', { run_id: 'saved-run' }]]);
});

test('unfinished and unavailable trade datasets do not become completed result views', async () => {
  await assert.rejects(loadCompletedHistoryRun('run', {
    result: async () => ({ status: 'running' }),
    trades: async () => { throw new Error('must not read unfinished trades'); },
  }, () => true), /완료된/);
  await assert.rejects(loadCompletedHistoryRun('run', {
    result: async () => ({ status: 'done' }), trades: async () => null,
  }, () => true), /체결 내역/);
  await assert.rejects(loadCompletedHistoryRun('run', {
    result: async () => ({ status: 'done' }), trades: async () => { throw new Error('offline'); },
  }, () => true), /offline/);
});

test('leaving the workspace during either read discards the stale result', async () => {
  let current = true;
  const result = await loadCompletedHistoryRun('run', {
    result: async () => { current = false; return { status: 'done' }; },
    trades: async () => { throw new Error('stale read'); },
  }, () => current);
  assert.equal(result, null);
  current = true;
  const afterTrades = await loadCompletedHistoryRun('run', {
    result: async () => ({ status: 'done' }),
    trades: async () => { current = false; return []; },
  }, () => current);
  assert.equal(afterTrades, null);
});

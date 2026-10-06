import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from './backtest-bridge.js';

test('natural operations route to exact POST endpoints and strip transport selectors', async () => {
  for (const operation of ['create', 'step', 'run', 'pause', 'result']) {
    let request;
    const response = await bridge.runBacktest({ backendBase: 'http://127.0.0.1:8765',
      decision_mode: 'natural', operation, session_id: 'safe-session',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, json: async () => ({ session_id: 'safe-session' }) };
      },
    });
    assert.equal(request.url, `http://127.0.0.1:8765/api/v1/backtest/natural/${operation}`);
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(JSON.parse(request.options.body), { session_id: 'safe-session' });
    assert.deepEqual(response, { ok: true, data: { session_id: 'safe-session' } });
  }
});

test('unrecognized or path-like natural operations are rejected without a network request', async () => {
  for (const operation of [undefined, 'delete', '../deployments', 'run?other=1', '__proto__']) {
    const result = await bridge.runBacktest({ backendBase: 'http://local',
      decision_mode: 'natural', operation,
      fetchImpl: () => { throw new Error('must not call fetch'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
});

test('ordinary backtest requests retain their original endpoint and payload', async () => {
  let request;
  const body = { source: 'python', params: { symbol: '005930' } };
  await bridge.runBacktest({ backendBase: 'http://local', ...body,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ run_id: 'legacy' }) };
    },
  });
  assert.equal(request.url, 'http://local/api/v1/backtest/runs');
  assert.deepEqual(JSON.parse(request.options.body), body);
});

test('natural cache coverage rejection preserves the backend explanation', async () => {
  const result = await bridge.runBacktest({ backendBase: 'http://local',
    decision_mode: 'natural', operation: 'create',
    fetchImpl: async () => ({ ok: false, status: 409,
      json: async () => ({ detail: '저장된 일봉 범위를 벗어납니다.' }),
    }),
  });
  assert.deepEqual(result, { ok: false, status: 409, error: '저장된 일봉 범위를 벗어납니다.' });
});

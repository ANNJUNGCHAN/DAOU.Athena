import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadBrainRequest() {
  const source = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function fetchBrainJson(');
  const end = source.indexOf("ipcMain.handle('athena:brain-status'", start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  let endpoint = null;
  const context = vm.createContext({
    URL,
    historySink: {
      getBearerToken: () => 'fixture-token',
      getBackendUrl: () => {
        if (!endpoint) throw new Error('Athena backend endpoint is not initialized');
        return endpoint;
      },
    },
    fetch: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, json: async () => ({ ready: true }) };
    },
  });
  vm.runInContext(source.slice(start, end), context);
  return { request: context.fetchBrainJson, calls, setEndpoint: (value) => { endpoint = value; } };
}

test('백엔드 준비 전 brain 요청은 IPC 예외 대신 실패 결과를 돌려주고 전송하지 않는다', async () => {
  const h = loadBrainRequest();
  const result = await h.request('/api/v1/brain/status');
  assert.equal(result.ok, false);
  assert.match(result.error, /요청 실패/);
  assert.equal(h.calls.length, 0);
});

test('준비 전 실패 후 다음 brain 요청은 새 백엔드 주소로 복구한다', async () => {
  const h = loadBrainRequest();
  assert.equal((await h.request('/api/v1/brain/status')).ok, false);
  h.setEndpoint('http://127.0.0.1:32100');
  const result = await h.request('/api/v1/brain/profile-summary', { params: { limit: 5, window_days: null } });
  assert.equal(result.ok, true);
  assert.equal(result.body.ready, true);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'http://127.0.0.1:32100/api/v1/brain/profile-summary?limit=5');
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer fixture-token');
});

test('brain 쓰기 요청의 method와 payload는 readiness 처리 후에도 유지된다', async () => {
  const h = loadBrainRequest();
  h.setEndpoint('http://127.0.0.1:32100');
  assert.equal((await h.request('/api/v1/brain/schedule', { method: 'PUT', payload: { chat: 10 } })).ok, true);
  assert.equal(h.calls[0].options.method, 'PUT');
  assert.equal(h.calls[0].options.body, '{"chat":10}');
  assert.equal(h.calls[0].options.headers['Content-Type'], 'application/json');
});

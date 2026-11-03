import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function functionSource(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, `missing ${signature}`);
  const open = source.indexOf(') {', start) + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unclosed ${signature}`);
}

function runtime({ exists = true, trashError = null } = {}) {
  const calls = [];
  const project = { id: 'p1', label: '개인 연구', path: 'D:\\연구자료' };
  const context = vm.createContext({
    conversations: {
      projectById: (id) => (id === project.id ? project : null),
      removeProject: (id) => { calls.push(['record-remove', id]); return { ok: true }; },
    },
    fs: {
      existsSync: (target) => { calls.push(['exists', target]); return exists; },
      promises: { rm: async (target) => { calls.push(['rm', target]); } },
    },
    shell: {
      trashItem: async (target) => {
        calls.push(['trash', target]);
        if (trashError) throw new Error(trashError);
      },
    },
    backtestBridge: { unregisterProject: async () => { calls.push(['unregister']); } },
    BACKEND_HTTP_BASE: 'http://127.0.0.1:8010',
    fetch: async () => { throw new Error('unexpected fetch'); },
    mdlog: () => {},
    getSessionBridge: () => null,
    String,
  });
  const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  vm.runInContext(functionSource(source, 'async function handleProjectRemove('), context);
  return { context, calls, project };
}

test('project removal sends the folder to the recycle bin, never a permanent rm', async () => {
  const r = runtime();
  const result = await r.context.handleProjectRemove(null, { id: 'p1', confirmName: '개인 연구' });
  assert.equal(result.ok, true);
  assert.deepEqual(r.calls.filter(([kind]) => kind === 'trash'), [['trash', r.project.path]]);
  assert.equal(r.calls.some(([kind]) => kind === 'rm'), false);
  assert.ok(r.calls.some(([kind]) => kind === 'record-remove'));
});

test('a folder already gone from disk still removes the record', async () => {
  const r = runtime({ exists: false });
  const result = await r.context.handleProjectRemove(null, { id: 'p1', confirmName: '개인 연구' });
  assert.equal(result.ok, true);
  assert.equal(r.calls.some(([kind]) => kind === 'trash' || kind === 'rm'), false);
  assert.ok(r.calls.some(([kind]) => kind === 'record-remove'));
});

test('a failed move to the recycle bin keeps the record and touches nothing else', async () => {
  const r = runtime({ trashError: 'locked' });
  const result = await r.context.handleProjectRemove(null, { id: 'p1', confirmName: '개인 연구' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'rm_failed');
  assert.equal(r.calls.some(([kind]) => kind === 'record-remove' || kind === 'unregister'), false);
});

test('a mismatched name removes nothing', async () => {
  const r = runtime();
  const result = await r.context.handleProjectRemove(null, { id: 'p1', confirmName: '다른 이름' });
  assert.equal(result.reason, 'name_mismatch');
  assert.deepEqual(r.calls, []);
});

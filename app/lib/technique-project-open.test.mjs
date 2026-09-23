import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
const start = source.indexOf('  openProject: async (folderPath) => {');
const end = source.indexOf('  createTechnique:', start);
assert.ok(start >= 0 && end > start);
function adapter(invoke) {
  return vm.runInNewContext(`({${source.slice(start, end)}}).openProject`, {
    window: { athena: { invoke } }, projectError: (res, fallback) => res?.error || fallback,
  });
}

test('missing folder is reported and retry uses real backend project instead of an offline sidebar ID', async () => {
  let exists = false;
  const calls = [];
  const open = adapter(async (channel) => {
    calls.push(channel);
    assert.equal(channel, 'athena:project-open');
    return exists ? { ok: true, data: { project: { id: 'backend-id' } } }
      : { ok: false, status: 404, error: '폴더가 존재하지 않는다' };
  });
  await assert.rejects(open('C:\\QA\\techniques'), /폴더가 존재하지 않는다/);
  exists = true;
  const created = await open('C:\\QA\\techniques');
  assert.equal(created.project.id, 'backend-id');
  assert.equal(calls.length, 2);
});

test('already registered folder resolves authoritative backend ID across Windows separator and case differences', async () => {
  const calls = [];
  const open = adapter(async (channel) => {
    calls.push(channel);
    if (channel === 'athena:project-open') return { ok: false, status: 409, error: '이미 등록된 폴더다' };
    assert.equal(channel, 'athena:project-list');
    return { ok: true, data: { projects: [{ id: 'backend-existing', path: 'C:\\QA\\techniques' }] } };
  });
  const result = await open('c:/qa/techniques/');
  assert.equal(result.project.id, 'backend-existing');
  assert.deepEqual(calls, ['athena:project-open', 'athena:project-list']);
});

test('unmatched duplicate error cannot reuse a different registered project', async () => {
  const open = adapter(async (channel) => channel === 'athena:project-open'
    ? { ok: false, status: 409, error: '이미 등록된 폴더다' }
    : { ok: true, data: { projects: [{ id: 'unrelated', path: 'C:\\other' }] } });
  await assert.rejects(open('C:\\QA'), /이미 등록된 폴더다/);
});

test('backend unavailable stays an error rather than manufacturing successful registration', async () => {
  const open = adapter(async () => ({ ok: false, status: 0, error: 'backend unavailable' }));
  await assert.rejects(open('C:\\QA'), /backend unavailable/);
});

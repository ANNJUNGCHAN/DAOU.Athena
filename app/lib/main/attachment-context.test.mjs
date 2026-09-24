import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import attachmentContext from './attachment-context.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'athena-attachment-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test('native selections capture UTF-8 bytes for any provider and keep an immutable snapshot', async t => {
  const root = await fixture(t), file = path.join(root, 'verification.txt');
  await fs.writeFile(file, '검증 코드 LILAC-4826\n상자 총 18개');
  const result = await attachmentContext.captureAttachments([file]);
  assert.equal(result.ok, true);
  assert.ok(result.attachments[0].id);
  assert.match(result.attachments[0].context, /LILAC-4826/);
  assert.match(result.attachments[0].context, /18개/);
  await fs.writeFile(file, 'changed');
  assert.match(result.attachments[0].context, /LILAC-4826/);
});

test('missing, oversized, binary and unsupported documents produce explicit errors without content', async t => {
  const root = await fixture(t);
  const fixtures = [['large.txt', Buffer.alloc(attachmentContext.MAX_TEXT_BYTES + 1, 65)],
    ['binary.bin', Buffer.from([0, 1, 2])], ['invalid.txt', Buffer.from([255, 254])],
    ['document.pdf', '%PDF-1.7 fake']];
  for (const [name, bytes] of fixtures) await fs.writeFile(path.join(root, name), bytes);
  const result = await attachmentContext.captureAttachments([...fixtures.map(([name]) => path.join(root, name)), path.join(root, 'missing.txt')]);
  for (const item of result.attachments) { assert.ok(item.error); assert.equal(item.context, undefined); }
});

test('folder attachment provides bounded immediate listing without reading nested files', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'nested'));
  await fs.writeFile(path.join(root, 'nested', 'hidden.txt'), 'SECRET-NESTED-CONTENT');
  await Promise.all(Array.from({ length: 105 }, (_, i) => fs.writeFile(path.join(root, `entry-${i}.txt`), 'FILE-CONTENT')));
  const result = await attachmentContext.captureAttachments([root], { directory: true });
  const context = result.attachments[0].context;
  assert.match(context, /최대 100개/);
  assert.match(context, /파일 내용과 하위 폴더는 읽지 않았습니다/);
  assert.doesNotMatch(context, /SECRET-NESTED-CONTENT|FILE-CONTENT/);
  assert.equal(context.split('\n').length, 102);
});

test('too many picker selections are rejected explicitly', async () => {
  const result = await attachmentContext.captureAttachments(Array(11).fill('unused'));
  assert.equal(result.ok, false);
  assert.match(result.error, /10개/);
  assert.deepEqual(result.attachments, []);
});

test('picker IPC captures only native dialog paths, never caller-supplied paths', async t => {
  const root = await fixture(t), selected = path.join(root, 'chosen.txt');
  await fs.writeFile(selected, 'PICKER-AUTHORIZED-CONTENT');
  const source = await fs.readFile(new URL('../../main.js', import.meta.url), 'utf8');
  const start = source.indexOf('async function handlePickFiles(');
  const end = source.indexOf("ipcMain.handle('athena:pick-files'", start);
  let canceled = false;
  const context = vm.createContext({
    shellWin: {}, dialog: { showOpenDialog: async () => ({ canceled, filePaths: [selected] }) },
    require: name => { assert.equal(name, './lib/main/attachment-context'); return attachmentContext; },
  });
  vm.runInContext(source.slice(start, end), context);
  const result = await context.handlePickFiles({}, { paths: ['not-selected'], directory: false });
  assert.deepEqual(result.paths, [selected]);
  assert.match(result.attachments[0].context, /PICKER-AUTHORIZED-CONTENT/);
  canceled = true;
  assert.equal((await context.handlePickFiles({}, {})).ok, false);
});

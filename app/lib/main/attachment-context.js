'use strict';

const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { TextDecoder } = require('node:util');

const MAX_FILES = 10;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_DIRECTORY_ENTRIES = 100;

// Called only with paths returned by the native picker. Capture a bounded
// snapshot once, so every provider and a retried turn see the same attachment.
async function captureAttachments(paths, { directory = false } = {}) {
  if (paths.length > MAX_FILES) {
    return { ok: false, error: `첨부는 한 번에 ${MAX_FILES}개까지 선택할 수 있습니다.`, paths: [], attachments: [] };
  }
  const attachments = [];
  for (const selectedPath of paths) {
    const attachment = { id: randomUUID(), path: selectedPath, isDir: directory };
    try {
      if (directory) {
        const entries = [];
        const dir = await fs.opendir(selectedPath);
        let truncated = false;
        for await (const entry of dir) {
          if (entries.length === MAX_DIRECTORY_ENTRIES) { truncated = true; break; }
          entries.push(`${entry.isDirectory() ? '[폴더]' : entry.isSymbolicLink() ? '[링크]' : '[파일]'} ${entry.name}`);
        }
        attachment.context = `폴더 목록: ${selectedPath}\n바로 아래 항목만 나열했습니다. 파일 내용과 하위 폴더는 읽지 않았습니다.${truncated ? ` 최대 ${MAX_DIRECTORY_ENTRIES}개로 잘린 목록입니다.` : ''}\n${entries.sort().join('\n') || '(빈 폴더)'}`;
      } else {
        const handle = await fs.open(selectedPath, 'r');
        let buffer;
        try {
          if (!(await handle.stat()).isFile()) throw new Error('일반 텍스트 파일만 첨부할 수 있습니다.');
          const bytes = Buffer.alloc(MAX_TEXT_BYTES + 1);
          let count = 0;
          while (count < bytes.length) {
            const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count);
            if (!bytesRead) break;
            count += bytesRead;
          }
          if (count > MAX_TEXT_BYTES) throw new Error('파일이 64 KiB를 초과합니다. 필요한 부분을 작은 텍스트 파일로 첨부해 주세요.');
          buffer = bytes.subarray(0, count);
        } finally { await handle.close(); }
        if (buffer.includes(0)) throw new Error('바이너리 파일은 지원하지 않습니다. UTF-8 텍스트 파일로 첨부해 주세요.');
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
        catch { throw new Error('UTF-8 텍스트 파일만 지원합니다. 인코딩을 변환해 주세요.'); }
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
          || text.startsWith('%PDF-')) throw new Error('문서/바이너리 형식은 지원하지 않습니다. UTF-8 텍스트로 변환해 주세요.');
        attachment.context = `텍스트 파일: ${selectedPath}\n${text || '(빈 파일)'}`;
      }
    } catch (error) {
      attachment.error = error.code ? `파일을 읽지 못했습니다 (${error.code}). 다시 선택해 주세요.` : error.message;
    }
    attachments.push(attachment);
  }
  return { ok: true, paths: attachments.map(item => item.path), attachments };
}

module.exports = { captureAttachments, MAX_FILES, MAX_TEXT_BYTES, MAX_DIRECTORY_ENTRIES };

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { detailPanelResponsiveWidth } = require('./board-mount.js');
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('expanded quote rows subtract their fixed level column before splitting bid and ask widths', () => {
  assert.equal(detailPanelResponsiveWidth(62), '54px');
  assert.equal(detailPanelResponsiveWidth(170), 'calc((100% - 54px) / 2)');
  assert.equal(detailPanelResponsiveWidth(151), 'calc((100% - 54px) / 2)');
  assert.equal(detailPanelResponsiveWidth(191), 'calc((100% - 20px) / 2)');
});

test('the 13K0 ranking footer follows its readable owner instead of its authored fixed width', () => {
  const css = fs.readFileSync(path.join(appRoot, 'styles', 'board-surface.css'), 'utf8');
  assert.match(css, /\[data-bs-board-id="13K0-2"\]\s+\[data-node="33WD-0"\]\s*>\s*\[data-node="33YY-0"\]\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;/s);
});

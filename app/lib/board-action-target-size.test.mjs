import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

test('Paper 카드 액션의 실제 role=button 대상은 최소 44x44px이다', () => {
  const css = fs.readFileSync(path.join(appRoot, 'styles', 'board-surface.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css,
    /\[data-card-action\]\[role="button"\]\s*\{[^}]*display:\s*inline-flex;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/);
});

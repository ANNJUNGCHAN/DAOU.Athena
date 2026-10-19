import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

const libDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(libDir, '..');
const links = JSON.parse(
  readFileSync(path.join(rootDir, 'config', 'links.json'), 'utf8'),
);
const githubLinkSource = readFileSync(path.join(libDir, 'github-link.ts'), 'utf8');
const homepageSource = readFileSync(path.join(rootDir, 'app', 'page.tsx'), 'utf8');

test('GitHub 바로가기 reads the URL from config/links.json', () => {
  assert.equal(typeof links.github, 'string');
  assert.match(links.github, /^https:\/\/github\.com\//);
  assert.equal(links.github, 'https://github.com/ANNJUNGCHAN/DAOU.Athena.git');

  assert.match(githubLinkSource, /from ['"]@\/config\/links\.json['"]/);
  assert.match(githubLinkSource, /links\.github/);

  assert.match(homepageSource, /from ['"]@\/lib\/github-link['"]/);
  const control = homepageSource.match(
    /<a\b[\s\S]*?aria-label="GitHub 바로가기 \(새 탭에서 열림\)"[\s\S]*?>[\s\S]*?GitHub 바로가기[\s\S]*?<\/a>/,
  );
  assert.ok(control, 'homepage must render the GitHub 바로가기 control');
  assert.match(control[0], /href=\{GITHUB_REPO_URL\}/);
  assert.equal(
    control[0].includes('https://github.com/ANNJUNGCHAN/DAOU.Athena.git'),
    false,
  );
});

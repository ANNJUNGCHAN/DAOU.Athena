import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'path';

const libDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(libDir, '..');
const release = JSON.parse(
  readFileSync(path.join(rootDir, 'config', 'product-release.json'), 'utf8'),
);
const installerSource = readFileSync(
  path.join(libDir, 'windows-installer.ts'),
  'utf8',
);
const buttonSource = readFileSync(
  path.join(rootDir, 'components', 'download-button.tsx'),
  'utf8',
);

test('Windows installer derives one coherent asset from the product release manifest', () => {
  assert.equal(release.schemaVersion, 1);
  assert.match(release.productRelease.version, /^\d+\.\d+\.\d+$/);
  assert.equal(release.productRelease.tag, `v${release.productRelease.version}`);
  assert.match(release.productRelease.sourceCommit, /^[0-9a-f]{40}$/);
  assert.equal(
    release.windowsInstaller.file,
    `Athena-Setup-${release.productRelease.version}-x64.exe`,
  );
  assert.equal(
    release.windowsInstaller.url,
    `https://github.com/ANNJUNGCHAN/DAOU.Athena/releases/download/${release.productRelease.tag}/${release.windowsInstaller.file}`,
  );
  assert.match(release.windowsInstaller.sha256, /^[0-9a-f]{64}$/);
  assert.match(release.windowsInstaller.buildInfoSha256, /^[0-9a-f]{64}$/);

  assert.match(
    installerSource,
    /from ['"]@\/config\/product-release\.json['"]/,
  );
  assert.match(installerSource, /release\.windowsInstaller\.file/);
  assert.match(installerSource, /release\.windowsInstaller\.url/);

  assert.match(buttonSource, /href=\{WINDOWS_INSTALLER_URL\}/);
  assert.match(buttonSource, /download=\{WINDOWS_INSTALLER_FILE\}/);
  assert.match(buttonSource, /PRODUCT_RELEASE_VERSION/);
});

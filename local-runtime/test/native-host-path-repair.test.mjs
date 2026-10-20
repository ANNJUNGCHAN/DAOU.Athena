import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPAIR_SCRIPT = fileURLToPath(new URL('../scripts/repair-native-host-path.ps1', import.meta.url));
const HOST_NAME = 'com.athena.wts';
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const IMMUTABLE_FILES = [
  'contracts/wts-foundation.mjs',
  'contracts/wts-foundation.protocol.schema.json',
  'runtime/package.json',
  'runtime/src/config.mjs',
  'runtime/src/errors.mjs',
  'runtime/src/framing.mjs',
  'runtime/src/host.mjs',
  'runtime/src/inventory-store.mjs',
  'runtime/src/main.mjs',
];

function powerShell() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runRepair(args) {
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', REPAIR_SCRIPT, ...args],
    { encoding: 'utf8' },
  );
}

function runPowerShell(source) {
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8' },
  );
}

function psLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function registryScript(registrySubKey, operation, value = '') {
  const setup = `
$ErrorActionPreference = 'Stop'
$subKey = ${psLiteral(registrySubKey)}
$value = ${psLiteral(value)}
$views = @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)
`;
  if (operation === 'set') {
    return `${setup}
foreach ($view in $views) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    $key = $base.CreateSubKey($subKey)
    try { $key.SetValue('', $value, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
  } finally { $base.Dispose() }
}
`;
  }
  if (operation === 'get') {
    return `${setup}
$result = foreach ($view in $views) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try {
    $key = $base.OpenSubKey($subKey, $false)
    if ($null -eq $key) { throw "Missing test key in $view" }
    try {
      [pscustomobject]@{ view = $view.ToString(); kind = $key.GetValueKind('').ToString(); value = $key.GetValue('') }
    } finally { $key.Dispose() }
  } finally { $base.Dispose() }
}
$result | ConvertTo-Json -Compress
`;
  }
  return `${setup}
foreach ($view in $views) {
  $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
  try { $base.DeleteSubKeyTree($subKey, $false) } finally { $base.Dispose() }
}
`;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function createInstalledV1(root) {
  const source = path.join(root, 'old host');
  const sourceData = path.join(root, 'old data');
  const manifestPath = path.join(source, `${HOST_NAME}.json`);
  const configPath = path.join(source, 'host-config.json');
  const launcherPath = path.join(source, 'athena-wts-native-host.cmd');
  const entryPoint = path.join(source, 'runtime', 'src', 'main.mjs');
  const allowedOrigin = `chrome-extension://${EXTENSION_ID}/`;
  await writeJson(path.join(source, '.athena-wts-native-host.json'), {
    installedBy: 'athena-wts-local-runtime',
    hostName: HOST_NAME,
    manifestPath,
    dataDirectory: sourceData,
  });
  await writeJson(manifestPath, {
    name: HOST_NAME,
    description: 'ATHENA WTS local observation runtime',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [allowedOrigin],
  });
  await writeJson(configPath, {
    hostName: HOST_NAME,
    allowedOrigin,
    dataDir: sourceData,
  });
  const launcher = [
    '@echo off',
    `set "ATHENA_WTS_HOST_CONFIG=${configPath}"`,
    `"${process.execPath}" "${entryPoint}" %*`,
    '',
  ].join('\r\n');
  await writeFile(launcherPath, launcher, 'utf8');
  await writeJson(path.join(source, 'runtime', 'package.json'), {
    name: '@athena/wts-local-runtime',
    version: '0.1.0',
    private: true,
    type: 'module',
    engines: { node: '>=20' },
  });
  const immutableContents = new Map();
  for (const relativePath of IMMUTABLE_FILES) {
    const filePath = path.join(source, relativePath);
    try {
      await access(filePath);
    } catch {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `fixture:${relativePath}\n`, 'utf8');
    }
    immutableContents.set(relativePath, await readFile(filePath));
  }
  return { source, sourceData, manifestPath, immutableContents };
}

test('path repair defaults to a non-mutating dry run and Apply preserves installed v1 bytes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.homedir(), '.athena-wts-repair-test-'));
  const registrySubKey = `Software\\AthenaWtsNativeHostRepairTests-${randomUUID()}\\${HOST_NAME}`;
  try {
    const fixture = await createInstalledV1(root);
    const destination = path.join(root, 'new host');
    const dataDirectory = path.join(root, 'new data');
    const registrySetup = runPowerShell(registryScript(registrySubKey, 'set', fixture.manifestPath));
    assert.equal(registrySetup.status, 0, registrySetup.stderr);

    const args = [
      '-Source', fixture.source,
      '-SourceDataDirectory', fixture.sourceData,
      '-Destination', destination,
      '-DataDirectory', dataDirectory,
      '-RegistrySubKey', registrySubKey,
    ];
    const dryRun = runRepair(args);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /mode\s+: DryRun/u);
    assert.match(dryRun.stdout, /filesWritten\s+: False/u);
    assert.match(dryRun.stdout, /registryUpdated\s+: False/u);
    await assert.rejects(access(destination), (error) => error.code === 'ENOENT');

    const beforeSource = new Map();
    for (const [relativePath, contents] of fixture.immutableContents) {
      beforeSource.set(relativePath, digest(contents));
    }
    const applied = runRepair([...args, '-Apply']);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /mode\s+: Apply/u);
    assert.match(applied.stdout, /oldInstallationPreserved\s+: True/u);

    for (const [relativePath, expectedDigest] of beforeSource) {
      assert.equal(digest(await readFile(path.join(fixture.source, relativePath))), expectedDigest);
      assert.equal(digest(await readFile(path.join(destination, relativePath))), expectedDigest);
    }
    const newManifestPath = path.join(destination, `${HOST_NAME}.json`);
    const manifest = JSON.parse(await readFile(newManifestPath, 'utf8'));
    const config = JSON.parse(await readFile(path.join(destination, 'host-config.json'), 'utf8'));
    const marker = JSON.parse(await readFile(path.join(destination, '.athena-wts-native-host.json'), 'utf8'));
    assert.equal(manifest.path, path.join(destination, 'athena-wts-native-host.cmd'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${EXTENSION_ID}/`]);
    assert.equal(config.dataDir, dataDirectory);
    assert.equal(marker.manifestPath, newManifestPath);
    assert.equal(marker.dataDirectory, dataDirectory);
    const rootEntries = await readdir(root);
    const backupNames = rootEntries.filter((entry) => /^\.athena-wts-native-host-registry-backup-[0-9a-f]{32}\.json$/u.test(entry));
    assert.equal(backupNames.length, 1);
    const backup = JSON.parse(await readFile(path.join(root, backupNames[0]), 'utf8'));
    assert.equal(backup.previousManifestPath, fixture.manifestPath);
    assert.deepEqual(backup.snapshots.map(({ view, kind, value }) => ({ view, kind, value })), [
      { view: 'Registry32', kind: 'String', value: fixture.manifestPath },
      { view: 'Registry64', kind: 'String', value: fixture.manifestPath },
    ]);

    const registryRead = runPowerShell(registryScript(registrySubKey, 'get'));
    assert.equal(registryRead.status, 0, registryRead.stderr);
    const registrations = JSON.parse(registryRead.stdout.trim());
    assert.deepEqual(registrations, [
      { view: 'Registry32', kind: 'String', value: newManifestPath },
      { view: 'Registry64', kind: 'String', value: newManifestPath },
    ]);
    const repairSource = await readFile(REPAIR_SCRIPT, 'utf8');
    assert.match(repairSource, /\[IO\.FileMode\]::CreateNew/u);
    await assert.rejects(
      access(path.join(destination, '.native-host-registry-backup.json')),
      (error) => error.code === 'ENOENT',
    );
  } finally {
    const registryCleanup = runPowerShell(registryScript(registrySubKey, 'delete'));
    assert.equal(registryCleanup.status, 0, registryCleanup.stderr);
    await rm(root, { recursive: true, force: true });
  }
});

test('path repair refuses a non-empty old data directory before creating a destination', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.homedir(), '.athena-wts-repair-test-'));
  try {
    const fixture = await createInstalledV1(root);
    const destination = path.join(root, 'new host');
    await mkdir(fixture.sourceData, { recursive: true });
    await writeFile(path.join(fixture.sourceData, 'capture.json'), '{"existing":true}', 'utf8');
    const refused = runRepair([
      '-Source', fixture.source,
      '-SourceDataDirectory', fixture.sourceData,
      '-Destination', destination,
      '-DataDirectory', path.join(root, 'new data'),
      '-RegistrySubKey', `Software\\AthenaWtsNativeHostRepairTests-${randomUUID()}\\${HOST_NAME}`,
      '-Apply',
    ]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /explicit data migration is required/u);
    await assert.rejects(access(destination), (error) => error.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

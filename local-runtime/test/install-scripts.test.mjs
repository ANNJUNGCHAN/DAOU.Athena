import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { access, link, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const INSTALL_SCRIPT = fileURLToPath(new URL('../scripts/install.ps1', import.meta.url));
const UNINSTALL_SCRIPT = fileURLToPath(new URL('../scripts/uninstall.ps1', import.meta.url));
const PATH_VALIDATION_SCRIPT = fileURLToPath(new URL('../scripts/path-validation.ps1', import.meta.url));
const REGISTRY_SCRIPT = fileURLToPath(new URL('../scripts/registry.ps1', import.meta.url));
const REGISTRY_TEST_SCRIPT = fileURLToPath(new URL('./registry-write.test.ps1', import.meta.url));
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const REVIEWED_RUNTIME_FILES = [
  'src\\backend-supervisor.mjs',
  'src\\chatgpt-provider\\browser-opener.mjs',
  'src\\chatgpt-provider\\control-candidate.mjs',
  'src\\chatgpt-provider\\models-client.mjs',
  'src\\chatgpt-provider\\oauth-session.mjs',
  'src\\chatgpt-provider\\openid-verifier.mjs',
  'src\\chatgpt-provider\\planning-client.mjs',
  'src\\chatgpt-provider\\provider-coordinator.mjs',
  'src\\chatgpt-provider\\registration-store.mjs',
  'src\\chatgpt-provider\\responses-client.mjs',
  'src\\chatgpt-provider\\token-session.mjs',
  'src\\config.mjs',
  'src\\control-planner.mjs',
  'src\\conversation-router.mjs',
  'src\\errors.mjs',
  'src\\financial-backend-supervisor.mjs',
  'src\\financial-source-bridge.mjs',
  'src\\framing.mjs',
  'src\\host.mjs',
  'src\\inventory-store.mjs',
  'src\\main.mjs',
  'src\\receipt-store.mjs',
  'src\\source-bridge.mjs',
  'src\\task-compiler.mjs',
  'src\\task-engine.mjs',
  'src\\task-store.mjs',
  'scripts\\open-openai-authorization.ps1',
  'scripts\\openai-registration-store.ps1',
];

function powerShell() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runScript(script, args, env = process.env) {
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { encoding: 'utf8', env },
  );
}

function runPowerShellCommand(command) {
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    { encoding: 'utf8' },
  );
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('installer dry-run validates a new destination without changing files or registry', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-install-'));
  const destination = path.join(root, 'installed host');
  const dataDirectory = path.join(root, 'user data');
  const result = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-DryRun',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /registryUpdated\s+: False/u);
  assert.match(result.stdout, /filesWritten\s+: False/u);
  await assert.rejects(access(destination), (error) => error.code === 'ENOENT');
});

test('installer accepts only a complete physically validated read-only backend pair', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-backend-pair-'));
  const destination = path.join(root, 'installed host');
  const dataDirectory = path.join(root, 'user data');
  const backendRoot = path.join(root, 'backend');
  const backendPackage = path.join(backendRoot, 'athena_api');
  await mkdir(backendPackage, { recursive: true });
  await writeFile(path.join(backendPackage, 'launcher.py'), '# launcher\n', 'utf8');
  await writeFile(path.join(backendPackage, 'readonly_app.py'), '# readonly\n', 'utf8');

  const missingPair = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-BackendRoot', backendRoot,
    '-DryRun',
  ]);
  assert.notEqual(missingPair.status, 0);
  assert.match(missingPair.stderr, /must be configured together/u);

  const relativePair = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-BackendRoot', 'relative-backend',
    '-PythonExecutable', 'relative-python.exe',
    '-DryRun',
  ]);
  assert.notEqual(relativePair.status, 0);
  assert.match(relativePair.stderr, /must be absolute paths/u);

  const emptyPair = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-BackendRoot', ' ',
    '-PythonExecutable', ' ',
    '-DryRun',
  ]);
  assert.notEqual(emptyPair.status, 0);
  assert.match(emptyPair.stderr, /must be absolute paths/u);

  const configured = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-BackendRoot', backendRoot,
    '-PythonExecutable', process.execPath,
    '-DryRun',
  ]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.match(configured.stdout, /backendConfigured\s+: True/u);
  assert.match(configured.stdout, /filesWritten\s+: False/u);
  await assert.rejects(access(destination), (error) => error.code === 'ENOENT');
});

test('installer validates required backend files before creating the destination', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-backend-files-'));
  const destination = path.join(root, 'installed host');
  const backendRoot = path.join(root, 'backend');
  await mkdir(path.join(backendRoot, 'athena_api'), { recursive: true });
  await writeFile(path.join(backendRoot, 'athena_api', 'launcher.py'), '# launcher\n', 'utf8');
  const result = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', path.join(root, 'user data'),
    '-BackendRoot', backendRoot,
    '-PythonExecutable', process.execPath,
    '-DryRun',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /read-only backend application must be a file/u);
  await assert.rejects(access(destination), (error) => error.code === 'ENOENT');

  const missingRoot = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', path.join(root, 'user data'),
    '-BackendRoot', path.join(root, 'missing-backend'),
    '-PythonExecutable', process.execPath,
    '-DryRun',
  ]);
  assert.notEqual(missingRoot.status, 0);
  assert.match(missingRoot.stderr, /backend root must be a directory/u);
});

test('installer and uninstaller default to the non-AppData user profile location', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-default-path-'));
  const userProfile = path.join(root, 'profile');
  const localAppData = path.join(root, 'virtualized-local-app-data');
  const destination = path.join(userProfile, '.athena', 'WtsNativeHost');
  const dataDirectory = path.join(userProfile, '.athena', 'WtsData');

  const result = runScript(
    INSTALL_SCRIPT,
    ['-ExtensionId', EXTENSION_ID, '-DryRun'],
    { ...process.env, USERPROFILE: userProfile, LOCALAPPDATA: localAppData },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.toLowerCase().includes(destination.toLowerCase()), result.stdout);
  assert.ok(result.stdout.toLowerCase().includes(dataDirectory.toLowerCase()), result.stdout);
  await assert.rejects(access(destination), (error) => error.code === 'ENOENT');
  await assert.rejects(access(dataDirectory), (error) => error.code === 'ENOENT');

  const uninstallSource = await readFile(UNINSTALL_SCRIPT, 'utf8');
  assert.match(uninstallSource, /USERPROFILE[\s\S]+\.athena\\WtsNativeHost/u);
  assert.doesNotMatch(uninstallSource, /LOCALAPPDATA[\s\S]+Athena\\WtsNativeHost/u);
});

test('physical-path helper resolves a real directory through a Windows handle', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-physical-path-'));
  const command = [
    `. ${quotePowerShell(PATH_VALIDATION_SCRIPT)}`,
    `$resolved = Assert-AthenaPhysicalPath -Path ${quotePowerShell(root)} -Purpose 'test directory'`,
    '[Console]::Out.Write($resolved)',
  ].join('; ');
  const result = runPowerShellCommand(command);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(path.resolve(result.stdout), path.resolve(root));
});

test('physical-path mismatch is rejected with a no-registration explanation', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-physical-mismatch-'));
  const differentPath = path.join(path.dirname(root), `${path.basename(root)}-redirected`);
  const command = [
    `. ${quotePowerShell(PATH_VALIDATION_SCRIPT)}`,
    `Assert-AthenaPhysicalPathMatch -RequestedPath ${quotePowerShell(root)} -PhysicalPath ${quotePowerShell(differentPath)} -Purpose 'test directory'`,
  ].join('; ');
  const result = runPowerShellCommand(command);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /path redirection or a junction/u);
  assert.match(result.stderr, /native host was not registered/u);

  const installerSource = await readFile(INSTALL_SCRIPT, 'utf8');
  const destinationCheck = installerSource.indexOf("Assert-AthenaInstallDirectory -Path $Destination");
  const writeTargetCheck = installerSource.indexOf('foreach ($writeTarget in $WriteTargets)');
  const registryWrite = installerSource.indexOf('Set-AthenaRegistryDefaultValue');
  assert.ok(destinationCheck >= 0 && destinationCheck < registryWrite);
  assert.ok(writeTargetCheck >= 0 && writeTargetCheck < registryWrite);
});

test('installer rejects an existing linked output before overwriting its external target', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-install-link-'));
  const destination = path.join(root, 'WtsNativeHost');
  const dataDirectory = path.join(root, 'WtsData');
  const manifestPath = path.join(destination, 'com.athena.wts.json');
  const markerPath = path.join(destination, '.athena-wts-native-host.json');
  const configPath = path.join(destination, 'host-config.json');
  const externalSentinel = path.join(root, 'external-sentinel.json');
  await mkdir(destination, { recursive: true });
  await writeFile(markerPath, JSON.stringify({
    installedBy: 'athena-wts-local-runtime',
    hostName: 'com.athena.wts',
    manifestPath,
    dataDirectory,
  }), 'utf8');
  await writeFile(externalSentinel, '{"external":"preserve"}', 'utf8');
  await link(externalSentinel, configPath);

  const result = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-DryRun',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unexpected linked installation output/u);
  assert.equal(await readFile(externalSentinel, 'utf8'), '{"external":"preserve"}');

  const installerSource = await readFile(INSTALL_SCRIPT, 'utf8');
  const writePreflight = installerSource.indexOf('foreach ($writeTarget in $WriteTargets)');
  const firstCopy = installerSource.indexOf('Copy-Item -LiteralPath');
  const firstWrite = installerSource.indexOf('[IO.File]::WriteAllText');
  const registryWrite = installerSource.indexOf('Set-AthenaRegistryDefaultValue');
  assert.ok(writePreflight >= 0 && writePreflight < firstCopy && writePreflight < firstWrite);
  assert.ok(writePreflight < registryWrite);
});

test('uninstaller refuses an unknown installation file before removing anything', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-uninstall-unknown-'));
  const destination = path.join(root, 'WtsNativeHost');
  const manifestPath = path.join(destination, 'com.athena.wts.json');
  const markerPath = path.join(destination, '.athena-wts-native-host.json');
  const unknownPath = path.join(destination, 'later-added.txt');
  await mkdir(destination, { recursive: true });
  await writeFile(markerPath, JSON.stringify({
    installedBy: 'athena-wts-local-runtime',
    hostName: 'com.athena.wts',
    manifestPath,
    dataDirectory: path.join(root, 'WtsData'),
  }), 'utf8');
  await writeFile(unknownPath, 'preserve me', 'utf8');

  const result = runScript(UNINSTALL_SCRIPT, [
    '-Destination', destination,
    '-RegistryPath', `HKCU:\\Software\\AthenaWtsNativeHostTests-${randomUUID()}`,
    '-DryRun',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unexpected item in the ATHENA installation/u);
  assert.equal(await readFile(unknownPath, 'utf8'), 'preserve me');
  assert.equal(JSON.parse(await readFile(markerPath, 'utf8')).hostName, 'com.athena.wts');

  const source = await readFile(UNINSTALL_SCRIPT, 'utf8');
  assert.ok(source.indexOf('Unexpected item in the ATHENA installation') < source.indexOf('Remove-Item -LiteralPath $RegistryPath'));
  assert.doesNotMatch(source, /Remove-Item[^\r\n]+-Recurse/iu);
});

test('uninstaller accepts the complete nested 0.8 runtime allowlist without changing user data', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-uninstall-nested-'));
  const destination = path.join(root, 'WtsNativeHost');
  const dataDirectory = path.join(root, 'WtsData');
  const manifestPath = path.join(destination, 'com.athena.wts.json');
  const markerPath = path.join(destination, '.athena-wts-native-host.json');
  const packageFiles = [
    ...REVIEWED_RUNTIME_FILES.map((relativePath) => path.join(destination, 'runtime', relativePath)),
    path.join(destination, 'runtime', 'package.json'),
    path.join(destination, 'contracts', 'wts-foundation.mjs'),
    path.join(destination, 'contracts', 'wts-foundation.protocol.schema.json'),
    path.join(destination, 'host-config.json'),
    path.join(destination, 'athena-wts-native-host.cmd'),
    manifestPath,
  ];
  for (const filePath of packageFiles) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `fixture:${path.basename(filePath)}\n`, 'utf8');
  }
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(path.join(dataDirectory, 'registration.json'), '{"preserve":true}\n', 'utf8');
  await writeFile(markerPath, JSON.stringify({
    installedBy: 'athena-wts-local-runtime',
    hostName: 'com.athena.wts',
    manifestPath,
    dataDirectory,
  }), 'utf8');

  const before = await readFile(path.join(dataDirectory, 'registration.json'));
  const result = runScript(UNINSTALL_SCRIPT, [
    '-Destination', destination,
    '-RegistryPath', `HKCU:\\Software\\AthenaWtsNativeHostTests-${randomUUID()}`,
    '-DryRun',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /userDataPreserved\s+: True/u);
  assert.equal(digest(await readFile(path.join(dataDirectory, 'registration.json'))), digest(before));
});

test('uninstaller rejects a junction without touching its target or registration', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-uninstall-junction-'));
  const destination = path.join(root, 'WtsNativeHost');
  const externalDirectory = path.join(root, 'external-runtime');
  const runtimeJunction = path.join(destination, 'runtime');
  const manifestPath = path.join(destination, 'com.athena.wts.json');
  const markerPath = path.join(destination, '.athena-wts-native-host.json');
  const sentinelPath = path.join(externalDirectory, 'sentinel.txt');
  const registryPath = `HKCU:\\Software\\AthenaWtsNativeHostTests-${randomUUID()}`;
  await mkdir(destination, { recursive: true });
  await mkdir(externalDirectory, { recursive: true });
  await writeFile(sentinelPath, 'external sentinel', 'utf8');
  await writeFile(markerPath, JSON.stringify({
    installedBy: 'athena-wts-local-runtime',
    hostName: 'com.athena.wts',
    manifestPath,
    dataDirectory: path.join(root, 'WtsData'),
  }), 'utf8');
  await symlink(externalDirectory, runtimeJunction, 'junction');

  const createRegistration = runPowerShellCommand([
    `. ${quotePowerShell(REGISTRY_SCRIPT)}`,
    `Set-AthenaRegistryDefaultValue -Path ${quotePowerShell(registryPath)} -Value ${quotePowerShell(manifestPath)}`,
  ].join('; '));
  assert.equal(createRegistration.status, 0, createRegistration.stderr);
  try {
    const result = runScript(UNINSTALL_SCRIPT, [
      '-Destination', destination,
      '-RegistryPath', registryPath,
      '-DryRun',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /path redirection or a junction|unexpected reparse point/u);
    assert.equal(await readFile(sentinelPath, 'utf8'), 'external sentinel');

    const readRegistration = runPowerShellCommand(
      `[Console]::Out.Write((Get-Item -LiteralPath ${quotePowerShell(registryPath)}).GetValue(''))`,
    );
    assert.equal(readRegistration.status, 0, readRegistration.stderr);
    assert.equal(readRegistration.stdout, manifestPath);
  } finally {
    const cleanup = runPowerShellCommand(
      `if (Test-Path -LiteralPath ${quotePowerShell(registryPath)}) { Remove-Item -LiteralPath ${quotePowerShell(registryPath)} -Force }`,
    );
    assert.equal(cleanup.status, 0, cleanup.stderr);
  }
});

test('installer dry-run leaves an existing default installation byte-for-byte unchanged', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-existing-'));
  const userProfile = path.join(root, 'profile');
  const destination = path.join(userProfile, '.athena', 'WtsNativeHost');
  const dataDirectory = path.join(userProfile, '.athena', 'WtsData');
  const manifestPath = path.join(destination, 'com.athena.wts.json');
  await mkdir(destination, { recursive: true });
  await mkdir(dataDirectory, { recursive: true });
  const files = new Map([
    [path.join(destination, '.athena-wts-native-host.json'), JSON.stringify({
      installedBy: 'athena-wts-local-runtime',
      hostName: 'com.athena.wts',
      manifestPath,
      dataDirectory,
    })],
    [manifestPath, '{"existing":"manifest"}'],
    [path.join(destination, 'host-config.json'), '{"existing":"config"}'],
    [path.join(destination, 'athena-wts-native-host.cmd'), '@echo existing\r\n'],
    [path.join(dataDirectory, 'inventory.json'), '{"user":"data"}'],
  ]);
  for (const [filePath, contents] of files) {
    await writeFile(filePath, contents, 'utf8');
  }
  const before = new Map();
  for (const filePath of files.keys()) {
    before.set(filePath, digest(await readFile(filePath)));
  }

  const result = runScript(
    INSTALL_SCRIPT,
    ['-ExtensionId', EXTENSION_ID, '-DryRun'],
    { ...process.env, USERPROFILE: userProfile },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /filesWritten\s+: False/u);
  for (const filePath of files.keys()) {
    assert.equal(digest(await readFile(filePath)), before.get(filePath), filePath);
  }

  const uninstall = runScript(
    UNINSTALL_SCRIPT,
    [
      '-Destination', destination,
      '-RegistryPath', `HKCU:\\Software\\AthenaWtsNativeHostTests-${randomUUID()}`,
      '-DryRun',
    ],
    { ...process.env, USERPROFILE: userProfile },
  );
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(await readFile(path.join(dataDirectory, 'inventory.json'), 'utf8'), '{"user":"data"}');
});

test('installer has an explicit runtime source allowlist for bounded WTS control', async () => {
  const source = await readFile(INSTALL_SCRIPT, 'utf8');
  for (const relativePath of REVIEWED_RUNTIME_FILES) assert.ok(source.includes(`'${relativePath}'`), relativePath);
  assert.match(source, /description = 'ATHENA WTS local bounded screen-control runtime'/u);
  assert.match(source, /Join-Path \$RuntimeDestination \$relativePath/u);
  assert.doesNotMatch(source, /GetFileName\(\$relativePath\)/u);
  assert.doesNotMatch(source, /Copy-Item[^\r\n]+['"]src['"][^\r\n]+-Recurse/iu);
  assert.doesNotMatch(source, /Copy-Item[^\r\n]+(?:backend|venv)[^\r\n]+-Recurse/iu);

  const uninstallSource = await readFile(UNINSTALL_SCRIPT, 'utf8');
  for (const relativePath of REVIEWED_RUNTIME_FILES) assert.ok(uninstallSource.includes(`'${relativePath}'`), relativePath);
  assert.match(uninstallSource, /Sort-Object \{ \$_\.Length \} -Descending/u);
});

test('installer rejects a non-Chrome extension id before writing files', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-bad-id-'));
  const destination = path.join(root, 'host');
  const result = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', 'not-an-extension-id',
    '-Destination', destination,
    '-DataDirectory', path.join(root, 'data'),
    '-DryRun',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ExtensionId must contain exactly 32/u);
});

test('installer rejects a data directory equal to the installation destination', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-same-data-'));
  const destination = path.join(root, 'host');
  const result = runScript(INSTALL_SCRIPT, [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', `${destination}${path.sep}`,
    '-DataDirectory', destination,
    '-DryRun',
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /DataDirectory must be outside Destination/u);
  await assert.rejects(access(destination), (error) => error.code === 'ENOENT');
});

test('registry provider writes and verifies a default value through a temporary HKCU key', { skip: process.platform !== 'win32' }, () => {
  const registryPath = `HKCU:\\Software\\AthenaWtsNativeHostTests-${randomUUID()}`;
  const expectedValue = 'C:\\Temp\\Athena Test\\com.athena.wts.json';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = runScript(REGISTRY_TEST_SCRIPT, [
      '-RegistryPath', registryPath,
      '-ExpectedValue', expectedValue,
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /C:\\Temp\\Athena Test\\com\.athena\.wts\.json/u);
  }
});

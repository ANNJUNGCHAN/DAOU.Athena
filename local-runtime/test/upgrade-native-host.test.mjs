import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const UPGRADE_SCRIPT = fileURLToPath(new URL('../scripts/upgrade-native-host.ps1', import.meta.url));
const PATH_VALIDATION_SCRIPT = fileURLToPath(new URL('../scripts/path-validation.ps1', import.meta.url));
const HOST_NAME = 'com.athena.wts';
const EXTENSION_ID = 'mhbcjkjmgabekcakpilhgkgeedhkjfee';
const REVIEWED_RUNTIME_SOURCE_FILES = [
  'backend-supervisor.mjs',
  'chatgpt-provider/browser-opener.mjs',
  'chatgpt-provider/control-candidate.mjs',
  'chatgpt-provider/models-client.mjs',
  'chatgpt-provider/oauth-session.mjs',
  'chatgpt-provider/openid-verifier.mjs',
  'chatgpt-provider/planning-client.mjs',
  'chatgpt-provider/provider-coordinator.mjs',
  'chatgpt-provider/registration-store.mjs',
  'chatgpt-provider/responses-client.mjs',
  'chatgpt-provider/token-session.mjs',
  'config.mjs',
  'control-planner.mjs',
  'conversation-router.mjs',
  'errors.mjs',
  'financial-backend-supervisor.mjs',
  'financial-source-bridge.mjs',
  'framing.mjs',
  'host.mjs',
  'inventory-store.mjs',
  'main.mjs',
  'receipt-store.mjs',
  'source-bridge.mjs',
  'task-compiler.mjs',
  'task-engine.mjs',
  'task-store.mjs',
];
const REVIEWED_RUNTIME_SCRIPT_FILES = [
  'open-openai-authorization.ps1',
  'openai-registration-store.ps1',
];

function powerShell() {
  return process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

function runUpgrade(args, script = UPGRADE_SCRIPT) {
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { encoding: 'utf8' },
  );
}

function psLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function runPowerShell(source) {
  const encoded = Buffer.from(source, 'utf16le').toString('base64');
  return spawnSync(
    powerShell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8' },
  );
}

function runOwnedProcessGuard({ installRoot, roots = [], snapshot = [], failQueryAt = 0 }) {
  return runPowerShell(`
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(${psLiteral(UPGRADE_SCRIPT)}, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Upgrade script parsing failed.' }
foreach ($name in @('Resolve-NormalizedPath', 'Assert-NoOwnedProcesses')) {
  $functions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $false))
  if ($functions.Count -ne 1) { throw 'Process guard function was not unique.' }
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
$TestMode = $false
$OwnedProcessId = 0
$script:queries = New-Object System.Collections.Generic.List[string]
$script:fixture = ${psLiteral(JSON.stringify({ roots, snapshot, failQueryAt }))} | ConvertFrom-Json
function Get-CimInstance {
  [CmdletBinding()]
  param([string]$Query)
  $script:queries.Add($Query)
  if ($Query -cnotmatch '^SELECT ProcessId, ParentProcessId, Name FROM Win32_Process(?: WHERE CommandLine LIKE .+)?$') {
    throw 'The guard requested fields outside the approved projection.'
  }
  if ($script:fixture.failQueryAt -eq $script:queries.Count) { throw 'Fixture query failure.' }
  if ($script:queries.Count -eq 1) { return $script:fixture.roots }
  if ($script:queries.Count -eq 2) { return $script:fixture.snapshot }
  throw 'Unexpected process query.'
}
$failure = $null
try { Assert-NoOwnedProcesses -InstallRoot ${psLiteral(installRoot)} } catch { $failure = $_.Exception.Message }
[pscustomobject]@{ failure = $failure; queries = @($script:queries) } | ConvertTo-Json -Depth 5 -Compress
`);
}

test('owned process guard requests only metadata and escapes the literal installation prefix', () => {
  const result = runOwnedProcessGuard({
    installRoot: String.raw`C:\Users\O'Brien_[x]%\WtsNativeHost`,
    snapshot: [{ ProcessId: 400, ParentProcessId: 5, Name: 'unrelated.exe' }],
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.failure, null);
  assert.deepEqual(output.queries, [
    String.raw`SELECT ProcessId, ParentProcessId, Name FROM Win32_Process WHERE CommandLine LIKE '%C:\\Users\\O\'Brien[_][[]x][%]\\WtsNativeHost\\%'`,
    'SELECT ProcessId, ParentProcessId, Name FROM Win32_Process',
  ]);
});

test('owned process guard retains root and recursive child blocking without command-line fields', () => {
  const result = runOwnedProcessGuard({
    installRoot: String.raw`C:\Fixture\WtsNativeHost`,
    roots: [{ ProcessId: 100, ParentProcessId: 5, Name: 'node.exe' }],
    snapshot: [
      { ProcessId: 300, ParentProcessId: 200, Name: 'python.exe' },
      { ProcessId: 200, ParentProcessId: 100, Name: 'cmd.exe' },
      { ProcessId: 100, ParentProcessId: 5, Name: 'node.exe' },
      { ProcessId: 400, ParentProcessId: 5, Name: 'unrelated.exe' },
    ],
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.failure,
    'The owned ATHENA native host or one of its child processes is still running: node.exe (100), cmd.exe (200), python.exe (300)');
  assert.equal(output.queries.length, 2);
  assert.doesNotMatch(output.failure, /unrelated/);
});

test('owned process guard retains a matched root absent from the later metadata snapshot', () => {
  const result = runOwnedProcessGuard({
    installRoot: String.raw`C:\Fixture\WtsNativeHost`,
    roots: [{ ProcessId: 100, ParentProcessId: 5, Name: 'node.exe' }],
    snapshot: [{ ProcessId: 400, ParentProcessId: 5, Name: 'unrelated.exe' }],
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.match(output.failure, /still running: node\.exe \(100\)$/);
});

test('owned process guard fails closed when either restricted metadata query fails', () => {
  for (const failQueryAt of [1, 2]) {
    const result = runOwnedProcessGuard({
      installRoot: String.raw`C:\Fixture\WtsNativeHost`, failQueryAt,
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.failure, 'Could not safely inspect ATHENA native-host processes.');
    assert.equal(output.queries.length, failQueryAt);
  }
});

function registryScript(subKey, operation, value = '') {
  const setup = `
$ErrorActionPreference = 'Stop'
$subKey = ${psLiteral(subKey)}
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
    if ($null -eq $key) { throw "Missing upgrade test key in $view" }
    try { [pscustomobject]@{ view = $view.ToString(); value = $key.GetValue('') } } finally { $key.Dispose() }
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

function setPrivateDirectoryAcl(directory) {
  const result = runPowerShell(`
$ErrorActionPreference = 'Stop'
$path = ${psLiteral(directory)}
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$security = New-Object Security.AccessControl.DirectorySecurity
$security.SetOwner($current)
$security.SetAccessRuleProtection($true, $false)
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
foreach ($sid in @($current, $system)) {
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $sid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  )
  [void]$security.AddAccessRule($rule)
}
[IO.Directory]::SetAccessControl($path, $security)
`);
  assert.equal(result.status, 0, result.stderr);
}

function directoryAclInfo(directory) {
  const result = runPowerShell(`
$ErrorActionPreference = 'Stop'
$security = [IO.Directory]::GetAccessControl(${psLiteral(directory)})
$rules = @($security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
  [pscustomobject]@{
    sid = $_.IdentityReference.Value
    type = $_.AccessControlType.ToString()
    rights = $_.FileSystemRights.ToString()
    inherited = $_.IsInherited
  }
})
[pscustomobject]@{
  protected = $security.AreAccessRulesProtected
  owner = $security.GetOwner([Security.Principal.SecurityIdentifier]).Value
  rules = $rules
} | ConvertTo-Json -Depth 5 -Compress
`);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function grantEveryoneFullControl(directory) {
  const result = runPowerShell(`
$ErrorActionPreference = 'Stop'
$path = ${psLiteral(directory)}
$security = [IO.Directory]::GetAccessControl($path)
$everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$rule = [Security.AccessControl.FileSystemAccessRule]::new(
  $everyone,
  [Security.AccessControl.FileSystemRights]::FullControl,
  $inheritance,
  [Security.AccessControl.PropagationFlags]::None,
  [Security.AccessControl.AccessControlType]::Allow
)
[void]$security.AddAccessRule($rule)
[IO.Directory]::SetAccessControl($path, $security)
`);
  assert.equal(result.status, 0, result.stderr);
}

function configureInheritedReadableAcl(destinationParent, destination) {
  const result = runPowerShell(`
$ErrorActionPreference = 'Stop'
$parent = ${psLiteral(destinationParent)}
$destination = ${psLiteral(destination)}
$current = [Security.Principal.WindowsIdentity]::GetCurrent().User
$system = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$everyone = [Security.Principal.SecurityIdentifier]::new('S-1-1-0')
$inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
$parentSecurity = New-Object Security.AccessControl.DirectorySecurity
$parentSecurity.SetOwner($current)
$parentSecurity.SetAccessRuleProtection($true, $false)
foreach ($sid in @($current, $system)) {
  [void]$parentSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $sid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow
  ))
}
[void]$parentSecurity.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
  $everyone,
  [Security.AccessControl.FileSystemRights]::ReadAndExecute,
  $inheritance,
  [Security.AccessControl.PropagationFlags]::None,
  [Security.AccessControl.AccessControlType]::Allow
))
[IO.Directory]::SetAccessControl($parent, $parentSecurity)
$destinationSecurity = New-Object Security.AccessControl.DirectorySecurity
$destinationSecurity.SetOwner($current)
$destinationSecurity.SetAccessRuleProtection($false, $false)
[IO.Directory]::SetAccessControl($destination, $destinationSecurity)
`);
  assert.equal(result.status, 0, result.stderr);
}

function aclTreeSnapshot(root) {
  const result = runPowerShell(`
$ErrorActionPreference = 'Stop'
$root = ${psLiteral(root)}
$items = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Force -Recurse)
@($items | ForEach-Object {
  $sections = [Security.AccessControl.AccessControlSections]::Owner -bor
    [Security.AccessControl.AccessControlSections]::Group -bor
    [Security.AccessControl.AccessControlSections]::Access
  $security = if ($_.PSIsContainer) {
    [IO.Directory]::GetAccessControl($_.FullName)
  } else {
    [IO.File]::GetAccessControl($_.FullName)
  }
  [pscustomobject]@{
    relativePath = if ($_.FullName -ceq $root) { '.' } else { $_.FullName.Substring($root.Length).TrimStart('\\') }
    sddl = $security.GetSecurityDescriptorSddlForm($sections)
  }
} | Sort-Object relativePath) | ConvertTo-Json -Depth 4 -Compress
`);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

function replaceArg(args, name, value) {
  const copy = args.slice();
  const index = copy.indexOf(name);
  assert.notEqual(index, -1, name);
  copy.splice(index, 2, name, value);
  return copy;
}

function removeArg(args, name) {
  const copy = args.slice();
  const index = copy.indexOf(name);
  assert.notEqual(index, -1, name);
  copy.splice(index, 2);
  return copy;
}

async function setLauncherNode(fixture, nodePath) {
  const launcher = [
    '@echo off',
    `set "ATHENA_WTS_HOST_CONFIG=${path.join(fixture.destination, 'host-config.json')}"`,
    `"${nodePath}" "${path.join(fixture.destination, 'runtime', 'src', 'main.mjs')}" %*`,
    '',
  ].join('\r\n');
  await writeFile(path.join(fixture.destination, 'athena-wts-native-host.cmd'), launcher, 'utf8');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function treeSnapshot(root) {
  const result = new Map();
  async function walk(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        result.set(`${relative}${path.sep}`, 'directory');
        await walk(fullPath, relative);
      } else {
        result.set(relative, digest(await readFile(fullPath)));
      }
    }
  }
  await walk(root);
  return result;
}

async function createFixture({ requiredNodeEngine = '>=20' } = {}) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'athena-wts-upgrade-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const destination = path.join(fixtureRoot, 'profile', '.athena', 'WtsNativeHost');
  const dataDirectory = path.join(fixtureRoot, 'profile', '.athena', 'WtsData');
  const backendRoot = path.join(sourceRoot, 'backend');
  const pythonExecutable = path.join(backendRoot, '.venv', 'Scripts', 'python.exe');
  const manifestPath = path.join(destination, `${HOST_NAME}.json`);
  const registrySubKey = `Software\\AthenaWtsNativeHostUpgradeTests-${randomUUID()}\\${HOST_NAME}`;
  const allowedOrigin = `chrome-extension://${EXTENSION_ID}/`;

  await mkdir(path.join(sourceRoot, 'local-runtime', 'src'), { recursive: true });
  await writeJson(path.join(sourceRoot, 'local-runtime', 'package.json'), {
    name: '@athena/wts-local-runtime',
    version: '0.8.0',
    private: true,
    type: 'module',
    engines: { node: requiredNodeEngine },
  });
  for (const relativePath of REVIEWED_RUNTIME_SOURCE_FILES) {
    const sourcePath = path.join(sourceRoot, 'local-runtime', 'src', relativePath);
    await mkdir(path.dirname(sourcePath), { recursive: true });
    const source = relativePath === 'main.mjs'
      ? 'export const version = "new";\n'
      : `export const fixture = ${JSON.stringify(relativePath)};\n`;
    await writeFile(sourcePath, source, 'utf8');
  }
  for (const relativePath of REVIEWED_RUNTIME_SCRIPT_FILES) {
    const scriptPath = path.join(sourceRoot, 'local-runtime', 'scripts', relativePath);
    await mkdir(path.dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, `# ${relativePath}\n`, 'utf8');
  }
  await mkdir(path.join(sourceRoot, 'contracts'), { recursive: true });
  await writeFile(path.join(sourceRoot, 'contracts', 'wts-foundation.mjs'), 'export const protocol = 7;\n', 'utf8');
  await writeJson(path.join(sourceRoot, 'contracts', 'wts-foundation.protocol.schema.json'), { protocol: 7 });
  await mkdir(path.dirname(pythonExecutable), { recursive: true });
  await copyFile(process.execPath, pythonExecutable);
  await mkdir(path.join(backendRoot, 'athena_api'), { recursive: true });
  await writeFile(path.join(backendRoot, 'athena_api', 'launcher.py'), '# launcher\n', 'utf8');
  await writeFile(path.join(backendRoot, 'athena_api', 'readonly_app.py'), '# readonly\n', 'utf8');

  const destinationParent = path.dirname(destination);
  await mkdir(destinationParent, { recursive: true });
  setPrivateDirectoryAcl(destinationParent);
  await mkdir(destination);
  setPrivateDirectoryAcl(destination);
  await mkdir(path.join(destination, 'runtime', 'src'), { recursive: true });
  await mkdir(path.join(destination, 'contracts'), { recursive: true });
  await mkdir(dataDirectory, { recursive: true });
  await writeJson(path.join(destination, '.athena-wts-native-host.json'), {
    installedBy: 'athena-wts-local-runtime',
    hostName: HOST_NAME,
    manifestPath,
    dataDirectory,
  });
  await writeJson(manifestPath, {
    name: HOST_NAME,
    description: 'ATHENA WTS local bounded screen-control runtime',
    path: path.join(destination, 'athena-wts-native-host.cmd'),
    type: 'stdio',
    allowed_origins: [allowedOrigin],
  });
  await writeJson(path.join(destination, 'host-config.json'), {
    hostName: HOST_NAME,
    allowedOrigin,
    dataDir: dataDirectory,
  });
  const launcher = [
    '@echo off',
    `set "ATHENA_WTS_HOST_CONFIG=${path.join(destination, 'host-config.json')}"`,
    `"${process.execPath}" "${path.join(destination, 'runtime', 'src', 'main.mjs')}" %*`,
    '',
  ].join('\r\n');
  await writeFile(path.join(destination, 'athena-wts-native-host.cmd'), launcher, 'utf8');
  await writeJson(path.join(destination, 'runtime', 'package.json'), {
    name: '@athena/wts-local-runtime',
    version: '0.3.0',
    private: true,
    type: 'module',
  });
  await writeFile(path.join(destination, 'runtime', 'src', 'main.mjs'), 'export const version = "old";\n', 'utf8');
  await writeFile(path.join(destination, 'contracts', 'wts-foundation.mjs'), 'export const protocol = 6;\n', 'utf8');
  await writeJson(path.join(destination, 'contracts', 'wts-foundation.protocol.schema.json'), { protocol: 6 });
  await writeFile(path.join(dataDirectory, 'inventory.json'), '{"stable":"data"}\n', 'utf8');

  const registry = runPowerShell(registryScript(registrySubKey, 'set', manifestPath));
  assert.equal(registry.status, 0, registry.stderr);
  const args = [
    '-ExtensionId', EXTENSION_ID,
    '-Destination', destination,
    '-DataDirectory', dataDirectory,
    '-SourceRoot', sourceRoot,
    '-BackendRoot', backendRoot,
    '-PythonExecutable', pythonExecutable,
    '-RegistrySubKey', registrySubKey,
    '-TestMode',
    '-FixtureRoot', fixtureRoot,
  ];
  return {
    fixtureRoot,
    sourceRoot,
    destination,
    dataDirectory,
    backendRoot,
    pythonExecutable,
    manifestPath,
    registrySubKey,
    destinationParent,
    args,
  };
}

async function destroyFixture(fixture) {
  const registry = runPowerShell(registryScript(fixture.registrySubKey, 'delete'));
  assert.equal(registry.status, 0, registry.stderr);
  await rm(fixture.fixtureRoot, { recursive: true, force: true });
}

test('staged native-host upgrade dry-run validates without writing any file or registry value', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  try {
    const beforeTree = await treeSnapshot(fixture.fixtureRoot);
    const beforeRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(beforeRegistry.status, 0, beforeRegistry.stderr);
    const result = runUpgrade([...fixture.args, '-DryRun']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode\s+: DryRun/u);
    assert.match(result.stdout, /filesWritten\s+: False/u);
    assert.match(result.stdout, /registryUpdated\s+: False/u);
    assert.match(result.stdout, /rollbackCreated\s+: False/u);
    assert.deepEqual(await treeSnapshot(fixture.fixtureRoot), beforeTree);
    const afterRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(afterRegistry.status, 0, afterRegistry.stderr);
    assert.equal(afterRegistry.stdout.trim(), beforeRegistry.stdout.trim());
  } finally {
    await destroyFixture(fixture);
  }
});

test('staged native-host upgrade rejects an unreviewed runtime source file without writing', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  try {
    const foreignSource = path.join(fixture.sourceRoot, 'local-runtime', 'src', 'unreviewed.mjs');
    await writeFile(foreignSource, 'export const unreviewed = true;\n', 'utf8');
    const beforeTree = await treeSnapshot(fixture.fixtureRoot);
    const beforeRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(beforeRegistry.status, 0, beforeRegistry.stderr);
    const result = runUpgrade([...fixture.args, '-DryRun']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reviewed native-host source allowlist/u);
    assert.deepEqual(await treeSnapshot(fixture.fixtureRoot), beforeTree);
    const afterRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(afterRegistry.status, 0, afterRegistry.stderr);
    assert.equal(afterRegistry.stdout.trim(), beforeRegistry.stdout.trim());
  } finally {
    await destroyFixture(fixture);
  }
});

test('staged native-host upgrade resolves its default SourceRoot in Windows PowerShell 5.1', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  try {
    const fixtureScripts = path.join(fixture.sourceRoot, 'local-runtime', 'scripts');
    const fixtureUpgradeScript = path.join(fixtureScripts, 'upgrade-native-host.ps1');
    await mkdir(fixtureScripts, { recursive: true });
    await copyFile(UPGRADE_SCRIPT, fixtureUpgradeScript);
    await copyFile(PATH_VALIDATION_SCRIPT, path.join(fixtureScripts, 'path-validation.ps1'));
    const beforeTree = await treeSnapshot(fixture.fixtureRoot);
    const beforeRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(beforeRegistry.status, 0, beforeRegistry.stderr);
    const result = runUpgrade([...removeArg(fixture.args, '-SourceRoot'), '-DryRun'], fixtureUpgradeScript);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode\s+: DryRun/u);
    assert.deepEqual(await treeSnapshot(fixture.fixtureRoot), beforeTree);
    const afterRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(afterRegistry.status, 0, afterRegistry.stderr);
    assert.equal(afterRegistry.stdout.trim(), beforeRegistry.stdout.trim());
  } finally {
    await destroyFixture(fixture);
  }
});

test('staged native-host upgrade swaps a hash-verified package and preserves the prior tree for rollback', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  try {
    const dataHash = digest(await readFile(path.join(fixture.dataDirectory, 'inventory.json')));
    const result = runUpgrade([...fixture.args, '-Apply']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /mode\s+: Apply/u);
    assert.match(result.stdout, /registryUpdated\s+: False/u);
    assert.match(result.stdout, /rollbackCreated\s+: True/u);
    const rollbackNames = (await readdir(path.dirname(fixture.destination)))
      .filter((name) => /^\.WtsNativeHost-rollback-/u.test(name) && !name.endsWith('.security'));
    assert.equal(rollbackNames.length, 1);
    const rollbackPath = path.join(path.dirname(fixture.destination), rollbackNames[0]);
    const rollbackMetadataPath = `${rollbackPath}.security`;
    const installedPackage = JSON.parse(await readFile(path.join(fixture.destination, 'runtime', 'package.json'), 'utf8'));
    const oldPackage = JSON.parse(await readFile(path.join(rollbackPath, 'runtime', 'package.json'), 'utf8'));
    assert.equal(installedPackage.version, '0.8.0');
    assert.equal(oldPackage.version, '0.3.0');
    assert.equal(
      digest(await readFile(path.join(fixture.destination, 'runtime', 'src', 'chatgpt-provider', 'provider-coordinator.mjs'))),
      digest(await readFile(path.join(fixture.sourceRoot, 'local-runtime', 'src', 'chatgpt-provider', 'provider-coordinator.mjs'))),
    );
    assert.equal(
      digest(await readFile(path.join(fixture.destination, 'runtime', 'scripts', 'openai-registration-store.ps1'))),
      digest(await readFile(path.join(fixture.sourceRoot, 'local-runtime', 'scripts', 'openai-registration-store.ps1'))),
    );
    const config = JSON.parse(await readFile(path.join(fixture.destination, 'host-config.json'), 'utf8'));
    assert.equal(config.backendRoot, fixture.backendRoot);
    assert.equal(config.pythonExecutable, fixture.pythonExecutable);
    assert.equal(digest(await readFile(path.join(fixture.dataDirectory, 'inventory.json'))), dataHash);
    for (const securedPath of [fixture.destination, rollbackPath, rollbackMetadataPath]) {
      const acl = directoryAclInfo(securedPath);
      assert.equal(acl.protected, true);
      assert.deepEqual(
        acl.rules.map((rule) => rule.sid).sort(),
        [acl.owner, 'S-1-5-18'].sort(),
      );
      assert.ok(acl.rules.every((rule) => rule.type === 'Allow' && rule.rights === 'FullControl' && !rule.inherited));
    }
    const rollbackSecurity = JSON.parse(await readFile(path.join(rollbackMetadataPath, 'security.json'), 'utf8'));
    assert.equal(rollbackSecurity.destination, fixture.destination);
    assert.equal(rollbackSecurity.rollbackPath, rollbackPath);
    assert.match(rollbackSecurity.originalRootSddl, /^O:/u);
    const registrations = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(registrations.status, 0, registrations.stderr);
    for (const entry of JSON.parse(registrations.stdout.trim())) assert.equal(entry.value, fixture.manifestPath);
  } finally {
    await destroyFixture(fixture);
  }
});

test('staged native-host upgrade handles nested inherited ACLs while preserving private rollback and exact restoration', { skip: process.platform !== 'win32' }, async (t) => {
  await t.test('successful exchange', async () => {
    const fixture = await createFixture();
    try {
      configureInheritedReadableAcl(fixture.destinationParent, fixture.destination);
      assert.equal(directoryAclInfo(fixture.destination).protected, false);
      const result = runUpgrade([...fixture.args, '-Apply']);
      assert.equal(result.status, 0, result.stderr);
      const rollbackNames = (await readdir(path.dirname(fixture.destination)))
        .filter((name) => /^\.WtsNativeHost-rollback-/u.test(name) && !name.endsWith('.security'));
      assert.equal(rollbackNames.length, 1);
      const rollbackAcl = aclTreeSnapshot(path.join(path.dirname(fixture.destination), rollbackNames[0]));
      assert.ok(rollbackAcl.every((entry) => !entry.sddl.includes('S-1-1-0')));
    } finally {
      await destroyFixture(fixture);
    }
  });

  await t.test('failure after old tree preservation', async () => {
    const fixture = await createFixture();
    try {
      configureInheritedReadableAcl(fixture.destinationParent, fixture.destination);
      const beforeTree = await treeSnapshot(fixture.destination);
      const beforeAcl = aclTreeSnapshot(fixture.destination);
      const beforeData = await treeSnapshot(fixture.dataDirectory);
      const beforeRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
      assert.equal(beforeRegistry.status, 0, beforeRegistry.stderr);
      const result = runUpgrade([...fixture.args, '-Apply', '-InjectFailure', 'AfterOldMoved']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /previous installation and registry registration were restored/u);
      assert.match(result.stderr, /Injected failure after preserving the previous native-host tree/u);
      assert.deepEqual(await treeSnapshot(fixture.destination), beforeTree);
      assert.deepEqual(aclTreeSnapshot(fixture.destination), beforeAcl);
      assert.deepEqual(await treeSnapshot(fixture.dataDirectory), beforeData);
      const afterRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
      assert.equal(afterRegistry.status, 0, afterRegistry.stderr);
      assert.equal(afterRegistry.stdout.trim(), beforeRegistry.stdout.trim());
    } finally {
      await destroyFixture(fixture);
    }
  });
});

test('staged native-host upgrade restores the exact prior tree after an injected post-exchange failure', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  try {
    const beforeDestination = await treeSnapshot(fixture.destination);
    const beforeData = await treeSnapshot(fixture.dataDirectory);
    const result = runUpgrade([...fixture.args, '-Apply', '-InjectFailure', 'AfterNewMoved']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /previous installation and registry registration were restored/u);
    assert.match(result.stderr, /Failed artifact verified: true/u);
    assert.deepEqual(await treeSnapshot(fixture.destination), beforeDestination);
    assert.deepEqual(await treeSnapshot(fixture.dataDirectory), beforeData);
    const registrations = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
    assert.equal(registrations.status, 0, registrations.stderr);
    for (const entry of JSON.parse(registrations.stdout.trim())) assert.equal(entry.value, fixture.manifestPath);
    const failedNames = (await readdir(path.dirname(fixture.destination)))
      .filter((name) => /^\.WtsNativeHost-failed-/u.test(name));
    assert.equal(failedNames.length, 1);
    assert.equal(directoryAclInfo(path.join(path.dirname(fixture.destination), failedNames[0])).protected, true);
  } finally {
    await destroyFixture(fixture);
  }
});

test('staged native-host upgrade verifies the launcher is real Node.js at the staged package engine floor', { skip: process.platform !== 'win32' }, async (t) => {
  await t.test('non-Node executable', async () => {
    const fixture = await createFixture();
    try {
      const fakeExecutable = path.join(fixture.sourceRoot, 'not-node.exe');
      await writeFile(fakeExecutable, 'not a PE executable\n', 'utf8');
      await setLauncherNode(fixture, fakeExecutable);
      const before = await treeSnapshot(fixture.fixtureRoot);
      const result = runUpgrade([...fixture.args, '-DryRun']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /identifiable Node\.js executable/u);
      assert.deepEqual(await treeSnapshot(fixture.fixtureRoot), before);
    } finally {
      await destroyFixture(fixture);
    }
  });

  await t.test('Node.js below package engine floor', async () => {
    const fixture = await createFixture({ requiredNodeEngine: '>=999' });
    try {
      const before = await treeSnapshot(fixture.fixtureRoot);
      const result = runUpgrade([...fixture.args, '-DryRun']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Node\.js 999 or newer is required/u);
      assert.deepEqual(await treeSnapshot(fixture.fixtureRoot), before);
    } finally {
      await destroyFixture(fixture);
    }
  });
});

test('staged native-host upgrade rejects a permissive write ACE before any stage is created', { skip: process.platform !== 'win32' }, async (t) => {
  for (const target of ['destinationParent', 'destination']) {
    await t.test(target, async () => {
      const fixture = await createFixture();
      try {
        grantEveryoneFullControl(fixture[target]);
        const before = await treeSnapshot(fixture.fixtureRoot);
        const result = runUpgrade([...fixture.args, '-DryRun']);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /untrusted identity/u);
        assert.deepEqual(await treeSnapshot(fixture.fixtureRoot), before);
      } finally {
        await destroyFixture(fixture);
      }
    });
  }
});

test('staged native-host upgrade derives failed-artifact verification from retained payloads', { skip: process.platform !== 'win32' }, async (t) => {
  for (const injection of ['TamperStagedFile', 'TamperInstalledFile']) {
    await t.test(injection, async () => {
      const fixture = await createFixture();
      try {
        const beforeDestination = await treeSnapshot(fixture.destination);
        const beforeData = await treeSnapshot(fixture.dataDirectory);
        const beforeRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
        assert.equal(beforeRegistry.status, 0, beforeRegistry.stderr);
        const result = runUpgrade([...fixture.args, '-Apply', '-InjectFailure', injection]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /Failed artifact verified: false/u);
        assert.deepEqual(await treeSnapshot(fixture.destination), beforeDestination);
        assert.deepEqual(await treeSnapshot(fixture.dataDirectory), beforeData);
        const failedNames = (await readdir(path.dirname(fixture.destination)))
          .filter((name) => /^\.WtsNativeHost-failed-/u.test(name));
        assert.equal(failedNames.length, 1);
        const failedPath = path.join(path.dirname(fixture.destination), failedNames[0]);
        assert.equal(directoryAclInfo(failedPath).protected, true);
        assert.match(await readFile(path.join(failedPath, 'runtime', 'src', 'main.mjs'), 'utf8'), /injected (installed )?tamper/u);
        const afterRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
        assert.equal(afterRegistry.status, 0, afterRegistry.stderr);
        assert.equal(afterRegistry.stdout.trim(), beforeRegistry.stdout.trim());
      } finally {
        await destroyFixture(fixture);
      }
    });
  }
});

test('staged native-host upgrade catches stage and pre-exchange failures with exact rollback and retained artifacts', { skip: process.platform !== 'win32' }, async (t) => {
  for (const injection of ['AfterStageCreated', 'BeforeExchange', 'AfterOldMoved']) {
    await t.test(injection, async () => {
      const fixture = await createFixture();
      try {
        const beforeDestination = await treeSnapshot(fixture.destination);
        const beforeDestinationAcl = directoryAclInfo(fixture.destination);
        const beforeData = await treeSnapshot(fixture.dataDirectory);
        const beforeRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
        assert.equal(beforeRegistry.status, 0, beforeRegistry.stderr);
        const result = runUpgrade([...fixture.args, '-Apply', '-InjectFailure', injection]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /previous installation and registry registration were restored/u);
        assert.match(result.stderr, /Failed artifact:/u);
        assert.match(
          result.stderr,
          new RegExp(`Failed artifact verified: ${injection === 'AfterStageCreated' ? 'false' : 'true'}`, 'u'),
        );
        assert.deepEqual(await treeSnapshot(fixture.destination), beforeDestination);
        assert.deepEqual(directoryAclInfo(fixture.destination), beforeDestinationAcl);
        assert.deepEqual(await treeSnapshot(fixture.dataDirectory), beforeData);
        const failedNames = (await readdir(path.dirname(fixture.destination)))
          .filter((name) => /^\.WtsNativeHost-failed-/u.test(name));
        assert.equal(failedNames.length, 1);
        assert.equal(directoryAclInfo(path.join(path.dirname(fixture.destination), failedNames[0])).protected, true);
        const metadataNames = (await readdir(path.dirname(fixture.destination)))
          .filter((name) => /^\.WtsNativeHost-rollback-.*\.security$/u.test(name));
        assert.equal(metadataNames.length, injection === 'AfterOldMoved' ? 1 : 0);
        if (metadataNames.length === 1) {
          assert.equal(directoryAclInfo(path.join(path.dirname(fixture.destination), metadataNames[0])).protected, true);
        }
        const afterRegistry = runPowerShell(registryScript(fixture.registrySubKey, 'get'));
        assert.equal(afterRegistry.status, 0, afterRegistry.stderr);
        assert.equal(afterRegistry.stdout.trim(), beforeRegistry.stdout.trim());
      } finally {
        await destroyFixture(fixture);
      }
    });
  }
});

test('staged native-host upgrade rejects either Destination/DataDirectory ancestor relationship without data changes', { skip: process.platform !== 'win32' }, async (t) => {
  await t.test('Destination contains DataDirectory', async () => {
    const fixture = await createFixture();
    try {
      const args = replaceArg(fixture.args, '-Destination', fixture.destinationParent);
      const beforeData = await treeSnapshot(fixture.dataDirectory);
      const result = runUpgrade([...args, '-DryRun']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must not contain one another/u);
      assert.deepEqual(await treeSnapshot(fixture.dataDirectory), beforeData);
    } finally {
      await destroyFixture(fixture);
    }
  });

  await t.test('DataDirectory contains Destination', async () => {
    const fixture = await createFixture();
    try {
      const args = replaceArg(fixture.args, '-DataDirectory', fixture.destinationParent);
      const beforeDestination = await treeSnapshot(fixture.destination);
      const result = runUpgrade([...args, '-DryRun']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /must not contain one another/u);
      assert.deepEqual(await treeSnapshot(fixture.destination), beforeDestination);
    } finally {
      await destroyFixture(fixture);
    }
  });
});

test('staged native-host upgrade refuses an active owned host process without killing it', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  try {
    assert.ok(child.pid);
    const result = runUpgrade([...fixture.args, '-DryRun', '-OwnedProcessId', String(child.pid)]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /native host or one of its child processes is still running/u);
    assert.equal(child.killed, false);
    process.kill(child.pid, 0);
  } finally {
    child.kill();
    await destroyFixture(fixture);
  }
});

test('staged native-host upgrade rejects foreign files and reparse points before exchange', { skip: process.platform !== 'win32' }, async (t) => {
  await t.test('foreign installed file', async () => {
    const fixture = await createFixture();
    try {
      await writeFile(path.join(fixture.destination, 'foreign.txt'), 'preserve\n', 'utf8');
      const result = runUpgrade([...fixture.args, '-DryRun']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Unexpected item in the owned ATHENA native-host installation/u);
      assert.equal(await readFile(path.join(fixture.destination, 'foreign.txt'), 'utf8'), 'preserve\n');
    } finally {
      await destroyFixture(fixture);
    }
  });

  await t.test('installed junction', async () => {
    const fixture = await createFixture();
    try {
      const external = path.join(fixture.fixtureRoot, 'external');
      const junction = path.join(fixture.destination, 'runtime', 'src', 'linked');
      await mkdir(external, { recursive: true });
      await writeFile(path.join(external, 'sentinel.txt'), 'external\n', 'utf8');
      await symlink(external, junction, 'junction');
      const result = runUpgrade([...fixture.args, '-DryRun']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /reparse point|path redirection or a junction/u);
      assert.equal(await readFile(path.join(external, 'sentinel.txt'), 'utf8'), 'external\n');
    } finally {
      await destroyFixture(fixture);
    }
  });
});

test('test hooks cannot target the real user installation or production registry namespace', { skip: process.platform !== 'win32' }, async () => {
  const fixture = await createFixture();
  try {
    const actualDestination = path.join(os.homedir(), '.athena', 'WtsNativeHost');
    const args = fixture.args.slice();
    args.splice(args.indexOf('-Destination'), 2);
    args.splice(args.indexOf('-RegistrySubKey'), 2);
    const result = runUpgrade([
      ...args,
      '-Destination', actualDestination,
      '-RegistrySubKey', `Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
      '-DryRun',
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /TestMode is restricted to an isolated fixture workspace/u);
  } finally {
    await destroyFixture(fixture);
  }
});

test('upgrade script contains no registry write or generic process termination path', async () => {
  const source = await readFile(UPGRADE_SCRIPT, 'utf8');
  assert.doesNotMatch(source, /SetValue\s*\(/u);
  assert.doesNotMatch(source, /Set-ItemProperty|Set-AthenaRegistryDefaultValue/u);
  assert.doesNotMatch(source, /Stop-Process|taskkill|\.Kill\s*\(/iu);
  assert.match(source, /Assert-SourceSnapshotUnchanged/u);
  assert.match(source, /Assert-RegistryUnchanged/u);
  assert.match(source, /\[IO\.Directory\]::Move\(\$Destination, \$rollbackPath\)/u);
});

#Requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Destination,
  [Parameter(Mandatory)] [string]$DownloadDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Update-BundledNpmIpAddress {
  param([string]$RuntimeRoot, [string]$CacheDirectory, [object]$Package)

  $root = [System.IO.Path]::GetFullPath($RuntimeRoot)
  $npmRoot = Join-Path $root 'node/node_modules/npm'
  $target = [System.IO.Path]::GetFullPath((Join-Path $npmRoot 'node_modules/ip-address'))
  if (-not $target.StartsWith($root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar,
      [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Bundled npm patch target is outside the runtime destination'
  }
  $installed = Get-Content -LiteralPath (Join-Path $target 'package.json') -Raw | ConvertFrom-Json
  if ($installed.name -ne 'ip-address' -or $installed.version -ne $Package.fromVersion) {
    throw 'Bundled npm ip-address changed; review its pinned replacement before building'
  }
  $archive = Join-Path $CacheDirectory "ip-address-$($Package.version).tgz"
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    Invoke-WebRequest -Uri $Package.url -OutFile $archive
  }
  if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Package.sha256) {
    throw 'SHA256 mismatch for bundled npm ip-address'
  }
  $expanded = Join-Path $CacheDirectory "ip-address-$($Package.version)-expanded"
  if (Test-Path -LiteralPath $expanded) { throw "Package extraction destination already exists: $expanded" }
  [void](New-Item -ItemType Directory -Path $expanded)
  $node = Join-Path $root 'node/node.exe'
  $extract = @'
const path = require('node:path');
const fs = require('node:fs');
const [npmRoot, archive, expanded, version] = process.argv.slice(1);
(async () => {
  await require(path.join(npmRoot, 'node_modules/tar')).x({ file: archive, cwd: expanded, strict: true });
  const pkg = require(path.join(expanded, 'package/package.json'));
  const socks = require(path.join(npmRoot, 'node_modules/socks/package.json'));
  const semver = require(path.join(npmRoot, 'node_modules/semver'));
  if (pkg.name !== 'ip-address' || pkg.version !== version || pkg.license !== 'MIT'
      || Object.keys(pkg.dependencies || {}).length
      || !semver.satisfies(process.versions.node, pkg.engines.node)
      || !semver.satisfies(version, socks.dependencies['ip-address'])
      || !fs.existsSync(path.join(expanded, 'package/LICENSE'))) {
    throw new Error('Bundled npm ip-address replacement is incompatible');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
'@
  & $node -e $extract $npmRoot $archive $expanded $Package.version
  if ($LASTEXITCODE -ne 0) { throw 'Bundled npm ip-address extraction or compatibility check failed' }
  # Only this newly staged package is replaced; the source Node archive and npm stay pinned.
  Remove-Item -LiteralPath $target -Recurse -Force
  Move-Item -LiteralPath (Join-Path $expanded 'package') -Destination $target
}

# Keep downloads pinned and verify before extracting or executing any binaries.
$manifestPath = Join-Path $PSScriptRoot 'windows-mcp-runtimes.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (Test-Path -LiteralPath $Destination) {
  throw "MCP runtime destination already exists: $Destination"
}
[void](New-Item -ItemType Directory -Path $Destination, $DownloadDirectory -Force)
foreach ($name in @('node', 'uv')) {
  $runtime = $manifest.$name
  $archive = Join-Path $DownloadDirectory "$name-$($runtime.version)-windows-x64.zip"
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
    Invoke-WebRequest -Uri $runtime.url -OutFile $archive
  }
  $actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualHash -ne $runtime.sha256) {
    throw "SHA256 mismatch for $name runtime: $archive"
  }
  $expanded = Join-Path $DownloadDirectory "$name-$($runtime.version)-expanded"
  if (Test-Path -LiteralPath $expanded) {
    throw "Runtime extraction destination already exists: $expanded"
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $expanded
  $source = Join-Path $expanded $runtime.archiveRoot
  $target = Join-Path $Destination $name
  [void](New-Item -ItemType Directory -Path $target)
  Get-ChildItem -LiteralPath $source -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse
  }
}

# Node's vendored npm has an affected ip-address copy separate from app/package-lock.json.
Update-BundledNpmIpAddress -RuntimeRoot $Destination -CacheDirectory $DownloadDirectory `
  -Package $manifest.node.npmIpAddress

# The uv binary archive omits its upstream license texts.
foreach ($license in $manifest.uv.licenses) {
  $licensePath = Join-Path $DownloadDirectory $license.name
  Invoke-WebRequest -Uri $license.url -OutFile $licensePath
  $licenseHash = (Get-FileHash -LiteralPath $licensePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($licenseHash -ne $license.sha256) {
    throw "SHA256 mismatch for uv license: $($license.name)"
  }
  Copy-Item -LiteralPath $licensePath -Destination (Join-Path $Destination "uv/$($license.name)")
}

foreach ($required in @('node/node.exe', 'node/npm.cmd', 'node/npx.cmd',
    'node/LICENSE', 'uv/LICENSE-MIT', 'uv/LICENSE-APACHE',
    'node/node_modules/npm/bin/npm-cli.js', 'node/node_modules/npm/bin/npx-cli.js',
    'uv/uv.exe', 'uv/uvx.exe')) {
  if (-not (Test-Path -LiteralPath (Join-Path $Destination $required) -PathType Leaf)) {
    throw "Bundled MCP runtime is missing $required"
  }
}

# Reproduce a GUI launch on a PC without globally installed Node/npm/uv.
$originalPath = $env:PATH
try {
  $env:PATH = Join-Path $env:SystemRoot 'System32'
  $node = Join-Path $Destination 'node/node.exe'
  $nodeVersion = & $node --version
  if ($LASTEXITCODE -ne 0 -or $nodeVersion -ne "v$($manifest.node.version)") {
    throw "Bundled Node version check failed: $nodeVersion"
  }
  foreach ($cli in @('npm', 'npx')) {
    & $node (Join-Path $Destination "node/node_modules/npm/bin/$cli-cli.js") --version
    if ($LASTEXITCODE -ne 0) { throw "Bundled $cli smoke test failed" }
  }
  $ipAddressSmoke = @'
const path = require('node:path');
const assert = require('node:assert/strict');
const [root, version] = process.argv.slice(1);
const modules = path.join(root, 'node/node_modules/npm/node_modules');
const { Address4, Address6 } = require(path.join(modules, 'ip-address'));
assert.equal(require(path.join(modules, 'ip-address/package.json')).version, version);
assert.equal(new Address6('a00::1').isInSubnet(new Address4('10.0.0.0/8')), false);
assert.equal(new Address4('32.0.0.1').isInSubnet(new Address6('2000::/3')), false);
assert.throws(() => new Address6('!'.repeat(16384)), error => !error.parseMessage || error.parseMessage.length < 1024);
const { ipToBuffer } = require(path.join(modules, 'socks/build/common/helpers.js'));
assert.equal(ipToBuffer('2001:db8::1').length, 16);
assert.equal(ipToBuffer('127.0.0.1').length, 4);
assert.equal(Address6.fromByteArray(Array(16).fill(0)).canonicalForm(), '0000:0000:0000:0000:0000:0000:0000:0000');
'@
  & $node -e $ipAddressSmoke $Destination $manifest.node.npmIpAddress.version
  if ($LASTEXITCODE -ne 0) { throw 'Bundled npm ip-address regression check failed' }
  foreach ($cli in @('uv', 'uvx')) {
    $cliVersion = & (Join-Path $Destination "uv/$cli.exe") --version
    if ($LASTEXITCODE -ne 0 -or $cliVersion -notmatch "^$cli $([regex]::Escape($manifest.uv.version))(?:\s|$)") {
      throw "Bundled $cli version check failed: $cliVersion"
    }
  }
} finally {
  $env:PATH = $originalPath
}
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $Destination 'versions.json')
Write-Host "Bundled MCP runtime smoke checks passed: $Destination"

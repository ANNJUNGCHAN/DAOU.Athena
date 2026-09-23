#Requires -Version 7.0

[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string]$Destination,
  [Parameter(Mandatory)] [string]$DownloadDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

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

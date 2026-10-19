$ErrorActionPreference = 'Stop'
$nodePath = $env:ATHENA_NODE
if (-not $nodePath) { $command = Get-Command node -ErrorAction SilentlyContinue; if ($command) { $nodePath = $command.Source } }
if (-not $nodePath) { $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js is required. Set ATHENA_NODE to node.exe.' }
Write-Host 'Rendering replaces athena-v23-60s.mp4. Historical receipts remain in source/video/history.'
& $nodePath (Join-Path $PSScriptRoot 'source\video\finish-render.cjs')
exit $LASTEXITCODE

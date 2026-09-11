# Dest-only: point this clone at committed .githooks (gitleaks pre-commit / pre-push).
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $root
git config core.hooksPath .githooks
Write-Host "core.hooksPath=.githooks ($root)"

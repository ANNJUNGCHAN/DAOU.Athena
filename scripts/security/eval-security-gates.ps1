# Pass/fail security eval for this dest repo. Does not push.
$ErrorActionPreference = 'Continue'
if ($PSScriptRoot) {
  Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}
$root = git rev-parse --show-toplevel
$failed = 0
function Gate([string]$name, [bool]$ok, [string]$detail) {
  $mark = if ($ok) { 'PASS' } else { 'FAIL' }
  if (-not $ok) { $script:failed++ }
  Write-Host "$mark  $name  $detail"
}

$hooks = git config --get core.hooksPath
Gate 'hooksPath' ($hooks -eq '.githooks') "core.hooksPath=$hooks"
Gate 'pre-commit' (Test-Path (Join-Path $root '.githooks\pre-commit')) 'file'
Gate 'pre-push' (Test-Path (Join-Path $root '.githooks\pre-push')) 'file'
Gate 'gitleaks.toml' (Test-Path (Join-Path $root 'scripts\security\gitleaks.toml')) 'file'

$cfg = Join-Path $root 'scripts\security\gitleaks.toml'
gitleaks git $root --no-banner --redact=100 -c $cfg | Out-Host
Gate 'gitleaks' ($LASTEXITCODE -eq 0) "rc=$LASTEXITCODE"

$envFiles = git -C $root ls-files | Select-String -Pattern '(^|/)\.env($|\.(?!example$))'
Gate 'no-live-env' (-not $envFiles) "tracked=$envFiles"

$origin = git -C $root remote get-url origin
$priv = $null
if ($origin -match 'github.com') {
  $priv = gh repo view --json isPrivate --jq .isPrivate 2>$null
  Gate 'github-private' ($priv -eq 'true') "isPrivate=$priv origin=$origin"
}

if ($failed -gt 0) { exit 1 }
Write-Host 'ALL_GATES_PASS'
exit 0

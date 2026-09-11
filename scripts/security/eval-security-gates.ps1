# Pass/fail security eval for a dest repo that is meant to stay public.
# Does not push.
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
Gate 'ci-workflow' (Test-Path (Join-Path $root '.github\workflows\secret-scan.yml')) 'file'

$cfg = Join-Path $root 'scripts\security\gitleaks.toml'
gitleaks git $root --no-banner --redact=100 -c $cfg | Out-Host
Gate 'gitleaks' ($LASTEXITCODE -eq 0) "rc=$LASTEXITCODE"

$envFiles = git -C $root ls-files | Select-String -Pattern '(^|/)\.env($|\.(?!example$))'
Gate 'no-live-env' (-not $envFiles) "tracked=$envFiles"

$origin = git -C $root remote get-url origin
if ($origin -match 'github.com') {
  $meta = gh api repos/:owner/:repo --jq '{private:.private,scan:.security_and_analysis.secret_scanning.status,push:.security_and_analysis.secret_scanning_push_protection.status}' 2>$null | ConvertFrom-Json
  Gate 'github-public' ($meta.private -eq $false) "private=$($meta.private) origin=$origin"
  Gate 'github-secret-scanning' ($meta.scan -eq 'enabled') "secret_scanning=$($meta.scan)"
  Gate 'github-push-protection' ($meta.push -eq 'enabled') "push_protection=$($meta.push)"
}

if ($failed -gt 0) { exit 1 }
Write-Host 'ALL_GATES_PASS'
exit 0

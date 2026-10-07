param([string]$RemoteUrl = '')

# Read-only checks. This script must not consume pre-push's standard input.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Gate([string]$Name, [bool]$Passed) {
    if (-not $Passed) { throw "Gate failed: $Name" }
    Write-Host "PASS  $Name"
}

function Assert-Exit([string]$Name) {
    Assert-Gate $Name ($LASTEXITCODE -eq 0)
}

try {
    Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    foreach ($name in @('git', 'gitleaks', 'gh')) {
        Assert-Gate "$name-installed" ($null -ne (Get-Command $name -ErrorAction SilentlyContinue))
    }

    $root = & git rev-parse --show-toplevel
    Assert-Exit 'git-repository'
    $hooksPath = & git config --get core.hooksPath
    Assert-Exit 'hooks-configured'
    Assert-Gate 'hooksPath' ($hooksPath -eq '.githooks')
    foreach ($path in @('.githooks/pre-commit', '.githooks/pre-push', 'scripts/security/gitleaks.toml')) {
        Assert-Gate $path (Test-Path -LiteralPath (Join-Path $root $path) -PathType Leaf)
    }

    $tracked = @(& git -c core.quotePath=false ls-files)
    Assert-Exit 'tracked-files-readable'
    $forbidden = @($tracked | Where-Object {
        $_ -match '(?i)(^|/)\.env($|\.)' -and $_ -notmatch '(?i)(^|/)\.env(?:\.[^/]*)?\.example$' -or
        $_ -match '(?i)(^|/)(\.aws|\.ssh|\.codex|\.agents|\.omc|\.omx|profiles|browser-profile|browser-data|user-data|User Data|node_modules)(/|$)' -or
        $_ -match '(?i)(^|/)(credentials|auth|storage-state|storageState|cookies)\.json$' -or
        $_ -match '(?i)\.(pem|key|p12|pfx|db|sqlite|sqlite3)(-[^/]*)?$'
    })
    Assert-Gate 'no-tracked-credentials-profiles-or-databases' ($forbidden.Count -eq 0)

    $config = Join-Path $root 'scripts/security/gitleaks.toml'
    & gitleaks git $root --no-banner --redact=100 --ignore-gitleaks-allow --max-archive-depth 2 --max-decode-depth 3 --config $config
    Assert-Exit 'gitleaks-history'
    # Scan materialized files as well as Git history: LFS pointers contain no PPTX/media contents.
    & gitleaks dir $root --no-banner --redact=100 --ignore-gitleaks-allow --max-archive-depth 2 --max-decode-depth 3 --config $config
    Assert-Exit 'gitleaks-working-files-and-archives'
    & git lfs fsck
    Assert-Exit 'git-lfs-integrity'

    if (-not $RemoteUrl) {
        $RemoteUrl = & git remote get-url origin
        Assert-Exit 'origin-readable'
    }
    $target = 'ANNJUNGCHAN/DAOU.Athena-Presentation'
    $targetPattern = [regex]::Escape($target)
    Assert-Gate 'github-target' ($RemoteUrl -match "^(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)$targetPattern(?:\.git)?$")
    $metadataJson = & gh api "repos/$target"
    Assert-Exit 'github-metadata-readable'
    $metadata = ($metadataJson -join "`n") | ConvertFrom-Json
    Assert-Gate 'github-public' ($metadata.private -eq $false -and $metadata.visibility -eq 'public')
    Assert-Gate 'github-secret-scanning' ($metadata.security_and_analysis.secret_scanning.status -eq 'enabled')
    Assert-Gate 'github-push-protection' ($metadata.security_and_analysis.secret_scanning_push_protection.status -eq 'enabled')

    Write-Host 'ALL_GATES_PASS'
    exit 0
} catch {
    Write-Host "FAIL  $($_.Exception.Message)"
    exit 1
}

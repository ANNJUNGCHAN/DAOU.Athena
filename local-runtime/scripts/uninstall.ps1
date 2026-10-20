[CmdletBinding()]
param(
    [string]$Destination = (Join-Path $env:USERPROFILE '.athena\WtsNativeHost'),
    [Parameter(DontShow = $true)]
    [string]$RegistryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.athena.wts',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'path-validation.ps1')

$HostName = 'com.athena.wts'
$DefaultRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
if (
    $RegistryPath -cne $DefaultRegistryPath -and
    (
        -not $DryRun -or
        $RegistryPath -cnotmatch '^HKCU:\\Software\\AthenaWtsNativeHostTests-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    )
) {
    throw 'RegistryPath override is restricted to the dry-run test namespace.'
}
$Destination = [IO.Path]::GetFullPath($Destination)
$ManifestPath = Join-Path $Destination "$HostName.json"
$MarkerPath = Join-Path $Destination '.athena-wts-native-host.json'
$RuntimeDirectory = Join-Path $Destination 'runtime'
$ContractsDirectory = Join-Path $Destination 'contracts'
$OwnedRuntimeFiles = @(
    'src\backend-supervisor.mjs',
    'src\chatgpt-provider\browser-opener.mjs',
    'src\chatgpt-provider\control-candidate.mjs',
    'src\chatgpt-provider\models-client.mjs',
    'src\chatgpt-provider\oauth-session.mjs',
    'src\chatgpt-provider\openid-verifier.mjs',
    'src\chatgpt-provider\planning-client.mjs',
    'src\chatgpt-provider\provider-coordinator.mjs',
    'src\chatgpt-provider\registration-store.mjs',
    'src\chatgpt-provider\responses-client.mjs',
    'src\chatgpt-provider\token-session.mjs',
    'src\config.mjs',
    'src\control-planner.mjs',
    'src\conversation-router.mjs',
    'src\errors.mjs',
    'src\financial-backend-supervisor.mjs',
    'src\financial-source-bridge.mjs',
    'src\framing.mjs',
    'src\host.mjs',
    'src\inventory-store.mjs',
    'src\main.mjs',
    'src\receipt-store.mjs',
    'src\source-bridge.mjs',
    'src\task-compiler.mjs',
    'src\task-engine.mjs',
    'src\task-store.mjs',
    'scripts\open-openai-authorization.ps1',
    'scripts\openai-registration-store.ps1',
    'package.json'
)
$OwnedFiles = @($OwnedRuntimeFiles | ForEach-Object { Join-Path $RuntimeDirectory $_ }) + @(
    (Join-Path $ContractsDirectory 'wts-foundation.mjs'),
    (Join-Path $ContractsDirectory 'wts-foundation.protocol.schema.json'),
    (Join-Path $Destination 'host-config.json'),
    (Join-Path $Destination 'athena-wts-native-host.cmd'),
    $ManifestPath,
    $MarkerPath
)
$OwnedDirectories = @(
    @($OwnedFiles | ForEach-Object { Split-Path $_ -Parent }) +
    @($RuntimeDirectory, $ContractsDirectory) |
        Sort-Object -Unique |
        Sort-Object { $_.Length } -Descending
)

if (-not (Test-Path -LiteralPath $MarkerPath -PathType Leaf)) {
    throw 'Ownership marker is missing; no files or registration were removed.'
}

$expectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$expectedDirectories = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($ownedPath in $OwnedFiles) {
    [void]$expectedFiles.Add([IO.Path]::GetFullPath($ownedPath))
}
foreach ($ownedPath in $OwnedDirectories) {
    [void]$expectedDirectories.Add([IO.Path]::GetFullPath($ownedPath))
}

$directoriesToInspect = New-Object 'System.Collections.Generic.Queue[string]'
$directoriesToInspect.Enqueue($Destination)
while ($directoriesToInspect.Count -gt 0) {
    $directory = $directoriesToInspect.Dequeue()
    Assert-AthenaPhysicalPath -Path $directory -Purpose 'owned installation directory' | Out-Null
    foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
        $itemPath = [IO.Path]::GetFullPath($item.FullName)
        $expectedAsFile = $expectedFiles.Contains($itemPath)
        $expectedAsDirectory = $expectedDirectories.Contains($itemPath)
        if (-not $expectedAsFile -and -not $expectedAsDirectory) {
            throw "Unexpected item in the ATHENA installation; no files or registration were removed: $itemPath"
        }
        if ($expectedAsFile -eq $item.PSIsContainer) {
            throw "ATHENA installation item type does not match the owned allowlist; no files or registration were removed: $itemPath"
        }
        Assert-AthenaPhysicalPath -Path $itemPath -Purpose 'owned installation item' | Out-Null
        $linkTypeProperty = $item.PSObject.Properties['LinkType']
        if (
            ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            ($null -ne $linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value))
        ) {
            throw "ATHENA installation contains an unexpected linked path; no files or registration were removed: $itemPath"
        }
        if ($item.PSIsContainer) {
            $directoriesToInspect.Enqueue($itemPath)
        }
    }
}

$marker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
if (
    $marker.installedBy -cne 'athena-wts-local-runtime' -or
    $marker.hostName -cne $HostName -or
    -not [string]::Equals($marker.manifestPath, $ManifestPath, [StringComparison]::OrdinalIgnoreCase)
) {
    throw 'Ownership marker does not match this installation; nothing was removed.'
}

$registrationOwned = $false
if (Test-Path -LiteralPath $RegistryPath) {
    $registeredManifest = (Get-Item -LiteralPath $RegistryPath).GetValue('')
    $registrationOwned = [string]::Equals(
        $registeredManifest,
        $ManifestPath,
        [StringComparison]::OrdinalIgnoreCase
    )
    if (-not $registrationOwned) {
        throw 'Native host registration points elsewhere; nothing was removed.'
    }
}

if (-not $DryRun) {
    if ($registrationOwned) {
        Remove-Item -LiteralPath $RegistryPath -Force
    }
    foreach ($ownedPath in $OwnedFiles) {
        if (Test-Path -LiteralPath $ownedPath -PathType Leaf) {
            Remove-Item -LiteralPath $ownedPath -Force
        }
    }
    foreach ($ownedPath in $OwnedDirectories) {
        if (
            (Test-Path -LiteralPath $ownedPath -PathType Container) -and
            -not (Get-ChildItem -LiteralPath $ownedPath -Force)
        ) {
            Remove-Item -LiteralPath $ownedPath -Force
        }
    }
    if ((Test-Path -LiteralPath $Destination) -and -not (Get-ChildItem -LiteralPath $Destination -Force)) {
        Remove-Item -LiteralPath $Destination -Force
    }
}

[pscustomobject]@{
    hostName = $HostName
    destination = $Destination
    registrationOwned = $registrationOwned
    registryRemoved = $registrationOwned -and -not $DryRun
    userDataPreserved = $true
}

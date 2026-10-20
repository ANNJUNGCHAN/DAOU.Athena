[CmdletBinding()]
param(
    [string]$Source = (Join-Path $env:LOCALAPPDATA 'Athena\WtsNativeHost'),
    [string]$SourceDataDirectory = (Join-Path $env:LOCALAPPDATA 'Athena\WtsData'),
    [string]$Destination = (Join-Path $env:USERPROFILE '.athena\WtsNativeHost'),
    [string]$DataDirectory = (Join-Path $env:USERPROFILE '.athena\WtsData'),
    [switch]$Apply,
    [Parameter(DontShow = $true)]
    [string]$RegistrySubKey = 'Software\Google\Chrome\NativeMessagingHosts\com.athena.wts'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'path-validation.ps1')

$HostName = 'com.athena.wts'
$ExpectedRegistrySubKey = "Software\Google\Chrome\NativeMessagingHosts\$HostName"
$TestRegistryPattern = '^Software\\AthenaWtsNativeHostRepairTests-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\com\.athena\.wts$'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Resolve-NormalizedPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'ATHENA native-host repair paths must not be empty.'
    }
    $fullPath = [IO.Path]::GetFullPath($Value)
    $rootPath = [IO.Path]::GetPathRoot($fullPath)
    if ([string]::Equals($fullPath, $rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath
    }
    return $fullPath.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
}

function Test-PathEqual([string]$Left, [string]$Right) {
    return [string]::Equals(
        (Resolve-NormalizedPath $Left),
        (Resolve-NormalizedPath $Right),
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Get-RegistrySnapshot([Microsoft.Win32.RegistryView]$View) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        $View
    )
    try {
        $key = $baseKey.OpenSubKey($RegistrySubKey, $false)
        if ($null -eq $key) {
            throw "The $View HKCU native-host registration is missing. No files or registry values were changed."
        }
        try {
            $kind = $key.GetValueKind('')
            if ($kind -notin @(
                [Microsoft.Win32.RegistryValueKind]::String,
                [Microsoft.Win32.RegistryValueKind]::ExpandString
            )) {
                throw "The $View HKCU native-host registration has unsupported value type '$kind'."
            }
            $rawValue = $key.GetValue(
                '',
                $null,
                [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
            )
            if ($rawValue -isnot [string]) {
                throw "The $View HKCU native-host registration has no string default value."
            }
            $resolvedValue = if ($kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
                [Environment]::ExpandEnvironmentVariables($rawValue)
            } else {
                $rawValue
            }
            return [pscustomobject]@{
                view = $View.ToString()
                kind = $kind.ToString()
                value = $rawValue
                resolvedValue = $resolvedValue
            }
        } finally {
            $key.Dispose()
        }
    } finally {
        $baseKey.Dispose()
    }
}

function Set-RegistrySnapshotValue(
    [Microsoft.Win32.RegistryView]$View,
    [string]$Value,
    [Microsoft.Win32.RegistryValueKind]$Kind
) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        $View
    )
    try {
        $key = $baseKey.OpenSubKey($RegistrySubKey, $true)
        if ($null -eq $key) {
            throw "The $View HKCU native-host registration disappeared during repair."
        }
        try {
            $key.SetValue('', $Value, $Kind)
            $writtenKind = $key.GetValueKind('')
            $writtenValue = $key.GetValue(
                '',
                $null,
                [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
            )
            if (
                $writtenKind -ne $Kind -or
                -not [string]::Equals([string]$writtenValue, $Value, [StringComparison]::Ordinal)
            ) {
                throw "The $View HKCU native-host registration could not be verified."
            }
        } finally {
            $key.Dispose()
        }
    } finally {
        $baseKey.Dispose()
    }
}

function ConvertTo-RegistryKind([string]$Kind) {
    return [Microsoft.Win32.RegistryValueKind]::$Kind
}

function Escape-BatchValue([string]$Value) {
    return $Value.Replace('%', '%%')
}

function Get-FileSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '')
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is required.'
}
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    throw 'USERPROFILE is required.'
}
if (
    $RegistrySubKey -cne $ExpectedRegistrySubKey -and
    $RegistrySubKey -cnotmatch $TestRegistryPattern
) {
    throw 'RegistrySubKey override is restricted to the ATHENA repair test namespace.'
}

$Source = Resolve-NormalizedPath $Source
$SourceDataDirectory = Resolve-NormalizedPath $SourceDataDirectory
$Destination = Resolve-NormalizedPath $Destination
$DataDirectory = Resolve-NormalizedPath $DataDirectory
if (Test-PathEqual $Source $Destination) {
    throw 'Source and Destination must be different paths.'
}
if (Test-PathEqual $Destination $DataDirectory) {
    throw 'DataDirectory must be outside Destination.'
}
$destinationPrefix = $Destination + [IO.Path]::DirectorySeparatorChar
if ($DataDirectory.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'DataDirectory must be outside Destination.'
}

$SourceManifestPath = Join-Path $Source "$HostName.json"
$SourceConfigPath = Join-Path $Source 'host-config.json'
$SourceLauncherPath = Join-Path $Source 'athena-wts-native-host.cmd'
$SourceMarkerPath = Join-Path $Source '.athena-wts-native-host.json'
$SourceEntryPoint = Join-Path $Source 'runtime\src\main.mjs'
$SourcePackagePath = Join-Path $Source 'runtime\package.json'
$RequiredSourceFiles = @(
    '.athena-wts-native-host.json',
    'athena-wts-native-host.cmd',
    'com.athena.wts.json',
    'host-config.json',
    'contracts\wts-foundation.mjs',
    'contracts\wts-foundation.protocol.schema.json',
    'runtime\package.json',
    'runtime\src\config.mjs',
    'runtime\src\errors.mjs',
    'runtime\src\framing.mjs',
    'runtime\src\host.mjs',
    'runtime\src\inventory-store.mjs',
    'runtime\src\main.mjs'
)
$MutableRelativePaths = @(
    '.athena-wts-native-host.json',
    'athena-wts-native-host.cmd',
    'com.athena.wts.json',
    'host-config.json'
)
$ImmutableRelativePaths = @($RequiredSourceFiles | Where-Object { $_ -notin $MutableRelativePaths })

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    throw "The installed ATHENA v1 source directory is missing: $Source"
}
$actualSourceFiles = @(
    Get-ChildItem -LiteralPath $Source -Recurse -Force -File |
        ForEach-Object { $_.FullName.Substring($Source.Length + 1) } |
        Sort-Object
)
$expectedSourceFiles = @($RequiredSourceFiles | Sort-Object)
if (
    $actualSourceFiles.Count -ne $expectedSourceFiles.Count -or
    (Compare-Object -ReferenceObject $expectedSourceFiles -DifferenceObject $actualSourceFiles)
) {
    throw 'The installed ATHENA host is not the expected v1 file set; refusing to mix source and installed versions.'
}

$marker = Get-Content -LiteralPath $SourceMarkerPath -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $SourceManifestPath -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath $SourceConfigPath -Raw | ConvertFrom-Json
$package = Get-Content -LiteralPath $SourcePackagePath -Raw | ConvertFrom-Json
if (
    $marker.installedBy -cne 'athena-wts-local-runtime' -or
    $marker.hostName -cne $HostName -or
    -not (Test-PathEqual ([string]$marker.manifestPath) $SourceManifestPath) -or
    -not (Test-PathEqual ([string]$marker.dataDirectory) $SourceDataDirectory)
) {
    throw 'The installed ATHENA ownership marker does not match the requested v1 source paths.'
}
if (
    $manifest.name -cne $HostName -or
    $manifest.type -cne 'stdio' -or
    -not (Test-PathEqual ([string]$manifest.path) $SourceLauncherPath) -or
    @($manifest.allowed_origins).Count -ne 1
) {
    throw 'The installed ATHENA native-host manifest is not the expected single-origin v1 manifest.'
}
$AllowedOrigin = [string]@($manifest.allowed_origins)[0]
if (
    $AllowedOrigin -cnotmatch '^chrome-extension://(?<extensionId>[a-p]{32})/$' -or
    $config.hostName -cne $HostName -or
    $config.allowedOrigin -cne $AllowedOrigin -or
    -not (Test-PathEqual ([string]$config.dataDir) $SourceDataDirectory) -or
    $package.name -cne '@athena/wts-local-runtime' -or
    $package.version -cne '0.1.0'
) {
    throw 'The installed ATHENA configuration is not the expected internally consistent v1 runtime.'
}

$launcherText = Get-Content -LiteralPath $SourceLauncherPath -Raw
$launcherPattern = '(?s)\A@echo off\r?\nset "ATHENA_WTS_HOST_CONFIG=(?<config>[^"\r\n]+)"\r?\n"(?<node>[^"\r\n]+)" "(?<entry>[^"\r\n]+)" %\*\r?\n?\z'
$launcherMatch = [regex]::Match($launcherText, $launcherPattern)
if (
    -not $launcherMatch.Success -or
    -not (Test-PathEqual $launcherMatch.Groups['config'].Value $SourceConfigPath) -or
    -not (Test-PathEqual $launcherMatch.Groups['entry'].Value $SourceEntryPoint)
) {
    throw 'The installed ATHENA launcher is not the expected v1 launcher.'
}
$NodePath = Resolve-NormalizedPath $launcherMatch.Groups['node'].Value
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
    throw "The Node.js executable selected by the installed launcher is missing: $NodePath"
}
Assert-AthenaPhysicalPath -Path $NodePath -Purpose 'Node.js executable' | Out-Null
$nodeVersion = (& $NodePath --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.') {
    throw "Unable to determine the installed launcher's Node.js version."
}
if ([int]$Matches.major -lt 20) {
    throw 'Node.js 20 or newer is required.'
}

if (Test-Path -LiteralPath $SourceDataDirectory) {
    if (-not (Test-Path -LiteralPath $SourceDataDirectory -PathType Container)) {
        throw 'The existing v1 data path is not a directory.'
    }
    if (@(Get-ChildItem -LiteralPath $SourceDataDirectory -Force).Count -gt 0) {
        throw 'The existing v1 data directory is not empty; explicit data migration is required before repair.'
    }
}
if (Test-Path -LiteralPath $Destination) {
    if (
        -not (Test-Path -LiteralPath $Destination -PathType Container) -or
        @(Get-ChildItem -LiteralPath $Destination -Force).Count -gt 0
    ) {
        throw 'Destination must be absent or an empty directory.'
    }
}
if (Test-Path -LiteralPath $DataDirectory) {
    if (
        -not (Test-Path -LiteralPath $DataDirectory -PathType Container) -or
        @(Get-ChildItem -LiteralPath $DataDirectory -Force).Count -gt 0
    ) {
        throw 'DataDirectory must be absent or empty.'
    }
}

$registry32 = Get-RegistrySnapshot -View ([Microsoft.Win32.RegistryView]::Registry32)
$registry64 = Get-RegistrySnapshot -View ([Microsoft.Win32.RegistryView]::Registry64)
foreach ($snapshot in @($registry32, $registry64)) {
    if (-not (Test-PathEqual $snapshot.resolvedValue $SourceManifestPath)) {
        throw "The $($snapshot.view) HKCU registration does not point to the owned v1 manifest."
    }
}

$DestinationManifestPath = Join-Path $Destination "$HostName.json"
$DestinationConfigPath = Join-Path $Destination 'host-config.json'
$DestinationLauncherPath = Join-Path $Destination 'athena-wts-native-host.cmd'
$DestinationMarkerPath = Join-Path $Destination '.athena-wts-native-host.json'
$DestinationEntryPoint = Join-Path $Destination 'runtime\src\main.mjs'
if (-not $Apply) {
    [pscustomobject]@{
        hostName = $HostName
        allowedOrigin = $AllowedOrigin
        source = $Source
        destination = $Destination
        dataDirectory = $DataDirectory
        manifestPath = $DestinationManifestPath
        installedVersion = $package.version
        nodePath = $NodePath
        nodeVersion = $nodeVersion
        registry32Kind = $registry32.kind
        registry64Kind = $registry64.kind
        filesWritten = $false
        registryUpdated = $false
        mode = 'DryRun'
    }
    return
}

$DestinationParent = Split-Path $Destination -Parent
$DataParent = Split-Path $DataDirectory -Parent
$RegistryBackupPath = Join-Path $DestinationParent (
    '.athena-wts-native-host-registry-backup-' + [guid]::NewGuid().ToString('N') + '.json'
)
New-Item -ItemType Directory -Force -Path $DestinationParent, $DataParent | Out-Null
Assert-AthenaPhysicalPath -Path $DestinationParent -Purpose 'native-host parent directory' | Out-Null
Assert-AthenaPhysicalPath -Path $DataParent -Purpose 'native-host data parent directory' | Out-Null

$stagePath = Join-Path $DestinationParent ('.WtsNativeHost-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stagePath | Out-Null
try {
    foreach ($relativePath in $ImmutableRelativePaths) {
        $stagedPath = Join-Path $stagePath $relativePath
        New-Item -ItemType Directory -Force -Path (Split-Path $stagedPath -Parent) | Out-Null
        Copy-Item -LiteralPath (Join-Path $Source $relativePath) -Destination $stagedPath
        $sourceHash = Get-FileSha256 (Join-Path $Source $relativePath)
        $stagedHash = Get-FileSha256 $stagedPath
        if ($sourceHash -cne $stagedHash) {
            throw "Immutable installed-v1 file copy verification failed: $relativePath"
        }
    }

    $newConfig = [ordered]@{
        hostName = $HostName
        allowedOrigin = $AllowedOrigin
        dataDir = $DataDirectory
    }
    $newManifest = [ordered]@{
        name = $HostName
        description = [string]$manifest.description
        path = $DestinationLauncherPath
        type = 'stdio'
        allowed_origins = @($AllowedOrigin)
    }
    $newMarker = [ordered]@{
        installedBy = 'athena-wts-local-runtime'
        hostName = $HostName
        manifestPath = $DestinationManifestPath
        dataDirectory = $DataDirectory
    }
    [IO.File]::WriteAllText(
        (Join-Path $stagePath 'host-config.json'),
        ($newConfig | ConvertTo-Json -Depth 4),
        $Utf8NoBom
    )
    [IO.File]::WriteAllText(
        (Join-Path $stagePath "$HostName.json"),
        ($newManifest | ConvertTo-Json -Depth 4),
        $Utf8NoBom
    )
    [IO.File]::WriteAllText(
        (Join-Path $stagePath '.athena-wts-native-host.json'),
        ($newMarker | ConvertTo-Json -Depth 4),
        $Utf8NoBom
    )
    $newLauncher = @(
        '@echo off',
        ('set "ATHENA_WTS_HOST_CONFIG={0}"' -f (Escape-BatchValue $DestinationConfigPath)),
        ('"{0}" "{1}" %*' -f (Escape-BatchValue $NodePath), (Escape-BatchValue $DestinationEntryPoint))
    ) -join "`r`n"
    [IO.File]::WriteAllText(
        (Join-Path $stagePath 'athena-wts-native-host.cmd'),
        "$newLauncher`r`n",
        $Utf8NoBom
    )

    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Force
    }
    Move-Item -LiteralPath $stagePath -Destination $Destination
} finally {
    if (Test-Path -LiteralPath $stagePath) {
        Remove-Item -LiteralPath $stagePath -Recurse -Force
    }
}

New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$registryBackup = [ordered]@{
    hostName = $HostName
    previousManifestPath = $SourceManifestPath
    replacementManifestPath = $DestinationManifestPath
    snapshots = @(
        [ordered]@{ view = $registry32.view; kind = $registry32.kind; value = $registry32.value },
        [ordered]@{ view = $registry64.view; kind = $registry64.kind; value = $registry64.value }
    )
}
$registryBackupBytes = $Utf8NoBom.GetBytes(($registryBackup | ConvertTo-Json -Depth 5))
$registryBackupStream = [IO.File]::Open(
    $RegistryBackupPath,
    [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None
)
try {
    $registryBackupStream.Write($registryBackupBytes, 0, $registryBackupBytes.Length)
    $registryBackupStream.Flush($true)
} finally {
    $registryBackupStream.Dispose()
}
Assert-AthenaPhysicalPath -Path $RegistryBackupPath -Purpose 'native-host registry backup' | Out-Null

foreach ($pathCheck in @(
    @{ Path = $Destination; Purpose = 'native-host destination' },
    @{ Path = $DataDirectory; Purpose = 'native-host data directory' },
    @{ Path = $DestinationManifestPath; Purpose = 'native-host manifest' },
    @{ Path = $DestinationLauncherPath; Purpose = 'native-host launcher' },
    @{ Path = $DestinationConfigPath; Purpose = 'native-host configuration' },
    @{ Path = $DestinationEntryPoint; Purpose = 'native-host entry point' },
    @{ Path = $NodePath; Purpose = 'Node.js executable' }
)) {
    Assert-AthenaPhysicalPath -Path $pathCheck.Path -Purpose $pathCheck.Purpose | Out-Null
}
foreach ($relativePath in $ImmutableRelativePaths) {
    $sourceHash = Get-FileSha256 (Join-Path $Source $relativePath)
    $destinationHash = Get-FileSha256 (Join-Path $Destination $relativePath)
    if ($sourceHash -cne $destinationHash) {
        throw "Immutable installed-v1 file changed after relocation: $relativePath"
    }
}

$updatedViews = New-Object System.Collections.Generic.List[Microsoft.Win32.RegistryView]
try {
    foreach ($entry in @(
        @{ View = [Microsoft.Win32.RegistryView]::Registry32; Snapshot = $registry32 },
        @{ View = [Microsoft.Win32.RegistryView]::Registry64; Snapshot = $registry64 }
    )) {
        Set-RegistrySnapshotValue `
            -View $entry.View `
            -Value $DestinationManifestPath `
            -Kind (ConvertTo-RegistryKind $entry.Snapshot.kind)
        $updatedViews.Add($entry.View)
    }
} catch {
    $updateError = $_
    $rollbackErrors = New-Object System.Collections.Generic.List[string]
    foreach ($entry in @(
        @{ View = [Microsoft.Win32.RegistryView]::Registry32; Snapshot = $registry32 },
        @{ View = [Microsoft.Win32.RegistryView]::Registry64; Snapshot = $registry64 }
    )) {
        try {
            Set-RegistrySnapshotValue `
                -View $entry.View `
                -Value $entry.Snapshot.value `
                -Kind (ConvertTo-RegistryKind $entry.Snapshot.kind)
        } catch {
            $rollbackErrors.Add("$($entry.View): $($_.Exception.Message)")
        }
    }
    if ($rollbackErrors.Count -gt 0) {
        throw "Native-host registration update failed and rollback was incomplete. Original error: $($updateError.Exception.Message). Rollback errors: $($rollbackErrors -join '; '). Backup: $RegistryBackupPath"
    }
    throw "Native-host registration update failed; both HKCU registry views were restored. $($updateError.Exception.Message)"
}

[pscustomobject]@{
    hostName = $HostName
    allowedOrigin = $AllowedOrigin
    source = $Source
    destination = $Destination
    dataDirectory = $DataDirectory
    manifestPath = $DestinationManifestPath
    installedVersion = $package.version
    nodePath = $NodePath
    nodeVersion = $nodeVersion
    registryBackupPath = $RegistryBackupPath
    filesWritten = $true
    registryUpdated = $true
    oldInstallationPreserved = $true
    oldDataPreserved = $true
    mode = 'Apply'
}

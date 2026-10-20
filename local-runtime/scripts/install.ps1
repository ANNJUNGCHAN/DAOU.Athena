[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExtensionId,
    [string]$Destination = (Join-Path $env:USERPROFILE '.athena\WtsNativeHost'),
    [string]$DataDirectory = (Join-Path $env:USERPROFILE '.athena\WtsData'),
    [string]$BackendRoot,
    [string]$PythonExecutable,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'registry.ps1')
. (Join-Path $PSScriptRoot 'path-validation.ps1')

$HostName = 'com.athena.wts'
$ExtensionPattern = '^[a-p]{32}$'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if ($ExtensionId -cnotmatch $ExtensionPattern) {
    throw 'ExtensionId must contain exactly 32 lowercase characters in the range a-p.'
}
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    throw 'USERPROFILE is required.'
}

function Resolve-NormalizedPath([string]$Value) {
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

function Test-AthenaAbsolutePath([string]$Value) {
    return $Value -cmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))'
}

$Destination = Resolve-NormalizedPath $Destination
$DataDirectory = Resolve-NormalizedPath $DataDirectory
$backendProvided = $PSBoundParameters.ContainsKey('BackendRoot')
$pythonProvided = $PSBoundParameters.ContainsKey('PythonExecutable')
if ($backendProvided -ne $pythonProvided) {
    throw 'BackendRoot and PythonExecutable must be configured together.'
}
$backendConfigured = $backendProvided
if ($backendConfigured) {
    if (
        [string]::IsNullOrWhiteSpace($BackendRoot) -or
        [string]::IsNullOrWhiteSpace($PythonExecutable) -or
        -not (Test-AthenaAbsolutePath $BackendRoot) -or
        -not (Test-AthenaAbsolutePath $PythonExecutable)
    ) {
        throw 'BackendRoot and PythonExecutable must be absolute paths.'
    }
    $BackendRoot = Resolve-NormalizedPath $BackendRoot
    $PythonExecutable = Resolve-NormalizedPath $PythonExecutable
} else {
    $BackendRoot = $null
    $PythonExecutable = $null
}
$destinationPrefix = $Destination + [IO.Path]::DirectorySeparatorChar
if (
    [string]::Equals($DataDirectory, $Destination, [StringComparison]::OrdinalIgnoreCase) -or
    $DataDirectory.StartsWith($destinationPrefix, [StringComparison]::OrdinalIgnoreCase)
) {
    throw 'DataDirectory must be outside Destination so uninstall preserves user data.'
}

$nodeCommand = Get-Command node.exe -ErrorAction Stop
$NodePath = [IO.Path]::GetFullPath($nodeCommand.Source)
$nodeVersion = (& $NodePath --version)
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(?<major>\d+)\.') {
    throw 'Unable to determine the installed Node.js version.'
}
if ([int]$Matches.major -lt 20) {
    throw 'Node.js 20 or newer is required.'
}

$RuntimeSource = Split-Path $PSScriptRoot -Parent
$RepositoryRoot = Split-Path $RuntimeSource -Parent
$ContractsSource = Join-Path $RepositoryRoot 'contracts'
$RuntimeFiles = @(
    'src\config.mjs',
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
$ContractFiles = @('wts-foundation.mjs', 'wts-foundation.protocol.schema.json')
foreach ($requiredPath in @(
    $RuntimeFiles | ForEach-Object { Join-Path $RuntimeSource $_ }
) + @(
    (Join-Path $RuntimeSource 'scripts\registry.ps1')
) + @(
    $ContractFiles | ForEach-Object { Join-Path $ContractsSource $_ }
)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Required installation file is missing: $requiredPath"
    }
}

$RuntimeDestination = Join-Path $Destination 'runtime'
$ContractsDestination = Join-Path $Destination 'contracts'
$ConfigPath = Join-Path $Destination 'host-config.json'
$LauncherPath = Join-Path $Destination 'athena-wts-native-host.cmd'
$ManifestPath = Join-Path $Destination "$HostName.json"
$MarkerPath = Join-Path $Destination '.athena-wts-native-host.json'
$RegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
$RuntimeWriteTargets = $RuntimeFiles | ForEach-Object { Join-Path $RuntimeDestination $_ }
$RuntimeDirectories = @(
    $RuntimeWriteTargets |
        ForEach-Object { Split-Path $_ -Parent } |
        Sort-Object -Unique
)
$ContractWriteTargets = $ContractFiles | ForEach-Object { Join-Path $ContractsDestination $_ }
$WriteTargets = @($RuntimeWriteTargets) + @($ContractWriteTargets) + @(
    $ConfigPath,
    $LauncherPath,
    $ManifestPath,
    $MarkerPath
)

function Assert-AthenaInstallDirectory([string]$Path, [string]$Purpose) {
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "ATHENA $Purpose must be a directory: $Path"
    }
    Assert-AthenaPhysicalPath -Path $Path -Purpose $Purpose | Out-Null
    $item = Get-Item -LiteralPath $Path -Force
    $linkTypeProperty = $item.PSObject.Properties['LinkType']
    if (
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($null -ne $linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value))
    ) {
        throw "ATHENA refused an unexpected linked path for $Purpose; the native host was not registered: $Path"
    }
}

function Assert-AthenaWriteTarget([string]$Path, [switch]$MustExist) {
    if (-not (Test-Path -LiteralPath $Path)) {
        if ($MustExist) {
            throw "ATHENA installation output is missing: $Path"
        }
        return
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "ATHENA installation output must be a file: $Path"
    }
    Assert-AthenaPhysicalPath -Path $Path -Purpose 'installation output' | Out-Null
    $item = Get-Item -LiteralPath $Path -Force
    $linkTypeProperty = $item.PSObject.Properties['LinkType']
    if (
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($null -ne $linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value))
    ) {
        throw "ATHENA refused an unexpected linked installation output; the native host was not registered: $Path"
    }
}

function Assert-AthenaPhysicalFile([string]$Path, [string]$Purpose) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "ATHENA $Purpose must be a file: $Path"
    }
    Assert-AthenaPhysicalPath -Path $Path -Purpose $Purpose | Out-Null
    $item = Get-Item -LiteralPath $Path -Force
    $linkTypeProperty = $item.PSObject.Properties['LinkType']
    if (
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($null -ne $linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value))
    ) {
        throw "ATHENA refused an unexpected linked path for $Purpose; the native host was not registered: $Path"
    }
}

if ($backendConfigured) {
    if (-not (Test-Path -LiteralPath $BackendRoot -PathType Container)) {
        throw "ATHENA read-only backend root must be a directory: $BackendRoot"
    }
    Assert-AthenaInstallDirectory -Path $BackendRoot -Purpose 'read-only backend root'
    Assert-AthenaPhysicalFile -Path $PythonExecutable -Purpose 'read-only backend Python executable'
    Assert-AthenaPhysicalFile -Path (Join-Path $BackendRoot 'athena_api\launcher.py') -Purpose 'read-only backend launcher'
    Assert-AthenaPhysicalFile -Path (Join-Path $BackendRoot 'athena_api\readonly_app.py') -Purpose 'read-only backend application'
}

if (Test-Path -LiteralPath $Destination) {
    Assert-AthenaInstallDirectory -Path $Destination -Purpose 'native host destination'
    $existingItems = @(Get-ChildItem -LiteralPath $Destination -Force)
    if ($existingItems.Count -gt 0 -and -not (Test-Path -LiteralPath $MarkerPath -PathType Leaf)) {
        throw 'Destination is not an owned ATHENA WTS installation.'
    }
    if (Test-Path -LiteralPath $MarkerPath -PathType Leaf) {
        $existingMarker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
        if (
            $existingMarker.installedBy -cne 'athena-wts-local-runtime' -or
            $existingMarker.hostName -cne $HostName -or
            -not [string]::Equals(
                $existingMarker.manifestPath,
                $ManifestPath,
                [StringComparison]::OrdinalIgnoreCase
            )
        ) {
            throw 'Destination ownership marker does not match this installation.'
        }
    }
}
Assert-AthenaInstallDirectory -Path $DataDirectory -Purpose 'observation data directory'
foreach ($directory in @($RuntimeDestination, $ContractsDestination) + $RuntimeDirectories) {
    Assert-AthenaInstallDirectory -Path $directory -Purpose 'installation directory'
}
foreach ($writeTarget in $WriteTargets) {
    Assert-AthenaWriteTarget -Path $writeTarget
}

if (-not $DryRun -and (Test-Path -LiteralPath $RegistryPath)) {
    $registeredManifest = (Get-Item -LiteralPath $RegistryPath).GetValue('')
    if (-not [string]::Equals($registeredManifest, $ManifestPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A different native host registration already owns this host name.'
    }
}

if ($DryRun) {
    [pscustomobject]@{
        hostName = $HostName
        allowedOrigin = "chrome-extension://$ExtensionId/"
        destination = $Destination
        dataDirectory = $DataDirectory
        backendConfigured = $backendConfigured
        manifestPath = $ManifestPath
        registryUpdated = $false
        filesWritten = $false
        nodeVersion = $nodeVersion
    }
    return
}

New-Item -ItemType Directory -Force -Path $Destination, $DataDirectory | Out-Null
Assert-AthenaInstallDirectory -Path $Destination -Purpose 'native host destination'
Assert-AthenaInstallDirectory -Path $DataDirectory -Purpose 'observation data directory'

New-Item -ItemType Directory -Force -Path $RuntimeDestination, $ContractsDestination | Out-Null
Assert-AthenaInstallDirectory -Path $RuntimeDestination -Purpose 'runtime destination'
Assert-AthenaInstallDirectory -Path $ContractsDestination -Purpose 'contracts destination'
foreach ($directory in $RuntimeDirectories) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    Assert-AthenaInstallDirectory -Path $directory -Purpose 'runtime package destination'
}
foreach ($writeTarget in $WriteTargets) {
    Assert-AthenaWriteTarget -Path $writeTarget
}
foreach ($relativePath in $RuntimeFiles) {
    $sourcePath = Join-Path $RuntimeSource $relativePath
    $destinationPath = Join-Path $RuntimeDestination $relativePath
    Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
}
foreach ($relativePath in $ContractFiles) {
    Copy-Item -LiteralPath (Join-Path $ContractsSource $relativePath) -Destination (Join-Path $ContractsDestination $relativePath) -Force
}

$config = [ordered]@{
    hostName = $HostName
    allowedOrigin = "chrome-extension://$ExtensionId/"
    dataDir = $DataDirectory
    backendRoot = $BackendRoot
    pythonExecutable = $PythonExecutable
}
$manifest = [ordered]@{
    name = $HostName
    description = 'ATHENA WTS local bounded screen-control runtime'
    path = $LauncherPath
    type = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
}
$marker = [ordered]@{
    installedBy = 'athena-wts-local-runtime'
    hostName = $HostName
    manifestPath = $ManifestPath
    dataDirectory = $DataDirectory
}

[IO.File]::WriteAllText($ConfigPath, ($config | ConvertTo-Json -Depth 4), $Utf8NoBom)
[IO.File]::WriteAllText($ManifestPath, ($manifest | ConvertTo-Json -Depth 4), $Utf8NoBom)
[IO.File]::WriteAllText($MarkerPath, ($marker | ConvertTo-Json -Depth 4), $Utf8NoBom)

function Escape-BatchValue([string]$Value) {
    return $Value.Replace('%', '%%')
}
$launcher = @(
    '@echo off',
    ('set "ATHENA_WTS_HOST_CONFIG={0}"' -f (Escape-BatchValue $ConfigPath)),
    ('"{0}" "{1}" %*' -f (Escape-BatchValue $NodePath), (Escape-BatchValue (Join-Path $RuntimeDestination 'src\main.mjs')))
) -join "`r`n"
[IO.File]::WriteAllText($LauncherPath, "$launcher`r`n", $Utf8NoBom)

foreach ($writeTarget in $WriteTargets) {
    Assert-AthenaWriteTarget -Path $writeTarget -MustExist
}
Set-AthenaRegistryDefaultValue -Path $RegistryPath -Value $ManifestPath

[pscustomobject]@{
    hostName = $HostName
    allowedOrigin = "chrome-extension://$ExtensionId/"
    destination = $Destination
    dataDirectory = $DataDirectory
    backendConfigured = $backendConfigured
    manifestPath = $ManifestPath
    registryUpdated = $true
    filesWritten = $true
    nodeVersion = $nodeVersion
}

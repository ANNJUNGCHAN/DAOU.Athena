[CmdletBinding()]
param(
    [string]$ExtensionId = 'mhbcjkjmgabekcakpilhgkgeedhkjfee',
    [string]$Destination = (Join-Path $env:USERPROFILE '.athena\WtsNativeHost'),
    [string]$DataDirectory = (Join-Path $env:USERPROFILE '.athena\WtsData'),
    [string]$SourceRoot,
    [string]$BackendRoot,
    [string]$PythonExecutable,
    [string]$RegistrySubKey = 'Software\Google\Chrome\NativeMessagingHosts\com.athena.wts',
    [switch]$Apply,
    [switch]$DryRun,
    [switch]$TestMode,
    [string]$FixtureRoot,
    [int]$OwnedProcessId = 0,
    [ValidateSet('None', 'AfterStageCreated', 'BeforeExchange', 'TamperStagedFile', 'AfterOldMoved', 'AfterNewMoved', 'TamperInstalledFile')]
    [string]$InjectFailure = 'None'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $PSBoundParameters.ContainsKey('SourceRoot')) {
    $SourceRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
}
. (Join-Path $PSScriptRoot 'path-validation.ps1')

$HostName = 'com.athena.wts'
$ExpectedExtensionId = 'mhbcjkjmgabekcakpilhgkgeedhkjfee'
$ExpectedOrigin = "chrome-extension://$ExpectedExtensionId/"
$ExpectedRegistrySubKey = "Software\Google\Chrome\NativeMessagingHosts\$HostName"
$TestRegistryPattern = '^Software\\AthenaWtsNativeHostUpgradeTests-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\com\.athena\.wts$'
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$ReviewedRuntimeSourceFiles = @(
    'backend-supervisor.mjs',
    'chatgpt-provider\browser-opener.mjs',
    'chatgpt-provider\control-candidate.mjs',
    'chatgpt-provider\models-client.mjs',
    'chatgpt-provider\oauth-session.mjs',
    'chatgpt-provider\openid-verifier.mjs',
    'chatgpt-provider\planning-client.mjs',
    'chatgpt-provider\provider-coordinator.mjs',
    'chatgpt-provider\registration-store.mjs',
    'chatgpt-provider\responses-client.mjs',
    'chatgpt-provider\token-session.mjs',
    'config.mjs',
    'control-planner.mjs',
    'conversation-router.mjs',
    'errors.mjs',
    'financial-backend-supervisor.mjs',
    'financial-source-bridge.mjs',
    'framing.mjs',
    'host.mjs',
    'inventory-store.mjs',
    'main.mjs',
    'receipt-store.mjs',
    'source-bridge.mjs',
    'task-compiler.mjs',
    'task-engine.mjs',
    'task-store.mjs'
)
$ReviewedRuntimeScriptFiles = @(
    'open-openai-authorization.ps1',
    'openai-registration-store.ps1'
)

if ($Apply -and $DryRun) {
    throw 'Apply and DryRun cannot be used together.'
}
if ($ExtensionId -cne $ExpectedExtensionId) {
    throw "The staged upgrade is restricted to the stable ATHENA extension ID $ExpectedExtensionId."
}
if ([string]::IsNullOrWhiteSpace($env:USERPROFILE)) {
    throw 'USERPROFILE is required.'
}

function Resolve-NormalizedPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'A required path was empty.'
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

function Test-PathInside([string]$Path, [string]$Root) {
    $resolvedPath = Resolve-NormalizedPath $Path
    $resolvedRoot = Resolve-NormalizedPath $Root
    if ([string]::Equals($resolvedPath, $resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
        return $true
    }
    return $resolvedPath.StartsWith(
        $resolvedRoot + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase
    )
}

function Assert-PhysicalItem([string]$Path, [string]$Purpose, [switch]$Directory, [switch]$File) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "ATHENA $Purpose is missing: $Path"
    }
    if ($Directory -and -not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "ATHENA $Purpose must be a directory: $Path"
    }
    if ($File -and -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "ATHENA $Purpose must be a file: $Path"
    }
    Assert-AthenaPhysicalPath -Path $Path -Purpose $Purpose | Out-Null
    $item = Get-Item -LiteralPath $Path -Force
    $linkType = $item.PSObject.Properties['LinkType']
    if (
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
        ($null -ne $linkType -and -not [string]::IsNullOrWhiteSpace([string]$linkType.Value))
    ) {
        throw "ATHENA refused an unexpected reparse point for ${Purpose}: $Path"
    }
}

function Assert-CurrentUserOwner([string]$Path, [string]$Purpose) {
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    try {
        $security = if (Test-Path -LiteralPath $Path -PathType Container) {
            [IO.Directory]::GetAccessControl($Path)
        } else {
            [IO.File]::GetAccessControl($Path)
        }
        $ownerSid = $security.GetOwner([Security.Principal.SecurityIdentifier]).Value
    } catch {
        throw "ATHENA could not verify the owner of ${Purpose}: $Path"
    }
    if ($ownerSid -cne $currentSid) {
        throw "ATHENA $Purpose is not owned by the current Windows user: $Path"
    }
}

function Get-CurrentUserSid() {
    return [Security.Principal.WindowsIdentity]::GetCurrent().User
}

function Get-DirectorySecurity([string]$Path) {
    return [IO.Directory]::GetAccessControl($Path)
}

function Get-DirectorySddl([string]$Path) {
    $sections = [Security.AccessControl.AccessControlSections]::Owner -bor
        [Security.AccessControl.AccessControlSections]::Group -bor
        [Security.AccessControl.AccessControlSections]::Access
    return (Get-DirectorySecurity $Path).GetSecurityDescriptorSddlForm($sections)
}

function Assert-AcceptableDirectoryDacl([string]$Path, [string]$Purpose) {
    Assert-AcceptableItemDacl -Path $Path -Purpose $Purpose
}

function Assert-AcceptableItemDacl([string]$Path, [string]$Purpose) {
    Assert-CurrentUserOwner -Path $Path -Purpose $Purpose
    $security = if (Test-Path -LiteralPath $Path -PathType Container) {
        Get-DirectorySecurity $Path
    } else {
        [IO.File]::GetAccessControl($Path)
    }
    if (-not $security.AreAccessRulesCanonical) {
        throw "ATHENA $Purpose has a non-canonical DACL: $Path"
    }
    $trustedSids = @(
        (Get-CurrentUserSid).Value,
        'S-1-5-18',
        'S-1-5-32-544'
    )
    $dangerousRights = [Security.AccessControl.FileSystemRights]::Write -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    $rules = @($security.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    ))
    foreach ($rule in $rules) {
        if (
            $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            ($rule.FileSystemRights -band $dangerousRights) -ne 0 -and
            [string]$rule.IdentityReference.Value -cnotin $trustedSids
        ) {
            throw "ATHENA $Purpose grants write, delete, or security-control rights to an untrusted identity: $Path"
        }
    }
}

function New-PrivateDirectorySecurity() {
    $security = New-Object Security.AccessControl.DirectorySecurity
    $currentSid = Get-CurrentUserSid
    $systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $security.SetOwner($currentSid)
    $security.SetAccessRuleProtection($true, $false)
    $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
        [Security.AccessControl.InheritanceFlags]::ObjectInherit
    foreach ($sid in @($currentSid, $systemSid)) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        [void]$security.AddAccessRule($rule)
    }
    return $security
}

function New-PrivateDirectory([string]$Path, [string]$Purpose) {
    if (Test-Path -LiteralPath $Path) {
        throw "ATHENA refused an existing $Purpose path: $Path"
    }
    [void][IO.Directory]::CreateDirectory($Path, (New-PrivateDirectorySecurity))
    Assert-PhysicalItem -Path $Path -Purpose $Purpose -Directory
    Assert-PrivateDirectoryDacl -Path $Path -Purpose $Purpose
}

function Set-PrivateDirectoryDacl([string]$Path, [string]$Purpose) {
    [IO.Directory]::SetAccessControl($Path, (New-PrivateDirectorySecurity))
    Assert-PrivateDirectoryDacl -Path $Path -Purpose $Purpose
}

function Assert-PrivateDirectoryDacl([string]$Path, [string]$Purpose) {
    Assert-CurrentUserOwner -Path $Path -Purpose $Purpose
    $security = Get-DirectorySecurity $Path
    if (-not $security.AreAccessRulesProtected -or -not $security.AreAccessRulesCanonical) {
        throw "ATHENA $Purpose must have a protected canonical DACL: $Path"
    }
    $expected = @((Get-CurrentUserSid).Value, 'S-1-5-18') | Sort-Object
    $rules = @($security.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    ))
    $actual = @($rules | ForEach-Object {
        if (
            $_.IsInherited -or
            $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl
        ) {
            throw "ATHENA $Purpose contains an unexpected access rule: $Path"
        }
        [string]$_.IdentityReference.Value
    } | Sort-Object)
    if ($actual.Count -ne $expected.Count -or ($actual -join '|') -cne ($expected -join '|')) {
        throw "ATHENA $Purpose is not restricted to the current user and SYSTEM: $Path"
    }
}

function Assert-PrivateItemDacl([string]$Path, [string]$Purpose) {
    Assert-CurrentUserOwner -Path $Path -Purpose $Purpose
    $security = if (Test-Path -LiteralPath $Path -PathType Container) {
        Get-DirectorySecurity $Path
    } else {
        [IO.File]::GetAccessControl($Path)
    }
    if (-not $security.AreAccessRulesCanonical) {
        throw "ATHENA $Purpose has a non-canonical DACL: $Path"
    }
    $expected = @((Get-CurrentUserSid).Value, 'S-1-5-18') | Sort-Object
    $rules = @($security.GetAccessRules(
        $true,
        $true,
        [Security.Principal.SecurityIdentifier]
    ))
    $actual = @($rules | ForEach-Object {
        if (
            $_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl
        ) {
            throw "ATHENA $Purpose contains an unexpected access rule: $Path"
        }
        [string]$_.IdentityReference.Value
    } | Sort-Object)
    if ($actual.Count -ne $expected.Count -or ($actual -join '|') -cne ($expected -join '|')) {
        throw "ATHENA $Purpose is not restricted to the current user and SYSTEM: $Path"
    }
}

function Assert-PrivateTreeDacl([string]$Root, [string]$Purpose) {
    Assert-PrivateDirectoryDacl -Path $Root -Purpose $Purpose
    foreach ($entry in Get-SafeTreeEntries -Root $Root -Purpose $Purpose) {
        Assert-PrivateItemDacl -Path $entry.fullPath -Purpose $Purpose
    }
}

function Set-DirectorySddl([string]$Path, [string]$Sddl, [string]$Purpose) {
    $sections = [Security.AccessControl.AccessControlSections]::Owner -bor
        [Security.AccessControl.AccessControlSections]::Group -bor
        [Security.AccessControl.AccessControlSections]::Access
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetSecurityDescriptorSddlForm($Sddl, $sections)
    [IO.Directory]::SetAccessControl($Path, $security)
    if ((Get-DirectorySddl $Path) -cne $Sddl) {
        throw "ATHENA could not restore the exact $Purpose security descriptor: $Path"
    }
}

function Get-SafeTreeEntries([string]$Root, [string]$Purpose) {
    Assert-PhysicalItem -Path $Root -Purpose $Purpose -Directory
    $pending = New-Object System.Collections.Generic.Stack[string]
    $pending.Push($Root)
    $entries = New-Object System.Collections.Generic.List[object]
    while ($pending.Count -gt 0) {
        $directory = $pending.Pop()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            Assert-PhysicalItem -Path $item.FullName -Purpose $Purpose `
                -Directory:$item.PSIsContainer -File:(-not $item.PSIsContainer)
            $relative = $item.FullName.Substring($Root.Length).TrimStart('\', '/')
            $entries.Add([pscustomobject]@{
                relativePath = $relative.Replace('/', '\')
                fullPath = $item.FullName
                isDirectory = [bool]$item.PSIsContainer
            })
            if ($item.PSIsContainer) {
                $pending.Push($item.FullName)
            }
        }
    }
    return @($entries | Sort-Object relativePath)
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

function Get-TreeFileSnapshot([string]$Root, [string]$Purpose) {
    $files = New-Object System.Collections.Generic.List[object]
    foreach ($entry in Get-SafeTreeEntries -Root $Root -Purpose $Purpose) {
        if (-not $entry.isDirectory) {
            $files.Add([pscustomobject]@{
                relativePath = $entry.relativePath
                hash = Get-FileSha256 $entry.fullPath
            })
        }
    }
    return @($files | Sort-Object relativePath)
}

function Assert-TreeFileSnapshot([string]$Root, [object[]]$Before, [string]$Purpose) {
    $after = @(Get-TreeFileSnapshot -Root $Root -Purpose $Purpose)
    if ($after.Count -ne $Before.Count) {
        throw "ATHENA $Purpose file set changed during the staged upgrade."
    }
    for ($index = 0; $index -lt $Before.Count; $index += 1) {
        if (
            $after[$index].relativePath -cne $Before[$index].relativePath -or
            $after[$index].hash -cne $Before[$index].hash
        ) {
            throw "ATHENA $Purpose changed during the staged upgrade: $($Before[$index].relativePath)"
        }
    }
}

function Get-TreeStateSnapshot([string]$Root, [string]$Purpose) {
    $snapshot = New-Object System.Collections.Generic.List[object]
    $snapshot.Add([pscustomobject]@{
        relativePath = '.'
        kind = 'directory'
        proof = Get-DirectorySddl $Root
    })
    foreach ($entry in Get-SafeTreeEntries -Root $Root -Purpose $Purpose) {
        $snapshot.Add([pscustomobject]@{
            relativePath = $entry.relativePath
            kind = if ($entry.isDirectory) { 'directory' } else { 'file' }
            proof = if ($entry.isDirectory) {
                Get-DirectorySddl $entry.fullPath
            } else {
                Get-FileSha256 $entry.fullPath
            }
        })
    }
    return @($snapshot | Sort-Object relativePath, kind)
}

function Assert-TreeStateSnapshot([string]$Root, [object[]]$Before, [string]$Purpose) {
    $after = @(Get-TreeStateSnapshot -Root $Root -Purpose $Purpose)
    if ($after.Count -ne $Before.Count) {
        throw "ATHENA $Purpose file or directory set changed during the staged upgrade."
    }
    for ($index = 0; $index -lt $Before.Count; $index += 1) {
        if (
            $after[$index].relativePath -cne $Before[$index].relativePath -or
            $after[$index].kind -cne $Before[$index].kind -or
            $after[$index].proof -cne $Before[$index].proof
        ) {
            throw "ATHENA $Purpose state changed during the staged upgrade: $($Before[$index].relativePath)"
        }
    }
}

function Assert-TreePayloadSnapshot([string]$Root, [object[]]$Before, [string]$Purpose) {
    $expected = @($Before | Where-Object { $_.relativePath -cne '.' })
    $after = @(Get-TreeStateSnapshot -Root $Root -Purpose $Purpose | Where-Object { $_.relativePath -cne '.' })
    if ($after.Count -ne $expected.Count) {
        throw "ATHENA $Purpose file or child-directory set changed during the staged upgrade."
    }
    for ($index = 0; $index -lt $expected.Count; $index += 1) {
        if (
            $after[$index].relativePath -cne $expected[$index].relativePath -or
            $after[$index].kind -cne $expected[$index].kind -or
            (
                $expected[$index].kind -ceq 'file' -and
                $after[$index].proof -cne $expected[$index].proof
            )
        ) {
            throw "ATHENA $Purpose payload changed: $($expected[$index].relativePath)"
        }
    }
}

function Get-RegistrySnapshot([Microsoft.Win32.RegistryView]$View) {
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        $View
    )
    try {
        $key = $base.OpenSubKey($RegistrySubKey, $false)
        if ($null -eq $key) {
            throw "The $View HKCU native-host registration is missing."
        }
        try {
            $kind = $key.GetValueKind('')
            if ($kind -notin @(
                [Microsoft.Win32.RegistryValueKind]::String,
                [Microsoft.Win32.RegistryValueKind]::ExpandString
            )) {
                throw "The $View HKCU native-host registration has an unsupported value kind."
            }
            $options = if ($kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
                [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
            } else {
                [Microsoft.Win32.RegistryValueOptions]::None
            }
            $value = [string]$key.GetValue('', $null, $options)
            $resolved = if ($kind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString) {
                [Environment]::ExpandEnvironmentVariables($value)
            } else {
                $value
            }
            return [pscustomobject]@{
                view = $View.ToString()
                kind = $kind.ToString()
                value = $value
                resolvedValue = Resolve-NormalizedPath $resolved
            }
        } finally {
            $key.Dispose()
        }
    } finally {
        $base.Dispose()
    }
}

function Assert-RegistryUnchanged([object[]]$Before, [string]$ManifestPath) {
    $after = @(
        Get-RegistrySnapshot -View ([Microsoft.Win32.RegistryView]::Registry32)
        Get-RegistrySnapshot -View ([Microsoft.Win32.RegistryView]::Registry64)
    )
    for ($index = 0; $index -lt $Before.Count; $index += 1) {
        if (
            $after[$index].view -cne $Before[$index].view -or
            $after[$index].kind -cne $Before[$index].kind -or
            $after[$index].value -cne $Before[$index].value -or
            -not (Test-PathEqual $after[$index].resolvedValue $ManifestPath)
        ) {
            throw 'The HKCU native-host registration changed during the staged upgrade.'
        }
    }
}

function Get-SourceSnapshot([string]$RepositoryRoot) {
    $runtimeRoot = Join-Path $RepositoryRoot 'local-runtime'
    $runtimeSource = Join-Path $runtimeRoot 'src'
    $runtimeScripts = Join-Path $runtimeRoot 'scripts'
    $contractsRoot = Join-Path $RepositoryRoot 'contracts'
    Assert-PhysicalItem -Path $runtimeRoot -Purpose 'runtime source root' -Directory
    Assert-PhysicalItem -Path $runtimeSource -Purpose 'runtime module source' -Directory
    Assert-PhysicalItem -Path $contractsRoot -Purpose 'contracts source root' -Directory
    $runtimeEntries = Get-SafeTreeEntries -Root $runtimeSource -Purpose 'runtime module source item'
    $runtimeFiles = @($runtimeEntries | Where-Object { -not $_.isDirectory })
    $actualRuntimePaths = @($runtimeFiles.relativePath | Sort-Object)
    $expectedRuntimePaths = @($ReviewedRuntimeSourceFiles | Sort-Object)
    if ($actualRuntimePaths.Count -ne $expectedRuntimePaths.Count) {
        throw 'Runtime src does not match the reviewed native-host source allowlist.'
    }
    for ($index = 0; $index -lt $expectedRuntimePaths.Count; $index += 1) {
        if ($actualRuntimePaths[$index] -cne $expectedRuntimePaths[$index]) {
            throw "Runtime src contains a missing or non-allowlisted file: $($actualRuntimePaths[$index])"
        }
    }
    $runtimeScriptFiles = foreach ($scriptName in $ReviewedRuntimeScriptFiles) {
        $scriptPath = Join-Path $runtimeScripts $scriptName
        Assert-PhysicalItem -Path $scriptPath -Purpose 'runtime helper script' -File
        Get-Item -LiteralPath $scriptPath -Force
    }
    $packagePath = Join-Path $runtimeRoot 'package.json'
    Assert-PhysicalItem -Path $packagePath -Purpose 'runtime package manifest' -File
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if (
        $package.name -cne '@athena/wts-local-runtime' -or
        [string]::IsNullOrWhiteSpace([string]$package.version) -or
        $package.type -cne 'module' -or
        [string]$package.engines.node -cnotmatch '^>=\s*(?<major>[0-9]+)(?:\.[0-9]+\.[0-9]+)?$'
    ) {
        throw 'Runtime package.json does not identify the ATHENA WTS local runtime.'
    }
    $engineFloor = [int]$Matches.major
    $contractFiles = @(Get-ChildItem -LiteralPath $contractsRoot -Force -File | Where-Object {
        $_.Name.EndsWith('.mjs', [StringComparison]::Ordinal) -or
        $_.Name.EndsWith('.schema.json', [StringComparison]::Ordinal)
    })
    foreach ($contractFile in $contractFiles) {
        Assert-PhysicalItem -Path $contractFile.FullName -Purpose 'contract source file' -File
    }
    if (
        -not ($contractFiles.Name -contains 'wts-foundation.mjs') -or
        -not ($contractFiles.Name -contains 'wts-foundation.protocol.schema.json')
    ) {
        throw 'The required WTS foundation contracts are missing.'
    }
    $files = New-Object System.Collections.Generic.List[object]
    $files.Add([pscustomobject]@{
        relativePath = 'runtime\package.json'
        sourcePath = $packagePath
        hash = Get-FileSha256 $packagePath
    })
    foreach ($runtimeFile in $runtimeFiles) {
        $relative = 'runtime\src\' + $runtimeFile.relativePath
        $files.Add([pscustomobject]@{
            relativePath = $relative
            sourcePath = $runtimeFile.fullPath
            hash = Get-FileSha256 $runtimeFile.fullPath
        })
    }
    foreach ($runtimeScript in $runtimeScriptFiles) {
        $files.Add([pscustomobject]@{
            relativePath = 'runtime\scripts\' + $runtimeScript.Name
            sourcePath = $runtimeScript.FullName
            hash = Get-FileSha256 $runtimeScript.FullName
        })
    }
    foreach ($contractFile in $contractFiles) {
        $files.Add([pscustomobject]@{
            relativePath = 'contracts\' + $contractFile.Name
            sourcePath = $contractFile.FullName
            hash = Get-FileSha256 $contractFile.FullName
        })
    }
    return [pscustomobject]@{
        packageVersion = [string]$package.version
        nodeMajorFloor = $engineFloor
        files = @($files | Sort-Object relativePath)
    }
}

function Assert-NodeRuntimeIdentity([string]$Path, [int]$RequiredMajor) {
    Assert-PhysicalItem -Path $Path -Purpose 'installed Node.js executable' -File
    if ([IO.Path]::GetExtension($Path) -cne '.exe') {
        throw 'The installed native-host launcher must use a Node.js executable.'
    }
    $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
    if (
        [string]$versionInfo.ProductName -cne 'Node.js' -or
        [string]$versionInfo.OriginalFilename -cne 'node.exe'
    ) {
        throw 'The installed native-host launcher does not reference an identifiable Node.js executable.'
    }
    $probeCode = 'process.stdout.write(JSON.stringify({execPath:process.execPath,release:process.release.name,version:process.versions.node}))'
    $probeOutput = (& $Path -e $probeCode)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$probeOutput)) {
        throw 'The installed Node.js executable identity probe failed.'
    }
    try {
        $probe = ([string]$probeOutput | ConvertFrom-Json)
    } catch {
        throw 'The installed Node.js executable returned an invalid identity probe.'
    }
    if (
        $probe.release -cne 'node' -or
        [string]$probe.version -cnotmatch '^(?<major>[0-9]+)\.[0-9]+\.[0-9]+$' -or
        -not (Test-PathEqual ([string]$probe.execPath) $Path)
    ) {
        throw 'The installed native-host launcher does not reference the probed Node.js executable.'
    }
    if ([int]$Matches.major -lt $RequiredMajor) {
        throw "Node.js $RequiredMajor or newer is required by the staged runtime package."
    }
}

function Assert-SourceSnapshotUnchanged([object]$Before, [string]$RepositoryRoot) {
    $after = Get-SourceSnapshot -RepositoryRoot $RepositoryRoot
    if ($after.files.Count -ne $Before.files.Count) {
        throw 'Upgrade source file set changed while the package was being staged.'
    }
    for ($index = 0; $index -lt $Before.files.Count; $index += 1) {
        if (
            $after.files[$index].relativePath -cne $Before.files[$index].relativePath -or
            $after.files[$index].hash -cne $Before.files[$index].hash
        ) {
            throw "Upgrade source changed while staging: $($Before.files[$index].relativePath)"
        }
    }
}

function Assert-InstalledFileSet([string]$Root, [object]$SourceSnapshot) {
    $allowedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in @(
        '.athena-wts-native-host.json',
        'athena-wts-native-host.cmd',
        'host-config.json',
        "$HostName.json"
    ) + @($SourceSnapshot.files.relativePath)) {
        [void]$allowedFiles.Add($item)
    }
    $allowedDirectories = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in @('runtime', 'runtime\src', 'contracts')) {
        [void]$allowedDirectories.Add($item)
    }
    foreach ($sourceFile in $SourceSnapshot.files) {
        $parent = Split-Path $sourceFile.relativePath -Parent
        while (-not [string]::IsNullOrWhiteSpace($parent)) {
            [void]$allowedDirectories.Add($parent)
            $next = Split-Path $parent -Parent
            if ($next -ceq $parent) { break }
            $parent = $next
        }
    }
    foreach ($entry in Get-SafeTreeEntries -Root $Root -Purpose 'installed native-host item') {
        Assert-CurrentUserOwner -Path $entry.fullPath -Purpose 'installed native-host item'
        Assert-AcceptableItemDacl -Path $entry.fullPath -Purpose 'installed native-host item'
        if ($entry.isDirectory) {
            if (-not $allowedDirectories.Contains($entry.relativePath)) {
                throw "Unexpected item in the owned ATHENA native-host installation: $($entry.relativePath)"
            }
        } elseif (-not $allowedFiles.Contains($entry.relativePath)) {
            throw "Unexpected item in the owned ATHENA native-host installation: $($entry.relativePath)"
        }
    }
}

function Assert-NoOwnedProcesses([string]$InstallRoot) {
    $owned = New-Object System.Collections.Generic.List[object]
    if ($TestMode -and $OwnedProcessId -gt 0) {
        $process = Get-Process -Id $OwnedProcessId -ErrorAction Stop
        $owned.Add([pscustomobject]@{ id = $process.Id; name = $process.ProcessName })
    } else {
        $prefix = (Resolve-NormalizedPath $InstallRoot) + [IO.Path]::DirectorySeparatorChar
        # Match the literal path on the provider; never retrieve process command lines.
        $pattern = $prefix.Replace('\', '\\').Replace("'", "\'").Replace('[', '[[]').Replace('%', '[%]').Replace('_', '[_]')
        $projection = 'SELECT ProcessId, ParentProcessId, Name FROM Win32_Process'
        try {
            $roots = @(Get-CimInstance -Query "$projection WHERE CommandLine LIKE '%$pattern%'" -ErrorAction Stop)
            $all = @($roots + @(Get-CimInstance -Query $projection -ErrorAction Stop) | Sort-Object ProcessId -Unique)
        } catch {
            throw 'Could not safely inspect ATHENA native-host processes.'
        }
        $rootIds = New-Object 'System.Collections.Generic.HashSet[uint32]'
        foreach ($process in $roots) {
            [void]$rootIds.Add([uint32]$process.ProcessId)
        }
        $changed = $true
        while ($changed) {
            $changed = $false
            foreach ($process in $all) {
                if ($rootIds.Contains([uint32]$process.ParentProcessId) -and -not $rootIds.Contains([uint32]$process.ProcessId)) {
                    [void]$rootIds.Add([uint32]$process.ProcessId)
                    $changed = $true
                }
            }
        }
        foreach ($process in $all) {
            if ($rootIds.Contains([uint32]$process.ProcessId)) {
                $owned.Add([pscustomobject]@{ id = [int]$process.ProcessId; name = [string]$process.Name })
            }
        }
    }
    if ($owned.Count -gt 0) {
        $summary = @($owned | Sort-Object id | ForEach-Object { "$($_.name) ($($_.id))" }) -join ', '
        throw "The owned ATHENA native host or one of its child processes is still running: $summary"
    }
}

function Escape-BatchValue([string]$Value) {
    return $Value.Replace('%', '%%')
}

$Destination = Resolve-NormalizedPath $Destination
$DataDirectory = Resolve-NormalizedPath $DataDirectory
$SourceRoot = Resolve-NormalizedPath $SourceRoot
$ManifestPath = Join-Path $Destination "$HostName.json"
$MarkerPath = Join-Path $Destination '.athena-wts-native-host.json'
$ConfigPath = Join-Path $Destination 'host-config.json'
$LauncherPath = Join-Path $Destination 'athena-wts-native-host.cmd'
$DestinationParent = Split-Path $Destination -Parent

if ($TestMode) {
    if ([string]::IsNullOrWhiteSpace($FixtureRoot)) {
        throw 'TestMode requires FixtureRoot.'
    }
    $FixtureRoot = Resolve-NormalizedPath $FixtureRoot
    $systemTempRoot = Resolve-NormalizedPath ([IO.Path]::GetTempPath())
    $fixtureLeaf = Split-Path $FixtureRoot -Leaf
    $actualHost = Resolve-NormalizedPath (Join-Path $env:USERPROFILE '.athena\WtsNativeHost')
    $actualData = Resolve-NormalizedPath (Join-Path $env:USERPROFILE '.athena\WtsData')
    if (
        $RegistrySubKey -cnotmatch $TestRegistryPattern -or
        -not (Test-PathInside $FixtureRoot $systemTempRoot) -or
        $fixtureLeaf -cnotmatch '^athena-wts-upgrade-[A-Za-z0-9_-]+$' -or
        -not (Test-PathInside $SourceRoot $FixtureRoot) -or
        -not (Test-PathInside $Destination $FixtureRoot) -or
        -not (Test-PathInside $DataDirectory $FixtureRoot) -or
        (Test-PathEqual $Destination $actualHost) -or
        (Test-PathEqual $DataDirectory $actualData)
    ) {
        throw 'TestMode is restricted to an isolated fixture workspace and test registry namespace.'
    }
} elseif (
    $RegistrySubKey -cne $ExpectedRegistrySubKey -or
    $OwnedProcessId -ne 0 -or
    $InjectFailure -cne 'None' -or
    -not [string]::IsNullOrWhiteSpace($FixtureRoot)
) {
    throw 'Test-only hooks cannot be used for a production native-host upgrade.'
}

if (
    (Test-PathEqual $Destination $DataDirectory) -or
    (Test-PathInside $DataDirectory $Destination) -or
    (Test-PathInside $Destination $DataDirectory)
) {
    throw 'DataDirectory and Destination must not contain one another.'
}
Assert-PhysicalItem -Path $SourceRoot -Purpose 'upgrade source root' -Directory
Assert-PhysicalItem -Path $DestinationParent -Purpose 'native-host destination parent' -Directory
Assert-PhysicalItem -Path $Destination -Purpose 'owned native-host destination' -Directory
Assert-PhysicalItem -Path $DataDirectory -Purpose 'stable WTS data directory' -Directory
Assert-AcceptableDirectoryDacl -Path $DestinationParent -Purpose 'native-host destination parent'
Assert-AcceptableDirectoryDacl -Path $Destination -Purpose 'native-host destination'
Assert-CurrentUserOwner -Path $Destination -Purpose 'native-host destination'
Assert-CurrentUserOwner -Path $DataDirectory -Purpose 'stable WTS data directory'

$backendProvided = $PSBoundParameters.ContainsKey('BackendRoot')
$pythonProvided = $PSBoundParameters.ContainsKey('PythonExecutable')
if ($backendProvided -ne $pythonProvided) {
    throw 'BackendRoot and PythonExecutable must be configured together.'
}
if (-not $backendProvided) {
    $BackendRoot = Join-Path $SourceRoot 'backend'
    $PythonExecutable = Join-Path $BackendRoot '.venv\Scripts\python.exe'
}
$BackendRoot = Resolve-NormalizedPath $BackendRoot
$PythonExecutable = Resolve-NormalizedPath $PythonExecutable
if ($TestMode -and (-not (Test-PathInside $BackendRoot $FixtureRoot) -or -not (Test-PathInside $PythonExecutable $FixtureRoot))) {
    throw 'TestMode backend paths must remain inside FixtureRoot.'
}
Assert-PhysicalItem -Path $BackendRoot -Purpose 'read-only backend root' -Directory
Assert-PhysicalItem -Path $PythonExecutable -Purpose 'read-only backend Python executable' -File
Assert-PhysicalItem -Path (Join-Path $BackendRoot 'athena_api\launcher.py') -Purpose 'read-only backend launcher' -File
Assert-PhysicalItem -Path (Join-Path $BackendRoot 'athena_api\readonly_app.py') -Purpose 'read-only backend application' -File

$sourceSnapshot = Get-SourceSnapshot -RepositoryRoot $SourceRoot
Assert-InstalledFileSet -Root $Destination -SourceSnapshot $sourceSnapshot
foreach ($required in @(
    $MarkerPath,
    $ManifestPath,
    $ConfigPath,
    $LauncherPath,
    (Join-Path $Destination 'runtime\package.json'),
    (Join-Path $Destination 'runtime\src\main.mjs'),
    (Join-Path $Destination 'contracts\wts-foundation.mjs'),
    (Join-Path $Destination 'contracts\wts-foundation.protocol.schema.json')
)) {
    Assert-PhysicalItem -Path $required -Purpose 'installed native-host control file' -File
    Assert-CurrentUserOwner -Path $required -Purpose 'installed native-host control file'
}
$installedSnapshot = @(Get-TreeStateSnapshot -Root $Destination -Purpose 'installed native-host snapshot')
$marker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
if (
    $marker.installedBy -cne 'athena-wts-local-runtime' -or
    $marker.hostName -cne $HostName -or
    -not (Test-PathEqual ([string]$marker.manifestPath) $ManifestPath) -or
    -not (Test-PathEqual ([string]$marker.dataDirectory) $DataDirectory)
) {
    throw 'Destination ownership marker does not match the requested native-host installation.'
}
if (
    $manifest.name -cne $HostName -or
    $manifest.type -cne 'stdio' -or
    -not (Test-PathEqual ([string]$manifest.path) $LauncherPath) -or
    @($manifest.allowed_origins).Count -ne 1 -or
    [string]@($manifest.allowed_origins)[0] -cne $ExpectedOrigin
) {
    throw 'The installed native-host manifest is not the expected stable single-origin manifest.'
}
if (
    $config.hostName -cne $HostName -or
    $config.allowedOrigin -cne $ExpectedOrigin -or
    -not (Test-PathEqual ([string]$config.dataDir) $DataDirectory)
) {
    throw 'The installed native-host configuration is not internally consistent.'
}
$configProperties = @($config.PSObject.Properties.Name)
foreach ($property in $configProperties) {
    if ($property -cnotin @('hostName', 'allowedOrigin', 'dataDir', 'backendRoot', 'pythonExecutable')) {
        throw "The installed native-host configuration contains an unknown property: $property"
    }
}

$launcherLines = @(Get-Content -LiteralPath $LauncherPath)
if (
    $launcherLines.Count -lt 3 -or
    $launcherLines[0] -cne '@echo off' -or
    $launcherLines[1] -cne ('set "ATHENA_WTS_HOST_CONFIG={0}"' -f $ConfigPath) -or
    $launcherLines[2] -cnotmatch '^"(?<node>[^"]+)"\s+"(?<entry>[^"]+)"\s+%\*$'
) {
    throw 'The installed native-host launcher is not the expected owned launcher.'
}
$NodePath = Resolve-NormalizedPath $Matches.node
$InstalledEntryPoint = Resolve-NormalizedPath $Matches.entry
if (-not (Test-PathEqual $InstalledEntryPoint (Join-Path $Destination 'runtime\src\main.mjs'))) {
    throw 'The installed native-host launcher entry point is inconsistent.'
}
Assert-NodeRuntimeIdentity -Path $NodePath -RequiredMajor $sourceSnapshot.nodeMajorFloor

$registryBefore = @(
    Get-RegistrySnapshot -View ([Microsoft.Win32.RegistryView]::Registry32)
    Get-RegistrySnapshot -View ([Microsoft.Win32.RegistryView]::Registry64)
)
foreach ($snapshot in $registryBefore) {
    if (-not (Test-PathEqual $snapshot.resolvedValue $ManifestPath)) {
        throw "The $($snapshot.view) HKCU registration does not point to the owned manifest."
    }
}
Assert-NoOwnedProcesses -InstallRoot $Destination

if (-not $Apply) {
    Assert-SourceSnapshotUnchanged -Before $sourceSnapshot -RepositoryRoot $SourceRoot
    Assert-RegistryUnchanged -Before $registryBefore -ManifestPath $ManifestPath
    [pscustomobject]@{
        mode = 'DryRun'
        hostName = $HostName
        allowedOrigin = $ExpectedOrigin
        destination = $Destination
        dataDirectory = $DataDirectory
        backendRoot = $BackendRoot
        pythonExecutable = $PythonExecutable
        packageVersion = $sourceSnapshot.packageVersion
        copiedFileCount = $sourceSnapshot.files.Count
        previousEntryCount = $installedSnapshot.Count
        filesWritten = $false
        registryUpdated = $false
        rollbackCreated = $false
    }
    return
}

$stagePath = Join-Path $DestinationParent ('.WtsNativeHost-stage-' + [guid]::NewGuid().ToString('N'))
$rollbackPath = Join-Path $DestinationParent ('.WtsNativeHost-rollback-' + [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N'))
$failedStagePath = Join-Path $DestinationParent ('.WtsNativeHost-failed-' + [guid]::NewGuid().ToString('N'))
$rollbackMetadataPath = "$rollbackPath.security"
foreach ($exchangePath in @($stagePath, $rollbackPath, $failedStagePath, $rollbackMetadataPath)) {
    if ((Test-PathEqual $exchangePath $DataDirectory) -or (Test-PathInside $exchangePath $DataDirectory) -or (Test-PathInside $DataDirectory $exchangePath)) {
        throw 'Stage, rollback, failed-artifact, and metadata paths must remain outside DataDirectory.'
    }
}

$originalRootSddl = Get-DirectorySddl $Destination
$stageSnapshot = $null
$failedArtifactPath = $null
try {
    New-PrivateDirectory -Path $stagePath -Purpose 'native-host upgrade stage'
    if ($TestMode -and $InjectFailure -ceq 'AfterStageCreated') {
        throw 'Injected failure after creating the protected native-host stage.'
    }
    foreach ($sourceFile in $sourceSnapshot.files) {
        $targetPath = Join-Path $stagePath $sourceFile.relativePath
        $targetParent = Split-Path $targetPath -Parent
        if (-not (Test-Path -LiteralPath $targetParent)) {
            New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
        }
        Assert-PhysicalItem -Path $targetParent -Purpose 'native-host stage directory' -Directory
        Copy-Item -LiteralPath $sourceFile.sourcePath -Destination $targetPath
        Assert-PhysicalItem -Path $targetPath -Purpose 'staged native-host file' -File
        if ((Get-FileSha256 $targetPath) -cne $sourceFile.hash) {
            throw "Staged file hash mismatch: $($sourceFile.relativePath)"
        }
    }

    $stageConfigPath = Join-Path $stagePath 'host-config.json'
    $stageManifestPath = Join-Path $stagePath "$HostName.json"
    $stageMarkerPath = Join-Path $stagePath '.athena-wts-native-host.json'
    $stageLauncherPath = Join-Path $stagePath 'athena-wts-native-host.cmd'
    $newConfig = [ordered]@{
        hostName = $HostName
        allowedOrigin = $ExpectedOrigin
        dataDir = $DataDirectory
        backendRoot = $BackendRoot
        pythonExecutable = $PythonExecutable
    }
    $newManifest = [ordered]@{
        name = $HostName
        description = 'ATHENA WTS local bounded screen-control runtime'
        path = $LauncherPath
        type = 'stdio'
        allowed_origins = @($ExpectedOrigin)
    }
    $newMarker = [ordered]@{
        installedBy = 'athena-wts-local-runtime'
        hostName = $HostName
        manifestPath = $ManifestPath
        dataDirectory = $DataDirectory
    }
    [IO.File]::WriteAllText($stageConfigPath, ($newConfig | ConvertTo-Json -Depth 4), $Utf8NoBom)
    [IO.File]::WriteAllText($stageManifestPath, ($newManifest | ConvertTo-Json -Depth 4), $Utf8NoBom)
    [IO.File]::WriteAllText($stageMarkerPath, ($newMarker | ConvertTo-Json -Depth 4), $Utf8NoBom)
    $launcher = @(
        '@echo off',
        ('set "ATHENA_WTS_HOST_CONFIG={0}"' -f (Escape-BatchValue $ConfigPath)),
        ('"{0}" "{1}" %*' -f (Escape-BatchValue $NodePath), (Escape-BatchValue (Join-Path $Destination 'runtime\src\main.mjs')))
    ) -join "`r`n"
    [IO.File]::WriteAllText($stageLauncherPath, "$launcher`r`n", $Utf8NoBom)
    foreach ($controlPath in @($stageConfigPath, $stageManifestPath, $stageMarkerPath, $stageLauncherPath)) {
        Assert-PhysicalItem -Path $controlPath -Purpose 'staged native-host control file' -File
    }

    Assert-InstalledFileSet -Root $stagePath -SourceSnapshot $sourceSnapshot
    Assert-PrivateDirectoryDacl -Path $stagePath -Purpose 'native-host upgrade stage'
    $stageSnapshot = @(Get-TreeStateSnapshot -Root $stagePath -Purpose 'complete staged native-host snapshot')
    $expectedStageFiles = @(
        @($sourceSnapshot.files.relativePath) + @(
            '.athena-wts-native-host.json',
            'athena-wts-native-host.cmd',
            'host-config.json',
            "$HostName.json"
        )
    ) | Sort-Object
    $actualStageFiles = @($stageSnapshot | Where-Object { $_.kind -ceq 'file' } | ForEach-Object { $_.relativePath }) | Sort-Object
    if (
        $actualStageFiles.Count -ne $expectedStageFiles.Count -or
        ($actualStageFiles -join '|') -cne ($expectedStageFiles -join '|')
    ) {
        throw 'The complete staged native-host file set does not match the frozen package allowlist.'
    }
    if ($TestMode -and $InjectFailure -ceq 'TamperStagedFile') {
        [IO.File]::AppendAllText((Join-Path $stagePath 'runtime\src\main.mjs'), "`n// injected tamper", $Utf8NoBom)
    }
    Assert-SourceSnapshotUnchanged -Before $sourceSnapshot -RepositoryRoot $SourceRoot
    Assert-TreeStateSnapshot -Root $stagePath -Before $stageSnapshot -Purpose 'complete staged native-host snapshot'
    Assert-TreeStateSnapshot -Root $Destination -Before $installedSnapshot -Purpose 'installed native-host snapshot'
    Assert-NoOwnedProcesses -InstallRoot $Destination
    Assert-RegistryUnchanged -Before $registryBefore -ManifestPath $ManifestPath
    if ($TestMode -and $InjectFailure -ceq 'BeforeExchange') {
        throw 'Injected failure before exchanging the native-host tree.'
    }

    [IO.Directory]::Move($Destination, $rollbackPath)
    Assert-TreeStateSnapshot -Root $rollbackPath -Before $installedSnapshot -Purpose 'preserved rollback snapshot'
    New-PrivateDirectory -Path $rollbackMetadataPath -Purpose 'native-host rollback metadata directory'
    $rollbackMetadataFile = Join-Path $rollbackMetadataPath 'security.json'
    $rollbackMetadata = [ordered]@{
        schemaVersion = 1
        destination = $Destination
        rollbackPath = $rollbackPath
        originalRootSddl = $originalRootSddl
        packageVersion = $sourceSnapshot.packageVersion
    }
    [IO.File]::WriteAllText(
        $rollbackMetadataFile,
        ($rollbackMetadata | ConvertTo-Json -Depth 4),
        $Utf8NoBom
    )
    Assert-PhysicalItem -Path $rollbackMetadataFile -Purpose 'native-host rollback security metadata' -File
    Set-PrivateDirectoryDacl -Path $rollbackPath -Purpose 'preserved native-host rollback tree'
    Assert-TreePayloadSnapshot `
        -Root $rollbackPath `
        -Before $installedSnapshot `
        -Purpose 'preserved rollback snapshot'
    Assert-PrivateTreeDacl -Root $rollbackPath -Purpose 'preserved native-host rollback tree'
    if ($TestMode -and $InjectFailure -ceq 'AfterOldMoved') {
        throw 'Injected failure after preserving the previous native-host tree.'
    }
    [IO.Directory]::Move($stagePath, $Destination)
    if ($TestMode -and $InjectFailure -ceq 'TamperInstalledFile') {
        [IO.File]::AppendAllText((Join-Path $Destination 'runtime\src\main.mjs'), "`n// injected installed tamper", $Utf8NoBom)
        throw 'Injected failure after tampering with the exchanged native-host tree.'
    }
    if ($TestMode -and $InjectFailure -ceq 'AfterNewMoved') {
        throw 'Injected failure after exchanging the native-host tree.'
    }

    Assert-PhysicalItem -Path $Destination -Purpose 'upgraded native-host destination' -Directory
    Assert-InstalledFileSet -Root $Destination -SourceSnapshot $sourceSnapshot
    Assert-PrivateDirectoryDacl -Path $Destination -Purpose 'upgraded native-host destination'
    Assert-TreeStateSnapshot -Root $Destination -Before $stageSnapshot -Purpose 'installed staged native-host snapshot'
    Assert-RegistryUnchanged -Before $registryBefore -ManifestPath $ManifestPath
} catch {
    $originalError = $_
    $rollbackErrors = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $rollbackPath -PathType Container) {
        if (Test-Path -LiteralPath $Destination -PathType Container) {
            try {
                [IO.Directory]::Move($Destination, $failedStagePath)
                $failedArtifactPath = $failedStagePath
                Assert-PrivateDirectoryDacl -Path $failedStagePath -Purpose 'failed native-host replacement artifact'
            } catch {
                $rollbackErrors.Add("preserve failed replacement: $($_.Exception.Message)")
            }
        } elseif (Test-Path -LiteralPath $stagePath -PathType Container) {
            try {
                [IO.Directory]::Move($stagePath, $failedStagePath)
                $failedArtifactPath = $failedStagePath
                Assert-PrivateDirectoryDacl -Path $failedStagePath -Purpose 'failed native-host stage artifact'
            } catch {
                $rollbackErrors.Add("preserve failed stage: $($_.Exception.Message)")
            }
        }
        if (-not (Test-Path -LiteralPath $Destination)) {
            try {
                Set-DirectorySddl -Path $rollbackPath -Sddl $originalRootSddl -Purpose 'native-host root'
                [IO.Directory]::Move($rollbackPath, $Destination)
                Assert-TreeStateSnapshot -Root $Destination -Before $installedSnapshot -Purpose 'restored native-host snapshot'
            } catch {
                $rollbackErrors.Add("restore previous installation: $($_.Exception.Message)")
            }
        }
    } elseif (Test-Path -LiteralPath $stagePath -PathType Container) {
        try {
            [IO.Directory]::Move($stagePath, $failedStagePath)
            $failedArtifactPath = $failedStagePath
            Assert-PrivateDirectoryDacl -Path $failedStagePath -Purpose 'failed native-host stage artifact'
        } catch {
            $rollbackErrors.Add("preserve failed stage: $($_.Exception.Message)")
        }
    }
    $failedArtifactVerified = $false
    if (
        -not [string]::IsNullOrWhiteSpace([string]$failedArtifactPath) -and
        $null -ne $stageSnapshot -and
        (Test-Path -LiteralPath $failedArtifactPath -PathType Container)
    ) {
        try {
            Assert-TreeStateSnapshot `
                -Root $failedArtifactPath `
                -Before $stageSnapshot `
                -Purpose 'retained failed native-host artifact'
            $failedArtifactVerified = $true
        } catch {
            $failedArtifactVerified = $false
        }
    }
    try {
        Assert-RegistryUnchanged -Before $registryBefore -ManifestPath $ManifestPath
    } catch {
        $rollbackErrors.Add("registry verification: $($_.Exception.Message)")
    }
    $failedArtifactReport = if ([string]::IsNullOrWhiteSpace([string]$failedArtifactPath)) {
        'none'
    } else {
        $failedArtifactPath
    }
    $metadataReport = if (Test-Path -LiteralPath $rollbackMetadataPath -PathType Container) {
        $rollbackMetadataPath
    } else {
        'none'
    }
    $verifiedReport = $failedArtifactVerified.ToString().ToLowerInvariant()
    if ($rollbackErrors.Count -gt 0) {
        throw "Native-host upgrade failed and rollback was incomplete. Original error: $($originalError.Exception.Message). Failed artifact: $failedArtifactReport. Failed artifact verified: $verifiedReport. Rollback metadata: $metadataReport. Rollback errors: $($rollbackErrors -join '; ')"
    }
    throw "Native-host upgrade failed; the previous installation and registry registration were restored. Failed artifact: $failedArtifactReport. Failed artifact verified: $verifiedReport. Rollback metadata: $metadataReport. $($originalError.Exception.Message)"
}

[pscustomobject]@{
    mode = 'Apply'
    hostName = $HostName
    allowedOrigin = $ExpectedOrigin
    destination = $Destination
    dataDirectory = $DataDirectory
    backendRoot = $BackendRoot
    pythonExecutable = $PythonExecutable
    packageVersion = $sourceSnapshot.packageVersion
    copiedFileCount = $sourceSnapshot.files.Count
    previousEntryCount = $installedSnapshot.Count
    stagedEntryCount = $stageSnapshot.Count
    filesWritten = $true
    registryUpdated = $false
    rollbackCreated = $true
    rollbackPath = $rollbackPath
    rollbackMetadataPath = $rollbackMetadataPath
}

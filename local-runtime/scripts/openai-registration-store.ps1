[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Operation,
    [Parameter(Mandatory = $true)]
    [string]$DataRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Utf8NoBomStrict = New-Object System.Text.UTF8Encoding($false, $true)
$RegistrationDirectoryName = 'openai-registration-v1'
$RegistrationFileName = 'registration.json'
$LockFileName = 'registration.lock'
$MaximumBytes = 4096
$LockDeadlineMilliseconds = 5000
$AllowedOperations = @('ensure-host', 'read', 'bind', 'reset')

function Stop-Registration([string]$Code) {
    $exception = New-Object System.InvalidOperationException($Code)
    $exception.Data['RegistrationCode'] = $Code
    throw $exception
}

if (-not ('AthenaRegistrationPhysicalPath.NativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace AthenaRegistrationPhysicalPath {
    public static class NativeMethods {
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint FILE_SHARE_DELETE = 0x00000004;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
            uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file, StringBuilder filePath, uint filePathSize, uint flags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool ReplaceFileW(
            string replacedFileName, string replacementFileName, string backupFileName,
            uint replaceFlags, IntPtr exclude, IntPtr reserved);

        public static string Resolve(string path) {
            using (SafeFileHandle handle = CreateFileW(
                path, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var buffer = new StringBuilder(1024);
                uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (length >= buffer.Capacity) {
                    buffer.Capacity = checked((int)length + 1);
                    length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
                    if (length == 0 || length >= buffer.Capacity) {
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    }
                }
                return buffer.ToString();
            }
        }

        public static void Replace(string target, string replacement) {
            const uint REPLACEFILE_WRITE_THROUGH = 0x00000001;
            if (!ReplaceFileW(target, replacement, null, REPLACEFILE_WRITE_THROUGH,
                    IntPtr.Zero, IntPtr.Zero)) {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }
        }
    }
}
'@
}

function Resolve-NormalizedPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value) -or
        -not [IO.Path]::IsPathRooted($Value) -or
        $Value -cnotmatch '^[A-Za-z]:[\\/]') {
        Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
    }
    try {
        $fullPath = [IO.Path]::GetFullPath($Value)
        $rootPath = [IO.Path]::GetPathRoot($fullPath)
    } catch {
        Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
    }
    if ([string]::Equals($fullPath, $rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath
    }
    return $fullPath.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
}

function Assert-FixedLocalDrive([string]$Path) {
    try {
        $root = [IO.Path]::GetPathRoot($Path)
        $drive = New-Object IO.DriveInfo($root)
        if ($drive.DriveType -ne [IO.DriveType]::Fixed) {
            Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
        }
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
    }
}

function ConvertFrom-DevicePath([string]$Value) {
    if ($Value.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
        return '\\' + $Value.Substring(8)
    }
    if ($Value.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) {
        return $Value.Substring(4)
    }
    return $Value
}

function Assert-PhysicalItem([string]$Path, [ValidateSet('Directory', 'File')] [string]$Kind) {
    try {
        if (-not (Test-Path -LiteralPath $Path)) {
            Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
        }
        if ($Kind -ceq 'Directory' -and -not (Test-Path -LiteralPath $Path -PathType Container)) {
            Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
        }
        if ($Kind -ceq 'File' -and -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
        }
        $item = Get-Item -LiteralPath $Path -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
        }
        $requested = Resolve-NormalizedPath $Path
        $physical = Resolve-NormalizedPath (ConvertFrom-DevicePath (
            [AthenaRegistrationPhysicalPath.NativeMethods]::Resolve($requested)))
        if (-not [string]::Equals($requested, $physical, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
        }
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_PATH_UNSAFE'
    }
}

function Get-CurrentUserSid() {
    return [Security.Principal.WindowsIdentity]::GetCurrent().User
}

function Get-ItemSecurity([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Container) {
        return [IO.Directory]::GetAccessControl($Path)
    }
    return [IO.File]::GetAccessControl($Path)
}

function Assert-CurrentUserOwner([string]$Path) {
    try {
        $owner = (Get-ItemSecurity $Path).GetOwner(
            [Security.Principal.SecurityIdentifier]).Value
        if ($owner -cne (Get-CurrentUserSid).Value) {
            Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
        }
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
    }
}

function Assert-AcceptableRootDacl([string]$Path) {
    Assert-CurrentUserOwner $Path
    try {
        $security = Get-ItemSecurity $Path
        if (-not $security.AreAccessRulesCanonical) {
            Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
        }
        $trusted = @((Get-CurrentUserSid).Value, 'S-1-5-18', 'S-1-5-32-544')
        $dangerous = [Security.AccessControl.FileSystemRights]::Write -bor
            [Security.AccessControl.FileSystemRights]::Delete -bor
            [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
            [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
            [Security.AccessControl.FileSystemRights]::TakeOwnership
        $rules = @($security.GetAccessRules($true, $true,
            [Security.Principal.SecurityIdentifier]))
        foreach ($rule in $rules) {
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                ($rule.FileSystemRights -band $dangerous) -ne 0 -and
                [string]$rule.IdentityReference.Value -cnotin $trusted) {
                Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
            }
        }
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
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
        [void]$security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        ))
    }
    return $security
}

function Assert-PrivateDacl([string]$Path, [switch]$Directory) {
    Assert-CurrentUserOwner $Path
    try {
        $security = Get-ItemSecurity $Path
        if (-not $security.AreAccessRulesCanonical -or ($Directory -and -not $security.AreAccessRulesProtected)) {
            Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
        }
        $expected = @((Get-CurrentUserSid).Value, 'S-1-5-18') | Sort-Object
        $rules = @($security.GetAccessRules($true, $true,
            [Security.Principal.SecurityIdentifier]))
        $actual = @($rules | ForEach-Object {
            if ($_.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
                $_.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
                Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
            }
            if ($Directory -and ($_.IsInherited -or
                $_.InheritanceFlags -ne (
                    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
                    [Security.AccessControl.InheritanceFlags]::ObjectInherit) -or
                $_.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None)) {
                Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
            }
            [string]$_.IdentityReference.Value
        } | Sort-Object)
        if ($actual.Count -ne $expected.Count -or ($actual -join '|') -cne ($expected -join '|')) {
            Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
        }
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_ACL_UNSAFE'
    }
}

function Assert-HostId([object]$Value) {
    if ($Value -isnot [string]) {
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
    if ([string]$Value -cmatch '^[A-Za-z0-9_-]{43}$') {
        try {
            $base64 = ([string]$Value).Replace('-', '+').Replace('_', '/') + '='
            $bytes = [Convert]::FromBase64String($base64)
            $canonical = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
            if ($bytes.Length -eq 32 -and $canonical -ceq [string]$Value) {
                Stop-Registration 'OPENAI_REGISTRATION_HOST_ID_UNSUPPORTED'
            }
        } catch {
            if ($_.Exception.Data['RegistrationCode']) { throw }
        }
    }
    if ([string]$Value -cnotmatch '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
}

function Assert-IssuedClientId([object]$Value, [string]$FailureCode) {
    if ($Value -isnot [string] -or
        [string]$Value -cnotmatch '^oaiapp_[A-Za-z0-9._~-]{1,249}$') {
        Stop-Registration $FailureCode
    }
}

function Assert-Binding([object]$Value, [string]$FailureCode) {
    if ($Value -isnot [string] -or [string]$Value -cnotmatch '^[0-9a-f]{64}$') {
        Stop-Registration $FailureCode
    }
}

function ConvertTo-DocumentJson([object]$Document) {
    $json = $Document | ConvertTo-Json -Compress
    if ($Utf8NoBomStrict.GetByteCount($json) -gt $MaximumBytes) {
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
    return $json
}

function Assert-ExactProperties([object]$Value, [string[]]$Expected, [string]$FailureCode) {
    if ($null -eq $Value -or $Value -is [Array]) { Stop-Registration $FailureCode }
    $actual = @($Value.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if ($actual.Count -ne $wanted.Count -or ($actual -join '|') -cne ($wanted -join '|')) {
        Stop-Registration $FailureCode
    }
}

function Read-BoundedInput() {
    $builder = New-Object Text.StringBuilder
    $buffer = New-Object char[] 1024
    while ($builder.Length -le ($MaximumBytes + 1)) {
        $count = [Console]::In.Read($buffer, 0, $buffer.Length)
        if ($count -eq 0) { break }
        [void]$builder.Append($buffer, 0, $count)
    }
    $raw = $builder.ToString()
    if ($Utf8NoBomStrict.GetByteCount($raw) -gt $MaximumBytes) {
        Stop-Registration 'OPENAI_REGISTRATION_REQUEST_INVALID'
    }
    return $raw
}

function Read-EmptyInput() {
    if ((Read-BoundedInput) -cne '') {
        Stop-Registration 'OPENAI_REGISTRATION_REQUEST_INVALID'
    }
}

function Read-ExactInput([string[]]$Expected) {
    $raw = Read-BoundedInput
    try { $value = $raw | ConvertFrom-Json } catch {
        Stop-Registration 'OPENAI_REGISTRATION_REQUEST_INVALID'
    }
    Assert-ExactProperties $value $Expected 'OPENAI_REGISTRATION_REQUEST_INVALID'
    if (($value | ConvertTo-Json -Compress) -cne $raw) {
        Stop-Registration 'OPENAI_REGISTRATION_REQUEST_INVALID'
    }
    return $value
}

function Read-Document([string]$Path) {
    Assert-PhysicalItem $Path 'File'
    Assert-PrivateDacl $Path
    try {
        $info = Get-Item -LiteralPath $Path -Force
        if ($info.Length -le 0 -or $info.Length -gt $MaximumBytes) {
            Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
        }
        $bytes = [IO.File]::ReadAllBytes($Path)
        $raw = $Utf8NoBomStrict.GetString($bytes)
        $value = $raw | ConvertFrom-Json
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
    Assert-ExactProperties $value @('version', 'hostId', 'issuedClientId', 'accountBindingSha256') `
        'OPENAI_REGISTRATION_CORRUPT'
    if ($value.version -isnot [int] -or $value.version -ne 1) {
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
    if ($value.hostId -isnot [string]) {
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
    Assert-HostId $value.hostId
    $unregistered = $null -eq $value.issuedClientId -and $null -eq $value.accountBindingSha256
    if (-not $unregistered) {
        if ($null -eq $value.issuedClientId -or $null -eq $value.accountBindingSha256) {
            Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
        }
        Assert-IssuedClientId $value.issuedClientId 'OPENAI_REGISTRATION_CORRUPT'
        Assert-Binding $value.accountBindingSha256 'OPENAI_REGISTRATION_CORRUPT'
    }
    if ((ConvertTo-DocumentJson $value) -cne $raw) {
        Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
    }
    return $value
}

function New-HostId() {
    return 'urn:uuid:' + [Guid]::NewGuid().ToString('D').ToLowerInvariant()
}

function Write-DocumentAtomically([string]$Directory, [string]$Target, [object]$Document) {
    $json = ConvertTo-DocumentJson $Document
    $bytes = $Utf8NoBomStrict.GetBytes($json)
    $temporary = Join-Path $Directory ('.registration-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $created = $false
    try {
        $stream = [IO.FileStream]::new(
            $temporary,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None,
            4096,
            [IO.FileOptions]::WriteThrough
        )
        $created = $true
        try {
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush($true)
        } finally {
            $stream.Dispose()
        }
        Assert-PhysicalItem $temporary 'File'
        Assert-PrivateDacl $temporary
        if (Test-Path -LiteralPath $Target) {
            Assert-PhysicalItem $Target 'File'
            Assert-PrivateDacl $Target
            [AthenaRegistrationPhysicalPath.NativeMethods]::Replace($Target, $temporary)
        } else {
            [IO.File]::Move($temporary, $Target)
        }
        $created = $false
        $verified = Read-Document $Target
        if ((ConvertTo-DocumentJson $verified) -cne $json) {
            Stop-Registration 'OPENAI_REGISTRATION_IO_FAILED'
        }
        return $verified
    } catch {
        if ($_.Exception.Data['RegistrationCode']) { throw }
        Stop-Registration 'OPENAI_REGISTRATION_IO_FAILED'
    } finally {
        if ($created -and (Test-Path -LiteralPath $temporary)) {
            try {
                Assert-PhysicalItem $temporary 'File'
                Assert-PrivateDacl $temporary
                [IO.File]::Delete($temporary)
            } catch {
                # Cleanup cannot replace the authoritative operation result.
            }
        }
    }
}

function Open-RegistrationLock([string]$Path) {
    $deadline = [Diagnostics.Stopwatch]::StartNew()
    while ($deadline.ElapsedMilliseconds -lt $LockDeadlineMilliseconds) {
        try {
            $stream = [IO.FileStream]::new(
                $Path,
                [IO.FileMode]::OpenOrCreate,
                [IO.FileAccess]::ReadWrite,
                [IO.FileShare]::None,
                1,
                [IO.FileOptions]::WriteThrough
            )
            if ($stream.Length -ne 0) {
                $stream.Dispose()
                Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
            }
            return $stream
        } catch [IO.IOException] {
            $win32 = $_.Exception.HResult -band 0xFFFF
            if ($win32 -ne 32 -and $win32 -ne 33) {
                Stop-Registration 'OPENAI_REGISTRATION_IO_FAILED'
            }
            Start-Sleep -Milliseconds 25
        } catch {
            if ($_.Exception.Data['RegistrationCode']) { throw }
            Stop-Registration 'OPENAI_REGISTRATION_IO_FAILED'
        }
    }
    Stop-Registration 'OPENAI_REGISTRATION_LOCK_TIMEOUT'
}

try {
    if ($Operation -cnotin $AllowedOperations) {
        Stop-Registration 'OPENAI_REGISTRATION_REQUEST_INVALID'
    }
    $inputValue = switch ($Operation) {
        'ensure-host' { Read-EmptyInput; $null }
        'read' { Read-EmptyInput; $null }
        'bind' { Read-ExactInput @('issuedClientId', 'accountBindingSha256') }
        'reset' { Read-ExactInput @('expectedIssuedClientId', 'expectedAccountBindingSha256') }
    }
    $DataRoot = Resolve-NormalizedPath $DataRoot
    Assert-FixedLocalDrive $DataRoot
    Assert-PhysicalItem $DataRoot 'Directory'
    Assert-AcceptableRootDacl $DataRoot
    $registrationDirectory = Join-Path $DataRoot $RegistrationDirectoryName
    if (-not (Test-Path -LiteralPath $registrationDirectory)) {
        if ($Operation -ceq 'read') {
            Stop-Registration 'OPENAI_REGISTRATION_NOT_FOUND'
        }
        try {
            [void][IO.Directory]::CreateDirectory(
                $registrationDirectory,
                (New-PrivateDirectorySecurity)
            )
        } catch {
            Stop-Registration 'OPENAI_REGISTRATION_IO_FAILED'
        }
    }
    Assert-PhysicalItem $registrationDirectory 'Directory'
    Assert-PrivateDacl $registrationDirectory -Directory

    $lockPath = Join-Path $registrationDirectory $LockFileName
    $registrationPath = Join-Path $registrationDirectory $RegistrationFileName
    if ($Operation -ceq 'read' -and -not (Test-Path -LiteralPath $lockPath)) {
        if (Test-Path -LiteralPath $registrationPath) {
            Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
        }
        Stop-Registration 'OPENAI_REGISTRATION_NOT_FOUND'
    }
    if (Test-Path -LiteralPath $lockPath) {
        Assert-PhysicalItem $lockPath 'File'
        Assert-PrivateDacl $lockPath
        if ((Get-Item -LiteralPath $lockPath -Force).Length -ne 0) {
            Stop-Registration 'OPENAI_REGISTRATION_CORRUPT'
        }
    }
    $lock = Open-RegistrationLock $lockPath
    try {
        Assert-PhysicalItem $DataRoot 'Directory'
        Assert-AcceptableRootDacl $DataRoot
        Assert-PhysicalItem $registrationDirectory 'Directory'
        Assert-PrivateDacl $registrationDirectory -Directory
        Assert-PhysicalItem $lockPath 'File'
        Assert-PrivateDacl $lockPath
        if ($lock.Length -ne 0) { Stop-Registration 'OPENAI_REGISTRATION_CORRUPT' }

        $exists = Test-Path -LiteralPath $registrationPath
        $document = if ($exists) { Read-Document $registrationPath } else { $null }

        switch ($Operation) {
            'read' {
                if (-not $exists) { Stop-Registration 'OPENAI_REGISTRATION_NOT_FOUND' }
            }
            'ensure-host' {
                if (-not $exists) {
                    $document = [ordered]@{
                        version = 1
                        hostId = New-HostId
                        issuedClientId = $null
                        accountBindingSha256 = $null
                    }
                    $document = Write-DocumentAtomically $registrationDirectory $registrationPath $document
                }
            }
            'bind' {
                if (-not $exists) { Stop-Registration 'OPENAI_REGISTRATION_NOT_FOUND' }
                Assert-IssuedClientId $inputValue.issuedClientId 'OPENAI_REGISTRATION_REQUEST_INVALID'
                Assert-Binding $inputValue.accountBindingSha256 'OPENAI_REGISTRATION_REQUEST_INVALID'
                if ($null -eq $document.issuedClientId -and $null -eq $document.accountBindingSha256) {
                    $document = [ordered]@{
                        version = 1
                        hostId = $document.hostId
                        issuedClientId = [string]$inputValue.issuedClientId
                        accountBindingSha256 = [string]$inputValue.accountBindingSha256
                    }
                    $document = Write-DocumentAtomically $registrationDirectory $registrationPath $document
                } elseif ($document.issuedClientId -cne [string]$inputValue.issuedClientId -or
                    $document.accountBindingSha256 -cne [string]$inputValue.accountBindingSha256) {
                    Stop-Registration 'OPENAI_REGISTRATION_BINDING_CONFLICT'
                }
            }
            'reset' {
                if (-not $exists) { Stop-Registration 'OPENAI_REGISTRATION_NOT_FOUND' }
                Assert-IssuedClientId $inputValue.expectedIssuedClientId `
                    'OPENAI_REGISTRATION_REQUEST_INVALID'
                Assert-Binding $inputValue.expectedAccountBindingSha256 `
                    'OPENAI_REGISTRATION_REQUEST_INVALID'
                if ($document.issuedClientId -cne [string]$inputValue.expectedIssuedClientId -or
                    $document.accountBindingSha256 -cne [string]$inputValue.expectedAccountBindingSha256) {
                    Stop-Registration 'OPENAI_REGISTRATION_RESET_CONFLICT'
                }
                $document = [ordered]@{
                    version = 1
                    hostId = $document.hostId
                    issuedClientId = $null
                    accountBindingSha256 = $null
                }
                $document = Write-DocumentAtomically $registrationDirectory $registrationPath $document
            }
        }
        [Console]::Out.Write((ConvertTo-DocumentJson $document))
    } finally {
        $lock.Dispose()
    }
} catch {
    $code = [string]$_.Exception.Data['RegistrationCode']
    if ([string]::IsNullOrWhiteSpace($code)) {
        $code = 'OPENAI_REGISTRATION_IO_FAILED'
    }
    [Console]::Out.Write((@{ code = $code } | ConvertTo-Json -Compress))
    exit 1
}

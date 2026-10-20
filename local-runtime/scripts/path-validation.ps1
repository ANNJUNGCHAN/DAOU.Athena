Set-StrictMode -Version Latest

if (-not ('AthenaPhysicalPath.NativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace AthenaPhysicalPath {
    public static class NativeMethods {
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint FILE_SHARE_DELETE = 0x00000004;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFileW(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile
        );

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandleW(
            SafeFileHandle file,
            StringBuilder filePath,
            uint filePathSize,
            uint flags
        );

        public static string Resolve(string path) {
            using (SafeFileHandle handle = CreateFileW(
                path,
                0,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                IntPtr.Zero,
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                IntPtr.Zero
            )) {
                if (handle.IsInvalid) {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }

                var buffer = new StringBuilder(1024);
                uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
                if (length == 0) {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
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
    }
}
'@
}

function ConvertFrom-AthenaDevicePath([string]$Path) {
    if ($Path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) {
        return '\\' + $Path.Substring(8)
    }
    if ($Path.StartsWith('\\?\', [StringComparison]::OrdinalIgnoreCase)) {
        return $Path.Substring(4)
    }
    return $Path
}

function Resolve-AthenaComparablePath([string]$Path) {
    $fullPath = [IO.Path]::GetFullPath((ConvertFrom-AthenaDevicePath $Path))
    $rootPath = [IO.Path]::GetPathRoot($fullPath)
    if ([string]::Equals($fullPath, $rootPath, [StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath
    }
    return $fullPath.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
}

function Get-AthenaPhysicalPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $requestedPath = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $requestedPath)) {
        throw "ATHENA physical-path validation requires an existing path: $requestedPath"
    }
    return Resolve-AthenaComparablePath ([AthenaPhysicalPath.NativeMethods]::Resolve($requestedPath))
}

function Assert-AthenaPhysicalPathMatch {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestedPath,
        [Parameter(Mandatory = $true)]
        [string]$PhysicalPath,
        [string]$Purpose = 'path'
    )

    $requested = Resolve-AthenaComparablePath $RequestedPath
    $physical = Resolve-AthenaComparablePath $PhysicalPath
    if (-not [string]::Equals($requested, $physical, [StringComparison]::OrdinalIgnoreCase)) {
        throw "ATHENA refused to use $Purpose '$requested' because Windows opened '$physical'. This indicates path redirection or a junction. Choose a non-redirected physical path such as USERPROFILE\.athena and retry; the native host was not registered."
    }
    return $physical
}

function Assert-AthenaPhysicalPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [string]$Purpose = 'path'
    )

    $requested = [IO.Path]::GetFullPath($Path)
    $physical = Get-AthenaPhysicalPath -Path $requested
    return Assert-AthenaPhysicalPathMatch -RequestedPath $requested -PhysicalPath $physical -Purpose $Purpose
}

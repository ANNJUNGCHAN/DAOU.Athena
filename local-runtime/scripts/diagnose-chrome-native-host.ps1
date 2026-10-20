[CmdletBinding()]
param(
    [ValidateSet('Plan', 'Launch', 'Collect')]
    [string]$Mode = 'Plan',
    [switch]$DryRun,
    [switch]$OpenWts,
    [string]$LogPath
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$WtsUrl = 'https://wts.kiwoom.com/'
$LogNamePattern = '^chrome-native-messaging-\d{8}-\d{6}-[0-9a-f]{32}\.log$'

if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    throw 'LOCALAPPDATA is required.'
}
if ($DryRun) {
    if ($Mode -eq 'Collect') {
        throw 'DryRun cannot be combined with Collect mode.'
    }
    $Mode = 'Plan'
}

function Resolve-StandardChromePath {
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        $candidates += (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')
    }
    if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
        $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
    }
    $candidates += (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Get-Item -LiteralPath $candidate).FullName
        }
    }
    throw 'A standard Google Chrome installation was not found.'
}

function Resolve-DiagnosticRoot {
    return [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Athena\WtsDiagnostics'))
}

function Resolve-OwnedLogPath([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'Collect mode requires -LogPath.'
    }
    $root = Resolve-DiagnosticRoot
    $fullPath = [IO.Path]::GetFullPath($Value)
    $parent = [IO.Path]::GetDirectoryName($fullPath)
    if (
        -not [string]::Equals($parent, $root, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($fullPath) -cnotmatch $LogNamePattern
    ) {
        throw 'LogPath must be an ATHENA Chrome diagnostic log under LOCALAPPDATA\Athena\WtsDiagnostics.'
    }
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
        throw "Diagnostic log does not exist: $fullPath"
    }
    return $fullPath
}

function Get-ChromeProcesses {
    return @(Get-Process -Name chrome -ErrorAction SilentlyContinue)
}

function New-DiagnosticLogPath([string]$Root) {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    return Join-Path $Root "chrome-native-messaging-$timestamp-$([Guid]::NewGuid().ToString('N')).log"
}

function New-ChromeArguments([string]$DiagnosticLogPath, [bool]$IncludeWts) {
    # Chrome 155 reports native-host discovery failures with plain LOG(WARNING).
    $arguments = @(
        '--enable-logging',
        ('--log-file="{0}"' -f $DiagnosticLogPath),
        '--log-level=1'
    )
    if ($IncludeWts) {
        $arguments += $WtsUrl
    }
    return $arguments
}

function Get-NativeMessagingEvidence([string]$Path) {
    $categories = @(
        [pscustomobject]@{
            code = 'HOST_MANIFEST_FILE_NOT_FOUND'
            pattern = "Failed to load manifest for native messaging host com\.athena\.wts(?![.\w-]): File doesn't exist\."
            meaning = 'Chrome resolved the com.athena.wts registration but could not find or read its manifest file.'
        },
        [pscustomobject]@{
            code = 'HOST_MANIFEST_NOT_FOUND'
            pattern = "Can't find manifest for native messaging host com\.athena\.wts(?![.\w-])"
            meaning = 'Chrome could not find a registered manifest for com.athena.wts.'
        },
        [pscustomobject]@{
            code = 'HOST_MANIFEST_FOUND'
            pattern = 'Found manifest for native messaging host com\.athena\.wts(?![.\w-]) at '
            meaning = 'Chrome discovered the com.athena.wts manifest.'
        },
        [pscustomobject]@{
            code = 'SPECIFIED_HOST_NOT_FOUND'
            pattern = '(?:Specified native messaging host not found|native messaging host.+(?:is not registered|was not found)).*(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost).*(?:Specified native messaging host not found|native messaging host.+(?:is not registered|was not found))'
            meaning = 'Chrome did not discover the requested native host registration or manifest.'
        },
        [pscustomobject]@{
            code = 'HOST_MANIFEST_INVALID'
            pattern = '(?:Failed to load manifest|Invalid name specified in the manifest).*(?:com\.athena\.wts(?:\.json)?(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?:\.json)?(?![.\w-])|Athena[\\/]WtsNativeHost).*(?:Failed to load manifest|Invalid name specified in the manifest)'
            meaning = 'Chrome resolved a native host manifest reference but could not read or validate it.'
        },
        [pscustomobject]@{
            code = 'HOST_ACCESS_FORBIDDEN'
            pattern = '(?:Access to the specified native messaging host is forbidden|native messaging host.+not allowed).*(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost).*(?:Access to the specified native messaging host is forbidden|native messaging host.+not allowed)'
            meaning = 'Chrome rejected the extension-to-host authorization.'
        },
        [pscustomobject]@{
            code = 'HOST_EXECUTABLE_NOT_FOUND'
            pattern = 'Found manifest, but not the binary.*(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost).*Found manifest, but not the binary'
            meaning = 'Chrome could not find the executable declared by the manifest.'
        },
        [pscustomobject]@{
            code = 'HOST_LAUNCH_FAILED'
            pattern = '(?:Failed to start native messaging host|native messaging host.+(?:failed to launch|launch failed)).*(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost).*(?:Failed to start native messaging host|native messaging host.+(?:failed to launch|launch failed))'
            meaning = 'Chrome discovered the host but could not start its process.'
        },
        [pscustomobject]@{
            code = 'HOST_COMMUNICATION_FAILED'
            pattern = '(?:Error when communicating with the native messaging host|native messaging host.+(?:communication|protocol).+(?:error|failed)).*(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost).*(?:Error when communicating with the native messaging host|native messaging host.+(?:communication|protocol).+(?:error|failed))'
            meaning = 'Chrome started the host but native-message communication failed.'
        },
        [pscustomobject]@{
            code = 'HOST_EXITED'
            pattern = '(?:Native messaging host.+(?:has exited|exited unexpectedly)|native message host has exited).*(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost)|(?:com\.athena\.wts(?![.\w-])|Athena[\\/]WtsNativeHost).*(?:Native messaging host.+(?:has exited|exited unexpectedly)|native message host has exited)'
            meaning = 'The native host process exited after launch.'
        },
        [pscustomobject]@{
            code = 'OTHER_HOST_MANIFEST_NOT_FOUND'
            pattern = "Can't find manifest for native messaging host "
            meaning = 'Chrome could not find a manifest for another requested native host name.'
        },
        [pscustomobject]@{
            code = 'OTHER_HOST_MANIFEST_FOUND'
            pattern = 'Found manifest for native messaging host '
            meaning = 'Chrome discovered a manifest for another requested native host name.'
        },
        [pscustomobject]@{
            code = 'UNSCOPED_NATIVE_MESSAGING_ERROR'
            pattern = 'Specified native messaging host not found|Access to the specified native messaging host is forbidden|Failed to start native messaging host|Error when communicating with the native messaging host|Native messag(?:e|ing) host.+(?:has exited|exited unexpectedly)|Failed to load manifest|Invalid name specified in the manifest|Found manifest, but not the binary'
            meaning = 'Chrome logged a native-messaging error without enough context to attribute it safely to com.athena.wts.'
        }
    )
    $counts = @{}
    $firstLines = @{}
    $lineNumber = 0
    $stream = $null
    $reader = $null
    try {
        $stream = New-Object IO.FileStream(
            $Path,
            [IO.FileMode]::Open,
            [IO.FileAccess]::Read,
            [IO.FileShare]::ReadWrite
        )
        $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            $lineNumber += 1
            foreach ($category in $categories) {
                if ($line -match $category.pattern) {
                    if (-not $counts.ContainsKey($category.code)) {
                        $counts[$category.code] = 0
                        $firstLines[$category.code] = $lineNumber
                    }
                    $counts[$category.code] += 1
                    break
                }
            }
        }
    } finally {
        if ($null -ne $reader) {
            $reader.Dispose()
        } elseif ($null -ne $stream) {
            $stream.Dispose()
        }
    }
    return @(
        $categories |
            Where-Object { $counts.ContainsKey($_.code) } |
            ForEach-Object {
                [pscustomobject]@{
                    code = $_.code
                    count = $counts[$_.code]
                    firstLine = $firstLines[$_.code]
                    meaning = $_.meaning
                }
            }
    )
}

$diagnosticRoot = Resolve-DiagnosticRoot

if ($Mode -eq 'Collect') {
    if ($OpenWts) {
        throw 'OpenWts is only valid in Launch mode.'
    }
    $resolvedLogPath = Resolve-OwnedLogPath $LogPath
    $evidence = @(Get-NativeMessagingEvidence $resolvedLogPath)
    [pscustomobject]@{
        mode = 'Collect'
        logPath = $resolvedLogPath
        evidenceCount = $evidence.Count
        evidence = $evidence
        rawLogShared = $false
        note = if ($evidence.Count -eq 0) {
            'No recognized native-messaging error category was found. The full Chrome log remains local.'
        } else {
            'Only recognized native-messaging categories are shown. The full Chrome log remains local.'
        }
    } | ConvertTo-Json -Depth 5
    return
}

if (-not [string]::IsNullOrWhiteSpace($LogPath)) {
    throw 'LogPath is only valid in Collect mode.'
}

$chromePath = Resolve-StandardChromePath
$chromeProcesses = @(Get-ChromeProcesses)
$diagnosticLogPath = New-DiagnosticLogPath $diagnosticRoot
$chromeArguments = @(New-ChromeArguments $diagnosticLogPath ([bool]$OpenWts))
if ($Mode -eq 'Plan') {
    [pscustomobject]@{
        mode = 'Plan'
        chromePath = $chromePath
        chromeRunning = ($chromeProcesses.Count -gt 0)
        wouldOpenWts = [bool]$OpenWts
        diagnosticDirectory = $diagnosticRoot
        logPath = $diagnosticLogPath
        chromeArguments = $chromeArguments
        filesWritten = $false
        browserLaunched = $false
    }
    return
}

if ($chromeProcesses.Count -gt 0) {
    throw 'Chrome is running. Close every Chrome window, wait for Chrome to exit, and run this diagnostic again. This script never closes Chrome for you.'
}

New-Item -ItemType Directory -Force -Path $diagnosticRoot | Out-Null

$process = Start-Process -FilePath $chromePath -ArgumentList $chromeArguments -PassThru
[pscustomobject]@{
    mode = 'Launch'
    chromePath = $chromePath
    processId = $process.Id
    logPath = $diagnosticLogPath
    openedWts = [bool]$OpenWts
    nextStep = 'In Chrome, reproduce the ATHENA native-host connection error. Keep Chrome open and run Collect with this exact logPath.'
}

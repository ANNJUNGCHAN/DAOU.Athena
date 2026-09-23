# Called by the NSIS installer and uninstaller. Paths are environment values,
# never PowerShell source code. Exit codes: 0 = selected, 1 = none, 2 = unsafe.
param([Parameter(Mandatory)][ValidateSet('Find', 'Close', 'Force')][string]$Action)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
  $installRoot = [IO.Path]::GetFullPath($env:ATHENA_INSTALLER_PROCESS_ROOT).TrimEnd('\')
  $rootExecutable = [IO.Path]::Combine($installRoot, 'Athena.exe')
  $rootPrefix = $installRoot + '\'
  $statePath = $env:ATHENA_INSTALLER_PROCESS_STATE
  $installerProcessId = [int]$env:ATHENA_INSTALLER_PROCESS_PID
  if (-not $statePath -or $installerProcessId -le 0) { throw 'Missing installer context' }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $comparison = [StringComparison]::OrdinalIgnoreCase
  $snapshot = @(Get-CimInstance -ClassName Win32_Process)
  $owned = @{}
  foreach ($entry in $snapshot) {
    if (-not $entry.ExecutablePath -or $entry.ProcessId -eq $installerProcessId) { continue }
    if (-not $entry.ExecutablePath.StartsWith($rootPrefix, $comparison)) { continue }
    $owner = Invoke-CimMethod -InputObject $entry -MethodName GetOwnerSid
    if ($owner.ReturnValue -ne 0) { throw 'Cannot identify candidate process owner' }
    if ($owner.Sid -ne $currentSid) { continue }
    try {
      $native = [Diagnostics.Process]::GetProcessById([int]$entry.ProcessId)
      try { $started = $native.StartTime.ToUniversalTime().Ticks.ToString() }
      finally { $native.Dispose() }
    } catch [ArgumentException] { continue } # exited since the snapshot
    catch [InvalidOperationException] { continue }
    $owned[[string]$entry.ProcessId] = [pscustomobject]@{
      Id = [int]$entry.ProcessId
      Parent = [int]$entry.ParentProcessId
      Path = [string]$entry.ExecutablePath
      Started = $started
    }
  }

  $selected = @{}
  foreach ($entry in $owned.Values) {
    if ($entry.Path.Equals($rootExecutable, $comparison)) { $selected[[string]$entry.Id] = $entry }
  }
  # Keep the identities of owned children after their parent exits gracefully.
  # A reused PID is not sufficient: start time and executable must still match.
  if (Test-Path -LiteralPath $statePath) {
    $saved = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not ([string]$saved.Root).Equals($installRoot, $comparison)) { throw 'Installation context changed' }
    foreach ($identity in $saved.Processes) {
      $entry = $owned[[string]$identity.Id]
      if ($entry -and $entry.Started -eq $identity.Started -and $entry.Path.Equals([string]$identity.Path, $comparison)) {
        $selected[[string]$entry.Id] = $entry
      }
    }
  }
  do {
    $added = $false
    foreach ($entry in $owned.Values) {
      $parent = $selected[[string]$entry.Parent]
      if ($parent -and -not $selected.ContainsKey([string]$entry.Id) -and [long]$parent.Started -le [long]$entry.Started) {
        $selected[[string]$entry.Id] = $entry
        $added = $true
      }
    }
  } while ($added)
  [pscustomobject]@{ Root = $installRoot; Processes = @($selected.Values) } |
    ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8

  if ($selected.Count -eq 0) { exit 1 }
  if ($Action -ne 'Find') {
    foreach ($entry in $selected.Values) {
      try {
        $native = [Diagnostics.Process]::GetProcessById($entry.Id)
        try {
          if ($native.StartTime.ToUniversalTime().Ticks.ToString() -ne $entry.Started) { continue }
          if (-not $native.MainModule.FileName.Equals($entry.Path, $comparison)) { throw 'Process executable changed' }
          if ($Action -eq 'Close') { [void]$native.CloseMainWindow() }
          else { $native.Kill() }
        } catch {
          if ($native.HasExited) { continue }
          throw
        } finally { $native.Dispose() }
      } catch [ArgumentException] { continue } # already exited
    }
  }
  exit 0
} catch {
  # Failure must block installation, never fall back to name-wide taskkill.
  [Console]::Error.WriteLine('Athena process verification failed. Close Athena and retry.')
  exit 2
}

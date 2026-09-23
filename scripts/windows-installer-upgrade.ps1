param([Parameter(Mandatory)][ValidateSet('Inspect', 'Preserve', 'VerifyRemoved')][string]$Action)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Read-InstallValue([string]$Key, [string]$Name) {
  if (-not $Key) { return '' }
  $entry = $registry.OpenSubKey($Key)
  if (-not $entry) { return '' }
  try { return [string]$entry.GetValue($Name, '') } finally { $entry.Dispose() }
}

function Assert-FullyQualifiedPath([string]$Path) {
  if ($Path -notmatch '^[A-Za-z]:[\\/]' -and $Path -notmatch '^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)') {
    throw 'Installation path is not fully qualified'
  }
}

function Assert-InstallRoot([string]$Root) {
  Assert-FullyQualifiedPath $Root
  $normalized = [IO.Path]::GetFullPath($Root).TrimEnd('\')
  if ($normalized -eq [IO.Path]::GetPathRoot($normalized).TrimEnd('\')) { throw 'Drive/share root' }
  $profile = [Environment]::GetFolderPath('UserProfile')
  $roaming = [Environment]::GetFolderPath('ApplicationData')
  $local = [Environment]::GetFolderPath('LocalApplicationData')
  foreach ($container in @($profile, $roaming, $local)) {
    if ($normalized.Equals($container.TrimEnd('\'), $comparison)) { throw 'Profile root' }
  }
  foreach ($data in @((Join-Path $profile '.athena'), (Join-Path $roaming 'Athena'), (Join-Path $roaming 'athena-shell'))) {
    if ($normalized.Equals($data, $comparison) -or $normalized.StartsWith($data + '\', $comparison)) { throw 'User data directory' }
  }
  $directory = [IO.DirectoryInfo]::new($normalized)
  if (-not $directory.Exists) { throw 'Previous installation is missing' }
  for ($ancestor = $directory; $null -ne $ancestor; $ancestor = $ancestor.Parent) {
    if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse installation path' }
  }
  foreach ($marker in @('Athena.exe', 'Uninstall Athena.exe', 'resources\app\package.json')) {
    $file = [IO.FileInfo]::new((Join-Path $normalized $marker))
    if (-not $file.Exists -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Missing installation identity' }
  }
  $package = Get-Content -LiteralPath (Join-Path $normalized 'resources\app\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($package.name -ne 'athena-shell') { throw 'Not an Athena installation' }
  return $normalized
}

function Get-PreviousInstall {
  $uninstall = Read-InstallValue $primaryKey 'UninstallString'
  if (-not $uninstall) { $uninstall = Read-InstallValue $secondaryKey 'UninstallString' }
  $location = Read-InstallValue $installKey 'InstallLocation'
  if (-not $uninstall) {
    if ($location) { throw 'Installation registration has no uninstaller' }
    return ''
  }
  # Accept the pinned builder's quoted executable and optional per-user flag.
  # No registered command is ever executed, even after it passes this check.
  if ($uninstall -notmatch '^\s*"([^"\r\n]+)"(?:\s+/currentuser)?\s*$') { throw 'Invalid uninstall registration' }
  $registeredExecutable = $Matches[1]
  Assert-FullyQualifiedPath $registeredExecutable
  $registeredExecutable = [IO.Path]::GetFullPath($registeredExecutable)
  if (-not $location) { $location = [IO.Path]::GetDirectoryName($registeredExecutable) }
  $root = Assert-InstallRoot $location
  if (-not $registeredExecutable.Equals((Join-Path $root 'Uninstall Athena.exe'), $comparison)) { throw 'Uninstall tuple mismatch' }
  return $root
}

function Write-Result([string]$Root, [string]$Backup = '', [string]$Receipt = '') {
  [IO.File]::WriteAllText($resultPath, "[upgrade]`r`nRoot=$Root`r`nBackup=$Backup`r`nReceipt=$Receipt`r`n", [Text.Encoding]::Unicode)
}

try {
  $comparison = [StringComparison]::OrdinalIgnoreCase
  $installKey = $env:ATHENA_UPGRADE_INSTALL_KEY
  $primaryKey = $env:ATHENA_UPGRADE_UNINSTALL_KEY
  $secondaryKey = $env:ATHENA_UPGRADE_UNINSTALL_KEY_2
  $resultPath = $env:ATHENA_UPGRADE_RESULT
  if (-not $installKey -or -not $primaryKey -or -not $resultPath) { throw 'Missing upgrade context' }
  # Athena's supported installer is per-user x64. Never inspect or mutate HKLM.
  $registry = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::Registry64)
  try {
    if ($Action -eq 'VerifyRemoved') {
      foreach ($key in @($primaryKey, $secondaryKey, $installKey)) {
        if (-not $key) { continue }
        $entry = $registry.OpenSubKey($key)
        if ($entry) { $entry.Dispose(); throw 'Previous registration remains' }
      }
      exit 0
    }
    $root = Get-PreviousInstall
    if ($Action -eq 'Inspect') {
      if ($root) {
        $backup = $root + '.Athena-upgrade-backup-' + [Guid]::NewGuid().ToString('N')
        Write-Result $root $backup ($backup + '.txt')
      } else { Write-Result '' }
      if ($root) { exit 0 } else { exit 1 }
    }
    if (-not $root -or -not $root.Equals($env:ATHENA_UPGRADE_EXPECTED_ROOT, $comparison)) { throw 'Previous installation changed' }
    $backup = $env:ATHENA_UPGRADE_BACKUP
    $backupPrefix = $root + '.Athena-upgrade-backup-'
    if (-not $backup -or -not $backup.StartsWith($backupPrefix, $comparison) -or $backup.Substring($backupPrefix.Length) -notmatch '^[0-9a-f]{32}$') { throw 'Invalid planned backup' }
    $receipt = $backup + '.txt'
    if ([IO.Directory]::Exists($backup) -or [IO.File]::Exists($backup) -or [IO.File]::Exists($receipt)) { throw 'Backup collision' }
    # Moving the whole directory preserves mixed-use/nested files. Never infer
    # that unknown contents are disposable, and never automatically prune it.
    [IO.Directory]::Move($root, $backup)
    try {
      $stream = [IO.File]::Open($receipt, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
      $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($true))
      try {
        $writer.WriteLine("Athena 업데이트 백업`r`n이전 설치 위치: $root`r`n보존된 폴더: $backup`r`n`r`n기존 설치와 포함된 모든 사용자 파일을 위 폴더에 보존했습니다.`r`n이 백업은 자동으로 삭제되지 않습니다. 새 버전을 설치한 뒤에도 이전 설치 용량이 유지됩니다.`r`n새 설치가 실패하면 보존된 파일로 복구할 수 있습니다. 설치가 자동으로 복구된 것은 아닙니다.")
      } finally { $writer.Dispose() }
      Write-Result $root $backup $receipt
    } catch {
      # Restore the old directory if receipt/result creation failed. If another
      # process prevents restoration, retain the backup and any receipt intact.
      if (-not [IO.Directory]::Exists($root)) {
        [IO.Directory]::Move($backup, $root)
        if ([IO.File]::Exists($receipt)) { [IO.File]::Delete($receipt) }
      }
      throw
    }
  } finally { $registry.Dispose() }
  exit 0
} catch {
  [Console]::Error.WriteLine('Athena upgrade validation or preservation failed. Existing registration was not cleared by this helper.')
  exit 2
}

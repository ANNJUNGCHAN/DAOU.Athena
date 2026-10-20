param(
    [Parameter(Mandatory = $true)]
    [string]$RegistryPath,
    [Parameter(Mandatory = $true)]
    [string]$ExpectedValue
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (Test-Path -LiteralPath $RegistryPath) {
    throw 'Temporary registry test key already exists.'
}

. (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\registry.ps1')
try {
    Set-AthenaRegistryDefaultValue -Path $RegistryPath -Value $ExpectedValue
    (Get-Item -LiteralPath $RegistryPath).GetValue('')
} finally {
    if (Test-Path -LiteralPath $RegistryPath) {
        Remove-Item -LiteralPath $RegistryPath -Recurse -Force
    }
}

function Set-AthenaRegistryDefaultValue {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    New-Item -Path $Path -Force | Out-Null
    Set-Item -LiteralPath $Path -Value $Value
    $writtenValue = (Get-Item -LiteralPath $Path).GetValue('')
    if (-not [string]::Equals($writtenValue, $Value, [StringComparison]::Ordinal)) {
        throw 'Registry default value verification failed.'
    }
}

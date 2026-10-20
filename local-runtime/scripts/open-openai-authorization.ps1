[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Utf8NoBomStrict = New-Object System.Text.UTF8Encoding($false, $true)

function Fail-Exit {
    try {
        $bytes = $Utf8NoBomStrict.GetBytes("ATHENA_OPENAI_LAUNCH_FAILED`n")
        [Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
    } catch {}
    exit 1
}

try {
    $stdin = [Console]::OpenStandardInput()
    $buffer = New-Object byte[] 8193
    $bytesRead = 0
    while ($true) {
        $read = $stdin.Read($buffer, $bytesRead, $buffer.Length - $bytesRead)
        if ($read -le 0) { break }
        $bytesRead += $read
        if ($bytesRead -gt 8192) {
            Fail-Exit
        }
    }
    if ($bytesRead -eq 0 -or $buffer[$bytesRead - 1] -ne 0x0A) {
        Fail-Exit
    }
    for ($i = 0; $i -lt $bytesRead - 1; $i++) {
        if ($buffer[$i] -eq 0x0D -or $buffer[$i] -eq 0x0A) {
            Fail-Exit
        }
    }
    $urlBytes = New-Object byte[] ($bytesRead - 1)
    [Array]::Copy($buffer, $urlBytes, $bytesRead - 1)
    $url = $Utf8NoBomStrict.GetString($urlBytes)

    if ([string]::IsNullOrWhiteSpace($url)) {
        Fail-Exit
    }

    $uri = $null
    if (-not [System.Uri]::TryCreate($url, [System.UriKind]::Absolute, [ref]$uri) -or $uri -eq $null) {
        Fail-Exit
    }

    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'auth.openai.com' -or $uri.Port -ne 443) {
        Fail-Exit
    }
    if ($uri.AbsolutePath -ne '/api/accounts/authorize') {
        Fail-Exit
    }
    if (-not [string]::IsNullOrEmpty($uri.UserInfo) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
        Fail-Exit
    }

    $rawQuery = $uri.Query
    if (-not $rawQuery.StartsWith('?')) {
        Fail-Exit
    }
    $pairs = $rawQuery.Substring(1).Split('&')
    $queryMap = [Collections.Generic.Dictionary[string, string]]::new(
        [StringComparer]::Ordinal)
    function ConvertFrom-FormComponent([string]$value) {
        try {
            # application/x-www-form-urlencoded decodes '+' before percent escapes.
            # This keeps an encoded %2B as a literal plus while turning raw '+' into space.
            return [System.Uri]::UnescapeDataString($value.Replace('+', ' '))
        } catch {
            Fail-Exit
        }
    }
    foreach ($pair in $pairs) {
        if ([string]::IsNullOrEmpty($pair)) { Fail-Exit }
        $kv = $pair.Split('=')
        if ($kv.Length -ne 2) { Fail-Exit }
        $key = ConvertFrom-FormComponent $kv[0]
        $val = ConvertFrom-FormComponent $kv[1]
        if ($queryMap.ContainsKey($key)) { Fail-Exit }
        $queryMap.Add($key, $val)
    }

    $clientId = $queryMap['client_id']
    if ([string]::IsNullOrEmpty($clientId)) { Fail-Exit }

    $isDynamic = ($clientId -eq 'dynamic_agent_client')
    $isOaiApp = ($clientId -match '^oaiapp_[A-Za-z0-9._~-]{1,249}$')
    if (-not $isDynamic -and -not $isOaiApp) { Fail-Exit }

    if ($isDynamic) {
        if ($queryMap.Count -ne 11) { Fail-Exit }
        if ($queryMap['agent_name_hint'] -ne 'ATHENA') { Fail-Exit }
    } else {
        if ($queryMap.Count -ne 10) { Fail-Exit }
        if ($queryMap.ContainsKey('agent_name_hint')) { Fail-Exit }
    }

    if ($queryMap['response_type'] -ne 'code') { Fail-Exit }
    if ($queryMap['code_challenge_method'] -ne 'S256') { Fail-Exit }
    if ($queryMap['resource'] -ne 'https://api.openai.com/v1') { Fail-Exit }
    if ($queryMap['scope'] -ne 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct') { Fail-Exit }

    $redirect = $queryMap['redirect_uri']
    if ($redirect -notmatch '^http://127\.0\.0\.1:([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])/auth/callback$') {
        Fail-Exit
    }

    function Test-Base64Url32([string]$val) {
        if ($val -notmatch '^[A-Za-z0-9_-]{43}$') { return $false }
        try {
            $base64 = $val.Replace('-', '+').Replace('_', '/')
            switch ($base64.Length % 4) {
                2 { $base64 += '==' }
                3 { $base64 += '=' }
            }
            $decoded = [System.Convert]::FromBase64String($base64)
            if ($decoded.Length -ne 32) { return $false }
            $reencoded = [System.Convert]::ToBase64String($decoded).TrimEnd('=').Replace('+', '-').Replace('/', '_')
            return ($reencoded -eq $val)
        } catch {
            return $false
        }
    }

    function Test-HostId([object]$val) {
        return ($val -is [string] -and
            [string]$val -cmatch '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    }

    if (-not (Test-Base64Url32 $queryMap['state'])) { Fail-Exit }
    if (-not (Test-Base64Url32 $queryMap['nonce'])) { Fail-Exit }
    if (-not (Test-Base64Url32 $queryMap['code_challenge'])) { Fail-Exit }
    if (-not (Test-HostId $queryMap['ext_agent_host_id'])) { Fail-Exit }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $url
    $psi.UseShellExecute = $true
    [System.Diagnostics.Process]::Start($psi) | Out-Null

    $successBytes = $Utf8NoBomStrict.GetBytes("ATHENA_OPENAI_LAUNCH_ACCEPTED`n")
    [Console]::OpenStandardOutput().Write($successBytes, 0, $successBytes.Length)
    exit 0
} catch {
    Fail-Exit
}

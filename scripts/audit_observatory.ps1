param(
    [string]$Python = (Join-Path $PSScriptRoot '../.venv/Scripts/python.exe'),
    [string]$Since,
    [Nullable[int]]$Baseline,
    [switch]$VerifyFilters,
    [string]$Output = ('observatory-audit/' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.json')
)

$ErrorActionPreference = 'Stop'
$savraRoot = Split-Path -Parent $PSScriptRoot
$savraPrivate = (Resolve-Path -LiteralPath (Join-Path $savraRoot '.local/neon')).Path
$savraRun = (Get-Content -LiteralPath (Join-Path $savraPrivate 'active-run.json') -Raw | ConvertFrom-Json).directory
$savraRun = (Resolve-Path -LiteralPath $savraRun).Path
if (-not $savraRun.StartsWith($savraPrivate + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Directorio privado inesperado.'
}
$savraIdentity = Get-Content -LiteralPath (Join-Path $savraRun 'target-identity.json') -Raw | ConvertFrom-Json
$savraAuthorization = Get-Content -LiteralPath (Join-Path $savraRun 'restore-authorization.json') -Raw | ConvertFrom-Json
$savraPrevious = $env:SAVRA_AUDIT_DSN
$savraPreviousHost = $env:SAVRA_AUDIT_HOST
$savraPreviousDatabase = $env:SAVRA_AUDIT_DATABASE
$savraSecure = $null
try {
    if (-not $env:SAVRA_AUDIT_DSN) {
        $savraSecure = ConvertTo-SecureString ((Get-Content -LiteralPath (Join-Path $savraRun 'neon.dpapi') -Raw).Trim())
        $savraUri = [UriBuilder]::new([Net.NetworkCredential]::new('', $savraSecure).Password)
        $savraHost = [string]$savraIdentity.expected_host
        if ($savraUri.Host -eq $savraHost.Insert($savraHost.IndexOf('.'), '-pooler')) { $savraUri.Host = $savraHost }
        $env:SAVRA_AUDIT_DSN = $savraUri.Uri.AbsoluteUri
    }
    $env:SAVRA_AUDIT_HOST = $savraIdentity.expected_host
    $env:SAVRA_AUDIT_DATABASE = $savraAuthorization.database
    $savraArgs = @('--output', $Output)
    if ($Since) { $savraArgs += @('--since', $Since) }
    if ($null -ne $Baseline) { $savraArgs += @('--baseline', $Baseline) }
    if ($VerifyFilters) { $savraArgs += '--verify-filters' }
    Push-Location $savraRoot
    try {
        & $Python (Join-Path $PSScriptRoot 'audit_observatory.py') @savraArgs
        exit $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    $env:SAVRA_AUDIT_DSN = $savraPrevious
    $env:SAVRA_AUDIT_HOST = $savraPreviousHost
    $env:SAVRA_AUDIT_DATABASE = $savraPreviousDatabase
    if ($savraSecure) { $savraSecure.Dispose() }
}

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('SaveCredential','Preflight','Verify','Restore')][string]$Action,
    [switch]$ConfirmRestore
)
$ErrorActionPreference = 'Stop'
$savraRoot = Split-Path -Parent $PSScriptRoot
$savraRun = (Get-Content -LiteralPath (Join-Path $savraRoot '.local/neon/active-run.json') -Raw | ConvertFrom-Json).directory
$savraRun = [IO.Path]::GetFullPath($savraRun)
$savraPrivateRoot = [IO.Path]::GetFullPath((Join-Path $savraRoot '.local/neon')) + [IO.Path]::DirectorySeparatorChar
if (-not $savraRun.StartsWith($savraPrivateRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Directorio privado inesperado' }
$savraCredential = Join-Path $savraRun 'neon.dpapi'
if ($Action -eq 'SaveCredential') {
    $savraSecure = Read-Host 'Conexión DIRECTA nueva de Neon, con TLS (no se mostrará)' -AsSecureString
    if ($savraSecure.Length -lt 32) { throw 'La conexión está incompleta' }
    $savraSecure | ConvertFrom-SecureString | Set-Content -LiteralPath $savraCredential -Encoding utf8
    $savraSecure.Dispose()
    Write-Output 'Conexión guardada cifrada con DPAPI para este usuario de Windows. No se realizó conexión ni restauración.'
    exit 0
}
if (-not (Test-Path -LiteralPath $savraCredential)) { throw 'Falta la conexión local cifrada. Ejecute primero -Action SaveCredential.' }
$savraEncrypted = (Get-Content -LiteralPath $savraCredential -Raw).Trim()
$savraSecure = ConvertTo-SecureString -String $savraEncrypted
$savraPrevious = $env:NEON_DATABASE_URL
try {
    $env:NEON_DATABASE_URL = [Net.NetworkCredential]::new('', $savraSecure).Password
    $savraIdentity = Get-Content -LiteralPath (Join-Path $savraRun 'target-identity.json') -Raw | ConvertFrom-Json
    $savraUri = [UriBuilder]::new($env:NEON_DATABASE_URL)
    $savraExpectedHost = [string]$savraIdentity.expected_host
    $savraFirstDot = $savraExpectedHost.IndexOf('.')
    $savraPooledHost = $savraExpectedHost.Insert($savraFirstDot, '-pooler')
    if ($savraUri.Host -eq $savraPooledHost) {
        $savraUri.Host = $savraExpectedHost
        $env:NEON_DATABASE_URL = $savraUri.Uri.AbsoluteUri
        Write-Output 'Se usará exclusivamente el endpoint DIRECTO equivalente del proyecto confirmado; las credenciales permanecen en memoria.'
    }
    if ($savraUri.Host -ne $savraExpectedHost) { throw 'El endpoint no coincide con el proyecto confirmado; procedimiento detenido.' }
    $savraPython = Join-Path $savraRoot '.venv/Scripts/python.exe'
    Push-Location $savraRoot
    try {
        if ($Action -eq 'Preflight') {
            & $savraPython scripts/neon_preflight.py --run-directory $savraRun
        } elseif ($Action -eq 'Verify') {
            $savraSource = Get-Content -LiteralPath (Join-Path $savraRun 'source-after.json') -Raw | ConvertFrom-Json
            & $savraPython scripts/database_manifest.py --database-env NEON_DATABASE_URL --expect-responses $savraSource.tables.responses.count --expect-answers $savraSource.tables.answers.count --compare (Join-Path $savraRun 'source-after.json') --output (Join-Path $savraRun 'target.json')
        } else {
            if (-not $ConfirmRestore) { throw 'Restauración requiere autorización expresa y -ConfirmRestore.' }
            $savraRunningServices = & docker compose ps --status running --services
            if ($savraRunningServices -contains 'frontend') { throw 'El formulario local debe permanecer detenido durante la migración.' }
            $savraCompatibility = Get-Content -LiteralPath (Join-Path $savraRoot '.local/neon/pg17-to-pg18-test.json') -Raw | ConvertFrom-Json
            if (-not $savraCompatibility.passed -or $savraCompatibility.real_data_used -or $savraCompatibility.target_server -ne '18.6') { throw 'Falta el ensayo aislado satisfactorio de PostgreSQL 17 a 18.' }
            $savraSource = Get-Content -LiteralPath (Join-Path $savraRun 'source-after.json') -Raw | ConvertFrom-Json
            & $savraPython scripts/database_manifest.py --local-compose --expect-responses $savraSource.tables.responses.count --expect-answers $savraSource.tables.answers.count --compare (Join-Path $savraRun 'source-after.json')
            if ($LASTEXITCODE -ne 0) { throw 'El origen cambió desde el respaldo; no restaurar.' }
            $savraHash = (Get-Content -LiteralPath (Join-Path $savraRun 'archive.sha256') -Raw).Trim()
            & $savraPython scripts/restore_neon.py (Join-Path $savraRun 'savra-neon.dump') --confirm-empty-neon --expected-sha256 $savraHash --preflight (Join-Path $savraRun 'target-preflight.json')
        }
        if ($LASTEXITCODE -ne 0) { throw 'Comprobación u operación detenida; no continúe con restauración o publicación.' }
    } finally { Pop-Location }
} finally {
    if ($null -eq $savraPrevious) { Remove-Item Env:NEON_DATABASE_URL -ErrorAction SilentlyContinue } else { $env:NEON_DATABASE_URL = $savraPrevious }
    $savraSecure.Dispose()
}

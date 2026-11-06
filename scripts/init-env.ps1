$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $targetPath) { Write-Output '.env ya existe; se conserva sin cambios.'; exit 0 }
function New-SecretHex([int]$length) {
  $secretBytes = New-Object byte[] $length
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $generator.GetBytes($secretBytes)
  $generator.Dispose()
  return ([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()
}
$content = Get-Content -Raw -LiteralPath (Join-Path $projectRoot '.env.example')
$content = $content.Replace('POSTGRES_PASSWORD=GENERATE_WITH_INIT_SCRIPT', 'POSTGRES_PASSWORD=' + (New-SecretHex 24))
$content = $content.Replace('CONSENT_SECRET=GENERATE_WITH_INIT_SCRIPT', 'CONSENT_SECRET=' + (New-SecretHex 32))
$content = $content.Replace('FINGERPRINT_SECRET=GENERATE_WITH_INIT_SCRIPT', 'FINGERPRINT_SECRET=' + (New-SecretHex 32))
[System.IO.File]::WriteAllText($targetPath, $content, (New-Object System.Text.UTF8Encoding $false))
Write-Output '.env creado. Conserve FINGERPRINT_SECRET para mantener la deduplicación.'

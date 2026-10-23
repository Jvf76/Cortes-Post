$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $envPath) {
    Write-Host '.env existente preservado.'
    exit 0
}
function New-RandomBase64([int] $size) {
    $bytes = New-Object byte[] $size
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
$template = Get-Content -LiteralPath (Join-Path $projectRoot '.env.example') -Raw
$dbPassword = (New-RandomBase64 24).Replace('+', 'A').Replace('/', 'B').TrimEnd('=')
$sessionKey = New-RandomBase64 48
$tokenKey = (New-RandomBase64 32).Replace('+', '-').Replace('/', '_')
$template = $template.Replace('POSTGRES_PASSWORD=', "POSTGRES_PASSWORD=$dbPassword")
$template = $template.Replace('SECRET_KEY=', "SECRET_KEY=$sessionKey")
$template = $template.Replace('TOKEN_ENCRYPTION_KEY=', "TOKEN_ENCRYPTION_KEY=$tokenKey")
[IO.File]::WriteAllText($envPath, $template, (New-Object Text.UTF8Encoding $false))
Write-Host '.env criado com segredos locais aleatorios. Nenhuma chave externa foi configurada.'

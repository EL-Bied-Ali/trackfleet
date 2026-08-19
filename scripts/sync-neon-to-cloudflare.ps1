param(
  [string]$VercelEnvFile = ".env.vercel.production",
  [string]$CloudflareEnvFile = ".env.cloudflare"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $VercelEnvFile)) {
  throw "$VercelEnvFile was not found. Pull the Vercel production environment first."
}
if (-not (Test-Path $CloudflareEnvFile)) {
  throw "$CloudflareEnvFile was not found."
}

$line = Get-Content $VercelEnvFile | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is missing from $VercelEnvFile." }

$value = ($line -replace '^DATABASE_URL=', '').Trim()
if ($value.Length -ge 2) {
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2).Trim()
  }
}
if (-not $value) { throw "DATABASE_URL is empty." }

$current = @(Get-Content $CloudflareEnvFile)
$found = $false
$updated = foreach ($entry in $current) {
  if ($entry -match '^DATABASE_URL=') {
    $found = $true
    "DATABASE_URL=$value"
  } else {
    $entry
  }
}
if (-not $found) { $updated += "DATABASE_URL=$value" }
$updated | Set-Content $CloudflareEnvFile

Write-Host "DATABASE_URL synchronized into $CloudflareEnvFile without printing the secret."

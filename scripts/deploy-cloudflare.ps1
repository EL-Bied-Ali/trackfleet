param(
  [ValidateSet("d1", "postgres")]
  [string]$Storage = "d1"
)

$ErrorActionPreference = "Stop"

$previousStorage = $env:TRACKFLEET_STORAGE
try {
  if ($Storage -eq "postgres") {
    $env:TRACKFLEET_STORAGE = "postgres"
  } else {
    Remove-Item Env:TRACKFLEET_STORAGE -ErrorAction SilentlyContinue
  }

  Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force .wrangler\deploy -ErrorAction SilentlyContinue
  $env:WRANGLER_LOG_PATH = ".wrangler/wrangler.log"

  Write-Host "Building TrackFleet for Cloudflare with storage mode: $Storage"
  pnpm exec vinext build
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare build failed." }

  Write-Host "Deploying TrackFleet Worker without overwriting stored secrets..."
  pnpm dlx wrangler@4.124.0 deploy
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare deployment failed." }
} finally {
  if ($null -eq $previousStorage) {
    Remove-Item Env:TRACKFLEET_STORAGE -ErrorAction SilentlyContinue
  } else {
    $env:TRACKFLEET_STORAGE = $previousStorage
  }
}

# ============================================================================
# start-db.ps1 - Start the local PostgreSQL server (idempotent)
# ----------------------------------------------------------------------------
# Locates PostgreSQL via PG_BIN / PGDATA env vars, falling back to the standard
# scoop install layout, then starts the server with pg_ctl. If it is already
# running, this is a no-op.
#
# Can be dot-sourced (`. .\start-db.ps1`) to expose $pgBin / $pgData to the
# caller (used by rebuild-local.ps1).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\db\start-db.ps1
# ============================================================================

# Locate the PostgreSQL binary directory.
if (-not $pgBin) {
  $pgBin = $env:PG_BIN
}
if (-not $pgBin) {
  $candidate = Join-Path $env:USERPROFILE "scoop\apps\postgresql\current\bin"
  if (Test-Path (Join-Path $candidate "pg_ctl.exe")) { $pgBin = $candidate }
}

# Locate the data directory (PG_VERSION marks an initialized cluster).
if (-not $pgData) {
  $pgData = $env:PGDATA
}
if (-not $pgData) {
  $candidate = Join-Path $env:USERPROFILE "scoop\persist\postgresql\data"
  if (Test-Path (Join-Path $candidate "PG_VERSION")) { $pgData = $candidate }
}

if (-not $pgBin -or -not (Test-Path (Join-Path $pgBin "pg_ctl.exe"))) {
  throw "PostgreSQL binaries not found. Install with 'scoop install postgresql' or set PG_BIN."
}
if (-not $pgData -or -not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
  throw "PostgreSQL data directory not found. Initialize one or set PGDATA."
}

$env:PATH = "$pgBin;$env:PATH"
$logFile = Join-Path $pgData "pg-server.log"

& "$pgBin\pg_ctl.exe" status -D $pgData 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Host "[start-db] PostgreSQL already running (data: $pgData)." -ForegroundColor Green
} else {
  & "$pgBin\pg_ctl.exe" start -D $pgData -l $logFile -w | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL failed to start. Check the log: $logFile"
  }
  Write-Host "[start-db] PostgreSQL started (log: $logFile)." -ForegroundColor Green
}

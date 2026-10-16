# ============================================================================
# stop-db.ps1 - Stop the local PostgreSQL server (idempotent)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\db\stop-db.ps1
# ============================================================================

. (Join-Path $PSScriptRoot "start-db.ps1")

& "$pgBin\pg_ctl.exe" stop -D $pgData -w 2>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "[stop-db] PostgreSQL stopped." -ForegroundColor Yellow
} else {
  Write-Host "[stop-db] PostgreSQL was not running." -ForegroundColor Yellow
}

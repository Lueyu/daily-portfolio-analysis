# ============================================================================
# rebuild-local.ps1 - Build the local PostgreSQL database from scratch
# ----------------------------------------------------------------------------
# Idempotent: creates the database if missing, drops and recreates the
# workspace schema, applies tables + roles, then imports the real data snapshot
# from db/snapshot/*.sql. Safe to run repeatedly.
#
# Prerequisites:
#   - PostgreSQL installed (scoop install postgresql)
#   - A snapshot present in db/snapshot/ (exported from the Miaoda app)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\db\rebuild-local.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = Join-Path $here "..\.."

# Ensure server is running and inherit $pgBin / $pgData from start-db.ps1.
. (Join-Path $here "start-db.ps1")

$env:PGCLIENTENCODING = "UTF8"
$env:PGCONNECTTIMEOUT = "5"

$db = if ($env:PGDATABASE) { $env:PGDATABASE } else { "portfolio" }
$schema = "workspace_aadkwdme7deas"
$psql = Join-Path $pgBin "psql.exe"
$common = @("-U", "postgres", "-h", "127.0.0.1", "-d", $db, "-v", "ON_ERROR_STOP=1")

# 1) Create the database if it does not exist yet.
$exists = & $psql -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'"
if ("$exists".Trim() -ne "1") {
  Write-Host "[rebuild] Creating database '$db' ..." -ForegroundColor Cyan
  & $psql -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE $db" | Out-Null
}

# 2) Recreate schema, types, tables, indexes, roles.
Write-Host "[rebuild] Dropping and recreating schema '$schema' ..." -ForegroundColor Cyan
# client_min_messages=WARNING silences the noisy "drop cascades to ..." NOTICEs
# (PowerShell renders native stderr as red text even though they are benign).
& $psql @common -c "SET client_min_messages TO WARNING; DROP SCHEMA IF EXISTS $schema CASCADE;" | Out-Null
& $psql @common -f (Join-Path $here "01_init.sql")
& $psql @common -f (Join-Path $here "02_tables.sql")
& $psql @common -f (Join-Path $here "03_roles.sql")

# 3) Import the real data snapshot in FK order (groups before holdings).
$snapshotDir = Join-Path $root "db\snapshot"
$order = @("groups", "holdings", "transactions", "watchlist", "analysis", "journal", "snapshots")
Write-Host "[rebuild] Importing snapshot from $snapshotDir ..." -ForegroundColor Cyan
foreach ($t in $order) {
  $file = Join-Path $snapshotDir "$t.sql"
  if (Test-Path $file) {
    & $psql @common -q -f $file
    Write-Host ("  imported {0,-14} (exit {1})" -f $t, $LASTEXITCODE) -ForegroundColor DarkGray
  } else {
    Write-Warning "  snapshot file missing, skipped: $t.sql"
  }
}

# 4) Report row counts.
& $psql @common -q -c "ANALYZE;" | Out-Null
Write-Host ""
Write-Host "[rebuild] Row counts:" -ForegroundColor Green
& $psql @common -c "SELECT relname AS table, n_live_tup AS rows FROM pg_stat_user_tables WHERE schemaname='$schema' ORDER BY relname;"

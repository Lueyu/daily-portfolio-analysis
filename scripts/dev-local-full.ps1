# ============================================================================
# dev-local-full.ps1 - One-click LOCAL fullstack with REAL DATA
# ----------------------------------------------------------------------------
# 1) Ensures the local PostgreSQL server is running.
# 2) Opens the NestJS backend (connected to the local DB snapshot) on :3000.
# 3) Opens the Vite frontend (proxies /api -> :3000) on :8080.
#
# First-time setup (once):
#   scoop install postgresql
#   (export your data snapshot into db/snapshot/)
#   powershell -ExecutionPolicy Bypass -File scripts\db\rebuild-local.ps1
#
# Then every time:
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local-full.ps1
#   open http://127.0.0.1:8080
#
# To stop, close the two windows (or run scripts\db\stop-db.ps1 for Postgres).
# ============================================================================

$ErrorActionPreference = "Stop"
$scripts = $PSScriptRoot
$dbScripts = Join-Path $scripts "db"

# 1) Make sure the local PostgreSQL server is up (idempotent).
& (Join-Path $dbScripts "start-db.ps1")

# 2) Backend (connected to local PostgreSQL) then frontend.
$backend = Join-Path $scripts "dev-local-db.ps1"
$frontend = Join-Path $scripts "dev-local-client.ps1"

Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$backend`"")
Write-Host "Starting backend on :3000 (local PostgreSQL) ..." -ForegroundColor Cyan
Start-Sleep -Seconds 10
Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$frontend`"")
Write-Host "Starting frontend on :8080 ..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Backend API : http://127.0.0.1:3000" -ForegroundColor Green
Write-Host "Open in     : http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "(First Vite build takes a few seconds; refresh if the page is blank.)" -ForegroundColor Yellow

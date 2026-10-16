# ============================================================================
# dev-local-all.ps1 — One-click LOCAL fullstack (backend + frontend)
# ----------------------------------------------------------------------------
# Opens TWO new PowerShell windows:
#   1) backend  : NestJS minimal mode on http://127.0.0.1:3000 (no DB)
#   2) frontend : Vite on http://127.0.0.1:8080 (proxies /api -> :3000)
#
# Then open http://127.0.0.1:8080 in your browser.
#
# Notes:
#   - DB-backed / login pages need the real platform env (see dev-local.js);
#     in this minimal mode market-data works while holdings/transactions/
#     journal may show errors or empty.
#   - To stop, close the two windows (or Ctrl+C inside each).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local-all.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
$scripts = $PSScriptRoot

$backend = Join-Path $scripts "dev-local-minimal.ps1"
$frontend = Join-Path $scripts "dev-local-client.ps1"

Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$backend`"")
Write-Host "Starting backend on :3000 ..." -ForegroundColor Cyan
Start-Sleep -Seconds 8
Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$frontend`"")
Write-Host "Starting frontend on :8080 ..." -ForegroundColor Cyan
Start-Sleep -Seconds 2

Write-Host ""
Write-Host "Backend API : http://127.0.0.1:3000" -ForegroundColor Green
Write-Host "Open in     : http://127.0.0.1:8080" -ForegroundColor Green
Write-Host "(First Vite build takes a few seconds; refresh if the page is blank.)" -ForegroundColor Yellow

# ============================================================================
# dev-local-client.ps1 — Minimal LOCAL frontend (Vite) for fullstack dev
# ----------------------------------------------------------------------------
# Serves the React SPA on http://127.0.0.1:8080 and proxies /api (and the
# text/html page request) to the NestJS backend on port 3000.
#
# IMPORTANT: start the backend FIRST (dev-local-minimal.ps1).
#
# Why MIAODA_APP_TYPE=3: the Vite preset only enables the fullstack dev-proxy
# (csrf + suda-webuser injection, /api proxy, HBS html entry) when
# MIAODA_APP_TYPE === '3' (the fullstack archType). The official dev.sh sets
# this; we set it explicitly here so the same project runs without the
# platform CLI.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local-client.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$env:NODE_ENV = "development"
$env:MIAODA_APP_TYPE = "3"
$env:CLIENT_DEV_HOST = "127.0.0.1"
$env:CLIENT_DEV_PORT = "8080"
$env:SERVER_PORT = "3000"

Write-Host "[dev-local-client] Vite on http://127.0.0.1:8080 (proxying /api -> 127.0.0.1:3000)" -ForegroundColor Cyan
npx vite --config vite.config.ts

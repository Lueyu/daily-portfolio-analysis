# ============================================================================
# dev-local-minimal.ps1 — Minimal LOCAL backend for stock-agent development
# ----------------------------------------------------------------------------
# Boots the NestJS backend WITHOUT the aPaaS platform credentials / database.
# This is enough for the public market-data endpoints used by the Python agent
# on M0 (e.g. GET /api/quote/batch). DB-backed and login-required endpoints will
# NOT work in this mode (holdings, transactions, journal, ...).
#
# For the FULL platform environment (real DB + auth, cloud sandbox), run the
# official launcher instead:  npm run dev   (requires `lark-cli` + env-pull)
#
# Why these env vars are needed (learned on M0 Day 2):
#   FORCE_AUTHN_INNERAPI_DOMAIN  PlatformHttpClientService hardcodes
#                                platform.enabled=true and needs a base domain at
#                                construction. We give a placeholder that public
#                                endpoints never call.
#   FORCE_AUTHN_ACCESS_KEY/SECRET
#                                Placeholder AK/SK so the JWT plugin builds with
#                                no token (never used by public endpoints).
#   DEPRECATED_SKIP_INIT_DB_CONNECTION=true
#                                Official datapaas escape hatch: onModuleInit
#                                skips creating the real DB connection.
#   DISABLE_CSRF=true            Turns off the browser double-token CSRF guard
#                                via PlatformModule.forRoot({ enableCsrf }).
#                                The agent is not a browser; it authenticates
#                                with x-agent-token through the Day 3 gateway.
#   SERVER_HOST=127.0.0.1        Bind IPv4 (bare "localhost" binds IPv6 ::1 here).
#
# Usage (from the project root or anywhere):
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local-minimal.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$env:NODE_ENV = "development"
$env:SERVER_HOST = "127.0.0.1"
$env:SERVER_PORT = "3000"
$env:FORCE_AUTHN_INNERAPI_DOMAIN = "http://127.0.0.1:9999"
$env:FORCE_AUTHN_ACCESS_KEY = "localdev"
$env:FORCE_AUTHN_ACCESS_SECRET = "localdev"
$env:DEPRECATED_SKIP_INIT_DB_CONNECTION = "true"
$env:DISABLE_CSRF = "true"

Write-Host "[dev-local-minimal] starting NestJS on http://127.0.0.1:3000 (no DB, no platform auth)" -ForegroundColor Cyan
npx nest start

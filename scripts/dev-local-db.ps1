# ============================================================================
# dev-local-db.ps1 - LOCAL backend connected to a LOCAL PostgreSQL snapshot
# ----------------------------------------------------------------------------
# Same NestJS backend as dev-local-minimal.ps1, but instead of skipping the DB
# it connects to a local PostgreSQL that already contains the real data
# exported from Miaoda (see scripts/db/). So DB-backed pages work offline:
# holdings, transactions, watchlist, journal, snapshots, analysis, ...
#
# It also:
#   - starts the local PostgreSQL server if it is not running (idempotent),
#   - resolves LOCAL_DEV_USER_ID automatically (the owner with the most
#     holdings) when that variable is not already set, so no personal id is
#     hard-coded in this file.
#
# Prerequisites (one-time / whenever you want a fresh snapshot):
#   1. PostgreSQL installed (scoop install postgresql).
#   2. Run scripts/db/rebuild-local.ps1 (creates db + schema + roles + imports).
#
# Env vars:
#   SUDA_DATABASE_URL   The aPaaS datapaas module reads this connection string;
#                       ?schema=<workspace> is used as the roleSchema suffix
#                       (SET LOCAL ROLE service_role_<schema> ...).
#   LOCAL_DEV_USER_ID   Optional; override to view a different account.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\dev-local-db.ps1
# ============================================================================

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# Local database coordinates (must match scripts/db/*.sql).
$dbName = "portfolio"
$schema = "workspace_aadkwdme7deas"

# Ensure local PostgreSQL is running and reuse $pgBin from start-db.ps1.
. (Join-Path $PSScriptRoot "db\start-db.ps1")

$env:NODE_ENV = "development"
$env:SERVER_HOST = "127.0.0.1"
$env:SERVER_PORT = "3000"
$env:FORCE_AUTHN_INNERAPI_DOMAIN = "http://127.0.0.1:9999"
$env:FORCE_AUTHN_ACCESS_KEY = "localdev"
$env:FORCE_AUTHN_ACCESS_SECRET = "localdev"
$env:DISABLE_CSRF = "true"
$env:SUDA_DATABASE_URL = "postgres://postgres@127.0.0.1:5432/$dbName" + "?schema=$schema"
# Use the real DB pool (this is a "full" mode, unlike the minimal script).
Remove-Item Env:DEPRECATED_SKIP_INIT_DB_CONNECTION -ErrorAction SilentlyContinue
Remove-Item Env:FORCE_FRAMEWORK_DISABLE_DATAPASS -ErrorAction SilentlyContinue

# Resolve the local identity so @NeedLogin() routes work without a gateway.
# Use LOCAL_DEV_USER_ID if provided; otherwise auto-detect the owner that has
# the most holdings in the snapshot (row-level isolation then hides every other
# account, exactly as in the cloud).
if (-not $env:LOCAL_DEV_USER_ID) {
  $psql = Join-Path $pgBin "psql.exe"
  $detectSql = 'SELECT (owner).user_id FROM "' + $schema + '".holdings ' +
    'GROUP BY (owner).user_id ORDER BY count(*) DESC LIMIT 1'
  $detected = & $psql -U postgres -h 127.0.0.1 -d $dbName -tAc $detectSql 2>$null
  if ($detected) { $env:LOCAL_DEV_USER_ID = "$detected".Trim() }
}
if (-not $env:LOCAL_DEV_USER_ID) {
  throw "No LOCAL_DEV_USER_ID and no owner detected in the snapshot. Run scripts/db/rebuild-local.ps1 first, or set LOCAL_DEV_USER_ID."
}

Write-Host "[dev-local-db] local identity (owner): $($env:LOCAL_DEV_USER_ID)" -ForegroundColor DarkGray

# Service-to-service Python agent gateway (/openapi/agent-gateway).
# The token must match WEBAPP_AGENT_TOKEN in agent/.env; the default acting user
# is the same locally detected owner. These stay local-only (no real secret).
$env:AGENT_GATEWAY_ENABLED = "true"
$env:AGENT_GATEWAY_TOKEN = "dev-agent-token-change-me"
$env:AGENT_GATEWAY_DEFAULT_USER_ID = "$($env:LOCAL_DEV_USER_ID)"

Write-Host "[dev-local-db] starting NestJS on http://127.0.0.1:3000 with LOCAL PostgreSQL" -ForegroundColor Cyan
npx nest start

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
  # 非正常关闭后，PG 启动会先做崩溃恢复并 fsync 整个数据目录（Windows 上可能
  # 30s 以上）。pg_ctl -w 偶尔在服务器真正 ready 前就报超时退出，因此这里 start
  # 后再用 `pg_ctl status` 轮询兜底，只认实际状态，避免“其实已就绪却报失败”。
  & "$pgBin\pg_ctl.exe" start -D $pgData -l $logFile -w -t 60 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    & "$pgBin\pg_ctl.exe" status -D $pgData 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    throw "PostgreSQL failed to become ready within ~80s. Check the log: $logFile"
  }
  Write-Host "[start-db] PostgreSQL started (log: $logFile)." -ForegroundColor Green
}

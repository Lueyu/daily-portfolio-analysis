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

# pg_ctl uses exit code 3 to mean "no server running", which this script relies
# on to decide whether a start is needed. Some hosts turn native non-zero exit
# codes into terminating errors ($ErrorActionPreference=Stop together with
# $PSNativeCommandUseErrorActionPreference). Disable that here so the expected
# status=3 does not abort the script before it can start the server.
$ErrorActionPreference = 'Continue'
$PSNativeCommandUseErrorActionPreference = $false

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
  # 非正常关闭后可能残留 postmaster.pid：pg_ctl 报告“未运行”，但锁文件仍指向
  # 一个已不存在的 postmaster。只有当该 PID 已消失且 5432 无监听时，才删除陈旧锁。
  $lockFilePath = Join-Path $pgData "postmaster.pid"
  if (Test-Path -LiteralPath $lockFilePath) {
    $stalePid = (Get-Content -LiteralPath $lockFilePath -ErrorAction SilentlyContinue | Select-Object -First 1)
    $staleAlive = $false
    if ($stalePid) { $staleAlive = [bool](Get-Process -Id $stalePid -ErrorAction SilentlyContinue) }
    $portBusy = [bool](Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)
    if (-not $staleAlive -and -not $portBusy) {
      Remove-Item -LiteralPath $lockFilePath -Force
      Write-Host "[start-db] removed stale postmaster.pid (PID $stalePid not running)." -ForegroundColor Yellow
    }
  }

  # 非正常关闭后，PG 启动会先做崩溃恢复并 fsync 整个数据目录（Windows 上可能
  # 30s 以上），叠加偶发的日志文件 sharing violation 重试约 30s，因此等待上限
  # 给到 120s。pg_ctl -w 偶尔在服务器真正 ready 前就报超时退出，所以这里 start
  # 后再用 `pg_ctl status` 轮询兜底，只认实际状态，避免“其实已就绪却报失败”。
  & "$pgBin\pg_ctl.exe" start -D $pgData -l $logFile -w -t 120 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    & "$pgBin\pg_ctl.exe" status -D $pgData 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    throw "PostgreSQL failed to become ready within ~120s. Check the log: $logFile"
  }
  Write-Host "[start-db] PostgreSQL started (log: $logFile)." -ForegroundColor Green
}

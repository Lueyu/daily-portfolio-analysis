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
  # After an unclean shutdown a stale postmaster.pid may remain: pg_ctl reports
  # "no server running" but the lock file still points at a postmaster that is
  # gone. Remove the stale lock only when that PID is dead and nothing listens
  # on 5432.
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

  # After an unclean shutdown PG first replays crash recovery and fsyncs the
  # whole data directory (30s+ on Windows), plus occasional log-file sharing
  # violation retries of ~30s, so allow up to 120s. `pg_ctl -w` can also report
  # a timeout just before the server is really ready, so after start we poll
  # `pg_ctl status` and only trust the actual state, avoiding a false "failed"
  # verdict when it is in fact already ready.
  # Quote one token for the Windows command line handed to Start-Process. A
  # token that ends in a backslash must have that backslash doubled inside the
  # quotes, otherwise it escapes the closing quote and swallows the following
  # arguments (e.g. PGDATA "C:\data\" would absorb the -l switch). This mirrors
  # how the CRT / CommandLineToArgvW parse the process command line, so paths
  # with spaces, trailing separators or a drive root all survive intact. The
  # token is always wrapped in quotes: pg_ctl is a CRT program that strips them
  # from argv, so this stays faithful to the previous native per-argument call.
  function ConvertTo-CmdArg {
    param([string]$Token)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    for ($i = 0; $i -lt $Token.Length; $i++) {
      $c = $Token[$i]
      if ($c -eq '\') {
        $numBackSlash = 1
        while (($i + 1) -lt $Token.Length -and $Token[$i + 1] -eq '\') {
          $numBackSlash++
          $i++
        }
        if (($i + 1) -eq $Token.Length) {
          [void]$sb.Append('\', ($numBackSlash * 2))
        } elseif ($Token[$i + 1] -eq '"') {
          [void]$sb.Append('\', ($numBackSlash * 2 + 1))
          [void]$sb.Append('"')
          $i++
        } else {
          [void]$sb.Append('\', $numBackSlash)
        }
      } elseif ($c -eq '"') {
        [void]$sb.Append('\"')
      } else {
        [void]$sb.Append($c)
      }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
  }

  # Start pg_ctl in its own hidden console. Piping its output to Out-Null (or
  # redirecting it to a file) lets the background postgres inherit the write
  # handle, so the outer capture pipe never reaches EOF and the launch hangs.
  # Start-Process -PassThru returns only the direct pg_ctl process; we wait on
  # that process alone with a finite bound, never on the whole process tree or
  # a background pipe. Build the argv as a list and quote each token instead of
  # hand-splicing one quoted string, so -w -t 120 stay separate switches and a
  # trailing backslash in PGDATA cannot absorb -l or the log path.
  $pgCtlArgs = @('start', '-D', $pgData, '-l', $logFile, '-w', '-t', '120')
  $pgCtlCmdLine = (($pgCtlArgs | ForEach-Object { ConvertTo-CmdArg $_ }) -join ' ')
  $pgCtl = Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList $pgCtlCmdLine -PassThru -WindowStyle Hidden
  $pgCtlExited = $pgCtl.WaitForExit(130000)
  $pgCtlExitCode = if ($pgCtlExited) { $pgCtl.ExitCode } else { $null }
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    & "$pgBin\pg_ctl.exe" status -D $pgData 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) {
    throw "PostgreSQL failed to become ready within ~120s (pg_ctl exit code: $pgCtlExitCode). Check the log: $logFile"
  }
  Write-Host "[start-db] PostgreSQL started (log: $logFile)." -ForegroundColor Green
}

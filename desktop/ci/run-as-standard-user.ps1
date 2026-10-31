param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('tests', 'source-smoke', 'packaged-smoke')]
  [string]$Scenario
)

$ErrorActionPreference = 'Stop'
$workspace = $env:GITHUB_WORKSPACE
$testRoot = $env:SQUABBLE_CI_TEMP
$userName = $env:SQUABBLE_CI_USER
$password = $env:SQUABBLE_CI_PASSWORD
if (-not $workspace -or -not $testRoot -or -not $userName -or -not $password) {
  throw 'Standard-user desktop CI environment is incomplete'
}

$credential = [pscredential]::new(
  "$env:COMPUTERNAME\$userName",
  (ConvertTo-SecureString $password -AsPlainText -Force)
)
$roaming = Join-Path $testRoot 'Roaming'
$local = Join-Path $testRoot 'Local'
$npmCache = Join-Path $testRoot 'npm-cache'
foreach ($directory in @($roaming, $local, $npmCache)) {
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
}
$environment = @{
  APPDATA = $roaming
  LOCALAPPDATA = $local
  TEMP = $testRoot
  TMP = $testRoot
  npm_config_cache = $npmCache
  PATH = $env:PATH
}

$arguments = @()
switch ($Scenario) {
  'tests' {
    $executable = Join-Path $env:SystemRoot 'System32/cmd.exe'
    $arguments = @('/d', '/c', 'npm run test:desktop')
  }
  'source-smoke' {
    $executable = (Get-Command node).Source
    $arguments = @('--import', 'tsx', 'desktop/smoke.mts')
  }
  'packaged-smoke' {
    $executable = Join-Path $workspace 'output/installers/win-unpacked/Squabble.exe'
    $dataRoot = Join-Path $testRoot 'packaged-data'
    New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
    $environment.SQUABBLE_DESKTOP_DATA_DIR = $dataRoot
    $environment.SQUABBLE_DESKTOP_SMOKE = '1'
  }
}
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
  throw "Missing desktop CI executable: $executable"
}

$stdout = Join-Path $testRoot "$Scenario.stdout.log"
$stderr = Join-Path $testRoot "$Scenario.stderr.log"
$options = @{
  FilePath = $executable
  Credential = $credential
  LoadUserProfile = $true
  Environment = $environment
  WorkingDirectory = $workspace
  RedirectStandardOutput = $stdout
  RedirectStandardError = $stderr
  WindowStyle = 'Hidden'
  PassThru = $true
}
if ($arguments.Count) { $options.ArgumentList = $arguments }
$application = Start-Process @options
$timeoutMs = switch ($Scenario) {
  'tests' { 180000 }
  'source-smoke' { 90000 }
  'packaged-smoke' { 60000 }
}
if (-not $application.WaitForExit($timeoutMs)) {
  Stop-Process -Id $application.Id -Force
  throw "Standard-user desktop $Scenario exceeded its $timeoutMs ms timeout"
}
if (Test-Path -LiteralPath $stdout) { Get-Content -LiteralPath $stdout }
if (Test-Path -LiteralPath $stderr) { Get-Content -LiteralPath $stderr }
if ($application.ExitCode -ne 0) {
  throw "Standard-user desktop $Scenario exited with code $($application.ExitCode)"
}

if ($Scenario -eq 'packaged-smoke') {
  $marker = Join-Path $dataRoot 'packaged-smoke.json'
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    $backendLog = Join-Path $dataRoot 'logs/backend.log'
    if (Test-Path -LiteralPath $backendLog) { Get-Content -LiteralPath $backendLog -Tail 40 }
    throw 'Packaged application did not start its API'
  }
  $result = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
  if ($result.healthy -ne $true -or $result.registrationOpen -ne $true) {
    throw 'Packaged API returned an invalid first-run result'
  }
  if ((Split-Path -Path $result.defaultDataRoot -Leaf) -ne 'Squabble') {
    throw 'Default user data directory does not use the product name'
  }
  if (Test-Path -LiteralPath (Join-Path $dataRoot 'postgres/postmaster.pid')) {
    throw 'Packaged PostgreSQL did not stop cleanly'
  }
}

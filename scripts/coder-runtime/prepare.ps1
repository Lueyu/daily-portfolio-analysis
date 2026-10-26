param([string]$Image = 'coding-agent-runtime:local', [string]$Distro = 'Ubuntu')
$ErrorActionPreference = 'Stop'
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildContext = Join-Path ([System.IO.Path]::GetTempPath()) ('coder-runtime-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildContext | Out-Null
try {
    Copy-Item -LiteralPath (Join-Path $repoRoot 'package.json'), (Join-Path $repoRoot 'package-lock.json') -Destination $buildContext
    Copy-Item -LiteralPath (Join-Path $repoRoot 'agent/pyproject.toml') -Destination (Join-Path $buildContext 'agent-pyproject.toml')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile'), (Join-Path $PSScriptRoot 'supervisor.py') -Destination $buildContext
    $linuxContext = (& wsl -d $Distro --exec wslpath -a ($buildContext.Replace('\', '/'))).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot translate the isolated build context path.' }
    & wsl -d $Distro --exec docker build --tag $Image $linuxContext
    if ($LASTEXITCODE -ne 0) { throw 'Runtime image build failed.' }
} finally {
    $resolvedContext = [System.IO.Path]::GetFullPath($buildContext)
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    if (-not $resolvedContext.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Build context cleanup refused: path is outside the temporary directory.'
    }
    Remove-Item -LiteralPath $resolvedContext -Recurse -Force
}

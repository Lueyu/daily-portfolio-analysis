<#
.SYNOPSIS
  一键把"妙搭(Miaoda)云端"的 Webapp 最新代码同步到本地仓库，并提交/推送到 GitHub。

.DESCRIPTION
  背景：日常主要在妙搭云端用 AI 改代码，妙搭云端不是 git。本脚本用 lark-cli 把云端
  默认分支"最后一次提交"的源码导出为 zip，只覆盖属于云端权威的 Webapp 文件，
  然后 git 提交并推送；属于本仓库自有的 Python Agent、docs、README 等一律不动。

  同步流程：
    1. 自动探测 lark-cli（环境变量 LARK_CLI > PATH > 豆包沙箱目录）
    2. lark-cli apps +export 导出云端源码 zip 并解压
    3. 安全网：若本地有未提交改动，先自动 commit 一个"sync 前快照"（任何本地改动都进 git，可恢复）
    4. 只覆盖云端权威文件：
       - 镜像目录(/MIR)：client、server、shared、.githooks、.spark
       - scripts 目录：只增改、不删除本地 dev-local-*.ps1
       - 根配置文件：package.json / vite.config.ts / tsconfig*.json 等
       绝不触碰：agent、docs、.git、README*、.gitignore、.env、*.sql、backups
    5. 展示 git status，自动 commit，并按参数决定是否 push

  注意：
    - lark-cli 导出的是云端"默认分支最后一次提交"。在妙搭沙箱里改完但没提交/发布的
      内容不会被导出，所以请先在妙搭里"提交/发布"再运行本脚本。
    - 首次运行若提示未登录，请在豆包环境完成一次 lark-cli 登录，或用 $env:LARK_CLI 指向可用 CLI。

.PARAMETER AppId
  妙搭 app_id，默认 app_17en1wnqecc。

.PARAMETER DryRun
  只导出云端源码并展示"将会覆盖的文件/当前 git 状态"，不覆盖、不提交、不推送。

.PARAMETER NoPush
  执行覆盖并在本地提交，但不 push 到 GitHub（便于先人工检查）。

.EXAMPLE
  # 先预演，确认将要同步哪些文件
  powershell -ExecutionPolicy Bypass -File scripts\sync-from-miaoda.ps1 -DryRun

.EXAMPLE
  # 一键同步并推送
  powershell -ExecutionPolicy Bypass -File scripts\sync-from-miaoda.ps1
#>
[CmdletBinding()]
param(
    [string]$AppId = "app_17en1wnqecc",
    [switch]$DryRun,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# ---- 1. 探测 lark-cli ----------------------------------------------------
function Resolve-LarkCli {
    if ($env:LARK_CLI -and (Test-Path $env:LARK_CLI)) { return $env:LARK_CLI }
    $onPath = Get-Command lark-cli -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $sandbox = Join-Path $env:LOCALAPPDATA "Doubao\User Data\Default\sandbox_envs_dir\envs"
    if (Test-Path $sandbox) {
        $hit = Get-ChildItem $sandbox -Recurse -Filter "lark-cli.exe" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($hit) { return $hit.FullName }
    }
    throw "未找到 lark-cli。请把它加入 PATH，或设置 `$env:LARK_CLI 为 lark-cli.exe 的完整路径。"
}

# ---- 2. 导出云端源码 zip -------------------------------------------------
function Export-CloudSource {
    param([string]$LarkCli, [string]$AppId, [string]$WorkDir)

    Push-Location $WorkDir
    try {
        Write-Host ">> 从妙拉导出 $AppId 源码 ..." -ForegroundColor Cyan
        # lark-cli 为交互式二进制，用 cmd /c 调用并以是否生成 zip 判定成功
        cmd /c "`"$LarkCli`" apps +export --app-id $AppId --output ./src.zip > export.log 2>&1"
        $zip = Join-Path $WorkDir "src.zip"
        if (-not (Test-Path $zip)) {
            Write-Host "导出失败，export.log 内容：" -ForegroundColor Red
            Get-Content (Join-Path $WorkDir "export.log") -ErrorAction SilentlyContinue
            throw "未能导出源码（可能未登录或 app_id 无权限）。请在豆包环境完成 lark-cli 登录后重试。"
        }
        Expand-Archive -Path $zip -DestinationPath (Join-Path $WorkDir "src") -Force
    }
    finally { Pop-Location }

    $extract = Join-Path $WorkDir "src"
    # 兼容压缩包内多一层顶层目录的情况
    if (-not (Test-Path (Join-Path $extract "package.json"))) {
        $sub = Get-ChildItem $extract -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($sub -and (Test-Path (Join-Path $sub.FullName "package.json"))) { $extract = $sub.FullName }
    }
    if (-not (Test-Path (Join-Path $extract "package.json"))) {
        throw "导出内容中找不到 package.json，请检查 app_id 与导出包结构。"
    }
    return $extract
}

# ---- 云端权威文件清单（仅这些会被覆盖）----------------------------------
$MirrorDirs = @("client", "server", "shared", ".githooks", ".spark")
$RootFiles = @(
    ".npmrc", ".prettierrc", ".spark_project", ".stylelintrc.js",
    "components.json", "eslint.config.js", "nest-cli.json",
    "package.json", "package-lock.json", "postcss.config.js",
    "tailwind.config.ts", "tsconfig.app.json", "tsconfig.json",
    "tsconfig.node.json", "vite.config.ts"
)
# 本仓库自有、绝不被云端覆盖的顶层路径
$Protected = @("agent", "docs", ".git", "README.md", "README.zh-CN.md", ".gitignore")

Write-Host "==================================================" -ForegroundColor Yellow
Write-Host " 妙搭云端 -> GitHub 同步   仓库: $RepoRoot" -ForegroundColor Yellow
Write-Host "==================================================" -ForegroundColor Yellow

$LarkCli = Resolve-LarkCli
Write-Host "使用 lark-cli: $LarkCli" -ForegroundColor Green

$tmp = Join-Path $env:TEMP ("miaoda-sync-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$extract = Export-CloudSource -LarkCli $LarkCli -AppId $AppId -WorkDir $tmp
Write-Host "云端源码已解压: $extract" -ForegroundColor Green

Push-Location $RepoRoot
try {
    if ($DryRun) {
        Write-Host "`n[DryRun] 云端镜像目录（将 /MIR 对齐）: $($MirrorDirs -join ', ')" -ForegroundColor Magenta
        Write-Host "[DryRun] 将覆盖的根配置文件: $($RootFiles -join ', ')" -ForegroundColor Magenta
        Write-Host "[DryRun] 受保护、不会覆盖: $($Protected -join ', ')" -ForegroundColor Magenta
        Write-Host "`n[DryRun] 云端导出目录内容预览（前 30 项）:" -ForegroundColor Magenta
        Get-ChildItem $extract -Force | Select-Object -First 30 Name | Format-Table -AutoSize | Out-String | Write-Host
        Write-Host "[DryRun] 当前本地 git 状态（仅供参考，不会提交）:" -ForegroundColor Magenta
        git status --short
        Write-Host "`n[DryRun] 未做任何覆盖/提交。确认无误后去掉 -DryRun 正式运行。" -ForegroundColor Yellow
        return
    }

    # ---- 3. 安全网：先提交本地工作快照（任何本地改动都先入 git）----
    $dirty = git status --porcelain
    if ($dirty) {
        Write-Host "`n>> 本地有未提交改动，先做 sync 前快照提交（安全网）..." -ForegroundColor Cyan
        git add -A
        git commit -m "chore: local snapshot before miaoda sync (auto)" | Out-Null
    }

    # ---- 4. 覆盖云端权威文件 ----
    Write-Host "`n>> 同步云端权威目录..." -ForegroundColor Cyan
    foreach ($d in $MirrorDirs) {
        $s = Join-Path $extract $d
        $t = Join-Path $RepoRoot $d
        if (Test-Path $s) {
            robocopy $s $t /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
            Write-Host "  - 镜像目录 $d" -ForegroundColor DarkGray
        }
    }
    # scripts：保留本地 dev-local-*.ps1，不做镜像删除
    if (Test-Path (Join-Path $extract "scripts")) {
        robocopy (Join-Path $extract "scripts") (Join-Path $RepoRoot "scripts") /E /XF dev-local-*.ps1 /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
        Write-Host "  - 同步 scripts（保留本地 dev-local-*.ps1）" -ForegroundColor DarkGray
    }
    # 根配置文件
    foreach ($f in $RootFiles) {
        $s = Join-Path $extract $f
        if (Test-Path $s) { Copy-Item $s (Join-Path $RepoRoot $f) -Force }
    }
    Write-Host "已覆盖根配置文件（$($RootFiles.Count) 个候选）" -ForegroundColor DarkGray

    # ---- 4.1 重新应用仓库自有的跨环境补丁 ----
    # 云端的 package.json / lint.js / run-precommit.js 含平台专用写法
    # （fullstack-cli、bash-only 脚本、无 shell 的 spawn），会让外部用户
    # npm install / pre-commit 直接失败。scripts/apply-local-patches.js
    # 在覆盖后统一改写为跨环境版本。
    node (Join-Path $RepoRoot "scripts\apply-local-patches.js")

    # ---- 5. 审查并提交 ----
    Write-Host "`n>> 本次同步带来的 git 变更:" -ForegroundColor Cyan
    git status --short

    $changed = git status --porcelain
    if (-not $changed) {
        Write-Host "`n云端与本地一致，没有需要提交的变更。" -ForegroundColor Green
        return
    }

    git add -A
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    git commit -m "chore: sync webapp from Miaoda ($AppId @ $stamp)" | Out-Null
    Write-Host "已提交本地 commit。" -ForegroundColor Green

    if ($NoPush) {
        Write-Host "-NoPush 指定，未推送到 GitHub。检查无误后执行 git push。" -ForegroundColor Yellow
    }
    else {
        Write-Host "`n>> 推送到 GitHub..." -ForegroundColor Cyan
        git push
        Write-Host "同步完成，已推送。" -ForegroundColor Green
    }
}
finally {
    Pop-Location
    # 清理临时导出目录
    if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}

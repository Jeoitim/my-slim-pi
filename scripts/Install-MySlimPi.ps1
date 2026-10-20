[CmdletBinding()]
param(
    [string]$AgentRoot = (Join-Path $env:USERPROFILE '.pi\agent'),
    [switch]$Update,
    [switch]$Plan,
    [switch]$AddToPath,
    [switch]$NoPath,
    [switch]$NonInteractive,
    [switch]$SkipSearchKeys,
    [switch]$FullCheck
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw '需要 PowerShell 7。请在 pwsh 中运行安装脚本，或双击 Install.bat；无需预装 Pi。' }
if ($env:OS -ne 'Windows_NT') { throw '此安装器仅支持 Windows。' }
if ($AddToPath -and $NoPath) { throw '请选择 AddToPath 或 NoPath，不能同时使用。' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$payload = Join-Path $repoRoot 'agent'
$manifest = Get-Content -LiteralPath (Join-Path $repoRoot 'distribution.json') -Raw | ConvertFrom-Json
$target = [IO.Path]::GetFullPath($AgentRoot).TrimEnd('\')
$homePath = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\')
if ($target -eq [IO.Path]::GetPathRoot($target) -or $target -eq $homePath -or $target -eq $repoRoot -or $target.StartsWith($payload + '\',[StringComparison]::OrdinalIgnoreCase) -or $target -eq $payload) { throw '选择独立的 Pi 配置目录，不能安装到盘根、主目录或源码 payload。' }
foreach ($systemPath in @($env:WINDIR,$env:ProgramFiles,$env:ProgramData)) {
    if ($systemPath -and ($target -eq $systemPath -or $target.StartsWith($systemPath+'\',[StringComparison]::OrdinalIgnoreCase))) { throw '不支持安装到系统目录。' }
}
for ($cursor=$target; $cursor; $cursor=Split-Path -Parent $cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '安装路径包含链接，停止。' }
    if ($cursor -eq [IO.Path]::GetPathRoot($cursor)) { break }
}
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$pwsh = (Get-Command pwsh.exe -ErrorAction SilentlyContinue).Source
if (-not $node -or -not $npm) { throw '未找到 Node.js 或 npm。请先安装 Node.js 24+（含 npm），重新打开 PowerShell 7 后再运行；无需预装 Pi。' }
if (-not $pwsh) { throw '未在 PATH 中找到 pwsh.exe。请安装 PowerShell 7 并重新打开终端；无需预装 Pi。' }
$nodeVersion = & $node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^\d+\.' -or [int]($nodeVersion.Split('.')[0]) -lt $manifest.nodeMajor) { throw '需要可正常运行的 Node.js 24 或更新版本（含 npm）；无需预装 Pi。' }
$rows = @($manifest.files.PSObject.Properties)
foreach ($row in $rows) {
    if ([IO.Path]::IsPathRooted($row.Name) -or $row.Name.Split('/') -contains '..') { throw '分发清单包含越界路径。' }
    $source = Join-Path $payload $row.Name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf) -or (Get-Item -LiteralPath $source).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "源文件不可用：$($row.Name)" }
    $canonical = [IO.File]::ReadAllText($source).Replace("`r`n","`n")
    $sourceHash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))).ToLowerInvariant()
    if ($sourceHash -ne $row.Value) { throw "源码与分发清单不一致：$($row.Name)；请先刷新导出。" }
    $destination = [IO.Path]::GetFullPath((Join-Path $target $row.Name))
    if (-not $destination.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '安装目标越界。' }
    for ($parent=$destination; $parent.Length -gt $target.Length; $parent=Split-Path -Parent $parent) {
        if ((Test-Path -LiteralPath $parent) -and ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '现有目标文件路径包含链接。' }
    }
}
Write-Host "My Slim Pi / Pi $($manifest.piVersion) / $($rows.Count) files / $(@($manifest.packages.PSObject.Properties).Count) pinned packages"
Write-Host "目标：$target"
Write-Host "将安装锁定版本的 Pi $($manifest.piVersion)、社区组件和构建工具；无需预装或全局安装 Pi。"
if ($Plan) { Write-Host '仅预览：未下载依赖、未修改配置或 PATH。'; return }
if ($FullCheck -and $target -notmatch '[\\/]\.local[\\/]') { throw '完整测试仅用于仓库 .local 内的一次性安装；实际部署只验证启动。' }
$offerKeys = $false
if (-not $NonInteractive -and -not [Console]::IsInputRedirected) {
    $choiceFile = [IO.Path]::GetTempFileName()
    try {
        $choiceArgs = @((Join-Path $PSScriptRoot 'installer-setup.mjs'),'--windows-options','--target',$target,'--version',$manifest.piVersion,'--result',$choiceFile)
        if ($Update) { $choiceArgs += '--update' }
        if ($AddToPath) { $choiceArgs += '--add-to-path' }
        if ($NoPath) { $choiceArgs += '--no-path' }
        if ($SkipSearchKeys) { $choiceArgs += '--skip-search-keys' }
        & $node @choiceArgs
        if ($LASTEXITCODE -ne 0) { throw '安装选项未完成，未修改安装目录。' }
        $choices = Get-Content -LiteralPath $choiceFile -Raw | ConvertFrom-Json
    } finally { [IO.File]::Delete($choiceFile) }
    if ($choices.cancel) { Write-Host '已取消，保留现有安装。'; return }
    if ($choices.target -ne $target) {
        & $PSCommandPath -AgentRoot $choices.target -Update:$choices.update -AddToPath:$choices.addToPath -NoPath:(-not $choices.addToPath) -NonInteractive -SkipSearchKeys -FullCheck:$FullCheck
        if ($LASTEXITCODE -ne 0) { throw '独立安装未完成。' }
        if ($choices.offerKeys) { & $node (Join-Path $PSScriptRoot 'installer-setup.mjs') --search-keys --target $choices.target }
        return
    }
    $Update = [bool]$choices.update
    $AddToPath = [bool]$choices.addToPath
    $offerKeys = [bool]$choices.offerKeys
}
$exists = (Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0
if ($exists -and -not $Update) { throw '目标已有配置。默认不覆盖；确认后使用 -Update（会备份被替换文件）。也可用 -AgentRoot 选择新目录。' }
$backup = $null
if ($exists) {
    $backup = & $node (Join-Path $payload 'customization/runtime/maintenance.mjs') --agent-root $target Backup
    if ($LASTEXITCODE -ne 0) { throw '更新前备份失败，停止安装。' }
    Write-Host "原配置与核心源码备份：$backup"
}
$oldAgent = $env:PI_CODING_AGENT_DIR
$oldOffline = $env:PI_OFFLINE
$oldMaintenanceTarget = $env:PI_MAINTENANCE_TARGET
try {
    $oldSettings = if (Test-Path -LiteralPath (Join-Path $target 'settings.json')) { Get-Content -LiteralPath (Join-Path $target 'settings.json') -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
    $runtimePrompt = Join-Path $target 'APPEND_SYSTEM.md'
    $platformPrompt = Join-Path $target 'APPEND_SYSTEM.windows.md'
    if ((Test-Path -LiteralPath $runtimePrompt) -and -not (Test-Path -LiteralPath $platformPrompt)) {
        Copy-Item -LiteralPath $runtimePrompt -Destination $platformPrompt
    }
    foreach ($row in $rows) {
        $destination = Join-Path $target $row.Name
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        if (($row.Name -match '^APPEND_SYSTEM(?:\.(?:windows|linux))?\.md$|^(?:agents/|themes/|[^/]+\.json$|extensions/(?:subagent|pi-permission-suite)/config\.json$)' -and $row.Name -ne 'settings.json') -and (Test-Path -LiteralPath $destination)) { continue }
        Copy-Item -LiteralPath (Join-Path $payload $row.Name) -Destination $destination -Force
    }
    $settingsFile = Join-Path $target 'settings.json'
    $newSettings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json -AsHashtable
    foreach ($key in @($oldSettings.Keys | Where-Object { $_ -notin @('packages','extensions') })) { $newSettings[$key]=$oldSettings[$key] }
    if ($oldSettings.extensions) { $newSettings.extensions = @(@($newSettings.extensions) + @($oldSettings.extensions) | Select-Object -Unique) }
    if ($oldSettings.packages) {
        $known = @($newSettings.packages | ForEach-Object { if ($_ -is [string]) { $_ -replace '@[^@]+$','' } else { $_.source -replace '@[^@]+$','' } })
        foreach ($package in $oldSettings.packages) {
            $source = if ($package -is [string]) { $package } else { $package.source }
            if ($source -match '^npm:pi-mcp-adapter@') { continue }
            if (($source -replace '@[^@]+$','') -notin $known) { $newSettings.packages += $package }
        }
    }
    $newSettings | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $settingsFile -Encoding utf8NoBOM
    & $node (Join-Path $target 'customization/runtime/maintenance.mjs') --agent-root $target MigrateWeb (Join-Path $payload 'web-search.json')
    if ($LASTEXITCODE -ne 0) { throw 'Web 配置迁移失败；备份保留。' }
    & $node (Join-Path $target 'customization/runtime/platform-config.mjs') $target
    if ($LASTEXITCODE -ne 0) { throw '平台配置失败。' }
    # Protect the selected target, including an isolated non-default install.
    $permissionFile = Join-Path $target 'extensions\pi-permission-suite\config.json'
    $permission = Get-Content -LiteralPath $permissionFile -Raw | ConvertFrom-Json -AsHashtable
    $permission.path.deny[(Join-Path $target 'secrets\*')]='Private search credentials'
    $permission.path.deny[(Join-Path $target 'auth.json')]='Private model credentials'
    $permission.path.deny[(Join-Path $target 'web-search.json')]='Private web configuration and credentials'
    $permission | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $permissionFile -Encoding utf8NoBOM
    $env:PI_CODING_AGENT_DIR=$target
    $env:PI_MAINTENANCE_TARGET=$target
    $env:PI_OFFLINE='1'
    # WSL may previously have downloaded ELF helpers into a shared Windows AgentRoot.
    # Quarantine only these known Pi-generated files; keep all bytes for rollback.
    foreach ($helper in @('rg','fd')) {
        $helperPath = Join-Path $target "bin/$helper"
        if (Test-Path -LiteralPath $helperPath -PathType Leaf) {
            $header = [IO.File]::OpenRead($helperPath)
            try { $magic = New-Object byte[] 4; $count = $header.Read($magic,0,4) } finally { $header.Dispose() }
            if ($count -eq 4 -and [Convert]::ToHexString($magic) -eq '7F454C46') {
                if (-not $backup) { throw '检测到 Linux 工具残留，请先备份此安装再修复。' }
                $quarantine = [IO.Path]::GetFullPath((Join-Path $backup "foreign-platform-tools/$helper"))
                if (-not $quarantine.StartsWith($backup+'\',[StringComparison]::OrdinalIgnoreCase)) { throw '工具备份路径越界。' }
                New-Item -ItemType Directory -Path (Split-Path -Parent $quarantine) -Force | Out-Null
                Move-Item -LiteralPath $helperPath -Destination $quarantine
                Write-Host "已备份错误平台的 $helper 工具：$quarantine"
            }
        }
    }
    foreach ($directory in @("install\releases\$($manifest.piVersion)",'npm','customization\runtime\build-runtime')) {
        Write-Host "安装锁定依赖：$directory"
        $npmArgs = @('ci','--prefix',(Join-Path $target $directory),'--no-audit','--no-fund','--ignore-scripts')
        if ($directory -eq 'npm') { $npmArgs += '--legacy-peer-deps' } # Host SDK is supplied by Pi, not installed as plugin peers.
        & $npm @npmArgs
        if ($LASTEXITCODE -ne 0) { throw "依赖安装失败：$directory" }
    }
    if (@($newSettings.packages).Count -gt @($manifest.packages.PSObject.Properties).Count) {
        $cli = Join-Path $target "install\releases\$($manifest.piVersion)\node_modules\@earendil-works\pi-coding-agent\dist\cli.js"
        & $node $cli update --extensions
        if ($LASTEXITCODE -ne 0) { throw '原有附加包协调失败。' }
    }
    & $node (Join-Path $target 'customization\runtime\build-extensions.cjs')
    if ($LASTEXITCODE -ne 0) { throw '构建失败。' }
    & $node (Join-Path $target 'customization/checks/check-startup.mjs')
    if ($LASTEXITCODE -ne 0) { throw '启动验证未通过。' }
    if ($FullCheck) {
        & $pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'customization\Maintain-Pi.ps1') -Action Check
        if ($LASTEXITCODE -ne 0) { throw '离线验证未通过。' }
    }
    if ($AddToPath) {
        $bin=Join-Path $target 'bin'
        $userPath=[Environment]::GetEnvironmentVariable('Path','User')
        $pathBackup = & $node (Join-Path $target 'customization/runtime/maintenance.mjs') --agent-root $target Backup --label before-path --files '[]'
        if ($LASTEXITCODE -ne 0) { throw 'PATH 备份失败，未调整用户 PATH。' }
        @{userPath=$userPath;createdAt=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pathBackup 'user-path.json') -Encoding utf8NoBOM
        [Environment]::SetEnvironmentVariable('Path',(@($bin)+@($userPath -split ';' | Where-Object { $_ -and $_ -ne $bin }) -join ';'),'User')
        $env:Path = @($bin)+@($env:Path -split ';' | Where-Object { $_ -and $_ -ne $bin }) -join ';'
        Write-Host "已将此安装设为用户 pi 命令：$bin。其他已安装 Pi 未卸载。"
        Write-Host "原用户 PATH 备份：$(Join-Path $pathBackup 'user-path.json')"
    }
    if ($offerKeys) { & $node (Join-Path $PSScriptRoot 'installer-setup.mjs') --search-keys --target $target }
    Write-Host "安装完成。启动：$(Join-Path $target 'bin\pi.cmd')" -ForegroundColor Green
    Write-Host '在 Pi 中配置模型认证；搜索 Key 使用维护菜单 3。Windows Terminal bellStyle 可自行设为 all。'
} catch {
    Write-Host '安装未完成，未自动删除任何目录。' -ForegroundColor Yellow
    if ($backup) { Write-Host "原文件备份保留在：$backup" }
    throw
} finally {
    $env:PI_CODING_AGENT_DIR=$oldAgent
    $env:PI_OFFLINE=$oldOffline
    $env:PI_MAINTENANCE_TARGET=$oldMaintenanceTarget
}

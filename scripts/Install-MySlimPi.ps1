[CmdletBinding()]
param(
    [string]$AgentRoot = (Join-Path $env:USERPROFILE '.pi\agent'),
    [switch]$Update,
    [switch]$Plan,
    [switch]$AddToPath
)
$ErrorActionPreference = 'Stop'
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
$node = (Get-Command node -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$nodeVersion = & $node -p 'process.versions.node'
if ([int]($nodeVersion.Split('.')[0]) -lt $manifest.nodeMajor) { throw '需要 Node.js 24 或更新版本。' }
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
if ($Plan) { Write-Host '仅预览：未下载依赖、未修改配置或 PATH。'; return }
$exists = (Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0
if ($exists -and -not $Update) { throw '目标已有配置。默认不覆盖；确认后使用 -Update（会备份被替换文件）。也可用 -AgentRoot 选择新目录。' }
$backup = $null
if ($exists) {
    $backup = Join-Path $target ('backups\installer-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $backup | Out-Null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true,$false)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')))
    Set-Acl -LiteralPath $backup -AclObject $acl
    foreach ($row in $rows) {
        $old = Join-Path $target $row.Name
        if (Test-Path -LiteralPath $old -PathType Leaf) {
            $copy = Join-Path $backup $row.Name
            New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force | Out-Null
            Copy-Item -LiteralPath $old -Destination $copy
        }
    }
    Write-Host "原文件备份：$backup"
}
$oldAgent = $env:PI_CODING_AGENT_DIR
$oldOffline = $env:PI_OFFLINE
try {
    $oldSettings = if (Test-Path -LiteralPath (Join-Path $target 'settings.json')) { Get-Content -LiteralPath (Join-Path $target 'settings.json') -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
    foreach ($row in $rows) {
        $destination = Join-Path $target $row.Name
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $payload $row.Name) -Destination $destination -Force
    }
    $settingsFile = Join-Path $target 'settings.json'
    $newSettings = Get-Content -LiteralPath $settingsFile -Raw | ConvertFrom-Json -AsHashtable
    foreach ($key in @('defaultProvider','defaultModel')) { if ($oldSettings.ContainsKey($key)) { $newSettings[$key]=$oldSettings[$key] } }
    if ($oldSettings.packages) {
        $known = @($newSettings.packages | ForEach-Object { if ($_ -is [string]) { $_ -replace '@[^@]+$','' } else { $_.source -replace '@[^@]+$','' } })
        foreach ($package in $oldSettings.packages) {
            $source = if ($package -is [string]) { $package } else { $package.source }
            if (($source -replace '@[^@]+$','') -notin $known) { $newSettings.packages += $package }
        }
    }
    $newSettings | ConvertTo-Json -Depth 40 | Set-Content -LiteralPath $settingsFile -Encoding utf8NoBOM
    # Protect the selected target, including an isolated non-default install.
    $permissionFile = Join-Path $target 'extensions\pi-permission-suite\config.json'
    $permission = Get-Content -LiteralPath $permissionFile -Raw | ConvertFrom-Json -AsHashtable
    $permission.path.deny[(Join-Path $target 'secrets\*')]='Private search credentials'
    $permission.path.deny[(Join-Path $target 'auth.json')]='Private model credentials'
    $permission | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $permissionFile -Encoding utf8NoBOM
    $env:PI_CODING_AGENT_DIR=$target
    $env:PI_OFFLINE='1'
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
    & $pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $target 'customization\Maintain-Pi.ps1') -Action Check
    if ($LASTEXITCODE -ne 0) { throw '离线验证未通过。' }
    if ($AddToPath) {
        $bin=Join-Path $target 'bin'
        $userPath=[Environment]::GetEnvironmentVariable('Path','User')
        if ($bin -notin @($userPath -split ';')) { [Environment]::SetEnvironmentVariable('Path',($userPath.TrimEnd(';')+';'+$bin).TrimStart(';'),'User') }
    }
    Write-Host "安装完成。启动：$(Join-Path $target 'bin\pi.cmd')" -ForegroundColor Green
    Write-Host '在 Pi 中配置模型认证；搜索 Key 使用维护菜单 3。Windows Terminal bellStyle 可自行设为 all。'
} catch {
    Write-Host '安装未完成，未自动删除任何目录。' -ForegroundColor Yellow
    if ($backup) { Write-Host "原文件备份保留在：$backup" }
    throw
} finally {
    $env:PI_CODING_AGENT_DIR=$oldAgent
    $env:PI_OFFLINE=$oldOffline
}

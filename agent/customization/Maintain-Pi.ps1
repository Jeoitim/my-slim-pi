param(
    [ValidateSet('Menu','Status','Backup','Restore','PruneBackups','Rebuild','Check','WebTest','Benchmark','Context','Clean','SetKey')]
    [string]$Action = 'Menu',
    [string]$BackupPath,
    [ValidateSet('All','KeepLatestTwo')][string]$BackupMode = 'KeepLatestTwo',
    [ValidateSet('brave','tavily','exa')][string]$KeyProvider,
    [switch]$Gui,
    [switch]$Apply,
    [string]$AgentRoot
)
$ErrorActionPreference = 'Stop'
$script:AgentRoot = if ($AgentRoot) { [IO.Path]::GetFullPath($AgentRoot) } else { [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot)) }
$env:PI_CODING_AGENT_DIR = $script:AgentRoot
$env:PI_MAINTENANCE_TARGET = $script:AgentRoot
$script:MaintenanceRoot = $PSScriptRoot
$script:ManualPath = Join-Path $PSScriptRoot 'Pi Agent 本机配置维护手册.md'
$script:Utf8 = New-Object Text.UTF8Encoding($false)
$OutputEncoding = $script:Utf8
try { [Console]::OutputEncoding = $script:Utf8 } catch { }

function Resolve-PiChild([string]$Base, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative)) { throw '不允许绝对路径。' }
    $basePath = [IO.Path]::GetFullPath($Base).TrimEnd('\')
    $full = [IO.Path]::GetFullPath((Join-Path $basePath $Relative))
    if (-not $full.StartsWith($basePath + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '路径超出允许目录。' }
    for ($cursor = $full; $cursor.Length -ge $basePath.Length; $cursor = Split-Path -Parent $cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw '操作路径包含链接，请手动检查。' }
        if ($cursor -eq $basePath) { break }
    }
    return $full
}
function Write-PiJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 30) + [Environment]::NewLine, $script:Utf8)
}
function Protect-PiPath([string]$Path, [switch]$File) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    # A fresh descriptor changes only the DACL. Round-tripping Get-Acl/Set-Acl
    # can also persist audit information and require SeSecurityPrivilege.
    if ($File) {
        $acl = New-Object Security.AccessControl.FileSecurity
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')
    } else {
        $acl = New-Object Security.AccessControl.DirectorySecurity
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.AddAccessRule($rule)
    if ($PSVersionTable.PSEdition -eq 'Core') {
        if ($File) { [IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($Path), $acl) }
        else { [IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($Path), $acl) }
    } else {
        if ($File) { [IO.File]::SetAccessControl($Path, $acl) }
        else { [IO.Directory]::SetAccessControl($Path, $acl) }
    }
}
function Test-PiConfigPath([string]$Relative) {
    $name = $Relative.Replace('/','\')
    return $name -match '^(settings\.json|trust\.json|models\.json|auth\.json|mcp\.json|keybindings\.json|pi-cc-extensions\.json|pi-btw\.json|hermes-memory-config\.json|APPEND_SYSTEM\.md|pi-hermes-memory\\STANDING\.md|secrets\\web-keys\.json|extensions\\pi-permission-suite\\config\.json|extensions\\subagent\\config\.json|skills\\(?:pi-maintenance|principal)\\SKILL\.md|customization\\(?:README\.md|Pi Agent 本机配置维护手册\.md|Maintain-Pi\.ps1|Pi-Maintenance\.bat)|customization\\runtime\\[^\\]+\.(cjs|mjs)|customization\\checks\\(?:tests\\)?[^\\]+\.(mjs|ps1)|bin\\pi(?:-launcher\.js|\.cmd)|agents\\[^\\]+\.md|themes\\[^\\]+\.json|extensions\\timrt-suite\\[^\\]+\.(ts|ps1))$'
}
function Get-PiConfigFiles {
    $files = @('settings.json','trust.json','mcp.json','keybindings.json','pi-cc-extensions.json','pi-btw.json','hermes-memory-config.json','APPEND_SYSTEM.md','pi-hermes-memory\STANDING.md','extensions\pi-permission-suite\config.json','extensions\subagent\config.json','skills\pi-maintenance\SKILL.md','skills\principal\SKILL.md','customization\README.md','customization\Pi Agent 本机配置维护手册.md','customization\Maintain-Pi.ps1','customization\Pi-Maintenance.bat','bin\pi-launcher.js','bin\pi.cmd')
    foreach ($group in @(@{Path='agents';Filter='*.md'},@{Path='themes';Filter='*.json'},@{Path='extensions\timrt-suite';Filter='*.ts'},@{Path='extensions\timrt-suite';Filter='*.ps1'})) {
        $directory = Resolve-PiChild $script:AgentRoot $group.Path
        if (Test-Path -LiteralPath $directory) { $files += Get-ChildItem -LiteralPath $directory -File -Filter $group.Filter | ForEach-Object { $group.Path + '\' + $_.Name } }
    }
    foreach ($relative in @('customization\runtime','customization\checks','customization\checks\tests')) {
        $directory = Resolve-PiChild $script:AgentRoot $relative
        if (Test-Path -LiteralPath $directory) { $files += Get-ChildItem -LiteralPath $directory -File | Where-Object { Test-PiConfigPath ($relative + '\' + $_.Name) } | ForEach-Object { $relative + '\' + $_.Name } }
    }
    return @($files | Select-Object -Unique)
}
function New-PiBackup([string]$Label = 'manual', [string[]]$Files) {
    if ($Label -notmatch '^[A-Za-z0-9-]+$') { throw '备份名称只允许英文、数字和连字符。' }
    $fullBackup = -not $Files
    if ($fullBackup) { $Files = Get-PiConfigFiles }
    $name = 'config-' + $Label + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $destination = Resolve-PiChild $script:AgentRoot ('backups\' + $name)
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Protect-PiPath $destination
    $copied = @(); $hashes = @{}
    foreach ($relative in $Files) {
        if (-not (Test-PiConfigPath $relative)) { throw '该文件不属于配置备份范围。' }
        $source = Resolve-PiChild $script:AgentRoot $relative
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { continue }
        $target = Resolve-PiChild $destination $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $target
        $copied += $relative; $hashes[$relative] = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    }
    Write-PiJson (Join-Path $destination 'configuration-snapshot.json') @{kind='pi-configuration';scope=$(if($fullBackup){'full'}else{'files'});createdAt=(Get-Date).ToString('o');files=$copied;hashes=$hashes;excludes=@('node_modules','sessions','memory database','runtime cache');credentialsIncluded=[bool]($copied -match '^(models\.json|auth\.json|secrets\\)')}
    return $destination
}
function Get-PiRestorePlan([string]$Snapshot) {
    $snapshotPath = [IO.Path]::GetFullPath($Snapshot).TrimEnd('\')
    $backupRoot = Resolve-PiChild $script:AgentRoot 'backups'
    if ((Split-Path -Parent $snapshotPath) -ne $backupRoot) { throw '请选择 Pi backups 下的配置快照目录。' }
    $manifestPath = Resolve-PiChild $snapshotPath 'configuration-snapshot.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $plan = @(foreach ($relative in $manifest.files) {
        $source = Resolve-PiChild $snapshotPath $relative
        $target = Resolve-PiChild $script:AgentRoot $relative
        # Restore managed source, including the maintainer/builder; never generated seals or dependencies.
        if (-not (Test-PiConfigPath $relative)) { continue }
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "快照缺少文件：$relative" }
        if ($manifest.hashes) {
            $expected = $manifest.hashes.PSObject.Properties[$relative].Value
            if (-not $expected -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expected) { throw "快照校验失败：$relative" }
        }
        [pscustomobject]@{Relative=$relative;Source=$source;Target=$target}
    })
    if (-not $plan.Count) { throw '没有可恢复的配置。' }
    return $plan
}
function Restore-PiBackup([string]$Snapshot, [switch]$Commit) {
    $plan = @(Get-PiRestorePlan $Snapshot)
    Write-Host "将恢复 $($plan.Count) 个配置/本地扩展文件。先退出所有 Pi。"
    if (-not $Commit) { $plan | ForEach-Object { Write-Host ('  ' + $_.Relative) }; return }
    if ((Read-Host '输入 RESTORE 确认恢复') -cne 'RESTORE') { return }
    $safety = New-PiBackup -Label before-restore -Files @($plan.Relative | Where-Object { Test-Path -LiteralPath (Resolve-PiChild $script:AgentRoot $_) -PathType Leaf })
    foreach ($file in $plan) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $file.Target) -Force | Out-Null
        Copy-Item -LiteralPath $file.Source -Destination $file.Target -Force
        if ($file.Relative -match '^(models\.json|auth\.json|secrets\\)') { Protect-PiPath $file.Target -File }
    }
    Write-Host "恢复完成；恢复前备份：$safety。请重建扩展并重启 Pi。" -ForegroundColor Green
}
function Invoke-PiState([string[]]$Arguments = @('status')) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $raw = & $node (Join-Path $script:MaintenanceRoot 'runtime\config-state.mjs') @Arguments
    if ($LASTEXITCODE -ne 0) { throw '配置读取/保存未完成。' }
    return ($raw -join "`n" | ConvertFrom-Json)
}
function Show-PiStatus {
    $state = Invoke-PiState
    Write-Host "Pi $($state.piVersion) | Node $($state.nodeVersion)" -ForegroundColor Cyan
    Write-Host "默认模型：$($state.model.provider) / $($state.model.name) [$($state.model.id)]"
    Write-Host "主题：$($state.theme) | 编译缓存就绪：$($state.buildReady)"
    Write-Host "搜索 Key：Brave=$($state.searchKeys.brave)；Tavily=$($state.searchKeys.tavily)；Exa=$($state.searchKeys.exa)"
    Write-Host "配置 JSON 错误：$(@($state.jsonErrors).Count)；组件：$(@($state.packages).Count)"
    $state.jsonErrors | ForEach-Object { Write-Host "  格式错误：$_" -ForegroundColor Yellow }
    $state.packages | ForEach-Object { Write-Host "  $_" }
}
function Select-PiItem([string]$Title, [array]$Items, [scriptblock]$Label) {
    if (-not $Items.Count) { Write-Host '没有可选项。'; return }
    Write-Host "`n$Title" -ForegroundColor Cyan
    for ($i=0; $i -lt $Items.Count; $i++) { Write-Host ("{0}. {1}" -f ($i+1),(& $Label $Items[$i])) }
    $answer = Read-Host '输入序号，回车返回'
    $index = 0
    if ([int]::TryParse($answer,[ref]$index) -and $index -ge 1 -and $index -le $Items.Count) { return $Items[$index-1] }
}
function Open-PiConfig {
    $choice = Read-Host "`n1 默认模型  2 默认主题  3 打开配置文件  0 返回"
    if ($choice -eq '1') {
        $catalog = Invoke-PiState -Arguments @('catalog')
        $providers = @($catalog.models.provider | Sort-Object -Unique)
        $provider = Select-PiItem '选择供应商' $providers {param($item) $item}
        if (-not $provider) { return }
        $model = Select-PiItem '选择模型（显示 name）' @($catalog.models | Where-Object provider -EQ $provider) {param($item) "$($item.name) [$($item.id)]"}
        if (-not $model) { return }
        $null = New-PiBackup -Label before-model -Files @('settings.json')
        $null = Invoke-PiState -Arguments @('set-model',$model.provider,$model.id)
        Write-Host "已保存：$($model.name)。新会话使用此模型。" -ForegroundColor Green
    } elseif ($choice -eq '2') {
        $catalog = Invoke-PiState -Arguments @('catalog')
        $theme = Select-PiItem '选择主题；Pi 内 /theme 可查看代码预览' @($catalog.themes) {param($item) "$($item.name) · $($item.appearance)"}
        if (-not $theme) { return }
        $null = New-PiBackup -Label before-theme -Files @('settings.json')
        $null = Invoke-PiState -Arguments @('set-theme',$theme.name)
        Write-Host "已保存主题：$($theme.name)。重启 Pi 生效。" -ForegroundColor Green
    } elseif ($choice -eq '3') {
        $items = @(
            @{Name='主设置';Path='settings.json'},@{Name='模型与供应商（含认证信息）';Path='models.json'},
            @{Name='系统附加提示词';Path='APPEND_SYSTEM.md'},@{Name='固定偏好';Path='pi-hermes-memory\STANDING.md'},
            @{Name='Hermes 记忆设置';Path='hermes-memory-config.json'},@{Name='审批模型定义';Path='agents\approver.md'},
            @{Name='MCP 服务器';Path='mcp.json'},
            @{Name='权限规则';Path='extensions\pi-permission-suite\config.json'},@{Name='快捷键';Path='keybindings.json'},
            @{Name='Claude 风格 UI';Path='pi-cc-extensions.json'},@{Name='任务子代理';Path='extensions\subagent\config.json'}
        )
        $item = Select-PiItem '编辑前自动建立私有备份' $items {param($entry) "$($entry.Name) — $($entry.Path)"}
        if (-not $item) { return }
        $file = Resolve-PiChild $script:AgentRoot $item.Path
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw '配置文件不存在。' }
        $null = New-PiBackup -Label before-edit -Files @($item.Path)
        Start-Process notepad.exe -ArgumentList @('"' + $file + '"') -WindowStyle Normal
        Write-Host '已打开编辑器。保存后重启 Pi；修改扩展源码后先重建。'
    }
}
function Read-PiSecretDialog([string]$Provider) {
    if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') { throw '密码窗口需要 STA。请通过 Pi-Maintenance.bat 打开，或启动 pwsh -STA。' }
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object Windows.Forms.Form
    $form.Text = "Pi · $Provider API Key"
    $form.ClientSize = New-Object Drawing.Size(510,210)
    $form.StartPosition = 'CenterScreen'
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.TopMost = $true
    $form.Font = New-Object Drawing.Font('Segoe UI',10)
    $hint = New-Object Windows.Forms.Label
    $hint.Text = '仅保存到本机。粘贴后核对字符数，内容不会发送到聊天。'
    $hint.SetBounds(18,16,475,34)
    $box = New-Object Windows.Forms.TextBox
    $box.UseSystemPasswordChar = $true
    $box.MaxLength = 4096
    $box.SetBounds(18,58,474,30)
    $counter = New-Object Windows.Forms.Label
    $counter.Text = '字符数：0'
    $counter.SetBounds(18,98,474,32)
    $paste = New-Object Windows.Forms.Button
    $paste.Text = '从剪贴板粘贴'
    $paste.SetBounds(18,152,140,36)
    $save = New-Object Windows.Forms.Button
    $save.Text = '保存'
    $save.SetBounds(280,152,100,36)
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = '取消'
    $cancel.DialogResult = [Windows.Forms.DialogResult]::Cancel
    $cancel.SetBounds(392,152,100,36)
    $box.Add_TextChanged({ $counter.Text = '字符数：' + $box.Text.Trim().Length; $counter.ForeColor = [Drawing.Color]::DimGray }.GetNewClosure())
    $paste.Add_Click({
        try {
            $clipboardValue = [Windows.Forms.Clipboard]::GetText().Trim()
            if ($clipboardValue -match '[\r\n]') { $counter.Text = '剪贴板含多行，请只复制 API Key 本身。'; return }
            $box.Text = $clipboardValue
            $box.Focus()
        } catch { $counter.Text = '无法读取剪贴板，请点击输入框后使用 Ctrl+V。' }
        finally { $clipboardValue = $null }
    }.GetNewClosure())
    $save.Add_Click({
        if ($box.Text.Trim().Length -lt 12 -or $box.Text.Trim() -match '\s') {
            $counter.ForeColor = [Drawing.Color]::Firebrick
            $counter.Text = 'Key 至少 12 字符且不能含空白；请重新粘贴完整 Key。'
            return
        }
        $form.DialogResult = [Windows.Forms.DialogResult]::OK
        $form.Close()
    }.GetNewClosure())
    $form.Controls.AddRange(@($hint,$box,$counter,$paste,$save,$cancel))
    $form.AcceptButton = $save
    $form.CancelButton = $cancel
    try {
        if ($form.ShowDialog() -ne [Windows.Forms.DialogResult]::OK) { return }
        return (ConvertTo-SecureString $box.Text.Trim() -AsPlainText -Force)
    } finally { $box.Clear(); $form.Dispose() }
}
function Set-PiWebKey([ValidateSet('brave','tavily','exa')][string]$Provider, [switch]$Gui) {
    if (-not $Provider) { $Provider = Select-PiItem '选择需要更新的搜索 Key（隐藏输入）' @('brave','tavily','exa') {param($item) $item} }
    if (-not $provider) { return }
    $secure = if ($Gui) { Read-PiSecretDialog $Provider } else { Read-Host "输入 $provider API Key" -AsSecureString }
    if (-not $secure) { Write-Host '已取消，未修改任何 Key。'; return }
    try {
        $plain = [Net.NetworkCredential]::new('', $secure).Password.Trim()
        if ($plain.Length -lt 12 -or $plain.Length -gt 4096 -or $plain -match '\s') { throw 'Key 应为 12 至 4096 字符且不含空白；未保存。' }
        $directory = Resolve-PiChild $script:AgentRoot 'secrets'
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        Protect-PiPath $directory
        $file = Resolve-PiChild $script:AgentRoot 'secrets\web-keys.json'
        $keys = @{}
        if (Test-Path -LiteralPath $file) {
            $existing = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($property in $existing.PSObject.Properties) { $keys[$property.Name] = $property.Value }
            $null = New-PiBackup -Label before-key -Files @('secrets\web-keys.json')
        }
        $keys[$provider] = $plain
        Write-PiJson $file $keys
        Protect-PiPath $file -File
        Write-Host "$provider Key 已保存，下一次联网调用生效。" -ForegroundColor Green
    } finally { $plain=$null; $keys=$null; $existing=$null; $secure.Dispose() }
}
function Invoke-PiNode([string[]]$Arguments, [string]$Log, [string]$WorkingDirectory = $script:AgentRoot) {
    $node = (Get-Command node -ErrorAction Stop).Source
    Push-Location -LiteralPath $WorkingDirectory
    try {
        if ($Log) { & $node @Arguments | Tee-Object -FilePath $Log -Append }
        else { & $node @Arguments }
        if ($LASTEXITCODE -ne 0) { throw "操作未通过（退出码 $LASTEXITCODE）。" }
    } finally { Pop-Location }
}
function Invoke-PiCheck([string]$Kind) {
    $reports = Resolve-PiChild $script:AgentRoot 'customization\reports'
    New-Item -ItemType Directory -Path $reports -Force | Out-Null
    $log = Resolve-PiChild $reports 'last-check.log'
    [IO.File]::WriteAllText($log, (Get-Date).ToString('o') + [Environment]::NewLine, $script:Utf8)
    $checks = Join-Path $script:MaintenanceRoot 'checks'
    if ($Kind -eq 'Check') {
        $powerShell = (Get-Process -Id $PID).Path
        & $powerShell -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $checks 'tests\Test-Maintenance.ps1') | Tee-Object -FilePath $log -Append
        if ($LASTEXITCODE -ne 0) { throw '维护脚本检查未通过。' }
        $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $checks 'tests') -Filter '*.test.mjs' -File | ForEach-Object FullName)
        Invoke-PiNode -Arguments (@('--test') + $testFiles) -Log $log
        Invoke-PiNode -Arguments @((Join-Path $checks 'check-components.mjs')) -Log $log
    } elseif ($Kind -eq 'WebTest') { Invoke-PiNode -Arguments @((Join-Path $checks 'check-components.mjs'),'--live-web') -Log $log }
    elseif ($Kind -eq 'Benchmark') { Invoke-PiNode -Arguments @((Join-Path $checks 'benchmark-startup.mjs')) -Log $log }
    elseif ($Kind -eq 'Context') { Invoke-PiNode -Arguments @((Join-Path $checks 'profile-prompt.mjs')) -Log $log }
    Write-Host "完成。最新日志：$log（下次检查覆盖）。" -ForegroundColor Green
}
function Get-PiCleanupItems {
    $reports = Resolve-PiChild $script:AgentRoot 'customization\reports'
    if (Test-Path -LiteralPath $reports) {
        foreach ($file in Get-ChildItem -LiteralPath $reports -File -Force) {
            if ($file.Extension -in @('.json','.log')) { [pscustomobject]@{Path=(Resolve-PiChild $reports $file.Name);IsDirectory=$false;Bytes=$file.Length} }
        }
    }
    $backups = Resolve-PiChild $script:AgentRoot 'backups'
    if (Test-Path -LiteralPath $backups) {
        foreach ($directory in Get-ChildItem -LiteralPath $backups -Directory) {
            if ($directory.Name -notmatch '^(maintenance|installation)-artifacts-\d{8}-\d{6}$') { continue }
            $path = Resolve-PiChild $backups $directory.Name
            $items = @(Get-ChildItem -LiteralPath $path -Recurse -Force)
            if (@($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw '清理目录包含链接，请手动检查。' }
            [pscustomobject]@{Path=$path;IsDirectory=$true;Bytes=($items | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum}
        }
    }
}
function Clear-PiGenerated([switch]$Commit) {
    $items = @(Get-PiCleanupItems)
    if (-not $items.Count) { Write-Host '没有可清理的报告或安装残留。'; return }
    Write-Host '仅清理生成的报告/日志及明确标记的安装、调试残留归档：' -ForegroundColor Yellow
    $items | ForEach-Object { Write-Host ('  {0}  ({1:N0} bytes)' -f $_.Path,$_.Bytes) }
    Write-Host ('合计约 {0:N2} MiB。配置快照、记忆、认证和编译缓存不在清单中。' -f (($items | Measure-Object Bytes -Sum).Sum / 1MB))
    if (-not $Commit) { Write-Host '当前仅预览；手动从菜单确认，或使用 -Action Clean -Apply。'; return }
    if ((Read-Host '输入 DELETE 确认永久删除以上生成物') -cne 'DELETE') { return }
    # Recompute and revalidate paths after confirmation; reject changes to the deletion set.
    $fresh = @(Get-PiCleanupItems)
    if (@(Compare-Object @($items.Path) @($fresh.Path)).Count) { throw '清理清单发生变化，请重新预览。' }
    foreach ($item in $fresh) {
        if ($item.IsDirectory) { Remove-Item -LiteralPath $item.Path -Recurse -Force }
        else { Remove-Item -LiteralPath $item.Path -Force }
    }
    Write-Host '生成物已清理。' -ForegroundColor Green
}
function Show-PiRestore {
    $backups = Resolve-PiChild $script:AgentRoot 'backups'
    $items = @(Get-ChildItem -LiteralPath $backups -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'configuration-snapshot.json') } | Sort-Object Name -Descending)
    $item = Select-PiItem '选择配置快照；恢复前会自动备份当前文件' $items {param($entry) $entry.Name}
    if ($item) { Restore-PiBackup $item.FullName -Commit }
}
function Get-PiBackupInventory {
    $root = Resolve-PiChild $script:AgentRoot 'backups'
    if (-not (Test-Path -LiteralPath $root)) { return }
    foreach ($item in Get-ChildItem -LiteralPath $root -Force) {
        $path = Resolve-PiChild $root $item.Name
        $files = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $path -Recurse -Force) } else { @($item) }
        if (@($files | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw '备份目录包含链接，请手动检查。' }
        $full = $false; $created = [DateTimeOffset]$item.CreationTimeUtc
        $manifestPath = Join-Path $path 'configuration-snapshot.json'
        if ($item.PSIsContainer -and (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
            try {
                $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $parsed = [DateTimeOffset]::MinValue
                if ($manifest.createdAt -is [DateTimeOffset]) { $created = $manifest.createdAt }
                elseif ($manifest.createdAt -is [DateTime]) { $created = [DateTimeOffset]$manifest.createdAt }
                elseif ([DateTimeOffset]::TryParse([string]$manifest.createdAt,[ref]$parsed)) { $created = $parsed }
                $normalized = @($manifest.files | ForEach-Object { $_.Replace('/','\') })
                if ($manifest.scope -eq 'full' -or (-not $manifest.scope -and $normalized -contains 'settings.json' -and $normalized -contains 'APPEND_SYSTEM.md')) {
                    $null = @(Get-PiRestorePlan $path)
                    $full = $true
                }
            } catch { $full = $false }
        }
        [pscustomobject]@{Name=$item.Name;Path=$path;IsDirectory=$item.PSIsContainer;Bytes=($files | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum;Created=$created;FullConfiguration=$full}
    }
}
function Get-PiBackupPrunePlan([ValidateSet('All','KeepLatestTwo')][string]$Mode) {
    $all = @(Get-PiBackupInventory)
    $keep = @()
    if ($Mode -eq 'KeepLatestTwo') { $keep = @($all | Where-Object FullConfiguration | Sort-Object Created,Name -Descending | Select-Object -First 2) }
    $delete = @($all | Where-Object { $keep.Path -notcontains $_.Path })
    return [pscustomobject]@{Mode=$Mode;Keep=$keep;Delete=$delete}
}
function Clear-PiBackups([ValidateSet('All','KeepLatestTwo')][string]$Mode = 'KeepLatestTwo', [switch]$Commit) {
    $plan = Get-PiBackupPrunePlan $Mode
    Write-Host "`n备份目录：$(Join-Path $script:AgentRoot 'backups')" -ForegroundColor Cyan
    if ($Mode -eq 'KeepLatestTwo') {
        Write-Host "保留最新 $($plan.Keep.Count) 份有效完整配置备份：" -ForegroundColor Green
        $plan.Keep | ForEach-Object { Write-Host ('  {0}  {1}' -f $_.Created.ToString('yyyy-MM-dd HH:mm:ss zzz'),$_.Name) }
        if ($plan.Keep.Count -eq 0) { throw '没有可识别的完整配置备份。请先使用菜单 4 创建备份，或明确选择删除全部。' }
    }
    if (-not $plan.Delete.Count) { Write-Host '没有需要删除的备份。'; return }
    Write-Host ('将删除 {0} 项旧备份/归档，约 {1:N2} MiB：' -f $plan.Delete.Count,(($plan.Delete | Measure-Object Bytes -Sum).Sum/1MB)) -ForegroundColor Yellow
    $plan.Delete | ForEach-Object { Write-Host ('  ' + $_.Path) }
    if (-not $Commit) { Write-Host '当前仅预览。手动使用 -Apply 或通过菜单确认。'; return }
    $confirmation = if ($Mode -eq 'All') { 'DELETE ALL BACKUPS' } else { 'KEEP LATEST 2' }
    if ((Read-Host "输入 $confirmation 确认永久删除清单中的备份") -cne $confirmation) { return }
    $fresh = Get-PiBackupPrunePlan $Mode
    if ((@($plan.Delete.Path | Sort-Object) -join "`n") -cne (@($fresh.Delete.Path | Sort-Object) -join "`n") -or (@($plan.Keep.Path | Sort-Object) -join "`n") -cne (@($fresh.Keep.Path | Sort-Object) -join "`n")) { throw '备份清单发生变化，请重新预览。' }
    foreach ($item in $fresh.Delete) {
        if ($item.IsDirectory) { Remove-Item -LiteralPath $item.Path -Recurse -Force }
        else { Remove-Item -LiteralPath $item.Path -Force }
    }
    Write-Host '备份清理完成。' -ForegroundColor Green
}
function Show-PiBackupMenu {
    $choice = Read-Host "`n1 恢复备份  2 删除全部备份  3 只保留最新两份完整配置备份  0 返回"
    switch ($choice) {
        '1' { Show-PiRestore }
        '2' { Clear-PiBackups -Mode All -Commit }
        '3' { Clear-PiBackups -Mode KeepLatestTwo -Commit }
    }
}
function Show-PiMenu {
    while ($true) {
        Write-Host "`n──── Pi 本机配置维护 ────" -ForegroundColor Cyan
        Write-Host '1 状态与配置体检    2 常用设置 / 编辑配置'
        Write-Host '3 搜索 API Key      4 备份配置（默认不含凭据）'
        Write-Host '5 恢复 / 删除备份    6 重建本地扩展'
        Write-Host '7 检查 / 联网 / 测速  8 清理报告和安装残留'
        Write-Host '9 启动 Pi           H 维护手册    0 退出'
        $choice = (Read-Host '选择操作').Trim().ToUpperInvariant()
        if ($choice -eq '0') { return }
        try {
            switch ($choice) {
                '1' { Show-PiStatus }
                '2' { Open-PiConfig }
                '3' { Set-PiWebKey -Gui }
                '4' { Write-Host ('备份已创建：' + (New-PiBackup)) -ForegroundColor Green }
                '5' { Show-PiBackupMenu }
                '6' { Invoke-PiNode @((Join-Path $script:MaintenanceRoot 'runtime\build-extensions.cjs')); Write-Host '构建完成。请重启 Pi。' -ForegroundColor Green }
                '7' {
                    $check = Select-PiItem '选择检查；均不调用模型，联网测试只用免费 Exa MCP' @('Check','WebTest','Benchmark','Context') {param($item) switch($item){'Check'{'离线测试与组件集成'} 'WebTest'{'免费联网测试'} 'Benchmark'{'三次启动测速'} 'Context'{'离线首轮上下文采集'}}}
                    if ($check) { Invoke-PiCheck $check }
                }
                '8' { Clear-PiGenerated -Commit }
                '9' {
                    $directory = Read-Host "项目目录（回车使用 $env:USERPROFILE）"
                    if (-not $directory) { $directory = $env:USERPROFILE }
                    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw '目录不存在。' }
                    Invoke-PiNode -Arguments @((Join-Path $script:AgentRoot 'bin\pi-launcher.js')) -WorkingDirectory $directory
                }
                'H' { Start-Process notepad.exe -ArgumentList @('"' + $script:ManualPath + '"') -WindowStyle Normal }
                default { Write-Host '请输入菜单中的选项。' }
            }
        } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
        $null = Read-Host '回车返回菜单'
    }
}
if ($MyInvocation.InvocationName -ne '.') {
    try {
        switch ($Action) {
            'Menu' { Show-PiMenu }
            'Status' { Show-PiStatus }
            'Backup' { Write-Output (New-PiBackup) }
            'SetKey' { Set-PiWebKey -Provider $KeyProvider -Gui:$Gui }
            'Restore' { if (-not $BackupPath) { throw '请提供 -BackupPath。' }; Restore-PiBackup $BackupPath -Commit:$Apply }
            'PruneBackups' { Clear-PiBackups -Mode $BackupMode -Commit:$Apply }
            'Rebuild' { Invoke-PiNode @((Join-Path $script:MaintenanceRoot 'runtime\build-extensions.cjs')) }
            'Clean' { Clear-PiGenerated -Commit:$Apply }
            default { Invoke-PiCheck $Action }
        }
    } catch { Write-Error $_.Exception.Message; exit 1 }
}

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
function Invoke-PiMaintenance([string[]]$Arguments) {
    $node = (Get-Command node -ErrorAction Stop).Source
    & $node (Join-Path $PSScriptRoot 'runtime/maintenance.mjs') --agent-root $script:AgentRoot @Arguments
    if ($LASTEXITCODE -ne 0) { throw '维护操作未完成。' }
}
function Test-PiConfigPath([string]$Relative) {
    $env:PI_CONFIG_PATH = $Relative
    $module = Join-Path $PSScriptRoot 'runtime/maintenance.mjs'
    $env:PI_MAINTENANCE_MODULE = $module
    $result = & node --input-type=module -e 'import {pathToFileURL} from "node:url"; const m=await import(pathToFileURL(process.env.PI_MAINTENANCE_MODULE));console.log(m.configPath(process.env.PI_CONFIG_PATH));'
    if ($LASTEXITCODE -ne 0) { throw '配置范围检查失败。' }
    return $result -eq 'true'
}
function New-PiBackup([string]$Label = 'manual', [string[]]$Files) {
    $arguments = @('Backup','--label',$Label)
    if ($null -ne $Files) { $arguments += @('--files', (ConvertTo-Json -InputObject @($Files) -Compress)) }
    return Invoke-PiMaintenance $arguments
}
function Get-PiRestorePlan([string]$Snapshot) {
    $plan = (Invoke-PiMaintenance @('Restore','--backup-path',$Snapshot)) -join "`n" | ConvertFrom-Json
    return @($plan.files | ForEach-Object { [pscustomobject]@{ Relative=$_.relative.Replace('/','\'); Source=(Join-Path $Snapshot $_.relative); Target=(Join-Path $script:AgentRoot $_.relative) } })
}
function Restore-PiBackup([string]$Snapshot, [switch]$Commit) {
    $arguments = @('Restore','--backup-path',$Snapshot)
    if ($Commit) { $arguments += '--apply' }
    Invoke-PiMaintenance $arguments
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
function Invoke-PiCheck([string]$Kind) { Invoke-PiMaintenance @($Kind) }
function Clear-PiGenerated([switch]$Commit) {
    $arguments = @('Clean'); if ($Commit) { $arguments += '--apply' }
    Invoke-PiMaintenance $arguments
}
function Show-PiRestore {
    $backups = Resolve-PiChild $script:AgentRoot 'backups'
    $items = @(Get-ChildItem -LiteralPath $backups -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'configuration-snapshot.json') } | Sort-Object Name -Descending)
    $item = Select-PiItem '选择配置快照；恢复前会自动备份当前文件' $items {param($entry) $entry.Name}
    if ($item) { Restore-PiBackup $item.FullName -Commit }
}
function Clear-PiBackups([ValidateSet('All','KeepLatestTwo')][string]$Mode = 'KeepLatestTwo', [switch]$Commit) {
    $arguments = @('PruneBackups','--backup-mode',$Mode); if ($Commit) { $arguments += '--apply' }
    Invoke-PiMaintenance $arguments
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
                '6' { Invoke-PiMaintenance @('Rebuild'); Write-Host '构建完成。请重启 Pi。' -ForegroundColor Green }
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
            'Rebuild' { Invoke-PiMaintenance @('Rebuild') }
            'Clean' { Clear-PiGenerated -Commit:$Apply }
            default { Invoke-PiCheck $Action }
        }
    } catch { Write-Error $_.Exception.Message; exit 1 }
}

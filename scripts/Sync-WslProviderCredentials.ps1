#Requires -Version 7.0
<#
.SYNOPSIS
手动将 Windows Pi 的 models.json、auth.json 同步到指定 WSL 安装。
.EXAMPLE
./scripts/Sync-WslProviderCredentials.ps1 -Distribution archlinux
.EXAMPLE
./scripts/Sync-WslProviderCredentials.ps1 -Distribution archlinux -LinuxUser yourname -Apply
.DESCRIPTION
默认只预览文件名；-Apply 先备份再整文件替换，不合并供应商。
缺失的源文件跳过，目标对应文件保留。不会同步设置、搜索 Key 或其他数据。
传输通过标准输入，不把凭据放进命令参数或仓库临时文件。
LinuxAgentRoot 默认采用目标 Linux 用户的 ~/.pi/agent。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$Distribution,
    [string]$LinuxUser,
    [string]$WindowsAgentRoot = (Join-Path $HOME '.pi/agent'),
    [string]$LinuxAgentRoot,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw '请在 Windows PowerShell 7 运行此入口。' }
$files = [ordered]@{}
foreach ($name in @('models.json', 'auth.json')) {
    $path = Join-Path ([IO.Path]::GetFullPath($WindowsAgentRoot)) $name
    if (-not (Test-Path -LiteralPath $path)) { continue }
    for ($cursor = $path; $cursor; $cursor = Split-Path -Parent $cursor) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '源路径不能包含链接。' }
    }
    $item = Get-Item -LiteralPath $path
    if ($item.PSIsContainer -or $item.Length -gt 4MB) { throw "源文件不是有效的小型配置文件：$name" }
    $content = [IO.File]::ReadAllText($path)
    try {
        $json = ConvertFrom-Json -InputObject $content -AsHashtable -ErrorAction Stop
        if ($json -isnot [System.Collections.IDictionary]) { throw 'Invalid object' }
    } catch { throw "源文件必须是 JSON 对象：$name（内容未输出）" }
    $files[$name] = $content
}
if (-not $files.Count) { throw 'Windows 安装中未找到 models.json 或 auth.json。' }
$wslArgs = @('--distribution', $Distribution)
if ($LinuxUser) { $wslArgs += @('--user', $LinuxUser) }
$helper = Join-Path $PSScriptRoot 'sync-wsl-provider-credentials.mjs'
$linuxHelper = & wsl.exe @wslArgs --exec wslpath -a -u $helper
if ($LASTEXITCODE -ne 0 -or -not $linuxHelper) { throw '无法定位 WSL 中的小工具。' }
# All shell text is fixed; paths are positional arguments. Secrets travel only on stdin.
$bootstrap = 'set -euo pipefail; root="${2:-$HOME/.pi/agent}"; node_bin=""; if [[ -f "$root/install/node-path" ]]; then IFS= read -r node_bin < "$root/install/node-path"; fi; if [[ "$node_bin" != /* || ! -x "$node_bin" ]]; then node_bin="$(command -v node || true)"; fi; if [[ -z "$node_bin" ]]; then printf "%s\n" "需要目标 Linux 安装的 Node 24+" >&2; exit 1; fi; exec "$node_bin" "$1"'
$start = [Diagnostics.ProcessStartInfo]::new('wsl.exe')
$start.UseShellExecute = $false
$start.RedirectStandardInput = $true
$start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
foreach ($arg in ($wslArgs + @('--exec','bash','-c',$bootstrap,'credential-sync',[string]$linuxHelper,[string]$LinuxAgentRoot))) { $start.ArgumentList.Add($arg) }
$process = [Diagnostics.Process]::new()
$process.StartInfo = $start
try {
    [void]$process.Start()
    $process.StandardInput.Write((@{files=$files; root=$LinuxAgentRoot; apply=[bool]$Apply} | ConvertTo-Json -Depth 8 -Compress))
    $process.StandardInput.Close()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'WSL 凭据同步未完成；请查看上方不含凭据的错误。' }
} finally { $process.Dispose() }

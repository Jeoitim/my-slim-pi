#requires -Version 7.0
<#
.SYNOPSIS
  清理本仓库 .local 中可重建的测试目录与生成结果。
.EXAMPLE
  pwsh -NoProfile -File .\scripts\Clear-LocalArtifacts.ps1 -List
.EXAMPLE
  pwsh -NoProfile -File .\scripts\Clear-LocalArtifacts.ps1 -Delete
#>
param(
    [switch]$Delete,
    [switch]$List
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$expectedLocal = [IO.Path]::GetFullPath((Join-Path $repo '.local'))
if (-not (Test-Path -LiteralPath $expectedLocal)) {
    Write-Output '没有 .local 目录，无需清理。'
    exit 0
}

$localItem = Get-Item -LiteralPath $expectedLocal -Force
$comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
if (-not $localItem.PSIsContainer -or
    ($localItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
    -not [string]::Equals($localItem.FullName, $expectedLocal, $comparison) -or
    -not [string]::Equals([IO.Path]::GetDirectoryName($localItem.FullName), $repo, $comparison)) {
    throw '.local 不是仓库内的普通目录，已停止。'
}

# 仅匹配本次盘点确认的一次性目录；以后新增的未知目录会保留并列出。
$generatedName = '^(?:(?:bootstrap|setup|prerequisite|patch-check|provider-sync|install-guard|doc-command|linux-installer)-[A-Za-z0-9]{6}|pi-.+-[A-Za-z0-9]{6}|pi-maintenance-check-[a-f0-9]{32})$'
$knownNames = @(
    'agent', 'ask-test-20261021151647', 'ask-test-temp', 'ask-user-source',
    'ask-user-windows', 'checkout-audit', 'cross-platform-agent',
    'cross-platform-agent-windows', 'deploy-2026-10-20T02-56-02-326Z',
    'extension-first-agent', 'fleet-host-recovery', 'fleet-live-windows',
    'fleet-windows', 'interactive-installer-windows', 'jiti',
    'maintenance-20261021-windows',
    'provider source-affada9c-7375-4a76-85e4-3cb4ccfdd87b',
    'smoke-agent', 'suite-test-20261021130738', 'verified-agent',
    'pi-web-access-upstream', 'web-after', 'web-before', 'web-compat-agent',
    'web-compat-temp', 'web-docs', 'web-test-tmp'
)
$allDirs = @(Get-ChildItem -LiteralPath $expectedLocal -Force -Directory)
$dirs = @($allDirs | Where-Object { $_.Name -match $generatedName -or $_.Name -in $knownNames })
$unknownDirs = @($allDirs | Where-Object { $_.Name -notmatch $generatedName -and $_.Name -notin $knownNames })

# 保留 .local 根目录中的脚本、Markdown 和文本草稿。
$outputExtensions = @('.log', '.json', '.tar', '.tgz')
$files = @(Get-ChildItem -LiteralPath $expectedLocal -Force -File |
    Where-Object { $_.Extension -in $outputExtensions })
$targets = @($dirs) + @($files)

foreach ($item in $targets) {
    if (-not [string]::Equals([IO.Path]::GetDirectoryName($item.FullName), $expectedLocal, $comparison) -or
        ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "目标不在 .local 直属目录内，或是链接：$($item.FullName)"
    }
}

# Get-ChildItem 默认不进入目录链接；只接纳已选测试目录内的普通 Junction/SymbolicLink。
$links = @(Get-ChildItem -LiteralPath $expectedLocal -Recurse -Force -Attributes ReparsePoint |
    Where-Object {
        $path = $_.FullName
        foreach ($dir in $dirs) {
            if ($path.StartsWith($dir.FullName + [IO.Path]::DirectorySeparatorChar, $comparison)) {
                return $true
            }
        }
        return $false
    })
foreach ($link in $links) {
    if ($link.LinkType -notin @('Junction', 'SymbolicLink')) {
        throw "发现未识别的链接类型，已停止：$($link.FullName) ($($link.LinkType))"
    }
}

Write-Output "仓库：$repo"
Write-Output "待清理：$($dirs.Count) 个目录、$($files.Count) 个输出文件。"
if ($links.Count -gt 0) {
    Write-Output "其中有 $($links.Count) 个目录内链接，只删除链接本身："
    $links | ForEach-Object { Write-Output "  $($_.FullName) -> $($_.Target)" }
}
if ($unknownDirs.Count -gt 0) {
    Write-Warning "有 $($unknownDirs.Count) 个未识别目录将保留：$($unknownDirs.Name -join ', ')"
}
if ($List) {
    $targets | Sort-Object FullName | ForEach-Object { Write-Output $_.FullName }
}
if (-not $Delete) {
    Write-Output '仅预览。确认后添加 -Delete 执行。'
    exit 0
}

# .NET 的非递归删除只移除 Junction/SymbolicLink 本身，不触及其目标。
foreach ($link in $links) {
    if ($link.PSIsContainer) {
        [IO.Directory]::Delete($link.FullName, $false)
    } else {
        [IO.File]::Delete($link.FullName)
    }
}

$remainingLinks = @(Get-ChildItem -LiteralPath $expectedLocal -Recurse -Force -Attributes ReparsePoint |
    Where-Object {
        $path = $_.FullName
        foreach ($dir in $dirs) {
            if ($path.StartsWith($dir.FullName + [IO.Path]::DirectorySeparatorChar, $comparison)) {
                return $true
            }
        }
        return $false
    })
if ($remainingLinks.Count -gt 0) {
    throw "仍有链接，已停止：$($remainingLinks[0].FullName)"
}

$failures = [System.Collections.Generic.List[string]]::new()
$removed = 0
foreach ($item in $targets) {
    try {
        if ($item.PSIsContainer) {
            # Directory.Delete 不会穿过清理过程中新增的链接；失败时保留目录并报告。
            [IO.Directory]::Delete($item.FullName, $true)
        } else {
            Remove-Item -LiteralPath $item.FullName -Force -ErrorAction Stop
        }
        $removed++
    } catch {
        $failures.Add("$($item.FullName): $($_.Exception.Message)")
    }
    if (($removed + $failures.Count) % 200 -eq 0) {
        Write-Output "已处理 $($removed + $failures.Count)/$($targets.Count)；失败 $($failures.Count)。"
    }
}

Write-Output "完成：删除 $removed/$($targets.Count) 项；失败 $($failures.Count) 项。"
if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
    exit 1
}

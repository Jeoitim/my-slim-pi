# Run in PowerShell 7: irm https://raw.githubusercontent.com/Jeoitim/my-slim-pi/main/install.ps1 | iex
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
& {
    $ErrorActionPreference = 'Stop'
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required. Open pwsh and run this installer again.' }
    if ($env:OS -ne 'Windows_NT') { throw 'My Slim Pi requires Windows.' }
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $node -or -not $npm) { throw 'Node.js 24+ (including npm) is required. Install it and reopen PowerShell 7. Pi itself does not need to be preinstalled.' }
    $version = & $node.Source -p 'process.versions.node'
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^\d+\.' -or [int]($version.Split('.')[0]) -lt 24) { throw 'A working Node.js 24+ with npm is required. Pi itself will be installed automatically.' }
    $target = [IO.Path]::GetFullPath($AgentRoot)
    if (($NonInteractive -or [Console]::IsInputRedirected) -and -not $Plan -and -not $Update -and (Test-Path -LiteralPath $target) -and @(Get-ChildItem -LiteralPath $target -Force).Count -gt 0) {
        throw 'Target already contains files. Use -AgentRoot for a separate install, or explicitly use -Update to back up and update existing files.'
    }
    $headers = @{ 'User-Agent'='my-slim-pi-installer'; 'Accept'='application/vnd.github+json' }
    $commit = Invoke-RestMethod -Uri 'https://api.github.com/repos/Jeoitim/my-slim-pi/commits/main' -Headers $headers -TimeoutSec 60
    $sha = [string]$commit.sha
    if ($sha -notmatch '^[0-9a-f]{40}$') { throw 'GitHub did not return a valid commit.' }
    Write-Host "My Slim Pi source: $sha"
    $workspace = Join-Path ([IO.Path]::GetTempPath()) ('my-slim-pi-'+[Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $workspace
    # Keep the downloaded source for inspection/retry; no automatic recursive cleanup.
    Write-Host "Installer source directory: $workspace"
    $archive = Join-Path $workspace 'source.zip'
    Invoke-WebRequest -Uri "https://codeload.github.com/Jeoitim/my-slim-pi/zip/$sha" -OutFile $archive -TimeoutSec 120
    $prefix = "my-slim-pi-$sha/"
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if (-not $name.StartsWith($prefix,[StringComparison]::Ordinal) -or $name.Split('/') -contains '..' -or $name.Contains(':')) {
                throw 'Archive contains an unexpected path.'
            }
        }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $workspace
    $installer = Join-Path $workspace "my-slim-pi-$sha\scripts\Install-MySlimPi.ps1"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Downloaded source is missing the installer.' }
    $extra = @{}
    if ($NoPath) { $extra.NoPath=$true }
    if ($NonInteractive) { $extra.NonInteractive=$true }
    if ($SkipSearchKeys) { $extra.SkipSearchKeys=$true }
    if ($FullCheck) { $extra.FullCheck=$true }
    & $installer -AgentRoot $target -Update:$Update -Plan:$Plan -AddToPath:$AddToPath @extra
}

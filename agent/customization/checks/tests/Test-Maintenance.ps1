$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\Maintain-Pi.ps1')
function Assert-Maintenance($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
$fixture = Join-Path $env:TEMP ('pi-maintenance-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$script:AgentRoot = $fixture
$script:MaintenanceRoot = Join-Path $fixture 'customization'
foreach ($directory in @('customization\reports','extensions\timrt-suite','secrets','agents','themes','skills\pi-maintenance')) {
    New-Item -ItemType Directory -Path (Join-Path $fixture $directory) -Force | Out-Null
}
Write-PiJson (Join-Path $fixture 'settings.json') @{theme='before'}
Write-PiJson (Join-Path $fixture 'models.json') @{private='fixture-only'}
Write-PiJson (Join-Path $fixture 'secrets\web-keys.json') @{exa='fixture-only-not-a-key';tavily='fixture-tavily-not-a-key'}
[IO.File]::WriteAllText((Join-Path $fixture 'extensions\timrt-suite\sample.ts'),'export default 1;')
[IO.File]::WriteAllText((Join-Path $fixture 'skills\pi-maintenance\SKILL.md'),'Skill before.')
$blocked=$false
try { $null = Resolve-PiChild $fixture '..\outside.txt' } catch { $blocked=$true }
Assert-Maintenance $blocked 'Path traversal was not rejected.'
$snapshot = New-PiBackup -Label test
$manifestFile = Join-Path $snapshot 'configuration-snapshot.json'
$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Maintenance ($manifest.files -contains 'settings.json') 'Settings missing from backup.'
Assert-Maintenance ($manifest.files -contains 'extensions\timrt-suite\sample.ts') 'Local source missing from backup.'
Assert-Maintenance ($manifest.files -contains 'skills\pi-maintenance\SKILL.md') 'Maintenance skill missing from backup.'
Assert-Maintenance (Test-PiConfigPath 'extensions\timrt-suite\read-only-parser.ps1') 'Parser is not permitted in configuration backups.'
Assert-Maintenance (-not ($manifest.files -contains 'models.json')) 'Credentials unexpectedly included.'
Assert-Maintenance (-not ($manifest.files -contains 'secrets\web-keys.json')) 'Search keys unexpectedly included.'
$plan = @(Get-PiRestorePlan $snapshot)
Assert-Maintenance ($plan.Count -eq 3) 'Restore plan should contain configuration, source and local skill.'
Write-PiJson (Join-Path $fixture 'settings.json') @{theme='changed'}
[IO.File]::WriteAllText((Join-Path $fixture 'skills\pi-maintenance\SKILL.md'),'Skill changed.')
function Read-Host { param($Prompt) return 'RESTORE' }
Restore-PiBackup $snapshot -Commit
$restored = Get-Content -LiteralPath (Join-Path $fixture 'settings.json') -Raw | ConvertFrom-Json
Assert-Maintenance ($restored.theme -eq 'before') 'Restore did not recover the saved configuration.'
Assert-Maintenance ((Get-Content -LiteralPath (Join-Path $fixture 'skills\pi-maintenance\SKILL.md') -Raw) -eq 'Skill before.') 'Restore did not recover the local skill.'
Assert-Maintenance (@(Get-ChildItem -LiteralPath (Join-Path $fixture 'backups') -Directory -Filter 'config-before-restore-*').Count -eq 1) 'Restore did not create its safety backup.'
[IO.File]::WriteAllText((Join-Path $snapshot 'settings.json'),'{}')
$blocked=$false
try { $null = @(Get-PiRestorePlan $snapshot) } catch { $blocked=$true }
Assert-Maintenance $blocked 'Tampered backup was accepted.'
Write-PiJson (Join-Path $fixture 'customization\reports\test.json') @{test=$true}
$trash = Join-Path $fixture 'backups\maintenance-artifacts-20261016-010101'
New-Item -ItemType Directory -Path $trash | Out-Null
[IO.File]::WriteAllText((Join-Path $trash 'old.txt'),'retired')
$cleanup = @(Get-PiCleanupItems)
Assert-Maintenance ($cleanup.Count -eq 2) 'Cleanup selected more than reports and explicitly marked artifacts.'
Assert-Maintenance (-not ($cleanup.Path -contains $snapshot)) 'Cleanup selected a configuration snapshot.'
function Read-Host { param($Prompt) return 'CANCEL' }
Clear-PiGenerated -Commit
Assert-Maintenance (Test-Path -LiteralPath $trash) 'Cancelled cleanup deleted its target.'
Assert-Maintenance (Test-Path -LiteralPath (Join-Path $fixture 'customization\reports\test.json')) 'Cancelled cleanup deleted a report.'
Assert-Maintenance (Test-Path -LiteralPath (Join-Path $fixture 'secrets\web-keys.json')) 'Cleanup touched credentials.'
$blocked=$false
try { Clear-PiBackups -Mode KeepLatestTwo } catch { $blocked=$true }
Assert-Maintenance $blocked 'Keep-latest-two should refuse when no valid full backup exists.'
$fullCopies = @()
foreach ($year in @(2000,2010,2020)) {
    $copy = New-PiBackup -Label ('full'+$year)
    $metadataPath = Join-Path $copy 'configuration-snapshot.json'
    $metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $metadata.createdAt = "$year-01-01T00:00:00Z"
    Write-PiJson $metadataPath $metadata
    $fullCopies += $copy
}
$partial = New-PiBackup -Label newest-partial -Files @('settings.json')
$metadataPath = Join-Path $partial 'configuration-snapshot.json'
$metadata = Get-Content -LiteralPath $metadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
$metadata.createdAt = '2030-01-01T00:00:00Z'
Write-PiJson $metadataPath $metadata
$retention = Get-PiBackupPrunePlan KeepLatestTwo
Assert-Maintenance ($retention.Keep.Count -eq 2) 'Retention did not keep exactly two full backups.'
Assert-Maintenance ($retention.Keep[0].Path -eq $fullCopies[2]) 'Newest full backup was not kept.'
Assert-Maintenance ($retention.Keep[0].Created.UtcDateTime.Hour -eq 0) 'Backup creation timestamp lost its UTC offset.'
Assert-Maintenance ($retention.Keep[1].Path -eq $fullCopies[1]) 'Second-newest full backup was not kept.'
Assert-Maintenance ($retention.Delete.Path -contains $partial) 'A single-file edit backup incorrectly replaced a full snapshot.'
$all = Get-PiBackupPrunePlan All
Assert-Maintenance ($all.Keep.Count -eq 0) 'Delete-all plan unexpectedly preserves backups.'
Assert-Maintenance ($all.Delete.Count -eq @(Get-PiBackupInventory).Count) 'Delete-all plan omitted entries.'
Clear-PiBackups -Mode All -Commit
Clear-PiBackups -Mode KeepLatestTwo -Commit
Assert-Maintenance (Test-Path -LiteralPath $fullCopies[0]) 'Cancelled backup pruning deleted a directory.'
function Read-Host { param($Prompt,[switch]$AsSecureString) return (ConvertTo-SecureString 'fixture-brave-not-a-real-key' -AsPlainText -Force) }
Set-PiWebKey -Provider brave
$savedKeys = Get-Content -LiteralPath (Join-Path $fixture 'secrets\web-keys.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Assert-Maintenance ($savedKeys.brave -eq 'fixture-brave-not-a-real-key') 'Brave secure entry did not persist the key.'
Assert-Maintenance ($savedKeys.exa -eq 'fixture-only-not-a-key' -and $savedKeys.tavily -eq 'fixture-tavily-not-a-key') 'Brave entry overwrote other provider keys.'
$keyFile = Join-Path $fixture 'secrets\web-keys.json'
$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
foreach ($privatePath in @($snapshot, (Join-Path $fixture 'secrets'), $keyFile)) {
    $isFile = Test-Path -LiteralPath $privatePath -PathType Leaf
    if ($PSVersionTable.PSEdition -eq 'Core') {
        if ($isFile) { $privateAcl = [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($privatePath), [Security.AccessControl.AccessControlSections]::Access) }
        else { $privateAcl = [IO.FileSystemAclExtensions]::GetAccessControl([IO.DirectoryInfo]::new($privatePath), [Security.AccessControl.AccessControlSections]::Access) }
    } else {
        if ($isFile) { $privateAcl = [IO.File]::GetAccessControl($privatePath, [Security.AccessControl.AccessControlSections]::Access) }
        else { $privateAcl = [IO.Directory]::GetAccessControl($privatePath, [Security.AccessControl.AccessControlSections]::Access) }
    }
    $rules = @($privateAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    Assert-Maintenance $privateAcl.AreAccessRulesProtected 'Private configuration unexpectedly inherits access permissions.'
    Assert-Maintenance ($rules.Count -eq 1 -and $rules[0].IdentityReference -eq $currentUserSid -and $rules[0].AccessControlType -eq 'Allow' -and $rules[0].FileSystemRights -eq 'FullControl') 'Private configuration should grant full access only to the current user.'
    if (-not $isFile) { Assert-Maintenance ($rules[0].InheritanceFlags -eq 'ContainerInherit, ObjectInherit') 'Private directory does not protect newly created child files.' }
}
$beforeCancel = (Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash
function Read-PiSecretDialog { param($Provider) return $null }
Set-PiWebKey -Provider brave -Gui
Assert-Maintenance ((Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash -eq $beforeCancel) 'Cancelled GUI entry changed existing keys.'
function Read-PiSecretDialog { param($Provider) return (ConvertTo-SecureString 'short' -AsPlainText -Force) }
$blocked = $false
try { Set-PiWebKey -Provider brave -Gui } catch { $blocked = $true }
Assert-Maintenance $blocked 'Invalid short input should be rejected.'
Assert-Maintenance ((Get-FileHash -LiteralPath $keyFile -Algorithm SHA256).Hash -eq $beforeCancel) 'Invalid GUI entry changed existing keys.'
Write-Host 'Maintenance checks passed: path boundaries, private backup scope and DACL, hashed restore, safety backup, tamper rejection, cancellation, delete-all plan, latest-two retention and secure Brave entry preserving existing keys.' -ForegroundColor Green

# The saved independent entry must restore the maintainer, builder and launcher even if the live entry is broken.
$recoveryEntry = Join-Path $fixture 'recovery-entry\Maintain-Pi.ps1'
New-Item -ItemType Directory -Path (Split-Path -Parent $recoveryEntry) -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\Maintain-Pi.ps1') -Destination $recoveryEntry
foreach ($relative in @('customization\Maintain-Pi.ps1','customization\runtime\build-extensions.cjs','bin\pi-launcher.js')) {
    $target = Join-Path $fixture $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    [IO.File]::WriteAllText($target,'original-core')
}
$coreBackup = New-PiBackup -Label core-recovery
$corePlan = @(Get-PiRestorePlan $coreBackup)
foreach ($relative in @('customization\Maintain-Pi.ps1','customization\runtime\build-extensions.cjs','bin\pi-launcher.js')) {
    Assert-Maintenance ($corePlan.Relative -contains $relative) 'Core source missing from backup/restore plan.'
    [IO.File]::WriteAllText((Join-Path $fixture $relative),'broken-core')
}
Assert-Maintenance (-not (Test-PiConfigPath 'customization\runtime\policy-seal.json')) 'Generated seal must not be restored as trusted source.'
$recoveryShell = (Get-Process -Id $PID).Path
$recoveryCode = ". '$($recoveryEntry.Replace("'","''"))' -AgentRoot '$($fixture.Replace("'","''"))'; function Read-Host { param(`$Prompt) 'RESTORE' }; Restore-PiBackup '$($coreBackup.Replace("'","''"))' -Commit"
& $recoveryShell -NoLogo -NoProfile -Command $recoveryCode
Assert-Maintenance ($LASTEXITCODE -eq 0) 'Independent saved maintenance entry failed to restore core files.'
foreach ($relative in @('customization\Maintain-Pi.ps1','customization\runtime\build-extensions.cjs','bin\pi-launcher.js')) {
    Assert-Maintenance ([IO.File]::ReadAllText((Join-Path $fixture $relative)) -eq 'original-core') 'Core restoration did not recover the saved original.'
}
Write-Host 'Core backup and independent-entry recovery checks passed.' -ForegroundColor Green

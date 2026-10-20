$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../../Maintain-Pi.ps1')
$fixture = Join-Path $env:TEMP ('pi-maintenance-check-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$script:AgentRoot = $fixture
[IO.File]::WriteAllText((Join-Path $fixture 'settings.json'),'{"theme":"before"}')
$saved = New-PiBackup
[IO.File]::WriteAllText((Join-Path $fixture 'settings.json'),'{"theme":"changed"}')
$node = (Get-Command node).Source
'RESTORE' | & $node (Join-Path $PSScriptRoot '../../runtime/maintenance.mjs') --agent-root $fixture Restore --backup-path $saved --apply
if ($LASTEXITCODE -ne 0) { throw 'Windows external recovery failed' }
if ((Get-Content (Join-Path $fixture 'settings.json') -Raw | ConvertFrom-Json).theme -ne 'before') { throw 'Windows external recovery failed' }
Write-Host 'Windows UI wrapper backup and external recovery passed.'

# Exercise the SecureString save path without placing a key in process args.
function Read-Host { param($Prompt,[switch]$AsSecureString) ConvertTo-SecureString '!fixture-private-search-value' -AsPlainText -Force }
Set-PiWebKey -Provider brave
$webFile = Join-Path $fixture 'web-search.json'
if ((Get-Content -LiteralPath $webFile -Raw | ConvertFrom-Json).braveApiKey -ne '$!fixture-private-search-value') { throw 'Native key escaping failed' }
$acl = [IO.FileSystemAclExtensions]::GetAccessControl([IO.FileInfo]::new($webFile))
if (-not $acl.AreAccessRulesProtected) { throw 'Private native Web DACL missing' }
Write-Host 'Windows SecureString native Web key save and private DACL passed.'

import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const test=process.platform==='win32'?nodeTest:nodeTest.skip;

const root = process.cwd();
const quote = value => "'" + value.replaceAll("'", "''") + "'";
function run(mode, flags = []) {
  mkdirSync('.local', {recursive: true});
  const fixture = mkdtempSync(resolve('.local/bootstrap-'));
  const target = join(fixture, 'target'), record = join(fixture, 'record.json');
  if (mode === 'existing') { mkdirSync(target); writeFileSync(join(target, 'keep.txt'), 'keep'); }
  const harness = join(fixture, 'harness.ps1');
  writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
$env:TEMP = ${quote(fixture)}
$env:TMP = ${quote(fixture)}
$sha = 'a' * 40
$archive = Join-Path $env:TEMP 'fixture.zip'
$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
try {
  $entryName = 'my-slim-pi-'+$sha+'/scripts/Install-MySlimPi.ps1'
  if (${quote(mode)} -eq 'traversal') { $entryName = 'my-slim-pi-'+$sha+'/../escape.ps1' }
  $writer = [IO.StreamWriter]::new($zip.CreateEntry($entryName).Open())
  try { $writer.Write(@'
param([string]$AgentRoot,[switch]$Update,[switch]$Plan,[switch]$AddToPath)
if ('${mode}' -eq 'installer-failure') { throw 'Fixture installation failed' }
@{AgentRoot=$AgentRoot;Update=[bool]$Update;Plan=[bool]$Plan;AddToPath=[bool]$AddToPath} | ConvertTo-Json | Set-Content -LiteralPath ${quote(record)}
'@) } finally { $writer.Dispose() }
} finally { $zip.Dispose() }
function Invoke-RestMethod {
  param($Uri,$Headers,$TimeoutSec)
  if (${quote(mode)} -eq 'existing') { throw 'NETWORK MUST NOT BE CALLED' }
  if ($Uri -ne 'https://api.github.com/repos/Jeoitim/my-slim-pi/commits/main') { throw 'Unexpected metadata URL' }
  @{sha=$(if (${quote(mode)} -eq 'invalid-sha') {'invalid'} else {$sha})}
}
function Invoke-WebRequest {
  param($Uri,$OutFile,$TimeoutSec)
  if ($Uri -ne "https://codeload.github.com/Jeoitim/my-slim-pi/zip/$sha") { throw 'Archive must use the resolved commit' }
  Copy-Item -LiteralPath ${quote(join(fixture, 'fixture.zip'))} -Destination $OutFile
}
& ${quote(join(root, 'install.ps1'))} -AgentRoot ${quote(target)} ${flags.join(' ')}
`);
  const result = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-File', harness], {encoding:'utf8'});
  return {...result, target, record};
}
test('remote entry forwards preview, update, PATH and isolated target options', () => {
  const result = run('normal', ['-Plan', '-Update', '-AddToPath']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(result.record, 'utf8')), {
    AgentRoot: result.target, Update:true, Plan:true, AddToPath:true,
  });
  assert.equal(existsSync(result.target), false);
});
test('remote entry refuses existing files before any download', () => {
  const result = run('existing');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Target already contains files/);
  assert.doesNotMatch(result.stderr, /NETWORK MUST NOT BE CALLED/);
  assert.equal(readFileSync(join(result.target, 'keep.txt'), 'utf8'), 'keep');
});
for (const [mode, message] of [
  ['invalid-sha', /valid commit/],
  ['traversal', /unexpected path/],
  ['installer-failure', /Fixture installation failed/],
]) {
  test(`remote entry fails closed: ${mode}`, () => {
    const result = run(mode, ['-Plan']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(existsSync(result.record), false);
    assert.equal(existsSync(result.target), false);
  });
}

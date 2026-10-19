import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,mkdirSync,mkdtempSync,writeFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,join} from 'node:path';
const root=process.cwd(),manifest=JSON.parse(readFileSync('distribution.json','utf8'));
test('all package versions match the restored npm lock',()=>{
 const lock=JSON.parse(readFileSync('agent/npm/package-lock.json','utf8'));
 for(const [name,version] of Object.entries(manifest.packages)){
  assert.equal(lock.packages[''].dependencies[name],version);
  assert.equal(lock.packages['node_modules/'+name].version,version);
 }
});
test('share defaults contain no personal provider and use an isolated launcher',()=>{
 const settings=JSON.parse(readFileSync('agent/settings.json','utf8'));
 assert.equal(settings.defaultProvider,undefined);assert.equal(settings.defaultModel,undefined);
 assert.match(readFileSync('agent/bin/pi-launcher.js','utf8'),/process.env.PI_CODING_AGENT_DIR = agentDir/);
 assert.match(readFileSync('agent/customization/Maintain-Pi.ps1','utf8'),/\$env:PI_CODING_AGENT_DIR = \$script:AgentRoot/);
 assert.equal(existsSync('agent/models.json'),false);assert.equal(existsSync('agent/auth.json'),false);
});
test('installer defaults to no overwrite and no persistent PATH change',()=>{
 const script=readFileSync('scripts/Install-MySlimPi.ps1','utf8');
 assert.match(script,/\$exists -and -not \$Update/);
 assert.match(script,/if \(\$Plan\).*return/);
 assert.match(script,/if \(\$AddToPath\)/);
 assert.doesNotMatch(script,/Remove-Item|Invoke-Expression/);
});

test('installer refuses an existing target before writing and its plan is read-only',()=>{
 mkdirSync('.local',{recursive:true});
 const dir=mkdtempSync(join(root,'.local','install-guard-'));
 writeFileSync(join(dir,'keep.txt'),'must survive');
 const args=['-NoLogo','-NoProfile','-File',join(root,'scripts/Install-MySlimPi.ps1'),'-AgentRoot',dir];
 const plan=spawnSync('pwsh',args.concat('-Plan'),{encoding:'utf8'});
 assert.equal(plan.status,0,plan.stderr);
 const install=spawnSync('pwsh',args,{encoding:'utf8'});
 assert.notEqual(install.status,0);
 assert.deepEqual(readdirSync(dir),['keep.txt']);
 assert.equal(readFileSync(join(dir,'keep.txt'),'utf8'),'must survive');
});
test('installer refuses a drive root as a destination',()=>{
 const run=spawnSync('pwsh',['-NoLogo','-NoProfile','-File',join(root,'scripts/Install-MySlimPi.ps1'),'-AgentRoot','C:\\','-Plan'],{encoding:'utf8'});
 assert.notEqual(run.status,0);
});

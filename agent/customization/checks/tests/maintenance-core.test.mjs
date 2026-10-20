import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {backup,restorePlan,restore,child,configPath,cleanupPlan,cleanup} from '../../runtime/maintenance.mjs';
import {configurePlatform} from '../../runtime/platform-config.mjs';
const fixture=()=>{const base=resolve(process.env.PI_TEST_ROOT||join(process.cwd(),'.local'));fs.mkdirSync(base,{recursive:true});return fs.mkdtempSync(join(base,'pi-maintenance-core-'));};
const put=(root,p,data)=>{fs.mkdirSync(dirname(join(root,p)),{recursive:true});fs.writeFileSync(join(root,p),data);};
test('backup defaults exclude credentials and personal databases; explicit secret backup stays private',()=>{
  const root=fixture();
  for(const p of ['settings.json','APPEND_SYSTEM.windows.md','APPEND_SYSTEM.linux.md','customization/runtime/maintenance.mjs','models.json','auth.json','secrets/web-keys.json','sessions/test.json','pi-hermes-memory/memory.db'])put(root,p,'original');
  const snapshot=backup(root),meta=JSON.parse(fs.readFileSync(join(snapshot,'configuration-snapshot.json')));
  assert.equal(meta.credentialsIncluded,false);assert.equal(meta.files.length,4);
  assert.ok(meta.files.includes('APPEND_SYSTEM.linux.md'));
  const secret=backup(root,{files:['auth.json']});assert.equal(JSON.parse(fs.readFileSync(join(secret,'configuration-snapshot.json'))).credentialsIncluded,true);
  if(process.platform==='linux'){assert.equal(fs.statSync(secret).mode&0o777,0o700);assert.equal(fs.statSync(join(secret,'auth.json')).mode&0o777,0o600);}
  assert.throws(()=>backup(root,{files:['sessions/test.json']}));
  assert.equal(configPath('customization/runtime/policy-seal.json'),false);
});
test('restore validates hashes and exact scope, snapshots before changes, preserves unrelated files',()=>{
  const root=fixture();put(root,'settings.json','old');put(root,'unrelated.txt','keep');
  const snapshot=backup(root);put(root,'settings.json','new');
  const result=restore(root,restorePlan(root,snapshot));
  assert.equal(fs.readFileSync(join(root,'settings.json'),'utf8'),'old');
  assert.equal(fs.readFileSync(join(root,'unrelated.txt'),'utf8'),'keep');
  assert.equal(fs.readFileSync(join(result.safety,'settings.json'),'utf8'),'new');
  put(snapshot,'settings.json','corrupt');assert.throws(()=>restorePlan(root,snapshot),/integrity/);
});
test('restore rejects stale approvals, traversal, links and unlisted metadata entries',()=>{
  const root=fixture();put(root,'settings.json','old');const snapshot=backup(root),plan=restorePlan(root,snapshot);
  put(root,'settings.json','external');assert.throws(()=>restore(root,plan),/changed/);
  for(const p of ['../outside','/absolute','a/../../x','C:/x','a//x'])assert.throws(()=>child(root,p),p);
  const metadata=JSON.parse(fs.readFileSync(join(snapshot,'configuration-snapshot.json')));metadata.files.push('../outside');put(snapshot,'configuration-snapshot.json',JSON.stringify(metadata));assert.throws(()=>restorePlan(root,snapshot));
  if(process.platform==='linux'){const external=fixture();fs.symlinkSync(external,join(root,'linked'));assert.throws(()=>child(root,'linked/file'),/Links/);fs.symlinkSync(join(root,'settings.json'),join(root,'dangling'));assert.throws(()=>child(root,'dangling'),/Links/);}
});
test('a restore interrupted by a concurrent writer rolls back earlier writes and preserves the conflict',()=>{
  const root=fixture();put(root,'settings.json','old');put(root,'mcp.json','old');const snapshot=backup(root);
  put(root,'settings.json','current');put(root,'mcp.json','current');
  const plan=restorePlan(root,snapshot);
  assert.throws(()=>restore(root,plan,{beforeWrite:row=>{if(row.relative==='mcp.json')put(root,'mcp.json','external');}}),/Restore failed/);
  assert.equal(fs.readFileSync(join(root,'settings.json'),'utf8'),'current');assert.equal(fs.readFileSync(join(root,'mcp.json'),'utf8'),'external');
});
test('a saved external maintainer recovers its broken live implementation',()=>{
  const root=fixture(),code=fs.readFileSync(new URL('../../runtime/maintenance.mjs',import.meta.url));
  put(root,'customization/runtime/maintenance.mjs',code);put(root,'settings.json','original');
  const snapshot=backup(root);put(root,'customization/runtime/maintenance.mjs','broken');put(root,'settings.json','changed');
  const result=spawnSync(process.execPath,[join(snapshot,'customization/runtime/maintenance.mjs'),'--agent-root',root,'Restore','--backup-path',snapshot,'--apply'],{encoding:'utf8',input:'RESTORE\n'});
  assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(join(root,'settings.json'),'utf8'),'original');assert.deepEqual(fs.readFileSync(join(root,'customization/runtime/maintenance.mjs')),code);
});
test('cleanup previews only designated generated files and rejects changed deletion evidence',()=>{
  const root=fixture();put(root,'customization/reports/old.log','old');put(root,'secrets/web-keys.json','private');put(root,'settings.json','{}');
  const snapshot=backup(root),plan=cleanupPlan(root);assert.equal(plan.length,1);
  put(root,'customization/reports/old.log','external');assert.throws(()=>cleanup(root,plan,'Clean'),/changed/);
  cleanup(root,cleanupPlan(root),'Clean');assert.ok(fs.existsSync(snapshot));assert.ok(fs.existsSync(join(root,'secrets/web-keys.json')));
});
test('retention keeps the latest two valid full snapshots; corrupted snapshots are not treated as recoverable',()=>{
  const root=fixture();put(root,'settings.json','{}');
  const snapshots=[backup(root),backup(root),backup(root)];
  const plan=cleanupPlan(root,'PruneBackups','KeepLatestTwo');assert.equal(plan.length,1);
  cleanup(root,plan,'PruneBackups','KeepLatestTwo');assert.equal(snapshots.filter(p=>fs.existsSync(p)).length,2);
  const empty=fixture();assert.throws(()=>cleanupPlan(empty,'PruneBackups','KeepLatestTwo'),/No valid full backup/);
});
test('platform configuration deploys one complete prompt and preserves custom tools and runtime rules',()=>{
  for(const [platform,shell,other] of [['win32','powershell','bash'],['linux','bash','powershell']]) {
    const root=fixture();put(root,'settings.json','{}');put(root,'APPEND_SYSTEM.windows.md','Windows rules');put(root,'APPEND_SYSTEM.linux.md','Linux rules');
    const result=configurePlatform(root,platform);assert.ok(result.defaultTools.includes(shell));assert.ok(!result.defaultTools.includes(other));
    assert.equal(fs.readFileSync(join(root,'APPEND_SYSTEM.md'),'utf8'),platform==='win32'?'Windows rules':'Linux rules');
    put(root,'settings.json','{"defaultTools":["read"]}');put(root,'APPEND_SYSTEM.md','custom rules');configurePlatform(root,platform);
    assert.equal(fs.readFileSync(join(root,'APPEND_SYSTEM.md'),'utf8'),'custom rules');assert.deepEqual(JSON.parse(fs.readFileSync(join(root,'settings.json'))).defaultTools,['read']);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir,tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,linkSync,symlinkSync,unlinkSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=process.env.PI_CODING_AGENT_DIR || join(homedir(),'.pi/agent');
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const {createJiti}=await import(pathToFileURL(join(root,'install/releases',version,'node_modules/jiti/lib/jiti.mjs')));
const {validateMaintenance,maintenanceScope,skillSourcePath,applyMaintenance,fileHash}=await createJiti(import.meta.url).import(join(root,'extensions/timrt-suite/self-maintenance.ts'));
const request='请维护 Pi 的主题和界面配置';
test('self-maintenance rejects hardlinked targets',()=>{
  const f=fixture(),alias=join(f.dir,'alias');linkSync(f.file,alias);
  assert.throws(()=>validateMaintenance(f.dir,request,[f.change]),/hard links/);
});
test('rollback refuses a symlink swapped in after the approved write', {skip:process.platform!=='linux'},async()=>{
  const f=fixture(),external=join(f.dir,'external.json');writeFileSync(external,f.change.content);
  await assert.rejects(applyMaintenance(f.dir,request,[f.change],{
    approved:async()=>true,current:()=>true,
    run:async(_cmd,args)=>{if(args.at(-1)==='Check'){unlinkSync(f.file);symlinkSync(external,f.file);return {code:1,stdout:'',stderr:'candidate failed'};}return {code:0,stdout:'backup-path',stderr:''};},
  }),/external concurrent changes/);
  assert.equal(readFileSync(external,'utf8'),f.change.content);
});
test('active platform prompt and runtime edits require one identical reviewed patch',()=>{
  const root=mkdtempSync(join(tmpdir(),'pi-prompt-pair-'));
  const active='APPEND_SYSTEM.'+(process.platform==='win32'?'windows':'linux')+'.md';
  writeFileSync(join(root,active),'old');writeFileSync(join(root,'APPEND_SYSTEM.md'),'old');
  const a={path:active,sha256:fileHash('old'),content:'new'},b={...a,path:'APPEND_SYSTEM.md'};
  assert.throws(()=>validateMaintenance(root,'请维护 Pi 权限规则',[a]),/Submit identical patches/);
  assert.throws(()=>validateMaintenance(root,'请维护 Pi 权限规则',[b]),/Submit identical patches/);
  assert.equal(validateMaintenance(root,'请维护 Pi 权限规则',[a,b]).length,2);
});
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'pi-self-maintenance-'));
  const path='pi-cc-extensions.json',file=join(dir,path),before='{"enabled":true}\n';
  writeFileSync(file,before);
  return {dir,path,file,before,change:{path,sha256:fileHash(before),content:'{"enabled":false}\n'}};
}
test('structure checks enforce scope and hashes without pretending to decide semantic consent',()=>{
  const f=fixture();
  assert.throws(()=>validateMaintenance(f.dir,'',[f.change]),/real user instruction/);
  assert.deepEqual(maintenanceScope(['extensions/timrt-suite/permissions.ts','APPEND_SYSTEM.md','themes/a.json'].map(path=>({path,content:'',before:null}))),{core:['extensions/timrt-suite/permissions.ts'],permissions:['APPEND_SYSTEM.md']});
  for(const path of ['../outside.json','C:/outside.json','auth.json','secrets/web-keys.json'])assert.throws(()=>validateMaintenance(f.dir,request,[{path,sha256:null,content:'x'}]),undefined,path);
  assert.throws(()=>validateMaintenance(f.dir,request,[{...f.change,sha256:'0'.repeat(64)}]),/file changed/);
  assert.throws(()=>validateMaintenance(f.dir,request,[f.change,f.change]),/duplicate file/);
  assert.equal(validateMaintenance(f.dir,request,[{path:'APPEND_SYSTEM.md',sha256:null,content:'policy'}]).length,1,'structure is not a semantic grant');
  assert.equal(validateMaintenance(f.dir,'请维护 Pi 权限配置',[{path:'APPEND_SYSTEM.md',sha256:null,content:'Keep safeguards.'}]).length,1);
  for(const path of ['extensions/timrt-suite/permissions.ts','extensions/timrt-suite/self-maintenance.ts','extensions/timrt-suite/index.ts','customization/runtime/policy-files.cjs','customization/runtime/build-extensions.cjs','customization/Maintain-Pi.ps1','bin/pi-launcher.js']) {
    assert.equal(validateMaintenance(f.dir,'请维护 Pi 权限、事务、构建和加载内核',[{path,sha256:null,content:'// reviewed source'}]).length,1,path);
  }
  for(const path of ['customization/runtime/policy-seal.json','customization/runtime/compiled-extensions.json','npm/node_modules/unsafe.js'])assert.throws(()=>validateMaintenance(f.dir,'请维护 Pi 权限内核',[{path,sha256:null,content:'{}'}]));
});
test('settings distinguish theme edits from loader changes for semantic review',()=>{
  const f=fixture(),settings={extensions:['kernel'],packages:['permission'],theme:'old',defaultTools:['read']};
  writeFileSync(join(f.dir,'settings.json'),JSON.stringify(settings));
  const change={path:'settings.json',sha256:fileHash(JSON.stringify(settings)),content:JSON.stringify({...settings,theme:'new'})};
  assert.equal(validateMaintenance(f.dir,request,[change]).length,1);
  assert.deepEqual(maintenanceScope(validateMaintenance(f.dir,request,[change])),{core:[],permissions:[]});
  assert.deepEqual(maintenanceScope(validateMaintenance(f.dir,request,[{...change,content:JSON.stringify({...settings,extensions:[]})}])),{core:['settings.json'],permissions:[]});
  assert.equal(validateMaintenance(f.dir,request,[{...change,content:JSON.stringify({...settings,extensions:[]})}]).length,1,'reviewer judges loader intent against the exact patch');
  assert.equal(validateMaintenance(f.dir,'请维护 Pi 组件加载清单',[{...change,content:JSON.stringify({...settings,extensions:['reviewed-loader']})}]).length,1);
});

function coreFixture() {
  const f=fixture(),path='customization/runtime/build-extensions.cjs';
  for(const [relative,text] of [[path,'// old builder'],['customization/Maintain-Pi.ps1','# old independent maintainer'],['customization/runtime/maintenance.mjs','// old node maintainer'],['customization/runtime/policy-files.cjs','// old verifier'],['customization/checks/check-components.mjs','// old checks']]) {
    const full=join(f.dir,relative);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);
  }
  const backup=join(f.dir,'backups','core-test');
  const change={path,sha256:fileHash('// old builder'),content:'// new reviewed builder'};
  const actions=[];
  const run=async(_cmd,args)=>{
    const action=args.at(-1);actions.push(action);
    if(action==='Backup'){
      mkdirSync(dirname(join(backup,path)),{recursive:true});writeFileSync(join(backup,path),'// old builder');
      writeFileSync(join(backup,'configuration-snapshot.json'),JSON.stringify({files:[path]}));
    } else {
      const runner=args[0];
      assert.equal(runner,join(backup,'transaction-runner/customization/runtime/maintenance.mjs'));
      assert.equal(readFileSync(runner,'utf8'),'// old node maintainer');
      assert.equal(readFileSync(join(backup,'transaction-runner',path),'utf8'),'// old builder');
    }
    return {code:0,stdout:backup,stderr:''};
  };
  return {...f,path,change,backup,actions,run};
}
test('core maintenance verifies full backup and runs only the pre-change maintenance/build/check snapshot',async()=>{
  const f=coreFixture();
  const result=await applyMaintenance(f.dir,'请维护 Pi 构建内核',[f.change],{approved:async()=>true,current:()=>true,run:f.run});
  assert.equal(result.coreMaintenance,true);assert.deepEqual(f.actions,['Backup','Rebuild','Check']);
  assert.equal(readFileSync(join(f.dir,f.path),'utf8'),f.change.content);
});
test('core maintenance refuses incomplete backups before applying files',async()=>{
  const f=coreFixture();
  await assert.rejects(applyMaintenance(f.dir,'请维护 Pi 构建内核',[f.change],{approved:async()=>true,current:()=>true,run:async(...args)=>{
    const result=await f.run(...args);writeFileSync(join(f.backup,'configuration-snapshot.json'),'{"files":[]}');return result;
  }}),/backup missing/);
  assert.equal(readFileSync(join(f.dir,f.path),'utf8'),'// old builder');
});
test('failed core validation restores the old builder without generating a new build identity',async()=>{
  const f=coreFixture();
  await assert.rejects(applyMaintenance(f.dir,'请维护 Pi 构建内核',[f.change],{approved:async()=>true,current:()=>true,run:async(...args)=>{
    const result=await f.run(...args);return args[1].at(-1)==='Check'?{...result,code:1,stderr:'candidate failed'}:result;
  }}),/source files.*restored/);
  assert.deepEqual(f.actions,['Backup','Rebuild','Check']);
  assert.equal(readFileSync(join(f.dir,f.path),'utf8'),'// old builder');
});
test('tampering with the frozen runner stops further commands and preserves a recovery path',async()=>{
  const f=coreFixture();
  await assert.rejects(applyMaintenance(f.dir,'请维护 Pi 构建内核',[f.change],{approved:async()=>true,current:()=>true,run:async(...args)=>{
    const result=await f.run(...args);
    if(args[1].at(-1)==='Rebuild')writeFileSync(join(f.backup,'transaction-runner/customization/Maintain-Pi.ps1'),'tampered');
    return result;
  }}),/snapshot changed/);
  assert.deepEqual(f.actions,['Backup','Rebuild']);
  assert.equal(readFileSync(join(f.dir,f.path),'utf8'),'// old builder');
});
test('approved maintenance backs up before writes, rebuilds, checks and requires reload',async()=>{
  const f=fixture(),actions=[];
  const result=await applyMaintenance(f.dir,request,[f.change],{
    approved:async()=>true,current:()=>true,
    run:async(_command,args)=>{const action=args.at(-1);actions.push(action);assert.equal(readFileSync(f.file,'utf8'),action==='Backup'?f.before:f.change.content);return {code:0,stdout:'backup-path',stderr:''};},
  });
  assert.deepEqual(actions,['Backup','Rebuild','Check']);assert.equal(result.reloadRequired,true);
  assert.equal(readFileSync(f.file,'utf8'),f.change.content);
});
test('rejected or stale maintenance does not run a backup or change files',async()=>{
  for(const approve of [false,true]){
    const f=fixture();let runs=0;
    await assert.rejects(applyMaintenance(f.dir,request,[f.change],{approved:async()=>approve,current:()=>false,run:async()=>{runs++;throw Error('must not run');}}));
    assert.equal(runs,0);assert.equal(readFileSync(f.file,'utf8'),f.before);
  }
});
test('failed checks restore original files and remove only files created in this transaction',async()=>{
  const f=fixture(),added={path:'themes/test.json',sha256:null,content:'{}'},actions=[];
  await assert.rejects(applyMaintenance(f.dir,request,[f.change,added],{
    approved:async()=>true,current:()=>true,
    run:async(_cmd,args)=>{const action=args.at(-1);actions.push(action);return {code:action==='Check'?1:0,stdout:'fixture-backup',stderr:action==='Check'?'fixture failure':''};},
  }),/source files.*restored/);
  assert.deepEqual(actions,['Backup','Rebuild','Check']);
  assert.equal(readFileSync(f.file,'utf8'),f.before);assert.equal(existsSync(join(f.dir,added.path)),false);
});
test('rollback preserves external concurrent edits and reports the backup instead of overwriting',async()=>{
  const f=fixture();
  await assert.rejects(applyMaintenance(f.dir,request,[f.change],{
    approved:async()=>true,current:()=>true,
    run:async(_cmd,args)=>{if(args.at(-1)==='Check'){writeFileSync(f.file,'external-edit');return {code:1,stdout:'fixture',stderr:'failure'};}return {code:0,stdout:'fixture-backup',stderr:''};},
  }),/external concurrent changes/);
  assert.equal(readFileSync(f.file,'utf8'),'external-edit');
});

test('a changed maintenance kernel is never executed after approval',async()=>{
  const f=fixture(),maintainer=join(f.dir,'customization/Maintain-Pi.ps1');
  mkdirSync(dirname(maintainer),{recursive:true});writeFileSync(maintainer,'original');
  let runs=0;
  await assert.rejects(applyMaintenance(f.dir,request,[f.change],{
    approved:async()=>{writeFileSync(maintainer,'external-change');return true;},current:()=>true,
    run:async()=>{runs++;return {code:0,stdout:'',stderr:''};},
  }),/core changed/);
  assert.equal(runs,0);assert.equal(readFileSync(f.file,'utf8'),f.before);
});

test('new skill text sources share transaction and backup scope without admitting arbitrary files',async()=>{
  const {configPath,configFiles,backup}=await import('../../runtime/maintenance.mjs');
  const f=fixture();
  for(const path of ['skills/cjk-display/SKILL.md','skills/cjk-display/scripts/check.py','skills/cjk-display/references/fonts.md','skills/cjk-display/assets/style.css']) {
    assert.equal(skillSourcePath(path),true);assert.equal(configPath(path),true);
    assert.equal(validateMaintenance(f.dir,'给 Pi 安装刚才讨论的中文字体技能',[{path,sha256:null,content:'source'}]).length,1);
    mkdirSync(dirname(join(f.dir,path)),{recursive:true});writeFileSync(join(f.dir,path),'source');
  }
  for(const path of ['skills/../auth.json','skills/name/auth.json','skills/name/scripts/.env','skills/name/scripts/tool.exe','skills/name/scripts/node_modules/x.js'])assert.equal(skillSourcePath(path),false,path);
  assert.ok(configFiles(f.dir).includes('skills/cjk-display/scripts/check.py'));
  const snapshot=backup(f.dir);assert.equal(readFileSync(join(snapshot,'skills/cjk-display/scripts/check.py'),'utf8'),'source');
});

test('failed validation restores byte-identical build outputs and seal; concurrent artifact edits are preserved',async()=>{
  for(const conflict of [false,true]) {
    const f=fixture(),builder=join(f.dir,'customization/runtime/build-extensions.cjs'),seal='customization/runtime/policy-seal.json',output='extensions/timrt-suite/timrt-fast.mjs';
    mkdirSync(dirname(builder),{recursive:true});mkdirSync(dirname(join(f.dir,output)),{recursive:true});
    writeFileSync(builder,'exports.stateFiles=()=>'+JSON.stringify([seal,output])+';');writeFileSync(join(f.dir,seal),'old-seal');
    const directory=join(f.dir,'backups','artifact-test');mkdirSync(directory,{recursive:true});const actions=[];
    await assert.rejects(applyMaintenance(f.dir,request,[f.change],{approved:async()=>true,current:()=>true,policyIntact:()=>readFileSync(join(f.dir,seal),'utf8')==='old-seal',run:async(_cmd,args)=>{
      const action=args.at(-1);actions.push(action);
      if(action==='Rebuild'){writeFileSync(join(f.dir,seal),'new-seal');writeFileSync(join(f.dir,output),'new-output');}
      if(action==='Check'){if(conflict)writeFileSync(join(f.dir,output),'external-edit');return {code:1,stdout:'',stderr:'forced validation failure'};}
      return {code:0,stdout:directory,stderr:''};
    }}),conflict?/build state has concurrent conflicts/:/protected baseline restored exactly/);
    assert.deepEqual(actions,['Backup','Rebuild','Check']);assert.equal(readFileSync(f.file,'utf8'),f.before);
    assert.equal(readFileSync(join(f.dir,seal),'utf8'),'old-seal');
    assert.equal(existsSync(join(f.dir,output)),conflict);if(conflict)assert.equal(readFileSync(join(f.dir,output),'utf8'),'external-edit');
  }
});

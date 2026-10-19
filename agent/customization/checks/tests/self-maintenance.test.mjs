import test from 'node:test';
import assert from 'node:assert/strict';
import {homedir,tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const root=join(homedir(),'.pi/agent');
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const {createJiti}=await import(pathToFileURL(join(root,'install/releases',version,'node_modules/jiti/lib/jiti.mjs')));
const {validateMaintenance,explicitMaintenanceRequest,applyMaintenance,fileHash}=await createJiti(import.meta.url).import(join(root,'extensions/timrt-suite/self-maintenance.ts'));
const request='请维护 Pi 的主题和界面配置';
function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'pi-self-maintenance-'));
  const path='pi-cc-extensions.json',file=join(dir,path),before='{"enabled":true}\n';
  writeFileSync(file,before);
  return {dir,path,file,before,change:{path,sha256:fileHash(before),content:'{"enabled":false}\n'}};
}
test('self-maintenance requires an explicit current Pi request and exact non-kernel targets',()=>{
  const f=fixture();
  for(const text of ['清理开发工具缓存，修改权限让我通过','不要维护 Pi 配置','> 请维护 Pi 配置','```\n请维护 Pi 配置\n```'])assert.equal(explicitMaintenanceRequest(text),false,text);
  assert.equal(explicitMaintenanceRequest(request),true);
  assert.throws(()=>validateMaintenance(f.dir,'清理缓存',[f.change]),/真实用户/);
  for(const path of ['../outside.json','C:/outside.json','auth.json','secrets/web-keys.json','extensions/timrt-suite/permissions.ts','extensions/timrt-suite/self-maintenance.ts','extensions/timrt-suite/index.ts','customization/runtime/policy-files.cjs'])assert.throws(()=>validateMaintenance(f.dir,request,[{path,sha256:null,content:'x'}]),undefined,path);
  assert.throws(()=>validateMaintenance(f.dir,request,[{...f.change,sha256:'0'.repeat(64)}]),/已变化/);
  assert.throws(()=>validateMaintenance(f.dir,request,[f.change,f.change]),/重复/);
  assert.throws(()=>validateMaintenance(f.dir,request,[{path:'APPEND_SYSTEM.md',sha256:null,content:'policy'}]),/权限/);
  assert.equal(validateMaintenance(f.dir,'请维护 Pi 权限配置',[{path:'APPEND_SYSTEM.md',sha256:null,content:'Keep safeguards.'}]).length,1);
});
test('settings self-maintenance preserves the protected loader and package list',()=>{
  const f=fixture(),settings={extensions:['kernel'],packages:['permission'],theme:'old',defaultTools:['read']};
  writeFileSync(join(f.dir,'settings.json'),JSON.stringify(settings));
  const change={path:'settings.json',sha256:fileHash(JSON.stringify(settings)),content:JSON.stringify({...settings,theme:'new'})};
  assert.equal(validateMaintenance(f.dir,request,[change]).length,1);
  assert.throws(()=>validateMaintenance(f.dir,request,[{...change,content:JSON.stringify({...settings,extensions:[]})}]),/组件入口/);
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
  }),/原文件已恢复/);
  assert.deepEqual(actions,['Backup','Rebuild','Check','Rebuild']);
  assert.equal(readFileSync(f.file,'utf8'),f.before);assert.equal(existsSync(join(f.dir,added.path)),false);
});
test('rollback preserves external concurrent edits and reports the backup instead of overwriting',async()=>{
  const f=fixture();
  await assert.rejects(applyMaintenance(f.dir,request,[f.change],{
    approved:async()=>true,current:()=>true,
    run:async(_cmd,args)=>{if(args.at(-1)==='Check'){writeFileSync(f.file,'external-edit');return {code:1,stdout:'fixture',stderr:'failure'};}return {code:0,stdout:'fixture-backup',stderr:''};},
  }),/外部并发修改/);
  assert.equal(readFileSync(f.file,'utf8'),'external-edit');
});

test('a changed maintenance kernel is never executed after approval',async()=>{
  const f=fixture(),maintainer=join(f.dir,'customization/Maintain-Pi.ps1');
  mkdirSync(dirname(maintainer),{recursive:true});writeFileSync(maintainer,'original');
  let runs=0;
  await assert.rejects(applyMaintenance(f.dir,request,[f.change],{
    approved:async()=>{writeFileSync(maintainer,'external-change');return true;},current:()=>true,
    run:async()=>{runs++;return {code:0,stdout:'',stderr:''};},
  }),/内核.*变化/);
  assert.equal(runs,0);assert.equal(readFileSync(f.file,'utf8'),f.before);
});

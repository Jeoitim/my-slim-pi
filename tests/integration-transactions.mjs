// Explicit integration command; intentionally outside Check's recursive test discovery.
// Only a disposable installation under a repository's .local directory is accepted.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=resolve(process.argv[2]||'');
if(!root.replaceAll('\\','/').includes('/.local/'))throw Error('Pass a disposable .local AgentRoot');
process.env.PI_CODING_AGENT_DIR=root;process.env.PI_MAINTENANCE_TARGET=root;process.env.PI_OFFLINE='1';
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const {createJiti}=await import(pathToFileURL(join(root,'install/releases',version,'node_modules/jiti/lib/jiti.mjs')));
const {applyMaintenance,fileHash}=await createJiti(import.meta.url).import(join(root,'extensions/my-slim-pi-suite/self-maintenance.ts'));
const run=async(command,args,options)=>{
  const r=spawnSync(command,args,{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:options.timeout,maxBuffer:16_000_000});
  return {code:r.status??1,stdout:r.stdout||'',stderr:r.stderr||String(r.error||'')};
};
// Reproduce a successful build followed by validation failure in a live, pinned
// process. The old seal must survive byte-for-byte without another rebuild.
const jiti=createJiti(import.meta.url);
const {policyHealth}=await jiti.import(join(root,'extensions/my-slim-pi-suite/call-policy.ts'));
const {createRequire}=await import('node:module');
const require=createRequire(import.meta.url),builder=join(root,'customization/runtime/build-extensions.cjs');
const states=require(builder).stateFiles();
const beforeBuild=new Map(states.map(p=>[p,readFileSync(join(root,p))]));
assert.equal(policyHealth(root).ok,true);
const path='pi-btw.json',before=readFileSync(join(root,path));
await assert.rejects(applyMaintenance(root,'继续之前的 Pi 界面维护',[{path,sha256:fileHash(before),content:before.toString('utf8')+'\n'}],{
  approved:async()=>true,current:()=>true,policyIntact:()=>policyHealth(root).ok,
  run:(command,args,options)=>args.at(-1)==='Check'?Promise.resolve({code:1,stdout:'',stderr:'forced post-build failure'}):run(command,args,options),
}),/保护基线已精确恢复/);
for(const [p,data] of beforeBuild)assert.deepEqual(readFileSync(join(root,p)),data,p);
assert.deepEqual(readFileSync(join(root,path)),before);assert.equal(policyHealth(root).ok,true);
assert.equal(require(builder).valid(),true,'rollback must not trigger an implicit rebuild at next launch');
console.log('PASS: post-build validation failure restores exact artifacts/seal; pinned live policy and build remain valid');
for(const [file,content,failure] of [
  ['pi-btw.json',null,false],
  ['customization/runtime/maintenance.mjs',null,false],
  ['customization/runtime/maintenance.mjs','const = invalid candidate syntax',true],
]) {
  const target=join(root,file),before=readFileSync(target),change={path:file,sha256:fileHash(before),content:content??before.toString('utf8')+'\n// placeholder'};
  if(file.endsWith('.json'))change.content=before.toString('utf8')+'\n';
  const deps={approved:async()=>true,current:()=>true,run};
  try {
    if(failure) {
      await assert.rejects(applyMaintenance(root,'请维护 Pi 事务、构建和校验内核',[change],deps),/语法预检失败/);
      assert.deepEqual(readFileSync(target),before);
      console.log('PASS: invalid candidate maintainer rejected before backup or source mutation');
    } else {
      const result=await applyMaintenance(root,'请维护 Pi 事务、构建和校验内核及界面配置',[change],deps);
      assert.equal(result.reloadRequired,true);assert.equal(readFileSync(target,'utf8'),change.content);
      console.log('PASS: real backup → apply → '+(result.coreMaintenance?'frozen ':'')+'rebuild → offline Check: '+file);
    }
  } finally {
    writeFileSync(target,before);
    const r=await run(process.execPath,[join(root,'customization/runtime/maintenance.mjs'),'--agent-root',root,'Rebuild'],{});assert.equal(r.code,0,r.stderr);
  }
}

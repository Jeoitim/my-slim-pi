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
const {applyMaintenance,fileHash}=await createJiti(import.meta.url).import(join(root,'extensions/timrt-suite/self-maintenance.ts'));
const run=async(command,args,options)=>{
  const r=spawnSync(command,args,{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,timeout:options.timeout,maxBuffer:16_000_000});
  return {code:r.status??1,stdout:r.stdout||'',stderr:r.stderr||String(r.error||'')};
};
for(const [file,content,failure] of [
  ['pi-cc-extensions.json',null,false],
  ['customization/runtime/maintenance.mjs',null,false],
  ['customization/runtime/maintenance.mjs','const = invalid candidate syntax',true],
]) {
  const target=join(root,file),before=readFileSync(target),change={path:file,sha256:fileHash(before),content:content??before.toString('utf8')+'\n// placeholder'};
  if(file.endsWith('.json'))change.content=before.toString('utf8')+'\n';
  const deps={approved:async()=>true,current:()=>true,run};
  try {
    if(failure) {
      await assert.rejects(applyMaintenance(root,'请维护 Pi 事务、构建和校验内核',[change],deps),/原文件已恢复/);
      assert.deepEqual(readFileSync(target),before);
      console.log('PASS: invalid candidate maintainer rejected by frozen code; original restored and rebuilt');
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

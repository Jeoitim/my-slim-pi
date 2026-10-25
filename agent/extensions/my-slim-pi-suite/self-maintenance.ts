import {createHash} from "node:crypto";
import {existsSync,lstatSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,readdirSync,copyFileSync,utimesSync,chmodSync} from "node:fs";
import {join,resolve,relative,dirname} from "node:path";
import {createRequire} from "node:module";

export type MaintenanceChange={path:string;sha256:string|null;content:string};
const pathKey=(p:string)=>process.platform==="win32"?p.toLowerCase():p;
const kernel=/^(?:extensions\/my-slim-pi-suite\/(?:index|self-maintenance|permissions|permission-brief|prompt-policy|call-policy|guards|deletion-review|approval-reviewer|approval-evidence|shell-analysis|terminal-notifications)\.ts|extensions\/my-slim-pi-suite\/read-only-parser\.ps1|customization\/runtime\/|customization\/(?:Maintain-Pi\.ps1|Pi-Maintenance\.bat|maintain-pi\.sh)|bin\/(?:pi|pi-launcher\.js|pi\.cmd|pi\.ps1)|trust\.json)$/i;
export const coreMaintenancePath=(path:string)=>kernel.test(path) || /^customization\/(?:runtime|checks)\//i.test(path);
export const fileHash=(data:Buffer|string)=>createHash("sha256").update(data).digest("hex");
export {skillSourcePath} from "../../customization/runtime/policy-files.cjs";
import {skillSourcePath,seal as policySeal} from "../../customization/runtime/policy-files.cjs";
export function maintenanceScope(plan:{path:string;content:string;before:Buffer|null}[]) {
  const paths=plan.map(p=>p.path);
  const core=paths.filter(coreMaintenancePath);
  for(const file of plan)if(pathKey(file.path)==='settings.json') {
    const before=file.before?JSON.parse(file.before.toString('utf8')):{},after=JSON.parse(file.content);
    if(['extensions','packages','defaultTools'].some(key=>JSON.stringify(before[key])!==JSON.stringify(after[key])))core.push(file.path);
  }
  return {core,permissions:paths.filter(p=>/^(?:APPEND_SYSTEM(?:\.(?:windows|linux))?\.md|agents\/approver\.md|extensions\/pi-permission-suite\/config\.json|trust\.json)$/i.test(p))};
}
function coreSnapshot(root:string) {
  // Capture the complete pre-change protected graph, using the old verifier's
  // canonical treatment of interactive settings and private Web credentials.
  return JSON.stringify(Object.entries(policySeal(root).files).sort(([a],[b])=>a<b?-1:a>b?1:0));
}
export function validateMaintenance(root:string,request:string,changes:MaintenanceChange[],validatePairs=true) {
  // This validates structure, never natural-language consent. The pre-change
  // reviewer (or ASK human) must authorize the exact patch against human evidence.
  if(!request.trim())throw Error("A current real user instruction is required before Pi self-maintenance can start.");
  if(!changes.length || changes.length>8)throw Error("Submit 1–8 explicit files per maintenance call; unknown bulk targets are not accepted.");
  if(changes.reduce((n,c)=>n+Buffer.byteLength(c.content,"utf8"),0)>128000)throw Error("Maintenance patch exceeds 128 KB; split it into reviewable tasks.");
  changes=changes.map(c=>({...c,path:c.path.replaceAll('\\','/')}));
  const activePrompt='APPEND_SYSTEM.'+(process.platform==='win32'?'windows':'linux')+'.md';
  if(validatePairs && existsSync(join(root,activePrompt))) {
    const runtime=changes.find(c=>pathKey(c.path)===pathKey('APPEND_SYSTEM.md')),source=changes.find(c=>pathKey(c.path)===pathKey(activePrompt));
    if((runtime || source) && (!runtime || !source || runtime.content!==source.content))throw Error('Submit identical patches for the current platform source and APPEND_SYSTEM.md in the same approval and backup.');
  }
  const seen=new Set<string>();
  return changes.map(change=>{
    const path=change.path.replaceAll("\\","/");
    if(!path || /[:\x00-\x1f]/.test(path) || path.startsWith("/") || path.split("/").some(p=>!p || p===".." || p==="."))throw Error("Maintenance paths must be explicit relative file paths inside the configuration directory.");
    const key=pathKey(path);if(seen.has(key))throw Error("Maintenance patch contains a duplicate file.");seen.add(key);
    const allowed=/^(?:settings\.json|trust\.json|APPEND_SYSTEM(?:\.(?:windows|linux))?\.md|agents\/approver\.md|extensions\/pi-permission-suite\/config\.json|extensions\/my-slim-pi-suite\/[^/]+\.(?:ts|ps1)|themes\/[^/]+\.json|skills\/(?:pi-maintenance|principal)\/SKILL\.md|customization\/(?:README\.md|Pi Agent 本机配置维护手册\.md|Maintain-Pi\.ps1|Pi-Maintenance\.bat|maintain-pi\.sh)|customization\/runtime\/[^/]+\.(?:cjs|mjs)|customization\/checks\/(?:tests\/)?[^/]+\.(?:mjs|ps1)|bin\/(?:pi|pi-launcher\.js|pi\.cmd|pi\.ps1)|(?:keybindings|pi-btw|mcp|hermes-memory-config)\.json)$/i.test(path);
    if((!allowed && !skillSourcePath(path)) || /(?:^|\/)(?:policy-seal|compiled-extensions)\.json$/i.test(path))throw Error("Path is outside self-maintenance source scope; credentials, dependencies, generated files, and arbitrary commands are not accepted: "+path);
    const full=resolve(root,path);
    if(relative(root,full).startsWith(".."))throw Error("Maintenance target escapes the configuration directory.");
    for(let part=full;part!==dirname(root);part=dirname(part)) {
      if(existsSync(part) && lstatSync(part).isSymbolicLink())throw Error("Maintenance path contains a symbolic link or junction.");
      if(part===root)break;
    }
    if(existsSync(full) && (!lstatSync(full).isFile() || lstatSync(full).nlink!==1))throw Error("Maintenance target must be a regular file without hard links.");
    const before=existsSync(full)?readFileSync(full):null;
    if((before===null?null:fileHash(before))!==change.sha256)throw Error("Maintenance file changed; reread and verify SHA256: "+path);
    if(/\.json$/i.test(path))JSON.parse(change.content);
    const stat=before===null?null:lstatSync(full);
    return {...change,path,full,before,stat};
  });
}

/** Exact protected-file transaction, reviewed under the pre-change rules. */
export async function applyMaintenance(root:string,request:string,changes:MaintenanceChange[],deps:{
  approved:()=>Promise<boolean|{approved:boolean;reason?:string}>;current:()=>boolean;policyIntact?:()=>boolean;
  run:(command:string,args:string[],options:{cwd:string;timeout:number;signal?:AbortSignal})=>Promise<{code:number;stdout:string;stderr:string}>;
  signal?:AbortSignal;progress?:(text:string)=>void;
}) {
  const plan=validateMaintenance(root,request,changes);
  let core=coreSnapshot(root);
  const updateCore=(paths:string[])=>{
    const allowed=new Set(paths.map(pathKey));
    const previous=JSON.parse(core) as [string,string|null][];
    const current=JSON.parse(coreSnapshot(root)) as [string,string|null][];
    core=JSON.stringify([...previous.filter(([path])=>!allowed.has(pathKey(path))),...current.filter(([path])=>allowed.has(pathKey(path)))].sort(([a],[b])=>a<b?-1:a>b?1:0));
  };
  let buildEffects:string[]=[];
  const checkCore=()=>{if(coreSnapshot(root)!==core)throw Error("Authorization or build core changed without approval during maintenance; stop and inspect.");};
  const decision=await deps.approved();
  if(!(typeof decision==='boolean'?decision:decision.approved))throw Error("This self-maintenance call was not approved; no files were changed. "+(typeof decision==='object'&&decision.reason?decision.reason+'. ':'')+"Explain the block; do not change protected files with another tool.");
  const fresh=()=>{if(deps.signal?.aborted || !deps.current())throw Error("User instructions or task state changed during maintenance; this call will stop.");if(deps.policyIntact && !deps.policyIntact())throw Error("Protected baseline changed after approval; this transaction will stop.");checkCore();validateMaintenance(root,request,changes);};
  fresh();
  const require=createRequire(join(root,"customization/runtime/maintenance.mjs"));
  const esbuild=join(root,"customization/runtime/build-runtime/node_modules/esbuild");
  if(existsSync(esbuild)) {
    const {transformSync}=require(esbuild);
    for(const file of plan)if(/\.(?:ts|[cm]?js)$/.test(file.path)) {
      try{transformSync(file.content,{loader:file.path.endsWith('.ts')?'ts':'js',sourcefile:file.path,target:'node24'});}
      catch(error){throw Error("Candidate source failed syntax preflight; no files changed: "+String(error));}
    }
  }
  let runner=join(root,"customization/runtime/maintenance.mjs");
  let frozen:Map<string,string>|undefined;
  const checkFrozen=()=>{if(frozen)for(const [path,hash] of frozen)if(!existsSync(path)||fileHash(readFileSync(path))!==hash)throw Error("Frozen pre-change maintenance/verification snapshot changed; stop: "+path);};
  const run=async(action:string)=>{
    checkCore();
    checkFrozen();
    const result=await deps.run(process.execPath,[runner,"--agent-root",root,action],{cwd:root,timeout:180000,signal:deps.signal});
    if(result.code!==0)throw Error(action+" failed: "+(result.stderr||result.stdout).slice(-3000));
    if(action==="Rebuild")updateCore(buildEffects);
    checkCore();
    checkFrozen();
    return result.stdout;
  };
  deps.progress?.("Backing up Pi configuration…");const backup=await run("Backup");fresh();
  const major=plan.some(p=>coreMaintenancePath(p.path) || pathKey(p.path)==="settings.json");
  if(major){
    const directory=resolve(backup.trim());
    if(pathKey(dirname(directory))!==pathKey(join(resolve(root),"backups")) || !existsSync(directory) || lstatSync(directory).isSymbolicLink())throw Error("Major changes require a valid backup directory created by the independent maintenance script.");
    const manifest=JSON.parse(readFileSync(join(directory,"configuration-snapshot.json"),"utf8"));
    for(const file of plan.filter(p=>p.before!==null)) {
      const saved=join(directory,file.path);
      if(!manifest.files.some((p:string)=>pathKey(p.replaceAll("\\","/"))===pathKey(file.path)) || !existsSync(saved) || fileHash(readFileSync(saved))!==fileHash(file.before!))throw Error("Major-change backup missing or failed verification: "+file.path);
    }
    frozen=new Map();
    const savedRoot=join(directory,"transaction-runner");
    const capture=(source:string,dest:string)=>{
      if(lstatSync(source).isSymbolicLink())throw Error("Maintenance snapshots cannot contain links.");
      mkdirSync(dirname(dest),{recursive:true,mode:0o700});copyFileSync(source,dest);frozen!.set(dest,fileHash(readFileSync(source)));
    };
    capture(join(root,"customization/Maintain-Pi.ps1"),join(savedRoot,"customization/Maintain-Pi.ps1"));
    for(const relative of ["customization/runtime","customization/checks","customization/checks/tests"]) {
      const base=join(root,relative);
      if(existsSync(base))for(const name of readdirSync(base))if(/\.(?:cjs|mjs|ps1)$/i.test(name))capture(join(base,name),join(savedRoot,relative,name));
    }
    runner=join(savedRoot,"customization/runtime/maintenance.mjs");checkFrozen();
  }
  // Preserve the exact old build, including its seal and timestamps. Rebuilding
  // after rollback creates a different build identity and invalidates a live session.
  const builder=join(root,"customization/runtime/build-extensions.cjs");
  if(existsSync(builder))delete require.cache[require.resolve(builder)];
  const stateFiles:string[]=existsSync(builder)?(require(builder).stateFiles?.() ?? []):[];
  buildEffects=stateFiles;
  const artifacts=stateFiles.map(path=>{
    const full=resolve(root,path);
    if(relative(root,full).startsWith('..'))throw Error('Build-state path escapes the configuration directory.');
    for(let cursor=full;;cursor=dirname(cursor)) {
      if(existsSync(cursor) && lstatSync(cursor).isSymbolicLink())throw Error('Build-state path contains a link.');
      if(cursor===root || dirname(cursor)===cursor)break;
    }
    const stat=existsSync(full)?lstatSync(full):null;
    if(stat && (!stat.isFile() || stat.nlink!==1))throw Error('Build state must be a regular file without hard links.');
    const before=stat?readFileSync(full):null;
    return {path,full,stat,before,after:before===null?null:fileHash(before)};
  });
  const directory=resolve(backup.trim());
  if(artifacts.length) {
    if(pathKey(dirname(directory))!==pathKey(join(resolve(root),'backups')))throw Error('Build snapshot requires a valid independent backup directory.');
    for(const file of artifacts)if(file.before!==null){const dest=join(directory,'build-state',file.path);mkdirSync(dirname(dest),{recursive:true,mode:0o700});writeFileSync(dest,file.before,{mode:0o600});}
    writeFileSync(join(directory,'build-state.json'),JSON.stringify(artifacts.map(f=>({path:f.path,sha256:f.before===null?null:fileHash(f.before),mode:f.stat?.mode,mtime:f.stat?.mtime,atime:f.stat?.atime}))),{mode:0o600});
  }
  const written:typeof plan=[];
  try {
    deps.progress?.("Applying approved files…");
    for(const file of plan){
      checkCore();checkFrozen();
      validateMaintenance(root,request,[{path:file.path,sha256:file.sha256,content:file.content}],false);
      mkdirSync(dirname(file.full),{recursive:true});written.push(file);writeFileSync(file.full,file.content,"utf8");
      updateCore([file.path]);
    }
    checkCore();
    if(!deps.current() || deps.signal?.aborted)throw Error("A new instruction arrived after applying files; restore this change.");
    deps.progress?.("Rebuilding extensions and policy manifest…");await run("Rebuild");
    for(const file of artifacts)file.after=existsSync(file.full)?fileHash(readFileSync(file.full)):null;
    deps.progress?.("Running offline checks…");await run("Check");
    if(!deps.current() || deps.signal?.aborted)throw Error("A new instruction arrived during verification; restore this change.");
    return {files:plan.map(p=>p.path),backup:backup.trim(),coreMaintenance:major,reloadRequired:true,message:"Maintenance completed under the pre-change rules. Backup, rebuild, and offline checks passed. Use /reload or restart to load the new code; this process will not accept a new protected baseline on its own."};
  } catch(error) {
    if(!written.length)throw error;
    const conflicts:string[]=[];
    for(const file of written){
      try {
        for(let cursor=file.full;;cursor=dirname(cursor)) {
          if(existsSync(cursor) && lstatSync(cursor).isSymbolicLink())throw Error('link');
          if(cursor===root || dirname(cursor)===cursor)break;
        }
        if(existsSync(file.full) && (!lstatSync(file.full).isFile() || lstatSync(file.full).nlink!==1))throw Error('not a single regular file');
      }catch{conflicts.push(file.path);continue;}
      let matches=existsSync(file.full) && fileHash(readFileSync(file.full))===fileHash(file.content);
      if(!matches && /\.json$/i.test(file.path) && existsSync(file.full)) {
        try{matches=JSON.stringify(JSON.parse(readFileSync(file.full,"utf8")))===JSON.stringify(JSON.parse(file.content));}catch{}
      }
      if(!matches){conflicts.push(file.path);continue;}
      if(file.before!==null)writeFileSync(file.full,file.before);else unlinkSync(file.full);
      if(file.stat)utimesSync(file.full,file.stat.atime,file.stat.mtime);
    }
    if(conflicts.length)throw Error(String(error)+"; external concurrent changes detected; conflicting files were not overwritten: "+conflicts.join(", ")+". Inspect the backup for recovery: "+backup.trim());
    for(const file of artifacts) {
      try {
        for(let cursor=file.full;;cursor=dirname(cursor)){if(existsSync(cursor) && lstatSync(cursor).isSymbolicLink())throw Error('link');if(cursor===root || dirname(cursor)===cursor)break;}
        const stat=existsSync(file.full)?lstatSync(file.full):null;
        if(stat && (!stat.isFile() || stat.nlink!==1))throw Error('not a regular file');
        const current=stat?fileHash(readFileSync(file.full)):null,original=file.before===null?null:fileHash(file.before);
        if(current!==file.after && current!==original)throw Error('concurrent build change');
        if(file.before===null){if(stat)unlinkSync(file.full);}else{writeFileSync(file.full,file.before);if(process.platform!=='win32')chmodSync(file.full,file.stat!.mode);utimesSync(file.full,file.stat!.atime,file.stat!.mtime);}
      }catch{conflicts.push(file.path);}
    }
    if(conflicts.length)throw Error(String(error)+"; source restored, but build state has concurrent conflicts requiring external review: "+conflicts.join(', ')+"; backup: "+backup.trim());
    if(deps.policyIntact && !deps.policyIntact())throw Error(String(error)+"; source files restored, but protected baseline was not restored; inspect externally. Backup: "+backup.trim());
    throw Error(String(error)+"; source files, build outputs, and protected baseline restored exactly; this change did not take effect. Backup: "+backup.trim());
  }
}

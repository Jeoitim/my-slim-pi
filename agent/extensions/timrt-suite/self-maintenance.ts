import {createHash} from "node:crypto";
import {existsSync,lstatSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,readdirSync,copyFileSync,utimesSync,chmodSync} from "node:fs";
import {join,resolve,relative,dirname} from "node:path";
import {createRequire} from "node:module";

export type MaintenanceChange={path:string;sha256:string|null;content:string};
const pathKey=(p:string)=>process.platform==="win32"?p.toLowerCase():p;
const kernel=/^(?:extensions\/timrt-suite\/(?:index|self-maintenance|permissions|permission-brief|prompt-policy|call-policy|guards|deletion-review|approval-reviewer|approval-evidence|shell-analysis|terminal-notifications)\.ts|extensions\/timrt-suite\/read-only-parser\.ps1|customization\/runtime\/|customization\/(?:Maintain-Pi\.ps1|Pi-Maintenance\.bat|maintain-pi\.sh)|bin\/(?:pi|pi-launcher\.js|pi\.cmd|pi\.ps1)|trust\.json)$/i;
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
  if(!request.trim())throw Error("缺少当前真实用户指示，不能启动 Pi 自维护。");
  if(!changes.length || changes.length>8)throw Error("每次维护提交 1～8 个文件，不接受批量未知目标。");
  if(changes.reduce((n,c)=>n+Buffer.byteLength(c.content,"utf8"),0)>128000)throw Error("维护补丁超过 128 KB，请按可审阅的任务拆分。");
  changes=changes.map(c=>({...c,path:c.path.replaceAll('\\','/')}));
  const activePrompt='APPEND_SYSTEM.'+(process.platform==='win32'?'windows':'linux')+'.md';
  if(validatePairs && existsSync(join(root,activePrompt))) {
    const runtime=changes.find(c=>pathKey(c.path)===pathKey('APPEND_SYSTEM.md')),source=changes.find(c=>pathKey(c.path)===pathKey(activePrompt));
    if((runtime || source) && (!runtime || !source || runtime.content!==source.content))throw Error('长期规则须同时提交当前平台源文件与 APPEND_SYSTEM.md 的相同补丁，纳入同一次审批和备份。');
  }
  const seen=new Set<string>();
  return changes.map(change=>{
    const path=change.path.replaceAll("\\","/");
    if(!path || /[:\x00-\x1f]/.test(path) || path.startsWith("/") || path.split("/").some(p=>!p || p===".." || p==="."))throw Error("维护路径必须是配置目录内的明确相对文件路径。");
    const key=pathKey(path);if(seen.has(key))throw Error("维护补丁包含重复文件。");seen.add(key);
    const allowed=/^(?:settings\.json|trust\.json|APPEND_SYSTEM(?:\.(?:windows|linux))?\.md|agents\/approver\.md|extensions\/pi-permission-suite\/config\.json|extensions\/timrt-suite\/[^/]+\.(?:ts|ps1)|themes\/[^/]+\.json|skills\/(?:pi-maintenance|principal)\/SKILL\.md|customization\/(?:README\.md|Pi Agent 本机配置维护手册\.md|Maintain-Pi\.ps1|Pi-Maintenance\.bat|maintain-pi\.sh)|customization\/runtime\/[^/]+\.(?:cjs|mjs)|customization\/checks\/(?:tests\/)?[^/]+\.(?:mjs|ps1)|bin\/(?:pi|pi-launcher\.js|pi\.cmd|pi\.ps1)|(?:keybindings|pi-cc-extensions|pi-btw|mcp|hermes-memory-config)\.json)$/i.test(path);
    if((!allowed && !skillSourcePath(path)) || /(?:^|\/)(?:policy-seal|compiled-extensions)\.json$/i.test(path))throw Error("该路径不属于自维护源码范围；不接受凭据、依赖、生成物或任意命令："+path);
    const full=resolve(root,path);
    if(relative(root,full).startsWith(".."))throw Error("维护目标越界。");
    for(let part=full;part!==dirname(root);part=dirname(part)) {
      if(existsSync(part) && lstatSync(part).isSymbolicLink())throw Error("维护路径包含符号链接或目录联接。");
      if(part===root)break;
    }
    if(existsSync(full) && (!lstatSync(full).isFile() || lstatSync(full).nlink!==1))throw Error("维护目标须为无硬链接的普通文件。");
    const before=existsSync(full)?readFileSync(full):null;
    if((before===null?null:fileHash(before))!==change.sha256)throw Error("维护文件已变化，请重新读取并核对 SHA256："+path);
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
  const checkCore=()=>{if(coreSnapshot(root)!==core)throw Error("授权或构建内核在维护期间发生未批准变化，停止执行并要求核对。");};
  const decision=await deps.approved();
  if(!(typeof decision==='boolean'?decision:decision.approved))throw Error("本次自维护未获批准，未修改文件。"+(typeof decision==='object'&&decision.reason?decision.reason+'。':'')+"请说明阻塞，不使用其他工具改写保护文件。");
  const fresh=()=>{if(deps.signal?.aborted || !deps.current())throw Error("维护期间用户指示或任务状态已变化，本次不继续。");if(deps.policyIntact && !deps.policyIntact())throw Error("维护批准后保护基线发生变化，当前事务停止。");checkCore();validateMaintenance(root,request,changes);};
  fresh();
  const require=createRequire(join(root,"customization/runtime/maintenance.mjs"));
  const esbuild=join(root,"customization/runtime/build-runtime/node_modules/esbuild");
  if(existsSync(esbuild)) {
    const {transformSync}=require(esbuild);
    for(const file of plan)if(/\.(?:ts|[cm]?js)$/.test(file.path)) {
      try{transformSync(file.content,{loader:file.path.endsWith('.ts')?'ts':'js',sourcefile:file.path,target:'node24'});}
      catch(error){throw Error("候选源码语法预检失败，未修改文件："+String(error));}
    }
  }
  let runner=join(root,"customization/runtime/maintenance.mjs");
  let frozen:Map<string,string>|undefined;
  const checkFrozen=()=>{if(frozen)for(const [path,hash] of frozen)if(!existsSync(path)||fileHash(readFileSync(path))!==hash)throw Error("修改前的维护/验证快照发生变化，停止执行："+path);};
  const run=async(action:string)=>{
    checkCore();
    checkFrozen();
    const result=await deps.run(process.execPath,[runner,"--agent-root",root,action],{cwd:root,timeout:180000,signal:deps.signal});
    if(result.code!==0)throw Error(action+" 未通过："+(result.stderr||result.stdout).slice(-3000));
    if(action==="Rebuild")updateCore(buildEffects);
    checkCore();
    checkFrozen();
    return result.stdout;
  };
  deps.progress?.("备份 Pi 配置…");const backup=await run("Backup");fresh();
  const major=plan.some(p=>coreMaintenancePath(p.path) || pathKey(p.path)==="settings.json");
  if(major){
    const directory=resolve(backup.trim());
    if(pathKey(dirname(directory))!==pathKey(join(resolve(root),"backups")) || !existsSync(directory) || lstatSync(directory).isSymbolicLink())throw Error("重大修改必须先获得独立维护脚本创建的有效备份目录。");
    const manifest=JSON.parse(readFileSync(join(directory,"configuration-snapshot.json"),"utf8"));
    for(const file of plan.filter(p=>p.before!==null)) {
      const saved=join(directory,file.path);
      if(!manifest.files.some((p:string)=>pathKey(p.replaceAll("\\","/"))===pathKey(file.path)) || !existsSync(saved) || fileHash(readFileSync(saved))!==fileHash(file.before!))throw Error("重大修改备份未覆盖或校验失败："+file.path);
    }
    frozen=new Map();
    const savedRoot=join(directory,"transaction-runner");
    const capture=(source:string,dest:string)=>{
      if(lstatSync(source).isSymbolicLink())throw Error("维护快照不接受链接。");
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
    if(relative(root,full).startsWith('..'))throw Error('构建状态路径越界。');
    for(let cursor=full;;cursor=dirname(cursor)) {
      if(existsSync(cursor) && lstatSync(cursor).isSymbolicLink())throw Error('构建状态路径包含链接。');
      if(cursor===root || dirname(cursor)===cursor)break;
    }
    const stat=existsSync(full)?lstatSync(full):null;
    if(stat && (!stat.isFile() || stat.nlink!==1))throw Error('构建状态须为无硬链接的普通文件。');
    const before=stat?readFileSync(full):null;
    return {path,full,stat,before,after:before===null?null:fileHash(before)};
  });
  const directory=resolve(backup.trim());
  if(artifacts.length) {
    if(pathKey(dirname(directory))!==pathKey(join(resolve(root),'backups')))throw Error('构建快照需要有效独立备份目录。');
    for(const file of artifacts)if(file.before!==null){const dest=join(directory,'build-state',file.path);mkdirSync(dirname(dest),{recursive:true,mode:0o700});writeFileSync(dest,file.before,{mode:0o600});}
    writeFileSync(join(directory,'build-state.json'),JSON.stringify(artifacts.map(f=>({path:f.path,sha256:f.before===null?null:fileHash(f.before),mode:f.stat?.mode,mtime:f.stat?.mtime,atime:f.stat?.atime}))),{mode:0o600});
  }
  const written:typeof plan=[];
  try {
    deps.progress?.("应用已批准文件…");
    for(const file of plan){
      checkCore();checkFrozen();
      validateMaintenance(root,request,[{path:file.path,sha256:file.sha256,content:file.content}],false);
      mkdirSync(dirname(file.full),{recursive:true});written.push(file);writeFileSync(file.full,file.content,"utf8");
      updateCore([file.path]);
    }
    checkCore();
    if(!deps.current() || deps.signal?.aborted)throw Error("应用后收到新指示，恢复本次修改。");
    deps.progress?.("重建扩展与策略清单…");await run("Rebuild");
    for(const file of artifacts)file.after=existsSync(file.full)?fileHash(readFileSync(file.full)):null;
    deps.progress?.("执行离线检查…");await run("Check");
    if(!deps.current() || deps.signal?.aborted)throw Error("验证期间收到新指示，恢复本次修改。");
    return {files:plan.map(p=>p.path),backup:backup.trim(),coreMaintenance:major,reloadRequired:true,message:"维护完成，修改前规则已审批，备份、重建和离线检查通过。请 /reload 或重启以加载新代码；当前进程不会自行接受新的保护基线。"};
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
    if(conflicts.length)throw Error(String(error)+"；检测到外部并发修改，未覆盖冲突文件："+conflicts.join(", ")+"。请从备份核对恢复："+backup.trim());
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
    if(conflicts.length)throw Error(String(error)+"；源码已恢复，构建状态有并发冲突，须外部核对："+conflicts.join(', ')+"；备份："+backup.trim());
    if(deps.policyIntact && !deps.policyIntact())throw Error(String(error)+"；原文件已恢复，但保护基线未恢复，须外部核对；备份："+backup.trim());
    throw Error(String(error)+"；原文件已恢复，构建产物与保护基线已精确恢复，本次修改未生效；备份："+backup.trim());
  }
}

// Companion to Sync-WslProviderCredentials.ps1. Never log input or credential values.
import * as fs from 'node:fs';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const digest=data=>createHash('sha256').update(data).digest('hex');
function regular(file,{missing=false}={}) {
  for(let p=file;;p=dirname(p)) {
    try { if(fs.lstatSync(p).isSymbolicLink())throw Error('路径不能包含链接'); }
    catch(e) {if(e.code!=='ENOENT')throw e;}
    if(dirname(p)===p)break;
  }
  let s;try{s=fs.lstatSync(file);}catch(e){if(missing&&e.code==='ENOENT')return null;throw e;}
  if(!s.isFile()||s.nlink!==1||s.size>4*1024*1024)throw Error('凭据路径必须是独立的小型普通文件');
  return fs.readFileSync(file);
}
export function syncCredentials({root=join(homedir(),'.pi/agent'),files,apply=false}, {beforeWrite}={}) {
  if(typeof root!=='string'||!isAbsolute(root)||/^\/mnt\/[a-z](?:\/|$)/i.test(root))throw Error('需要 Linux 原生安装的绝对路径');
  root=resolve(root);
  regular(join(root,'install/current-version'));regular(join(root,'bin/pi'));
  if(!files||typeof files!=='object'||Array.isArray(files)||!Object.keys(files).length)throw Error('没有可同步文件');
  const rows=Object.entries(files).map(([name,content])=>{
    if(!['models.json','auth.json'].includes(name)||typeof content!=='string'||Buffer.byteLength(content)>4*1024*1024)throw Error('同步范围仅限 models.json 和 auth.json');
    let value;try{value=JSON.parse(content.replace(/^\uFEFF/,''));}catch{throw Error('源凭据 JSON 无效（内容未输出）');}
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('源凭据必须是 JSON 对象');
    const target=join(root,name),before=regular(target,{missing:true});
    return {name,target,before,after:Buffer.from(content)};
  });
  if(!apply)return {mode:'preview',root,files:rows.map(r=>({name:r.name,action:r.before?'replace':'create'}))};
  const backups=join(root,'backups');
  // Reject linked ancestors before mkdir, including a pre-existing backup directory.
  regular(join(backups,'.credential-sync-path-check'),{missing:true});
  fs.mkdirSync(backups,{recursive:true,mode:0o700});
  const backup=join(backups,'provider-credentials-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID());
  fs.mkdirSync(backup,{mode:0o700});
  for(const row of rows)if(row.before)fs.writeFileSync(join(backup,row.name),row.before,{flag:'wx',mode:0o600});
  const written=[];
  const same=(a,b)=>a===null?b===null:b!==null&&digest(a)===digest(b);
  try {
    for(const row of rows) {
      beforeWrite?.(row.name);
      if(!same(row.before,regular(row.target,{missing:true})))throw Error('目标在同步期间发生变化，已停止');
      const temp=join(root,'.provider-sync-'+randomUUID());
      try {
        fs.writeFileSync(temp,row.after,{flag:'wx',mode:0o600});
        fs.renameSync(temp,row.target);written.push(row);
      }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    }
  }catch {
    const conflicts=[];
    for(const row of written.reverse()) {
      try {
        if(!same(row.after,regular(row.target,{missing:true}))){conflicts.push(row.name);continue;}
        if(row.before)fs.writeFileSync(row.target,row.before,{mode:0o600});else fs.unlinkSync(row.target);
      }catch{conflicts.push(row.name);}
    }
    throw Error('同步失败；已回退本次写入，并发修改保留。备份：'+backup+(conflicts.length?'；需检查：'+conflicts.join(', '):''));
  }
  return {mode:'applied',root,files:rows.map(r=>r.name),backup};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<24)throw Error('需要 Linux Node 24+');
    let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>9*1024*1024)throw Error('输入过大');}
    let request;try{request=JSON.parse(input);}catch{throw Error('请求格式无效（内容未输出）');}
    if(!request.root)delete request.root;
    console.log(JSON.stringify(syncCredentials(request),null,2));
  }catch(e){console.error(e.message);process.exitCode=1;}
}

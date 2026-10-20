// Shared external maintenance core. No model calls; importable for recovery from saved code.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';

export const hash = data => createHash('sha256').update(data).digest('hex');
export const pathKey = p => process.platform === 'win32' ? p.toLowerCase() : p;
export function child(base, relative) {
  if (typeof relative !== 'string' || !relative || /[:\x00-\x1f]/.test(relative)) throw Error('Invalid relative path');
  const parts = relative.replaceAll('\\','/').split('/');
  if (parts.some(p => !p || p === '.' || p === '..')) throw Error('Path escape');
  base = path.resolve(base);
  const full = path.resolve(base, ...parts), rel = path.relative(base, full);
  if (!rel || rel === '..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel)) throw Error('Path escape');
  for (let p = full; ; p = path.dirname(p)) {
    let stat; try { stat = fs.lstatSync(p); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (stat?.isSymbolicLink()) throw Error('Links are not allowed');
    if (path.dirname(p) === p) break;
  }
  return full;
}
export const configPath = p => /^(?:install\/node-path|settings\.json|trust\.json|models\.json|auth\.json|mcp\.json|keybindings\.json|pi-cc-extensions\.json|pi-btw\.json|hermes-memory-config\.json|APPEND_SYSTEM(?:\.(?:windows|linux))?\.md|pi-hermes-memory\/STANDING\.md|secrets\/web-keys\.json|extensions\/(?:pi-permission-suite|subagent)\/config\.json|skills\/(?:pi-maintenance|principal)\/SKILL\.md|customization\/(?:README\.md|Pi Agent 本机配置维护手册\.md|Maintain-Pi\.ps1|Pi-Maintenance\.bat|maintain-pi\.sh)|customization\/runtime\/[^/]+\.(?:cjs|mjs)|customization\/checks\/(?:tests\/)?[^/]+\.(?:mjs|ps1)|bin\/(?:pi|pi-launcher\.js|pi\.cmd|pi\.ps1)|agents\/[^/]+\.md|themes\/[^/]+\.json|extensions\/timrt-suite\/[^/]+\.(?:ts|ps1))$/.test(p.replaceAll('\\','/'));
const credential = p => /^(?:models\.json|auth\.json|secrets\/)/.test(p);
export function protect(file, directory = false) {
  if (process.platform === 'linux') fs.chmodSync(file, directory ? 0o700 : 0o600);
  else {
    // Keep Windows' native DACL protection; no dependency on external utilities.
    const code = "$p=$env:PI_PROTECT_PATH;$d=$env:PI_PROTECT_DIR -eq '1';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;if($d){$a=[Security.AccessControl.DirectorySecurity]::new();$r=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{$a=[Security.AccessControl.FileSecurity]::new();$r=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')};$a.SetAccessRuleProtection($true,$false);$a.AddAccessRule($r);if($d){[IO.FileSystemAclExtensions]::SetAccessControl([IO.DirectoryInfo]::new($p),$a)}else{[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($p),$a)}";
    const r = spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',code],{env:{...process.env,PI_PROTECT_PATH:file,PI_PROTECT_DIR:directory?'1':'0'},windowsHide:true,encoding:'utf8'});
    if (r.status !== 0) throw Error('Cannot protect private maintenance path');
  }
}
function privateDir(dir) { fs.mkdirSync(dir,{recursive:true,mode:0o700}); protect(dir,true); }
const json = file => JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
export function configFiles(root) {
  const files = ['install/node-path','settings.json','trust.json','mcp.json','keybindings.json','pi-cc-extensions.json','pi-btw.json','hermes-memory-config.json','APPEND_SYSTEM.md','APPEND_SYSTEM.windows.md','APPEND_SYSTEM.linux.md','pi-hermes-memory/STANDING.md','extensions/pi-permission-suite/config.json','extensions/subagent/config.json','skills/pi-maintenance/SKILL.md','skills/principal/SKILL.md','customization/README.md','customization/Pi Agent 本机配置维护手册.md','customization/Maintain-Pi.ps1','customization/Pi-Maintenance.bat','customization/maintain-pi.sh','bin/pi-launcher.js','bin/pi.cmd','bin/pi.ps1','bin/pi'];
  for (const dir of ['agents','themes','extensions/timrt-suite','customization/runtime','customization/checks','customization/checks/tests']) {
    const base = child(root,dir);
    if (fs.existsSync(base)) for (const name of fs.readdirSync(base)) if (configPath(dir+'/'+name)) files.push(dir+'/'+name);
  }
  return [...new Set(files)];
}
export function backup(root, {label='manual', files} = {}) {
  if (!/^[A-Za-z0-9-]+$/.test(label)) throw Error('Invalid backup label');
  const full = files === undefined;
  files ??= configFiles(root);
  const rows = files.map(p => p.replaceAll('\\','/'));
  if (new Set(rows.map(pathKey)).size !== rows.length || rows.some(p => !configPath(p))) throw Error('Invalid backup file set');
  const base = child(root,'backups'); privateDir(base);
  const destination = child(root,'backups/config-'+label+'-'+new Date().toISOString().replace(/[-:.TZ]/g,'')+'-'+randomUUID().slice(0,8)); privateDir(destination);
  const copied=[], hashes={};
  for (const p of rows) {
    const source=child(root,p), target=child(destination,p);
    if (!fs.existsSync(source)) continue;
    if (!fs.lstatSync(source).isFile()) throw Error('Backup source is not a regular file: '+p);
    const data=fs.readFileSync(source);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,data,{mode:0o600});
    copied.push(p);hashes[p]=hash(data);
  }
  fs.writeFileSync(child(destination,'configuration-snapshot.json'),JSON.stringify({kind:'pi-configuration',version:1,scope:full?'full':'files',createdAt:new Date().toISOString(),files:copied,hashes,excludes:['node_modules','sessions','memory database','runtime cache'],credentialsIncluded:copied.some(credential)},null,2)+'\n',{mode:0o600});
  return destination;
}
const fileState = file => {
  if (!fs.existsSync(file)) return null;
  const s=fs.lstatSync(file);if(!s.isFile() || s.nlink !== 1) throw Error('Expected a regular file without hard links');
  return {sha256:hash(fs.readFileSync(file)),mode:s.mode & 0o777};
};
export function restorePlan(root, snapshot) {
  snapshot=path.resolve(snapshot);
  if (pathKey(path.dirname(snapshot))!==pathKey(child(root,'backups'))) throw Error('Snapshot must be an immediate child of backups');
  child(root,'backups/'+path.basename(snapshot));
  const manifestFile=child(snapshot,'configuration-snapshot.json'), metadata=json(manifestFile);
  if(metadata.kind!=='pi-configuration' || !Array.isArray(metadata.files) || !metadata.files.length || !metadata.hashes) throw Error('Invalid snapshot metadata');
  const seen=new Set();
  const files=metadata.files.map(p=>{
    const relative=p.replaceAll('\\','/'), key=pathKey(relative);
    if(!configPath(relative) || seen.has(key))throw Error('Invalid snapshot file set');seen.add(key);
    const source=child(snapshot,relative), target=child(root,relative), state=fileState(source);
    if(!state || !/^[a-f0-9]{64}$/i.test(metadata.hashes[p]||'') || state.sha256!==metadata.hashes[p].toLowerCase())throw Error('Snapshot integrity check failed: '+relative);
    return {relative,sha256:state.sha256,before:fileState(target)};
  });
  return {snapshot,manifestHash:hash(fs.readFileSync(manifestFile)),files};
}
export function restore(root, plan, {beforeWrite} = {}) {
  if(JSON.stringify(restorePlan(root,plan.snapshot))!==JSON.stringify(plan))throw Error('Restore plan changed; preview again');
  const safety=backup(root,{label:'before-restore',files:plan.files.filter(p=>p.before!==null).map(p=>p.relative)});
  const written=[];
  try {
    for(const row of plan.files) {
      beforeWrite?.(row);
      const source=child(plan.snapshot,row.relative), target=child(root,row.relative);
      if(JSON.stringify(fileState(target))!==JSON.stringify(row.before) || hash(fs.readFileSync(source))!==row.sha256)throw Error('File changed during restore: '+row.relative);
      fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
      const data=fs.readFileSync(source);if(hash(data)!==row.sha256)throw Error('Snapshot changed');
      fs.writeFileSync(target,data,{mode:row.before?.mode ?? 0o600});written.push(row);
      if(credential(row.relative))protect(target);
    }
    return {restored:written.map(p=>p.relative),safety,rebuildRequired:true};
  } catch(error) {
    const conflicts=[];
    for(const row of written.reverse()) {
      try {
        const target=child(root,row.relative);
        if(fileState(target)?.sha256!==row.sha256) {conflicts.push(row.relative);continue;}
        if(row.before) {const saved=child(safety,row.relative), data=fs.readFileSync(saved);if(hash(data)!==row.before.sha256)throw Error('Safety snapshot changed');fs.writeFileSync(target,data);}
        else fs.unlinkSync(target);
      } catch {conflicts.push(row.relative);}
    }
    throw Error('Restore failed: '+error.message+'; rolled back written files; conflicts='+JSON.stringify(conflicts)+'; safety='+safety);
  }
}
function treeState(root, relative) {
  const file=child(root,relative), stat=fs.lstatSync(file);
  if(stat.isFile())return [[relative,hash(fs.readFileSync(file))]];
  if(!stat.isDirectory())throw Error('Unsupported cleanup entry');
  return [[relative,'directory'],...fs.readdirSync(file).sort().flatMap(name=>treeState(root,relative+'/'+name))];
}
export function cleanupPlan(root, kind='Clean', mode='KeepLatestTwo') {
  const candidates=[];
  const reports=child(root,'customization/reports'), backups=child(root,'backups');
  if(kind==='Clean') {
    if(fs.existsSync(reports))for(const n of fs.readdirSync(reports))if(/\.(json|log)$/.test(n))candidates.push('customization/reports/'+n);
    if(fs.existsSync(backups))for(const n of fs.readdirSync(backups))if(/^(maintenance|installation)-artifacts-\d{8}-\d{6}$/.test(n))candidates.push('backups/'+n);
  } else {
    if(!['All','KeepLatestTwo'].includes(mode))throw Error('Invalid retention mode');
    const all=fs.existsSync(backups)?fs.readdirSync(backups):[], valid=[];
    for(const n of all)try {const p=restorePlan(root,child(root,'backups/'+n));const m=json(child(p.snapshot,'configuration-snapshot.json')),date=Date.parse(m.createdAt);if(m.scope==='full' && Number.isFinite(date))valid.push({name:n,date});}catch{}
    valid.sort((a,b)=>b.date-a.date||b.name.localeCompare(a.name));
    if(mode==='KeepLatestTwo' && !valid.length)throw Error('No valid full backup; refuse retention cleanup');
    const keep=mode==='All'?[]:valid.slice(0,2).map(p=>p.name);
    candidates.push(...all.filter(n=>!keep.includes(n)).map(n=>'backups/'+n));
  }
  return candidates.map(p=>({path:p,state:treeState(root,p)}));
}
export function cleanup(root, plan, kind, mode) {
  if(JSON.stringify(cleanupPlan(root,kind,mode))!==JSON.stringify(plan))throw Error('Cleanup set changed');
  for(const row of plan){if(JSON.stringify(treeState(root,row.path))!==JSON.stringify(row.state))throw Error('Cleanup file changed');fs.rmSync(child(root,row.path),{recursive:true});}
}
export function runNode(root, args, log) {
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:log?'pipe':'inherit',encoding:'utf8',maxBuffer:16_000_000,timeout:180_000,windowsHide:true,env:{...process.env,PI_CODING_AGENT_DIR:root,PI_MAINTENANCE_TARGET:root,PI_OFFLINE:'1',PI_HASHLINE_DIR:path.join(root,'pi-hashline-edit-pro')}});
  if(log){process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');fs.appendFileSync(log,(result.stdout||'')+(result.stderr||''));}
  if(result.status!==0)throw Error('Maintenance child failed ('+(result.status ?? result.error?.code)+')');
}
export async function main(args=process.argv.slice(2)) {
  const take=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;if(!args[i+1] || args[i+1].startsWith('--'))throw Error('Missing '+name);const v=args[i+1];args.splice(i,2);return v;};
  const root=path.resolve(take('--agent-root',process.env.PI_MAINTENANCE_TARGET || path.resolve(import.meta.dirname,'../..')));
  const snapshot=take('--backup-path'),mode=take('--backup-mode','KeepLatestTwo'), filesArg=take('--files'),label=take('--label','manual');
  const apply=args.includes('--apply');args=args.filter(a=>a!=='--apply');
  const [action='Status',...values]=args;
  const ask=async expected=>{const rl=createInterface({input:process.stdin,output:process.stdout});try{return await rl.question('Type '+expected+' to confirm: ')===expected;}finally{rl.close();}};
  const checks=path.resolve(import.meta.dirname,'../checks');
  let log;
  if(['check','webtest','benchmark','context'].includes(action.toLowerCase())) {
    const dir=child(root,'customization/reports');fs.mkdirSync(dir,{recursive:true,mode:0o700});
    log=child(root,'customization/reports/last-check.log');fs.writeFileSync(log,new Date().toISOString()+'\n',{mode:0o600});
  }
  const execute=args=>runNode(root,args,log);
  switch(action.toLowerCase()) {
    case 'backup': console.log(backup(root,{label,files:filesArg?JSON.parse(filesArg):undefined}));break;
    case 'restore': {const plan=restorePlan(root,snapshot);console.log(JSON.stringify(plan,null,2));if(apply && await ask('RESTORE'))console.log(JSON.stringify(restore(root,plan)));break;}
    case 'clean':case 'prunebackups': {const kind=action.toLowerCase()==='clean'?'Clean':'PruneBackups';const p=cleanupPlan(root,kind,mode);console.log(JSON.stringify(p,null,2));if(apply && await ask(kind==='Clean'?'DELETE':mode==='All'?'DELETE ALL BACKUPS':'KEEP LATEST 2'))cleanup(root,p,kind,mode);break;}
    case 'rebuild': runNode(root,[path.join(import.meta.dirname,'build-extensions.cjs')]);break;
    case 'check': {
      // Validate candidate maintenance code with this pre-change runner. Never import it
      // merely to check its syntax, and never accept a broken next-start recovery path.
      for(const name of fs.readdirSync(child(root,'customization/runtime')))if(/\.(?:mjs|cjs)$/.test(name))execute(['--check',child(root,'customization/runtime/'+name)]);
      if(process.platform==='win32') {const r=spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-File',path.join(checks,'tests/Test-Maintenance.ps1')],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,PI_CODING_AGENT_DIR:root}});if(r.status!==0)throw Error('Windows maintenance check failed');}
      execute(['--test','--test-concurrency=1',...fs.readdirSync(path.join(checks,'tests')).filter(n=>n.endsWith('.test.mjs')).map(n=>path.join(checks,'tests',n))]);
      execute([path.join(checks,'check-components.mjs')]);break;
    }
    case 'webtest': execute([path.join(checks,'check-components.mjs'),'--live-web']);break;
    case 'benchmark': execute([path.join(checks,'benchmark-startup.mjs')]);break;
    case 'context': execute([path.join(checks,'profile-prompt.mjs')]);break;
    case 'status':case 'catalog':case 'set-model':case 'set-theme':
      if(action.toLowerCase().startsWith('set-'))backup(root,{label:'before-setting',files:['settings.json']});
      runNode(root,[path.join(import.meta.dirname,'config-state.mjs'),action.toLowerCase(),...values]);break;
    case 'editconfig': {
      const file=values[0];
      if(values.length!==1 || !/^(?:settings\.json|models\.json|mcp\.json|keybindings\.json|hermes-memory-config\.json|pi-cc-extensions\.json|pi-btw\.json|APPEND_SYSTEM(?:\.(?:windows|linux))?\.md|pi-hermes-memory\/STANDING\.md|extensions\/(?:subagent|pi-permission-suite)\/config\.json|agents\/approver\.md)$/.test(file))throw Error('Choose an explicit editable configuration file');
      const target=child(root,file);fileState(target);backup(root,{label:'before-edit',files:[file]});
      const editor=process.env.VISUAL||process.env.EDITOR||(process.platform==='win32'?'notepad.exe':'vi');
      const result=spawnSync(editor,[target],{cwd:root,stdio:'inherit',windowsHide:true});
      if(result.status!==0)throw Error('Editor did not complete; backup retained');
      child(root,file);if(credential(file))protect(target);
      if(file.endsWith('.json'))try{json(target);}catch{throw Error('Edited JSON is invalid; restore the before-edit backup');}
      console.log('Saved; rebuild after source/policy edits and restart Pi');break;
    }
    case 'setkey': {
      const provider=values[0];if(!['brave','tavily','exa'].includes(provider) || values.length!==1 || !process.stdin.isTTY)throw Error('Use SetKey brave|tavily|exa in a terminal');
      let secret='';
      process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();
      process.stdout.write('API Key (hidden): ');
      try {secret=await new Promise((resolve,reject)=>{const handler=s=>{for(const c of s){if(c==='\u0003'){done();reject(Error('Cancelled'));return;}if(c==='\r'||c==='\n'){done();resolve(secret);return;}if(c==='\u007f'||c==='\b')secret=secret.slice(0,-1);else secret+=c;if(secret.length>4096){done();reject(Error('Key too long'));return;}}};const done=()=>process.stdin.off('data',handler);process.stdin.on('data',handler);});} finally {process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
      if(secret.length<12 || /\s/.test(secret))throw Error('Invalid key');
      const dir=child(root,'secrets');privateDir(dir);const file=child(root,'secrets/web-keys.json');let keys={};if(fs.existsSync(file)){keys=json(file);backup(root,{label:'before-key',files:['secrets/web-keys.json']});}
      keys[provider]=secret;fs.writeFileSync(file,JSON.stringify(keys)+'\n',{mode:0o600});protect(file);console.log('Key saved');break;
    }
    default: throw Error('Unknown maintenance action');
  }
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.error(e.message);process.exitCode=1;});

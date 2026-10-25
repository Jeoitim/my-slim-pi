import * as fs from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {backup,child,hash,runNode,protect,migrateWebAccess} from '../agent/customization/runtime/maintenance.mjs';
import {configurePlatform} from '../agent/customization/runtime/platform-config.mjs';
import {setupChoices,configureBashPath,offerSearchKeys} from './installer-setup.mjs';
const repo=resolve(import.meta.dirname,'..'), payload=join(repo,'agent');
try {
  if(process.platform!=='linux')throw Error('Use the Windows installer on Windows');
  if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24+ required');
  for(const program of ['bash','npm'])if(spawnSync(program,['--version'],{stdio:'ignore'}).status!==0)throw Error(program+' is required');
  const args=process.argv.slice(2), at=args.indexOf('--agent-root');
  if(at>=0 && (!args[at+1] || args[at+1].startsWith('--')))throw Error('Missing --agent-root');
  let target=resolve(at>=0?args[at+1]:join(homedir(),'.pi/agent'));
  if(at>=0)args.splice(at,2);
  if(args.some(a=>!['--plan','--update','--non-interactive','--add-to-path','--no-path','--skip-search-keys','--full-check'].includes(a)))throw Error('Options: --agent-root PATH --plan --update --non-interactive --add-to-path --no-path --skip-search-keys --full-check');
  if(args.includes('--add-to-path')&&args.includes('--no-path'))throw Error('Choose either --add-to-path or --no-path');
  if(!args.includes('--plan')) {
    const choices=await setupChoices({target,version:JSON.parse(fs.readFileSync(join(repo,'distribution.json'),'utf8')).piVersion,update:args.includes('--update'),nonInteractive:args.includes('--non-interactive'),addToPath:args.includes('--add-to-path'),noPath:args.includes('--no-path'),skipKeys:args.includes('--skip-search-keys')});
    if(choices.cancel)process.exit(0);
    target=choices.target;if(choices.update&&!args.includes('--update'))args.push('--update');
    if(choices.addToPath&&!args.includes('--add-to-path'))args.push('--add-to-path');
    if(choices.offerKeys)args.push('--offer-search-keys');
  }
  if([repo,payload,homedir(),'/'].includes(target) || [payload,'/etc','/usr','/var','/bin','/sbin','/boot','/proc','/sys','/dev','/run'].some(p=>target.startsWith(p+'/')) || repo.startsWith(target+'/'))throw Error('Choose an independent AgentRoot');
  if(process.env.WSL_DISTRO_NAME&&/^\/mnt\/[a-z]\//i.test(target))throw Error('WSL requires a Linux-native AgentRoot, not a Windows drive mount');
  if(args.includes('--full-check')&&!target.includes('/.local/'))throw Error('Full tests require a disposable repository .local AgentRoot');
  // Also validates ancestors of a not-yet-existing target.
  child(target,'settings.json');
  const manifest=JSON.parse(fs.readFileSync(join(repo,'distribution.json'),'utf8'));
  for(const [p,expected] of Object.entries(manifest.files)) {
    const source=child(payload,p);child(target,p);
    if(!fs.lstatSync(source).isFile() || hash(fs.readFileSync(source,'utf8').replaceAll('\r\n','\n'))!==expected)throw Error('Distribution integrity check failed: '+p);
  }
  console.log(JSON.stringify({target,pi:manifest.piVersion,files:Object.keys(manifest.files).length,platform:'linux',plan:args.includes('--plan')}));
  if(args.includes('--plan'))process.exit(0);
  const existing=fs.existsSync(target) && fs.readdirSync(target).length>0;
  if(existing && !args.includes('--update'))throw Error('Target already contains files; use --update after review');
  fs.mkdirSync(target,{recursive:true,mode:0o700});protect(target,true);
  for(const p of ['auth.json','models.json','secrets/web-keys.json']) {
    const file=child(target,p);
    if(fs.existsSync(file)){if(!fs.lstatSync(file).isFile() || fs.lstatSync(file).nlink!==1)throw Error('Invalid private file');protect(file);}
  }
  if(fs.existsSync(child(target,'secrets')))protect(child(target,'secrets'),true);
  let safety;if(existing)safety=backup(target,{label:'before-update'});
  const oldSettings=fs.existsSync(child(target,'settings.json'))?JSON.parse(fs.readFileSync(child(target,'settings.json'),'utf8')):{};
  try {
    if(fs.existsSync(child(target,'APPEND_SYSTEM.md'))&&!fs.existsSync(child(target,'APPEND_SYSTEM.linux.md')))fs.copyFileSync(child(target,'APPEND_SYSTEM.md'),child(target,'APPEND_SYSTEM.linux.md'));
    for(const p of Object.keys(manifest.files)) {
      // Preserve every existing personal configuration; core source updates have an independent backup.
      const dest=child(target,p);
      if(existing && fs.existsSync(dest) && (/^APPEND_SYSTEM(?:\.(?:windows|linux))?\.md$/.test(p) || /^(?:agents\/|themes\/|[^/]+\.json$|extensions\/(?:subagent|pi-permission-suite)\/config\.json$)/.test(p)))continue;
      fs.mkdirSync(dirname(dest),{recursive:true,mode:0o700});
      fs.copyFileSync(child(payload,p),dest);fs.chmodSync(dest,0o600);
    }
    const settingsFile=child(target,'settings.json'), settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
    if(!existing)delete settings.defaultTools;
    else Object.assign(settings,oldSettings);
    const name=p=>(typeof p==='string'?p:p.source).replace(/@[^@]+$/,'');
    const defaults=JSON.parse(fs.readFileSync(child(payload,'settings.json'),'utf8')).packages;
    const known=new Set(defaults.map(name));
    const extras=(oldSettings.packages||[]).filter(p=>!known.has(name(p)) && !name(p).includes('pi-mcp-adapter') && name(p)!=='npm:pi-cc-extensions');
    settings.packages=[...defaults.map(p=>{
      if(name(p)==='npm:pi-web-access')return p;
      const old=(oldSettings.packages||[]).find(o=>name(o)===name(p));
      return old && typeof old==='object'?{...old,source:typeof p==='string'?p:p.source}:p;
    }),...extras];
    fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2)+'\n',{mode:0o600});
    migrateWebAccess(target,JSON.parse(fs.readFileSync(child(payload,'web-search.json'),'utf8')));
    configurePlatform(target);
    const permissionFile=child(target,'extensions/pi-permission-suite/config.json'),permission=JSON.parse(fs.readFileSync(permissionFile,'utf8'));
    permission.path.deny[join(target,'secrets/*')]='Private search credentials';permission.path.deny[join(target,'auth.json')]='Private model credentials';permission.path.deny[join(target,'web-search.json')]='Private web configuration and credentials';
    fs.writeFileSync(permissionFile,JSON.stringify(permission,null,2)+'\n',{mode:0o600});
    for(const dir of ['install/releases/'+manifest.piVersion,'npm','customization/runtime/build-runtime']) {
      const r=spawnSync('npm',['ci','--prefix',child(target,dir),'--no-audit','--no-fund','--ignore-scripts',...(dir==='npm'?['--legacy-peer-deps']:[])],{cwd:target,stdio:'inherit'});
      if(r.status!==0)throw Error('Locked dependency installation failed: '+dir);
    }
    if(extras.length)runNode(target,[child(target,'install/releases/'+manifest.piVersion+'/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'update','--extensions']);
    fs.chmodSync(child(target,'bin/pi'),0o700);fs.chmodSync(child(target,'customization/maintain-pi.sh'),0o700);
    fs.writeFileSync(child(target,'install/node-path'),process.execPath+'\n',{mode:0o600});
    runNode(target,[child(target,'customization/runtime/maintenance.mjs'),'--agent-root',target,'Rebuild']);
    runNode(target,[child(target,'customization/checks/check-startup.mjs')]);
    if(args.includes('--full-check'))runNode(target,[child(target,'customization/runtime/maintenance.mjs'),'--agent-root',target,'Check','--full-check']);
    if(args.includes('--add-to-path')) {
      const changes=configureBashPath(child(target,'bin'));for(const item of changes)console.log('PATH: '+item.file+(item.backup?' (backup: '+item.backup+')':''));
      const rc=/(?:^|\/)zsh$/.test(process.env.SHELL||'')?'~/.zshrc':'~/.bashrc';
      console.log('新终端可直接运行 pi；当前终端执行 source '+rc+'; hash -r。现有 Pi 未卸载。');
    }
    if(args.includes('--offer-search-keys'))await offerSearchKeys(target);
    console.log('Installed. Start: '+join(target,'bin/pi'));
  } catch(e) {
    // Keep the recoverable backup and report actual state; dependencies/builds may be incomplete.
    console.error('Installation incomplete; no directories deleted. '+(safety?'Pre-update backup: '+safety:'New isolated target retained for inspection.'));
    throw e;
  }
} catch(e){console.error(e.message);process.exitCode=1;}

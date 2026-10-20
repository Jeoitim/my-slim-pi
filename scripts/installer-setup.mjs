// Installer-only user choices. Never loaded into Pi's model context.
import * as fs from 'node:fs';
import {join,resolve,dirname,delimiter} from 'node:path';
import {homedir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline/promises';
import {pathToFileURL} from 'node:url';
import {child} from '../agent/customization/runtime/maintenance.mjs';

export const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function existingPi(env=process.env) {
  const found=[];
  for(const dir of (env.PATH||env.Path||'').split(delimiter).filter(Boolean))for(const name of process.platform==='win32'?['pi.cmd','pi.ps1','pi.exe']:['pi']) {
    const file=join(dir,name);if(!fs.existsSync(file) || found.some(p=>p.path===file))continue;
    let version='unknown';
    // Read managed version metadata without loading extensions or touching auth.
    const managed=join(dirname(dirname(file)),'install/current-version');
    if(fs.existsSync(managed)) {const text=fs.readFileSync(managed,'utf8').trim();if(/^[\w.+-]{1,60}$/.test(text))version=text;}
    else {
      const result=process.platform==='win32'
        ?spawnSync('pwsh.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command','& $env:PI_INSPECT_PROGRAM --version'],{encoding:'utf8',timeout:5000,windowsHide:true,env:{...env,PI_OFFLINE:'1',PI_INSPECT_PROGRAM:file}})
        :spawnSync(file,['--version'],{encoding:'utf8',timeout:5000,env:{...env,PI_OFFLINE:'1'}});
      const match=(result.stdout||'').match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/);if(match)version=match[0];
    }
    found.push({path:file,version});
  }
  return found;
}
export async function choose(question,options,defaultIndex=0) {
  if(!process.stdin.isTTY)throw Error('Interactive input is unavailable; pass explicit non-interactive options');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  try {
    for(;;) {
      console.log(question);options.forEach((text,i)=>console.log(`  ${i+1}. ${text}${i===defaultIndex?' [默认]':''}`));
      const answer=(await rl.question('选择 / Choose: ')).trim();
      const n=answer===''?defaultIndex:Number(answer)-1;if(Number.isInteger(n)&&n>=0&&n<options.length)return n;
    }
  }finally{rl.close();}
}
export async function setupChoices({target,version,update=false,nonInteractive=false,addToPath=false,noPath=false,skipKeys=false}) {
  const interactive=!nonInteractive && Boolean(process.stdin.isTTY);
  const commands=interactive?existingPi():[];
  console.log(`需要安装的 Pi / Pinned Pi: ${version}`);
  for(const command of commands)console.log(`已有命令 / Existing: ${command.path} (Pi ${command.version}${command.version===version?', same version':', different or unknown version'})`);
  const exists=fs.existsSync(target)&&fs.readdirSync(target).length>0;
  if(exists) {
    let installed='unknown';const file=join(target,'install/current-version');
    if(fs.existsSync(file)){const text=fs.readFileSync(file,'utf8').trim();if(/^[\w.+-]{1,60}$/.test(text))installed=text;}
    console.log(`目标安装 / Target: ${target} (Pi ${installed}${installed===version?', same version':', different or unknown version'})`);
  }
  if(exists&&!update) {
    if(!interactive)throw Error('Target already contains files; use --update after review');
    const answer=await choose('目标已有文件；选择处理方式 / Existing installation:', ['备份后更新或修复 / Backup and update or repair','使用新的独立目录 / Side-by-side install','取消并保留现有安装 / Cancel']);
    if(answer===2)return {cancel:true};
    if(answer===1) {
      const rl=createInterface({input:process.stdin,output:process.stdout});
      try {target=resolve((await rl.question('新的独立 AgentRoot 绝对路径: ')).trim());}finally{rl.close();}
      if(fs.existsSync(target)&&fs.readdirSync(target).length)throw Error('Side-by-side directory must be empty');
    }else update=true;
  } else if(commands.length&&!exists) {
    const answer=await choose('发现已有 pi；不会卸载或改写现有程序 / Existing command:', ['继续安装独立定制版，随后选择命令优先级 / Install managed Pi alongside','取消，继续使用现有 pi / Keep existing and cancel']);
    if(answer===1)return {cancel:true};
  }
  if(interactive&&!addToPath&&!noPath)addToPath=(await choose('将此安装的 pi 设为用户默认命令？ / Add to user PATH and prefer this pi?', ['是 / Yes','否，使用完整启动路径 / No']))===0;
  return {target,update,addToPath,offerKeys:interactive&&!skipKeys};
}
export function configureBashPath(bin,home=homedir(),loginShell=process.env.SHELL||'') {
  bin=resolve(bin);const changes=[];
  const begin='# >>> My Slim Pi >>>',end='# <<< My Slim Pi <<<';
  const block=`${begin}\ncase "$PATH" in\n  ${shellQuote(bin)}:*) ;;\n  *) export PATH=${shellQuote(bin)}:"$PATH" ;;\nesac\n${end}`;
  // bash_profile may override profile, so cover the active login file plus bashrc.
  const login=fs.existsSync(join(home,'.bash_profile'))?'.bash_profile':fs.existsSync(join(home,'.bash_login'))?'.bash_login':'.profile';
  const profiles=[login,'.bashrc',...(/(?:^|\/)zsh$/.test(loginShell)?['.zprofile','.zshrc']:[])];
  for(const name of [...new Set(profiles)]) {
    const file=child(home,name);let text=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
    if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).nlink!==1))throw Error('Shell profile must be an ordinary file');
    const i=text.indexOf(begin),j=text.indexOf(end);
    if((i<0)!==(j<0)||i>j)throw Error('Incomplete My Slim Pi profile block; inspect it manually');
    if(i>=0)text=text.slice(0,i)+text.slice(j+end.length).replace(/^\r?\n/,'');
    const next=text.replace(/(?:\r?\n)*$/,'')+'\n\n'+block+'\n';
    if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===next)continue;
    let backup;
    if(fs.existsSync(file)) {backup=child(home,name+'.my-slim-pi-backup-'+Date.now());fs.writeFileSync(backup,fs.readFileSync(file),{mode:0o600,flag:'wx'});}
    fs.writeFileSync(file,next,{mode:0o600});changes.push({file,backup});
  }
  return changes;
}
export async function offerSearchKeys(target) {
  for(;;) {
    const n=await choose('可选：现在配置搜索 Key？免费 Exa MCP 无需 Key / Optional API keys:', ['跳过或完成 / Skip or done','Brave','Tavily','Exa API']);
    if(n===0)return;
    const result=spawnSync(process.execPath,[join(target,'customization/runtime/maintenance.mjs'),'--agent-root',target,'SetKey',['','brave','tavily','exa'][n]],{stdio:'inherit'});
    if(result.status!==0)console.log('Key 未保存；可以重试或跳过。No key saved.');
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
    if(args.includes('--windows-options')) {
      const result=await setupChoices({target:value('--target'),version:value('--version'),update:args.includes('--update'),addToPath:args.includes('--add-to-path'),noPath:args.includes('--no-path'),skipKeys:args.includes('--skip-search-keys')});
      fs.writeFileSync(value('--result'),JSON.stringify(result),{mode:0o600});
    }else if(args.includes('--search-keys'))await offerSearchKeys(resolve(value('--target')));
    else throw Error('Unknown installer setup action');
  }catch(error){console.error(error.message);process.exitCode=1;}
}

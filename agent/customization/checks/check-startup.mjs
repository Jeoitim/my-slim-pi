// Deployment readiness only. No test fixtures, model requests, session persistence or memory queries.
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.PI_CODING_AGENT_DIR||join(import.meta.dirname,'../..'));
process.env.PI_CODING_AGENT_DIR=root;process.env.PI_OFFLINE='1';
process.env.PI_HASHLINE_DIR=join(root,'pi-hashline-edit-pro');
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
if(!/^[\w.+-]+$/.test(version))throw Error('Invalid managed version');
const base=join(root,'install/releases',version,'node_modules/@earendil-works/pi-coding-agent/dist');
const sdk=await import(pathToFileURL(join(base,'index.js')));
const {initTheme}=await import(pathToFileURL(join(base,'modes/interactive/theme/theme.js')));
initTheme('claude-warm');
const loader=new sdk.DefaultResourceLoader({cwd:root,agentDir:root,noContextFiles:true,extensionFactories:[sdk.createMcpExtension({loadConfig:()=>({servers:[],errors:[]})})]});
await loader.reload();
const errors=loader.getExtensions().errors;
if(errors.length){console.error('Extension startup failed:',JSON.stringify(errors));process.exitCode=1;}
else {
  const {session}=await sdk.createAgentSession({cwd:root,agentDir:root,resourceLoader:loader,sessionManager:sdk.SessionManager.inMemory(root)});
  const runtimeErrors=[];session.extensionRunner.onError(error=>runtimeErrors.push(error));
  try {
    await session.bindExtensions({mode:'json'});
    // pi-cc registers its write renderer on the next event-loop turn. Keep the
    // session alive until startup callbacks finish before checking or disposing it.
    await new Promise(resolve=>setTimeout(resolve,50));
    const tools=session.getActiveToolNames();
    const configured=JSON.parse(readFileSync(join(root,'settings.json'),'utf8')).defaultTools||[];
    const shell=process.platform==='win32'?'powershell':'bash';
    if(configured.includes(shell)&&!tools.includes(shell))throw Error('Configured native shell was not loaded');
    if(!tools.includes('maintain_pi')||runtimeErrors.length)throw Error('Managed extension startup did not complete');
    console.log(JSON.stringify({startup:'ok',version,platform:process.platform,shell,tools,extensionErrors:0}));
  }finally{await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});session.dispose();}
}

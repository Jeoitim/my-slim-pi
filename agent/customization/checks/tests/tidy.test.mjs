import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.env.PI_CODING_AGENT_DIR);
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const base=join(root,'install/releases',version,'node_modules/@earendil-works/pi-coding-agent/dist');
const sdk=await import(pathToFileURL(join(base,'index.js')));
const themes=await import(pathToFileURL(join(base,'modes/interactive/theme/theme.js')));
themes.initTheme('claude-warm');
const tui=await import(pathToFileURL(join(root,'install/releases',version,'node_modules/@earendil-works/pi-tui/dist/index.js')));

test('native pi-tidy coexists with the suite and shell chrome, folds reads and keeps edits visible',async()=>{
  const settings=JSON.parse(readFileSync(join(root,'settings.json'),'utf8'));
  assert.equal(settings.packages.filter(p=>(typeof p==='string'?p:p.source).startsWith('npm:pi-tidy@')).length,1);
  assert.equal(JSON.parse(readFileSync(join(root,'pi-cc-extensions.json'),'utf8')).mode,'off');
  assert.equal(settings.tidy.enabled,true);
  assert.ok(['replace','insert','write'].every(name=>settings.tidy.alwaysShowTools.includes(name)));
  const loader=new sdk.DefaultResourceLoader({cwd:root,agentDir:root,noContextFiles:true,extensionFactories:[sdk.createMcpExtension({loadConfig:()=>({servers:[],errors:[]})})]});
  await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
  const tidy=loader.getExtensions().extensions.filter(e=>e.path.replaceAll('\\','/').includes('/pi-tidy/'));
  assert.equal(tidy.length,1,'one native entry, not a second bundled copy');
  assert.equal(tidy[0].tools.size,0,'rendering never replaces execution tools');
  const {session}=await sdk.createAgentSession({cwd:root,agentDir:root,resourceLoader:loader,sessionManager:sdk.SessionManager.inMemory(root)});
  const errors=[];session.extensionRunner.onError(error=>errors.push(error));
  const stub=session.extensionRunner.getUIContext();
  const ui=new Proxy(stub,{get(target,key){if(key==='theme')return themes.theme;if(key==='onTerminalInput')return()=>()=>{};if(key==='getEditorComponent')return()=>undefined;return Reflect.get(target,key);}});
  try{
    await session.bindExtensions({mode:'tui',uiContext:ui});
    await new Promise(r=>setTimeout(r,60));
    assert.deepEqual(errors,[]);
    assert.ok(session.extensionRunner.getCommand('ccstyle'),'pi-cc shell features remain installed');
    assert.ok(session.extensionRunner.getCommand('task-agents'));
    const display={requestRender(){},terminal:{columns:100}};
    const card=(name,id,text)=>{const c=new sdk.ToolExecutionComponent(name,id,{path:'fixture.txt'},undefined,undefined,display,root);c.setArgsComplete();c.updateResult({content:[{type:'text',text}],isError:false,durationMs:10});return c;};
    const first=card('read','tidy-read-1','first output'),second=card('read','tidy-read-2','second output');
    const container=new tui.Container();container.addChild(first);container.addChild(second);
    const render=()=>container.render(100).map(tui.stripTerminalSequences).join('\n');
    render();const folded=render();
    assert.match(folded,/2 calls/);assert.doesNotMatch(folded,/first output|second output/);
    first.setExpanded(true);second.setExpanded(true);
    const expanded=render();assert.match(expanded,/first output/);assert.match(expanded,/second output/);
    const edited=card('replace','tidy-edit','visible edit result');
    const editText=edited.render(100).map(tui.stripTerminalSequences).join('\n');
    assert.match(editText,/visible edit result/);assert.match(editText,/╭/);
    assert.ok(!session.getActiveToolNames().includes('edit'),'disabled execution tools stay disabled');
  }finally{await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});session.dispose();}
});

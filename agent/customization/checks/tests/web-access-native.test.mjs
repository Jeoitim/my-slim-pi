import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
const root=process.env.PI_CODING_AGENT_DIR;
if(!root || !root.replaceAll('\\','/').includes('/.local/'))throw Error('Use an isolated .local AgentRoot');
process.env.PI_HASHLINE_DIR=join(root,'pi-hashline-edit-pro');
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const host=join(root,'install/releases',version,'node_modules/@earendil-works/pi-coding-agent/dist');
const sdk=await import(pathToFileURL(join(host,'index.js')));
const {initTheme}=await import(pathToFileURL(join(host,'modes/interactive/theme/theme.js')));initTheme('claude-warm');

test('native package auto activation, real permission pipeline, serial fallback, fetch and cached retrieval',async()=>{
  // An installer-imported proxy switches upstream fetch to curl, bypassing the
  // fetch mock. Isolate the transport and credentials before loading the plugin.
  const configFile=join(root,'web-search.json'),originalConfig=readFileSync(configFile);
  const config=JSON.parse(originalConfig.toString('utf8'));delete config.proxy;
  for(const key of Object.keys(config))if(/ApiKey$/.test(key))delete config[key];
  writeFileSync(configFile,JSON.stringify(config));
  try {
  mkdirSync(join(root,'cache'),{recursive:true});const cwd=mkdtempSync(join(root,'cache/native-web-'));
  const env={...process.env},originalFetch=globalThis.fetch,calls=[];let winner='tavily';
  for(const key of Object.keys(process.env))if(/^(?:https?|all)_proxy$/i.test(key))delete process.env[key];
  // Every transport response is local; no keys or provider traffic are used.
  for(const p of ['EXA','BRAVE','TAVILY'])process.env[p+'_API_KEY']='fixture-native-'+p;
  process.env.DEGOOG_URL='https://93.184.216.34';
  for(const p of ['EXA_BASE_URL','BRAVE_BASE_URL','TAVILY_BASE_URL'])delete process.env[p];
  globalThis.fetch=async(input)=>{
    const url=String(input instanceof Request?input.url:input);calls.push(url);
    const freeItem={title:'Keyless source',url:'https://93.184.216.34/docs',content:'keyless evidence',snippet:'keyless evidence',excerpts:['keyless evidence']};
    if(url.startsWith('https://93.184.216.34/api/search'))return Response.json({results:[freeItem]});
    if(url.startsWith('https://93.184.216.34/'))return new Response('native cached public page text '.repeat(40),{headers:{'content-type':'text/plain'}});
    if(url.includes('duckduckgo.com'))return new Response('<div class="result"><a class="result__a" href="https://93.184.216.34/docs">Keyless source</a><div class="result__snippet">keyless evidence</div></div>');
    if(url.includes('degoog.org') || url.includes('keenable'))return Response.json({results:[freeItem]});
    if(url.includes('parallel.ai'))return Response.json({jsonrpc:'2.0',id:1,result:{structuredContent:{results:[freeItem]}}});
    const provider=url.includes('exa.ai')?'exa':url.includes('brave.com')?'brave':url.includes('tavily.com')?'tavily':undefined;
    assert.ok(provider,'Unexpected outbound request: '+url);
    if(provider!==winner)return new Response('fixture transient error',{status:503});
    const item={title:'Native source',url:'https://93.184.216.34/docs',text:'native evidence',description:'native evidence',content:'native evidence'};
    return Response.json(provider==='brave'?{web:{results:[item]}}:{results:[item]});
  };
  const model={id:'offline',name:'offline',provider:'web-offline',api:'openai-completions',input:['text'],reasoning:false,contextWindow:10000,maxTokens:100,cost:{input:0,output:0,cacheRead:0,cacheWrite:0},compat:{supportsMidConvoSystemMessages:true,supportsMidConvoToolAdditions:true}};
  const loader=new sdk.DefaultResourceLoader({cwd,agentDir:root,noContextFiles:true,extensionFactories:[sdk.createMcpExtension({loadConfig:()=>({servers:[],errors:[]})})]});
  await loader.reload();assert.deepEqual(loader.getExtensions().errors,[]);
  const {session}=await sdk.createAgentSession({cwd,agentDir:root,resourceLoader:loader,model,sessionManager:sdk.SessionManager.inMemory(cwd)});
  try {
    await session.bindExtensions({mode:'json'});
    await new Promise(resolve=>setTimeout(resolve,100));
    assert.ok(session.getActiveToolNames().includes('web_enable'));
    assert.ok(!session.getActiveToolNames().includes('web_search'));
    assert.ok(!session.getAllTools().some(t=>['web','source_check'].includes(t.name)));
    const searchSchema=JSON.stringify(session.extensionRunner.getToolDefinition('web_search').parameters);
    for(const provider of ['exa','parallel-mcp','degoog','duckduckgo','keenable','searxng','openai','kimi'])assert.ok(searchSchema.includes('"'+provider+'"'),provider);
    for(const command of ['curator','websearch','google-account'])assert.equal(session.extensionRunner.getCommand(command),undefined);
    const call=async(name,args)=>{
      const id='web-fixture-'+session.agent.state.messages.length;
      const assistant={role:'assistant',content:[{type:'toolCall',id,name,arguments:args}],api:model.api,provider:model.provider,model:model.id,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{...model.cost,total:0}},stopReason:'toolUse',timestamp:Date.now()};
      session.agent.state.messages.push(assistant);session.sessionManager.appendMessage(assistant);
      const outcome=await session.extensionRunner.createToolContext(id).executeTool(name,args);
      return {...outcome.result,isError:outcome.isError};
    };
    const mode=session.extensionRunner.getCommand('approval-mode');await (mode.handler||mode.command.handler)('plan',session.extensionRunner.createContext());
    assert.equal((await call('web_enable',{})).isError,false);
    for(const tool of ['web_search','fetch_content','get_search_content'])assert.ok(session.getActiveToolNames().includes(tool),tool);
    const before=calls.length;
    for(const args of [{url:join(cwd,'private.mp4')},{url:'https://github.com/example/repo',forceClone:true},{url:'https://example.com',auth:true},{url:'https://example.com',proxy:'http://proxy.example:3128'}])assert.equal((await call('fetch_content',args)).isError,true);
    assert.equal(calls.length,before);
    const search=await call('web_search',{query:'native fixture',includeContent:false});assert.equal(search.isError,false,JSON.stringify(search));
    assert.deepEqual(calls.map(u=>u.includes('exa.ai')?'exa':u.includes('brave.com')?'brave':'tavily'),['exa','brave','tavily']);
    calls.length=0;winner='exa';
    assert.equal((await call('web_search',{query:'stop fixture',includeContent:false})).isError,false);assert.equal(calls.length,1);
    for(const provider of ['parallel-mcp','degoog','duckduckgo','keenable']) {
      const result=await call('web_search',{query:'keyless fixture',provider,includeContent:false});
      assert.equal(result.isError,false,provider+': '+JSON.stringify(result));
      assert.match(JSON.stringify(result),/Keyless source/);
    }
    for(const provider of ['brave','tavily']) {
      for(const key of Object.keys(process.env))if(key.startsWith(provider.toUpperCase()+'_API_KEY') || key==='BRAVE_SEARCH_API_KEY')delete process.env[key];
      const result=await call('web_search',{query:'missing key fixture',provider,includeContent:false});
      assert.equal(result.isError,true);
      assert.match(JSON.stringify(result.content),/web-search\.json/);
      assert.doesNotMatch(JSON.stringify(result.content),/Pi-Maintenance\.bat|Maintain-Pi\.ps1/);
    }
    const fetched=await call('fetch_content',{url:'https://93.184.216.34/docs',mode:'raw'});assert.equal(fetched.isError,false,JSON.stringify(fetched));
    const responseId=fetched.details?.responseId;assert.ok(responseId,JSON.stringify(fetched.details));
    const requests=calls.length;
    const cached=await call('get_search_content',{responseId});assert.equal(cached.isError,false,JSON.stringify(cached));
    assert.match(JSON.stringify(cached),/native cached public page/);assert.equal(calls.length,requests);
    const proxied=[];
    const proxy=createServer((request,response)=>{proxied.push(request.url);response.writeHead(200,{'Content-Type':'text/plain'});response.end('native curl proxy fixture '.repeat(40));});
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    try {
      await (mode.handler||mode.command.handler)('act',session.extensionRunner.createContext());
      const result=await call('fetch_content',{url:'http://93.184.216.34/proxy-fixture',mode:'raw',proxy:'http://127.0.0.1:'+proxy.address().port});
      assert.equal(result.isError,false,JSON.stringify(result));
      assert.deepEqual(proxied,['http://93.184.216.34/proxy-fixture']);
    } finally {await new Promise(resolve=>proxy.close(resolve));}
  } finally {
    await new Promise(resolve=>setTimeout(resolve,100));
    await session.extensionRunner.emit({type:'session_shutdown',reason:'exit'});session.dispose();globalThis.fetch=originalFetch;
    for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
  }
  } finally {writeFileSync(configFile,originalConfig);}
});

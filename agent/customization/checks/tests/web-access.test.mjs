import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,jiti,harness,APPROVE} from './auto-harness.mjs';
import {migrateWebAccess,backup,restore,restorePlan,literalCredential} from '../../runtime/maintenance.mjs';
const {webReadOnly}=await jiti.import(join(root,'extensions/timrt-suite/call-policy.ts'));
const defaults=JSON.parse(readFileSync(join(root,'web-search.json'),'utf8'));
delete defaults.proxy;

for(const mode of ['auto','act','ask','plan'])test(`native Web public calls are exempt; sensitive parameters follow ${mode}`,async()=>{
  const h=await harness(()=>APPROVE);h.setMode(mode);const asked=h.ask('✅ 批准');
  for(const [name,input] of [['web_enable',{}],['get_search_content',{responseId:'fixture'}],['web_search',{query:'public docs'}],['web_search',{query:'public docs',includeContent:true}],['fetch_content',{url:'https://example.com/docs'}],['fetch_content',{urls:['https://example.com/a','https://pi.dev/b'],mode:'raw'}]])assert.equal(await h.call(name,input),undefined,name);
  assert.equal(h.requests.length,0);assert.equal(asked(),0);
  for(const input of [{url:join(h.ctx.cwd,'local.mp4')},{url:pathToFileURL(join(h.ctx.cwd,'local.mp4')).href},{url:'https://github.com/example/repo',forceClone:true},{url:'https://example.com/private',auth:true},{url:'https://example.com/a',proxy:'http://proxy.example:3128'},{url:'https://user:pass@example.com/a'},{url:'http://127.0.0.1/a'},{url:'https://example.com',mode:'answer',prompt:'analyze'},{urls:['https://example.com',join(h.ctx.cwd,'local.mp4')]}]) {
    const before=h.requests.length,questions=asked(),result=await h.call('fetch_content',input);
    assert.equal(Boolean(result?.block),mode==='plan',JSON.stringify(input));
    assert.equal(h.requests.length-before,mode==='auto'?1:0);
    assert.equal(asked()-questions,mode==='ask'?1:0);
  }
  const denied=await h.call('fetch_content',{url:join(root,'web-search.json')});assert.equal(denied?.block,true);
});

test('PDF response uncertainty, clone/credentials and credential commands remove read-only exemption',()=>{
  const fixture=mkdtempSync(join(root,'cache/web-policy-'));
  const check=config=>{writeFileSync(join(fixture,'web-search.json'),JSON.stringify(config));return webReadOnly('fetch_content',{url:'https://example.com/no-extension'},fixture);};
  assert.equal(check(defaults),true);
  for(const feature of ['pdf','githubClone','githubPrIssue','youtube'])assert.equal(check({...defaults,[feature]:{enabled:true}}),false,feature);
  assert.equal(check({...defaults,allowBrowserCookies:true}),false);
  assert.equal(check({...defaults,exaApiKey:'!trusted-secret-command'}),false);
  writeFileSync(join(fixture,'web-search.json'),'{');assert.equal(webReadOnly('fetch_content',{url:'https://example.com'},fixture),false);
  assert.equal(webReadOnly('unknown_web',{readOnlyHint:true},root),false);
});

test('migration removes obsolete implementation, backs up keys, preserves native proxy and supports restore',async()=>{
  const fixture=mkdtempSync(join(root,'cache/web-migration-'));
  const put=(p,s)=>{mkdirSync(join(fixture,p,'..'),{recursive:true});writeFileSync(join(fixture,p),s);};
  put('secrets/web-keys.json',JSON.stringify({exa:'fixture-exa',brave:'!literal-brave',tavily:'fixture-tavily'}));
  put('web-search.json',JSON.stringify({proxy:'http://127.0.0.1:3128',exaApiKey:'existing-native',searchRouting:{providers:['exa','brave','tavily']},webSearch:{allowedProviders:['exa','brave','tavily']}}));
  put('extensions/timrt-suite/web-route.ts','obsolete');
  put('npm/package.json','{"dependencies":{}}');put('npm/package-lock.json','{"lockfileVersion":3}');
  put('mcp.json',JSON.stringify({mcpServers:{exa:{url:'https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa'},other:{command:'other'}}}));
  migrateWebAccess(fixture,defaults);
  const config=JSON.parse(readFileSync(join(fixture,'web-search.json')));
  assert.equal(config.exaApiKey,'existing-native');assert.equal(config.braveApiKey,'$!literal-brave');
  assert.equal(config.tavilyApiKey,'fixture-tavily');
  assert.equal(config.proxy,'http://127.0.0.1:3128');assert.equal(config.toolActivation,'auto');
  assert.equal(config.searchRouting,undefined);assert.equal(config.webSearch?.allowedProviders,undefined);
  assert.equal(existsSync(join(fixture,'secrets/web-keys.json')),false);
  assert.equal(existsSync(join(fixture,'extensions/timrt-suite/web-route.ts')),false);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(fixture,'mcp.json'))).mcpServers),['other']);
  const snapshot=backup(fixture);assert.equal(JSON.parse(readFileSync(join(snapshot,'configuration-snapshot.json'))).credentialsIncluded,true);
  assert.equal(readFileSync(join(snapshot,'npm/package-lock.json'),'utf8'),'{"lockfileVersion":3}');
  writeFileSync(join(fixture,'web-search.json'),'{}');restore(fixture,restorePlan(fixture,snapshot));
  assert.deepEqual(JSON.parse(readFileSync(join(fixture,'web-search.json'))),config);
  assert.equal(literalCredential('$literal'),'$$literal');
  if(process.platform==='linux')assert.equal((await import('node:fs')).statSync(join(fixture,'web-search.json')).mode&0o777,0o600);
});

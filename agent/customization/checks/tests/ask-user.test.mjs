import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setImmediate as flush } from 'node:timers/promises';
const root=process.env.PI_CODING_AGENT_DIR;
assert.ok(root,'Use an isolated AgentRoot');
const version=readFileSync(join(root,'install/current-version'),'utf8').trim();
const modules=join(root,'install/releases',version,'node_modules');
const {createJiti}=await import(pathToFileURL(join(modules,'jiti/lib/jiti.mjs')));
const jiti=createJiti(import.meta.url,{alias:{
  '@earendil-works/pi-coding-agent':join(modules,'@earendil-works/pi-coding-agent/dist/index.js'),
  '@earendil-works/pi-tui':join(modules,'@earendil-works/pi-tui/dist/index.js'),
  '@sinclair/typebox':join(modules,'typebox/build/index.mjs'),
}});
const {installAskUser,QUESTION_TIMEOUT_MS}=await jiti.import(join(root,'extensions/my-slim-pi-suite/ask-user.ts'));
const question={question:'选择实现？',options:[{title:'现有接口'},{title:'新增接口'}]};
test('compact declaration preserves upstream validation and UI controls',async()=>{
  const {default:register}=await jiti.import(join(root,'npm/node_modules/pi-ask-user/index.ts'));
  let original;register({on(){},registerTool(t){original=t;},events:{emit(){}}});
  const originalJson=JSON.stringify(original.parameters);
  const compact=harness().tool.parameters;
  // Keep non-enumerable and symbol keys too: TypeBox uses optional markers.
  const constraints=(value,properties=false)=>{
    if(Array.isArray(value))return value.map(v=>constraints(v));
    if(!value || typeof value!=='object')return value;
    return Object.fromEntries(Reflect.ownKeys(value).filter(key=>properties || key!=='description').map(key=>[key,constraints(value[key],key==='properties')]));
  };
  const expected=Object.create(Object.getPrototypeOf(original.parameters),Object.getOwnPropertyDescriptors(original.parameters));
  expected.properties={...original.parameters.properties};
  delete expected.properties.timeout;
  assert.deepEqual(constraints(compact),constraints(expected));
  assert.equal(JSON.stringify(original.parameters),originalJson,'vendor schema was not mutated');
  assert.ok(JSON.stringify(compact).length<JSON.stringify(expected).length);
  assert.match(compact.properties.question.description,/heading/);
  assert.doesNotMatch(compact.properties.questions.items.properties.question.description,/heading/);
  assert.equal(harness().tool.exposure,'model-only');
  assert.equal(harness().tool.executionMode,'sequential');
});
function harness(mode='auto', contextMode) {
  const hooks=new Map(),events=[],notices=[];let tool;
  const pi={on(name,fn){hooks.set(name,[...(hooks.get(name)||[]),fn]);},registerTool(t){tool=t;},events:{emit:(...args)=>events.push(args)}};
  const state={mode};installAskUser(pi,state);
  const wait=(_title,_rows,{signal}={})=>new Promise(resolve=>signal?.aborted?resolve(undefined):signal?.addEventListener('abort',()=>resolve(undefined),{once:true}));
  const ctx={mode:contextMode,hasUI:true,ui:{custom:async()=>undefined,select:wait,input:wait,notify:(...args)=>notices.push(args)}};
  return {tool,ctx,state,events,notices,call:(args=question,signal)=>tool.execute('question',args,signal,undefined,ctx),
    emit(name,event={}){for(const fn of hooks.get(name)||[])fn(event,ctx);}};
}
for(const mode of ['auto','act'])test(`${mode}: exactly 90 seconds defaults to the visible recommendation`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const h=harness(mode);let settled=false;
  const pending=h.call({...question,timeout:1}).then(r=>(settled=true,r));await flush();
  t.mock.timers.tick(QUESTION_TIMEOUT_MS-1);await flush();assert.equal(settled,false);
  t.mock.timers.tick(1);const result=await pending;
  assert.equal(result.details.cancelled,false);assert.equal(result.details.autoSelected,true);
  assert.deepEqual(result.details.response,{kind:'selection',selections:['现有接口 (recommended)']});
  assert.match(result.content[0].text,/not user answers or operation authorization/);
  assert.equal(h.events.filter(e=>e[0]==='ask:answered').length,0);
  assert.equal(h.events.filter(e=>e[0]==='timrt:question-default').length,1);
  assert.deepEqual(h.events.filter(e=>e[0]==='herdr:blocked').map(e=>e[1].active),[true,false]);
});
for(const mode of ['ask','plan'])test(`${mode}: ignores caller timeout and waits for an explicit answer`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(mode);let complete,settled=false;
  h.ctx.ui.select=()=>new Promise(resolve=>complete=resolve);
  const pending=h.call({...question,timeout:1}).then(r=>(settled=true,r));await flush();
  t.mock.timers.tick(180_000);await flush();assert.equal(settled,false);
  complete('新增接口');const result=await pending;assert.equal(result.details.autoSelected,undefined);
  assert.deepEqual(result.details.response.selections,['新增接口']);
});
test('explicit cancellation and user choice are never replaced',async()=>{
  const h=harness();h.ctx.ui.select=async()=>undefined;
  assert.equal((await h.call()).details.cancelled,true);
  h.ctx.ui.select=async()=> '新增接口';
  const result=await h.call();assert.equal(result.details.autoSelected,undefined);
  assert.deepEqual(result.details.response.selections,['新增接口']);
});

test('a submitted recommendation reaches the approval model through the recorded question exchange',async()=>{
  const {harness:permissions}=await import('./auto-harness.mjs');
  const h=harness(),approval=await permissions(()=>'{"approved":true,"confidence":0.95,"reason":"用户选择了推荐的改名方案"}');
  h.ctx.ui.select=async(_title,rows)=>rows[0];
  const result=await h.call();
  approval.entries.push({id:'ui-question-call',message:{role:'assistant',content:[{type:'toolCall',name:'ask_user',id:'question',arguments:question}]}},
    {id:'ui-question-answer',message:{role:'toolResult',toolName:'ask_user',toolCallId:'question',...result,isError:false}});
  assert.equal(await approval.call('write',{path:'./selected.txt',content:'task data'}),undefined);
  const prompt=approval.requests[0].context.messages[0].content[0].text;
  assert.match(prompt,/"kind":"question-answer"/);
  assert.match(prompt,/现有接口 \(recommended\)/);
  assert.match(prompt,/选择实现/);
});
test('freeform answers and optional comments remain available',async()=>{
  const h=harness();h.ctx.ui.select=async(_title,rows)=>rows.at(-1);h.ctx.ui.input=async()=> '使用第三种方案';
  assert.deepEqual((await h.call()).details.response,{kind:'freeform',text:'使用第三种方案'});
  h.ctx.ui.select=async(_title,rows)=>rows[0];h.ctx.ui.input=async()=> '保持接口兼容';
  assert.equal((await h.call({...question,allowComment:true})).details.response.comment,'保持接口兼容');
});
test('headless mode, malformed defaults and UI failures never manufacture an answer',async()=>{
  const h=harness();h.ctx.hasUI=false;await assert.rejects(h.call(),/interactive mode/);
  h.ctx.hasUI=true;await assert.rejects(h.call({question:'需要什么？'}),/recommendation first/);
  h.ctx.ui.custom=async()=>{throw Error('UI failed');};await assert.rejects(h.call(),/UI failed/);
  assert.equal(h.events.some(e=>e[0]==='timrt:question-default'),false);
});
for(const kind of ['signal','input','tree','shutdown','mode'])test(`${kind}: cancellation or changed context cannot become a default`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness(),controller=new AbortController();
  const pending=h.call(question,controller.signal);await flush();
  if(kind==='signal')controller.abort();
  else if(kind==='mode')h.state.mode='ask';
  else h.emit(kind==='input'?'input':kind==='tree'?'session_tree':'session_shutdown',{source:'interactive'});
  t.mock.timers.tick(90_000);const result=await pending;
  assert.equal(result.details.cancelled,true);assert.equal(result.details.autoSelected,undefined);
});
test('batch expiry supplies a recommendation for every unanswered question',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness();
  const pending=h.call({questions:[question,{...question,question:'选择数据层？'}]});await flush();
  t.mock.timers.tick(90_000);const result=await pending;
  assert.equal(result.details.kind,'batch');assert.equal(result.details.cancelled,false);
  assert.equal(result.details.answers.length,2);
  assert.ok(result.details.answers.every(a=>a.status==='answered'&&a.response.selections[0]==='现有接口 (recommended)'));
});
test('batch expiry retains earlier submitted user answers and defaults only the rest',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness();
  const wait=h.ctx.ui.select;let calls=0;
  h.ctx.ui.select=(...args)=>++calls===1?'新增接口':wait(...args);
  const pending=h.call({questions:[question,{...question,question:'选择数据层？'}]});await flush();
  t.mock.timers.tick(90_000);const result=await pending;
  assert.deepEqual(result.details.answers[0].response.selections,['新增接口']);
  assert.equal(result.details.answers[0].source,undefined);
  assert.deepEqual(result.details.answers[1].response.selections,['现有接口 (recommended)']);
  assert.equal(result.details.answers[1].source,'timeout-default');
});
test('native picker renders the recommendation and closes exactly once on expiry',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const h=harness();let component,closed=0,removed=0;
  const theme={fg:(_color,text)=>text,bg:(_color,text)=>text,bold:text=>text};
  h.ctx.ui.onTerminalInput=()=>()=>removed++;
  h.ctx.ui.custom=factory=>new Promise(resolve=>{
    component=factory({terminal:{rows:40,columns:100},requestRender(){}},theme,{getKeys:()=>['enter'],matches:()=>false},value=>{closed++;resolve(value);});
  });
  const pending=h.call();await flush();
  for(const width of [40,80,120])assert.match(component.render(width).join('\n'),/recommended/);
  t.mock.timers.tick(90_000);assert.equal((await pending).details.autoSelected,true);
  assert.equal(closed,1);assert.equal(removed,1);assert.equal('timeout' in h.tool.parameters.properties,false);
});
test('rpc mode uses native dialogs instead of the terminal custom UI',async()=>{
  const h=harness('ask','rpc');let custom=0;
  h.ctx.ui.custom=async()=>{custom++;return {kind:'selection',selections:['不应使用']};};
  h.ctx.ui.select=async(_title,rows)=>rows[1];
  const result=await h.call();
  assert.equal(custom,0);
  assert.deepEqual(result.details.response,{kind:'selection',selections:['新增接口']});
  assert.equal(result.details.cancelled,false);
});
test('child agents contact their Supervisor instead of opening a user prompt',async()=>{
  const before=process.env.PI_SUBAGENT_CHILD;
  try {process.env.PI_SUBAGENT_CHILD='1';await assert.rejects(harness().call(),/contact_supervisor/);}
  finally {if(before===undefined)delete process.env.PI_SUBAGENT_CHILD;else process.env.PI_SUBAGENT_CHILD=before;}
});
test('question defaults cannot enable delegation, approve operations or change permission modes',async()=>{
  const {harness:permissions}=await import('./auto-harness.mjs');
  const h=await permissions(()=>'{"approved":false,"confidence":0.99,"reason":"没有用户委派授权","taskAgentAuthorization":"unchanged"}');
  for(const mode of ['auto','act','ask','plan']) {
    h.setMode(mode);assert.equal(await h.call('ask_user',question),undefined);
    assert.equal(h.state.mode,mode);assert.equal(h.state.taskAgents,false);
    assert.equal((await h.call('subagent',{agent:'developer',task:'implement'}))?.block,true);
    assert.equal((await h.call('set_approval_mode',{mode:'act'}))?.block,true);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { jiti,root } from './auto-harness.mjs';
const { installPermissions } = await jiti.import(join(root,'extensions/timrt-suite/permissions.ts'));
const { resolveSubagentCapabilityCeiling } = await jiti.import(join(root,'npm/node_modules/pi-subagents/src/api/capability-ceiling.js'));
async function harness(directory) {
  if(!directory){mkdirSync(join(root,'.local'),{recursive:true});directory=mkdtempSync(join(root,'.local/delegation-'));mkdirSync(join(directory,'extensions/pi-permission-suite'),{recursive:true});writeFileSync(join(directory,'extensions/pi-permission-suite/config.json'),'{"reviewer":{"humanFallback":"ask"}}');}
  const before=process.env.PI_CODING_AGENT_DIR;process.env.PI_CODING_AGENT_DIR=directory;
  const hooks=new Map(),commands=new Map(),tools=new Map(),entries=[],reviews=[];
  let answer={approved:false,source:'subagent',reason:'真实用户未授权',taskAgentAuthorization:'unchanged'};
  let active=['subagent','contact_supervisor','subagent_supervisor'];
  const pi={on(name,fn){hooks.set(name,[...(hooks.get(name)||[]),fn]);},registerCommand:(name,cmd)=>commands.set(name,cmd),registerShortcut(){},registerTool:t=>tools.set(t.name,t),
    getActiveTools:()=>active,setActiveTools:names=>active=names,appendEntry:(customType,data)=>entries.push({type:'custom',customType,data}),events:{on:()=>()=>{},emit(){}}};
  const native={description:'native admin',handler:async()=> 'native admin'};
  const state=installPermissions(pi,async(_ctx,name,input)=>{reviews.push({name,input});return answer;},async api=>{
    api.registerCommand('subagents',native);api.registerCommand('subagents-fleet',native);api.registerCommand('run',{handler:async()=> 'native run'});
    for(const name of ['subagent','contact_supervisor','subagent_supervisor','bg_wait'])api.registerTool({name});
  });
  const id=randomUUID();
  const ctx={cwd:directory,hasUI:true,model:{provider:'fixture',id:'fixture',name:'fixture'},modelRegistry:{getAll:()=>[]},
    sessionManager:{getEntries:()=>entries,getBranch:()=>entries,getSessionId:()=>id},ui:{theme:{appearance:'dark'},setStatus(){},notify(){},confirm:async()=>false}};
  const emit=async(name,event={})=>{let result;for(const fn of hooks.get(name)||[]){result=await fn(event,ctx);if(result?.block)return result;}return result;};
  await emit('session_start');
  return {state,ctx,commands,tools,reviews,native,directory,id,active:()=>active,setAnswer:v=>answer=v,input:text=>emit('input',{source:'interactive',text}),
    call:(toolName,input={})=>emit('tool_call',{toolName,input}),ceiling:()=>resolveSubagentCapabilityCeiling(id),
    close:async()=>{await emit('session_shutdown');if(before===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=before;}};
}
const grant={approved:true,source:'subagent',reason:'用户允许自主委派',taskAgentAuthorization:'grant'};
test('native management commands register at startup without granting delegation',async()=>{
  const h=await harness();try {
    assert.equal(h.commands.get('subagents'),h.native);assert.equal(h.commands.get('subagents-fleet'),h.native);
    assert.notEqual(h.commands.get('background-models'),h.native);assert.equal(h.state.taskAgents,false);
    assert.deepEqual(h.ceiling().allowedAgents,[]);
    await h.input('查看进度');
    for(const [name,args] of [['subagent',{action:'status'}],['subagent',{action:'read',id:'existing'}],['bg_wait',{}],['contact_supervisor',{message:'需要哪个接口？'}],['subagent_supervisor',{action:'reply',replyTo:'existing',message:'沿用现有接口'}]])assert.equal(await h.call(name,args),undefined);
    assert.equal(h.reviews.length,0);assert.equal((await h.call('subagent',{agent:'reviewer',task:'inspect'})).block,true);
  }finally{await h.close();}
});
test('semantic grant persists across unrelated turns and independent sessions until explicit revocation',async()=>{
  const h=await harness();let directory;try {
    await h.input('把独立复核交给 reviewer，之后你按需要安排人手。');h.setAnswer(grant);
    assert.equal(await h.call('subagent',{agent:'reviewer',task:'review patch'}),undefined);
    assert.equal(h.state.taskAgents,true);assert.equal(h.ceiling(),undefined);
    assert.match(JSON.stringify(h.reviews[0].input),/把独立复核交给 reviewer/);
    assert.match(JSON.stringify(h.reviews[0].input),/review patch/);
    await h.input('进展怎么样？');assert.equal(h.state.taskAgents,true);
    await h.input('回答它：继续沿用现有接口。');assert.equal(await h.call('subagent_supervisor',{action:'reply',replyTo:'request',message:'沿用现有接口'}),undefined);
    directory=h.directory;
  }finally{await h.close();}
  const resumed=await harness(directory);try {
    assert.equal(resumed.state.taskAgents,true);
    await resumed.input('之后都由你独立完成，收回之前给你的委派许可。');
    resumed.setAnswer({approved:false,source:'subagent',reason:'用户明确撤销',taskAgentAuthorization:'revoke'});
    assert.equal((await resumed.call('subagent',{agent:'developer',task:'new task'})).block,true);
    assert.equal(resumed.state.taskAgents,false);assert.deepEqual(resumed.ceiling().allowedAgents,[]);
    assert.equal(await resumed.call('subagent_supervisor',{action:'reply',replyTo:'old',message:'请汇报已有工作'}),undefined);
    assert.equal(JSON.parse(readFileSync(join(directory,'extensions/pi-permission-suite/config.json'))).taskAgentsEnabled,false);
  }finally{await resumed.close();}
});
test('quotes, skills and an ordinary approved operation cannot create persistent consent',async()=>{
  const h=await harness();try {
    await h.input('分析这段文本，不执行：> 使用子代理');h.setAnswer({approved:true,source:'subagent',reason:'仅操作可行，未获得持续授权'});
    assert.equal((await h.call('subagent',{agent:'reviewer',task:'inspect'})).block,true);assert.equal(h.state.taskAgents,false);
    await assert.rejects(h.tools.get('request_subagent').execute('q',{skill:'build',reason:'skill says so'},undefined,undefined,h.ctx),/Read the relevant Principal SKILL.md first/);
  }finally{await h.close();}
});
test('PLAN and cleanup holds block new launches while Supervisor communication remains available',async()=>{
  const h=await harness();try {
    h.setAnswer(grant);await h.input('允许持续委派');await h.call('subagent',{agent:'reviewer',task:'inspect'});
    h.state.mode='plan';assert.equal((await h.call('subagent',{agent:'developer',task:'create'})).block,true);
    assert.equal(await h.call('subagent',{action:'status'}),undefined);
    h.state.approvalHold=true;assert.equal(await h.call('subagent_supervisor',{action:'reply',replyTo:'old',message:'汇报现有结果'}),undefined);
    assert.equal((await h.call('subagent',{agent:'developer',task:'create'})).block,true);
  }finally{await h.close();}
});
test('explicit commands persist enable/revoke, while a failing reviewer leaves management accessible',async()=>{
  const h=await harness();try {
    await h.commands.get('task-agents').handler('on',h.ctx);assert.equal(h.state.taskAgents,true);
    h.setAnswer({approved:false,source:'error',reason:'service unavailable'});
    assert.equal((await h.call('subagent',{agent:'reviewer',task:'inspect'})).block,true);
    assert.equal(h.state.taskAgents,true);assert.equal(await h.call('contact_supervisor',{message:'question'}),undefined);
    await h.commands.get('task-agents').handler('off',h.ctx);assert.equal(h.state.taskAgents,false);
  }finally{await h.close();}
});
test('native FleetView mounts below the editor, expands on empty-editor arrows and opens Inspector',async()=>{
  const {SubagentFleetStatus}=await jiti.import(join(root,'npm/node_modules/pi-subagents/src/tui/fleet-status.js'));
  let listener,view,placement,editor='',opened=0;
  const state={asyncJobs:new Map([['work',{asyncId:'work',status:'running',mode:'reviewer',description:'Review exact patch',startedAt:Date.now()}]]),foregroundControls:new Map(),fleetJobs:new Map(),herdrProjectPanes:new Map(),baseCwd:root,currentSessionId:'fleet-test'};
  const theme={fg:(_c,s)=>s,bg:(_c,s)=>s,bold:s=>s};
  const ctx={hasUI:true,ui:{getEditorText:()=>editor,notify(){},getFocusOwner:()=> 'editor',
    onTerminalInput(fn){listener=fn;return()=>{listener=undefined;};},
    setWidget(_key,factory,options){placement=options?.placement;if(factory)view=factory({requestRender(){},focusedComponent:{render:()=>[],invalidate(){},handleInput(){},getText:()=>editor,setText:text=>editor=text}},theme);}}};
  const fleet=new SubagentFleetStatus(state,async()=>{opened++;},{placement:'belowEditor'});
  try {
    fleet.setContext(ctx);assert.equal(placement,'belowEditor');
    editor='draft';assert.equal(listener('\x1b[B'),undefined);
    editor='';assert.deepEqual(listener('\x1b[B'),{consume:true});
    assert.match(view.render(100).join('\n'),/reviewer/);
    listener('\x1b[B');listener('\r');await new Promise(resolve=>setImmediate(resolve));assert.equal(opened,1);
    listener('\x1b');assert.deepEqual(listener('\x1b[D'),{consume:true});
  }finally{fleet.dispose();}
});

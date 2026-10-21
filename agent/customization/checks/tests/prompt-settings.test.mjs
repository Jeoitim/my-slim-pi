import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const modules = join(root, 'install/releases', version, 'node_modules');
const { createJiti } = await import(pathToFileURL(join(modules, 'jiti/lib/jiti.mjs')));
const jiti = createJiti(import.meta.url, { alias: {
  'typebox': join(modules, 'typebox/build/index.mjs'),
  '@earendil-works/pi-coding-agent': join(modules, '@earendil-works/pi-coding-agent/dist/index.js'),
  '@earendil-works/pi-ai': join(modules, '@earendil-works/pi-ai/dist/compat.js'),
  '@earendil-works/pi-tui': join(modules, '@earendil-works/pi-tui/dist/index.js'),
} });
const source = name => join(root, 'extensions/timrt-suite', name + '.ts');

test('date is local and large post-write previews preserve a bounded set of anchors', async () => {
  const {installPromptPolicy}=await jiti.import(source('prompt-policy'));
  const hooks={}; installPromptPolicy({on:(event,fn)=>{hooks[event]=fn;}});
  const text='--- Auto-read (hashline anchors) ---\n'+Array.from({length:1000},(_,i)=>`anchor${i}│${'data'.repeat(20)}`).join('\n');
  const event={toolName:'write',isError:false,content:[{type:'text',text:'Successfully wrote 17000 bytes'},{type:'text',text}]};
  const result=hooks.tool_result(event);
  assert.match(result.content[0].text,/Successfully wrote/);
  assert.ok(result.content[1].text.length<6200);
  assert.match(result.content[1].text,/anchor0│/);
  assert.match(result.content[1].text,/使用 read/);
  assert.equal(hooks.tool_result({...event,isError:true}),undefined);
  const options={sections:{},contextFiles:[],skills:[]};
  hooks.before_agent_start({messageType:'user',prompt:'hello',systemPromptOptions:options},{cwd:root});
  assert.match(options.sections['local-date'],/\d{4}-\d{2}-\d{2}/);
});

test('background roles default to session and persist independent model choices', async () => {
  const settings = await jiti.import(source('background-models'));
  const dir = mkdtempSync(join(tmpdir(), 'pi-background-models-'));
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents/approver.md'), '---\nname: approver\ntools: []\n---\nReviewer instructions.\n');
  writeFileSync(join(dir, 'hermes-memory-config.json'), JSON.stringify({ nudgeEveryTurns: 12 }));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    const events = [];
    const pi = { events: { emit: (...args) => events.push(args) } };
    const model = { provider: 'provider-b', id: 'model/id', name: 'Actual Friendly Name' };
    const ctx = { model, modelRegistry: { getAll: () => [model], getAvailable: () => [model] } };
    for (const role of ['approver', 'hermes']) {
      assert.equal(settings.configuredBackgroundModel(role), undefined);
      assert.match(settings.backgroundModelLabel(role, ctx), /Session model.*Actual Friendly Name/);
      let choice = 0;
      ctx.ui = { select: async (_title, rows) => rows[choice++ === 0 ? 1 : 0] };
      await settings.chooseBackgroundModel(role, ctx, pi);
      assert.equal(settings.configuredBackgroundModel(role), 'provider-b/model/id');
      assert.equal(settings.backgroundModelLabel(role, ctx), 'provider-b · Actual Friendly Name');
    }
    assert.match(readFileSync(join(dir, 'agents/approver.md'), 'utf8'), /Reviewer instructions/);
    assert.equal(JSON.parse(readFileSync(join(dir, 'hermes-memory-config.json'), 'utf8')).nudgeEveryTurns, 12);
    assert.equal(settings.sessionModelReference(ctx), 'provider-b/model/id');
    for (const role of ['approver', 'hermes']) {
      ctx.ui = { select: async (_title, rows) => rows[0] };
      await settings.chooseBackgroundModel(role, ctx, pi);
      assert.equal(settings.configuredBackgroundModel(role), undefined);
    }
    assert.deepEqual(events.at(-1), ['timrt:hermes-model', { reference: null }]);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test('skill index is stable across cache inventory, development and Git projects; the model chooses detail', async () => {
  const { installPromptPolicy, stripForeignMemory } = await jiti.import(source('prompt-policy'));
  assert.equal(stripForeignMemory('Use pytest.\n<claude-mem-context>old memories</claude-mem-context>\nNo bulk deletion.'), 'Use pytest.\n\nNo bulk deletion.');
  const hooks={};installPromptPolicy({on:(event,fn)=>{hooks[event]=fn;}});
  const cwd=mkdtempSync(join(tmpdir(),'pi-skill-index-'));
  const options=()=>({sections:{},contextFiles:[{path:'AGENTS.md',content:'Project rules.\n<claude-mem-context>stale</claude-mem-context>'}],skills:[
    {name:'build',filePath:'/principal-pi-skills/build/SKILL.md',description:'Detailed engineering metadata'},
    {name:'principal',filePath:'/skills/principal/SKILL.md',description:'Engineering skill index'},
    {name:'pi-maintenance',filePath:'/skills/pi-maintenance/SKILL.md',description:'Maintain Pi configuration.'},
  ]});
  const run=prompt=>{const event={messageType:'user',prompt,systemPromptOptions:options()};hooks.before_agent_start(event,{cwd});return event.systemPromptOptions;};
  assert.deepEqual(run('hello').skills,[]);
  const inventory=run('盘点开发工具缓存，不删除');
  assert.equal(inventory.contextFiles[0].content,'Project rules.');
  assert.deepEqual(inventory.skills.map(s=>s.name),['principal','pi-maintenance']);
  for(const prompt of ['解释一下云的形成','修复代码中的 bug','帮我维护 Pi 插件，排查启动慢'])assert.deepEqual(run(prompt).skills,inventory.skills);
  mkdirSync(join(cwd,'.git'));
  assert.deepEqual(run('盘点开发工具缓存，不删除').skills,inventory.skills);
  assert.equal(inventory.sections['principal-routing'],undefined);
});

test('memory gateway keeps schemas on demand and forwards real tool error state', async () => {
  const { installMemoryGateway, MEMORY_TOOLS } = await jiti.import(source('memory-gateway'));
  let tool;
  installMemoryGateway({ registerTool: t => { tool = t; }, getAllTools: () => [{ name: 'skill_manage', description: 'Full skill management guide', parameters: { type: 'object' } }] });
  assert.deepEqual(tool.prepareLoadout({ declared: MEMORY_TOOLS.map(name => ({ name })) }).hiddenDeclarations, MEMORY_TOOLS);
  const described = await tool.execute('id', { action: 'describe', tool: 'skill_manage' });
  assert.match(described.content[0].text, /Full skill management guide/);
  const calls = [];
  const ctx = { executeTool: async (...args) => { calls.push(args); return { result: { content: [{ type: 'text', text: 'actual result' }] }, isError: true }; } };
  const searched = await tool.execute('id', { action: 'search', query: 'preference' }, undefined, undefined, ctx);
  assert.equal(searched.isError, true);
  assert.deepEqual(calls[0].slice(0, 2), ['memory_search', { query: 'preference', limit: 5 }]);
  await tool.execute('id', { action: 'add', target: 'user', content: 'Chinese responses' }, undefined, undefined, ctx);
  assert.deepEqual(calls[1].slice(0, 2), ['memory_add', { target: 'user', content: 'Chinese responses' }]);
});

test('skill text cannot authorize itself and native management is separate from background models', async () => {
  const { installPermissions } = await jiti.import(source('permissions'));
  const hooks = new Map(), commands = new Map(), tools = new Map();
  const pi = {
    on(event, fn) { const list = hooks.get(event) || []; list.push(fn); hooks.set(event, list); },
    registerCommand: (name, command) => commands.set(name, command), registerShortcut() {},
    registerTool: tool => tools.set(tool.name, tool), getActiveTools: () => [], setActiveTools() {},
    appendEntry() {}, events: { on: () => () => {}, emit() {} },
  };
  const native = {handler:async()=>{}};
  const state = installPermissions(pi,async()=>({approved:false,source:'subagent',reason:'真实用户未授权'}),async api=>{
    api.registerCommand('subagents',native);api.registerCommand('subagents-fleet',native);
  });
  let confirmations = 0, menus = 0;
  const ctx = { cwd: homedir(), hasUI: true, model: { name: 'Session Model' }, modelRegistry: { getAll: () => [] }, sessionManager: { getEntries: () => [] }, ui: { theme: { appearance: 'dark' }, setStatus() {}, notify() {}, select: async () => { menus++; }, confirm: async () => { confirmations++; return false; } } };
  for (const fn of hooks.get('session_start')) await fn({}, ctx);
  const input = async text => { for (const fn of hooks.get('input')) await fn({ text, source: 'interactive' }, ctx); };
  await input('修复代码并按需读取 Principal build 技能');
  assert.equal(state.taskAgents, false);
  const request = tools.get('request_subagent');
  await assert.rejects(request.execute('id', { skill: 'build', reason: 'Skill recommends review' }, undefined, undefined, ctx), /先读取/);
  assert.equal(confirmations, 0);
  for (const fn of hooks.get('tool_result')) await fn({ toolName: 'read', input: { path: join(root, 'npm/node_modules/principal-pi-skills/build/SKILL.md') }, isError: false }, ctx);
  await assert.rejects(request.execute('id', { skill: 'build', reason: 'Skill recommends review' }, undefined, undefined, ctx), /未授权/);
  assert.equal(confirmations, 0);
  assert.equal(state.loaded, true);
  assert.equal(state.taskAgents, false);
  await input('不要使用子代理，继续修复代码');
  await assert.rejects(request.execute('id', { reason: 'Request again' }, undefined, undefined, ctx), /未授权/);
  assert.equal(confirmations, 0);
  assert.equal(commands.get('subagents'),native);
  assert.equal(commands.get('subagents-fleet'),native);
  await commands.get('subagents').handler('', ctx);
  assert.equal(menus, 0);
  await commands.get('background-models').handler('', ctx);
  assert.equal(menus, 1);
  assert.equal(state.loaded, true);
});

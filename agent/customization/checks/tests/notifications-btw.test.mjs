import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const modules = join(root, 'install/releases', version, 'node_modules');
const { createJiti } = await import(pathToFileURL(join(modules, 'jiti/lib/jiti.mjs')));
const jiti = createJiti(import.meta.url, { alias: {
  '@earendil-works/pi-ai': join(modules, '@earendil-works/pi-ai/dist/compat.js'),
  '@earendil-works/pi-coding-agent': join(modules, '@earendil-works/pi-coding-agent/dist/index.js'),
  '@earendil-works/pi-tui': join(modules, '@earendil-works/pi-tui/dist/index.js'),
  typebox: join(modules, 'typebox/build/index.mjs'),
} });

test('approval dialogs ring once; settings, automatic approvals and non-TTY output stay silent', async () => {
  const { installTerminalNotifications, confirmApprovalWithAlert } = await jiti.import(join(root, 'extensions/my-slim-pi-suite/terminal-notifications.ts'));
  const hooks = new Map(), commands = new Map(), writes = [];
  const events = new Map();
  const pi = { on: (name, fn) => hooks.set(name, fn), registerCommand: (name, command) => commands.set(name, command),
    events: { on(name, fn) { events.set(name, fn); return () => events.delete(name); }, emit(name, event) { events.get(name)?.(event); } } };
  let enabled = true;
  installTerminalNotifications(pi, { enabled: () => enabled, write: text => writes.push(text) });
  const ctx = { hasUI: true, ui: { notify() {} } };
  const start = title => hooks.get('ui_prompt_start')({ type: 'ui_prompt_start', kind: 'confirm', title }, ctx);
  const end = () => hooks.get('ui_prompt_end')({}, ctx);
  for (const title of ['Choose a theme', "Permission mode (risky deletions need this call's approval)", 'Background models', '子代理与后台模型设置', 'Model settings']) { start(title); end(); }
  assert.equal(writes.length, 0);
  start('Automatic review is uncertain: approve this call?');
  start('Automatic review is uncertain: approve this call?');
  assert.deepEqual(writes, ['\x07']);
  end();
  start('Approve this deletion?'); end();
  assert.equal(writes.length, 2);
  enabled = false;
  start('Approve tool call'); end();
  assert.equal(writes.length, 2);
  enabled = true; ctx.hasUI = false;
  start('Approve this deletion?'); end();
  assert.equal(writes.length, 2);
  ctx.hasUI = true;
  await commands.get('notify-test').handler('', ctx);
  assert.equal(writes.length, 3);
  hooks.get('ui_prompt_start')({ type: 'ui_prompt_start', kind: 'custom' }, ctx);
  ctx.ui.confirm = async () => true;
  assert.equal(await confirmApprovalWithAlert(pi, ctx, 'Approve this deletion?', 'fixture; no deletion executed'), true);
  assert.equal(writes.length, 4, 'an approval inside an already open BTW/custom overlay still rings');
  await confirmApprovalWithAlert(pi, ctx, '自动审批不确定：批准本次操作？', 'fixture');
  assert.equal(writes.length, 5, 'closing a nested approval resets notification deduplication');
  assert.ok(writes.every(text => text === '\x07'), 'only BEL reaches the terminal, never prompt text');
});

test('approval timeout aborts the real modal and never accepts a late approval', async () => {
  const { confirmApprovalWithAlert, selectApprovalWithAlert, APPROVAL_TIMEOUT_MS } = await jiti.import(join(root, 'extensions/my-slim-pi-suite/terminal-notifications.ts'));
  assert.equal(APPROVAL_TIMEOUT_MS, 90_000);
  for (const kind of ['confirm', 'select']) {
    const events=[], entries=[], notices=[];
    let closed=false, signal;
    const pi={events:{emit:(name,value)=>events.push([name,value])},appendEntry:(...args)=>entries.push(args)};
    const ctx={hasUI:true,ui:{notify:(...args)=>notices.push(args),[kind]:async(_title,_body,options)=>{
      signal=options.signal;
      return new Promise(resolve=>signal.addEventListener('abort',()=>{closed=true;resolve(kind==='confirm'?true:'approve');},{once:true}));
    }}};
    const result=kind==='confirm'
      ? await confirmApprovalWithAlert(pi,ctx,'Approve this call?','fixture',{timeout:10})
      : await selectApprovalWithAlert(pi,ctx,'审批本次操作',['approve','reject'],{timeout:10});
    assert.equal(result,kind==='confirm'?false:undefined);
    assert.equal(signal.aborted,true);assert.equal(closed,true);
    assert.equal(entries.length,1);assert.equal(notices.length,1);
    assert.equal(events.filter(([name])=>name==='timrt:approval-timeout').length,1);
    assert.ok(events.some(([name,event])=>name==='timrt:approval-wait' && event.phase==='end'));
  }
});

test('approval cancellation closes its timer; pre-aborted requests never open a dialog', async () => {
  const {confirmApprovalWithAlert}=await jiti.import(join(root,'extensions/my-slim-pi-suite/terminal-notifications.ts'));
  const events=[];let opened=0;
  const pi={events:{emit:(name)=>events.push(name)},appendEntry(){throw Error('unexpected timeout');}};
  const ctx={hasUI:true,ui:{notify(){throw Error('unexpected notification');},confirm:async()=>{opened++;return true;}}};
  assert.equal(await confirmApprovalWithAlert(pi,ctx,'批准操作','fixture',{timeout:10}),true);
  const controller=new AbortController();controller.abort();
  assert.equal(await confirmApprovalWithAlert(pi,ctx,'批准操作','fixture',{signal:controller.signal}),false);
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(opened,1);assert.equal(events.includes('timrt:approval-timeout'),false);
});

test('ASK approval waits for an explicit choice and does not install a timeout',async()=>{
  const {confirmApprovalWithAlert}=await jiti.import(join(root,'extensions/my-slim-pi-suite/terminal-notifications.ts'));
  let resolveDialog,options,message;
  const events=[];
  const pi={events:{emit:(name)=>events.push(name)},appendEntry(){throw Error('ASK must not expire');}};
  const ctx={hasUI:true,ui:{notify(){throw Error('ASK must not expire');},confirm:async(_title,body,opts)=>{options=opts;message=body;return new Promise(resolve=>{resolveDialog=resolve;});}}};
  let settled=false;
  const pending=confirmApprovalWithAlert(pi,ctx,'ASK: approve this tool call?','fixture',{timeout:0}).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(settled,false);assert.equal(options.timeout,undefined);assert.equal(options.signal.aborted,false);
  assert.match(message,/no timeout/i);assert.doesNotMatch(message,/90 seconds/i);
  resolveDialog(true);assert.equal(await pending,true);
  assert.equal(events.includes('timrt:approval-timeout'),false);
});

test('human fallback is shared, takes effect without reload and never weakens ASK or the policy seal',async()=>{
  const {configuredHumanFallback,saveApprovalFallback,confirmApprovalWithAlert,selectApprovalWithAlert}=await jiti.import(join(root,'extensions/my-slim-pi-suite/terminal-notifications.ts'));
  const {createApprovalReviewer}=await jiti.import(join(root,'extensions/my-slim-pi-suite/approval-reviewer.ts'));
  const {default:policy}=await import(pathToFileURL(join(root,'customization/runtime/policy-files.cjs')));
  const fixture=mkdtempSync(join(root,'approval-setting-test-'));
  const before=process.env.PI_CODING_AGENT_DIR;
  try {
    mkdirSync(join(fixture,'extensions/pi-permission-suite'),{recursive:true});
    mkdirSync(join(fixture,'extensions/my-slim-pi-suite'),{recursive:true});
    mkdirSync(join(fixture,'customization/runtime'),{recursive:true});
    mkdirSync(join(fixture,'agents'),{recursive:true});
    writeFileSync(join(fixture,'agents/approver.md'),'---\nname: approver\n---\nReview.');
    writeFileSync(join(fixture,'extensions/my-slim-pi-suite/index.ts'),'');
    const file=join(fixture,'extensions/pi-permission-suite/config.json');
    writeFileSync(file,JSON.stringify({path:{deny:{secret:'protected'}},reviewer:{humanFallback:'ask',other:'keep'}}));
    writeFileSync(join(fixture,'customization/runtime/policy-seal.json'),JSON.stringify(policy.seal(fixture)));
    process.env.PI_CODING_AGENT_DIR=fixture;
    let dialogs=0,alerts=0;
    const pi={events:{emit(){alerts++;}},appendEntry(){}};
    const ctx={hasUI:true,cwd:fixture,modelRegistry:{find(){}},ui:{notify(){alerts++;},select:async()=>{dialogs++;return '✅ Approve';},confirm:async()=>{dialogs++;return true;}}};
    const review=createApprovalReviewer(pi);
    assert.equal(configuredHumanFallback(),'ask');
    saveApprovalFallback(false);
    assert.equal((await review(ctx,'operation:write',{})).source,'paused');
    assert.equal(await confirmApprovalWithAlert(pi,ctx,'批准操作','fixture'),false);
    assert.equal(await selectApprovalWithAlert(pi,ctx,'审批操作',['approve','deny']),undefined);
    assert.equal(dialogs,0);assert.equal(alerts,0,'off emits no prompt or approval notification');
    assert.equal(policy.verify(fixture).ok,true,'only the interactive field is exempt from the seal');
    assert.equal(policy.protectedPath(fixture,file),true,'tools still cannot edit the preference');
    assert.equal(await confirmApprovalWithAlert(pi,ctx,'ASK：批准操作','fixture',{timeout:0}),true);
    assert.equal(dialogs,1,'ASK still asks even when AUTO/ACT fallback is off');
    saveApprovalFallback(true);
    assert.equal((await review(ctx,'operation:write',{})).approved,true,'an existing reviewer reads the current preference');
    assert.equal(dialogs,2);
    const config=JSON.parse(readFileSync(file,'utf8'));
    assert.equal(config.reviewer.other,'keep');
    config.path.deny={};writeFileSync(file,JSON.stringify(config));
    assert.equal(policy.verify(fixture).ok,false,'other permission changes remain sealed');
  }finally{
    if(before===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=before;
    rmSync(fixture,{recursive:true,force:true});
  }
});

test('/btw runs independently while the main task is busy, declares no tools and never auto-injects', async () => {
  const pkg = join(root, 'npm/node_modules/@narumitw/pi-btw');
  const { default: installBtw } = await jiti.import(join(pkg, 'src/btw.ts'));
  const { completeSideThreadTurn } = await jiti.import(join(pkg, 'src/side-thread.ts'));
  const parent = [{ type: 'message', id: 'main-1', message: { role: 'user', content: [{ type: 'text', text: 'Main task must continue.' }] } }];
  const before = JSON.stringify(parent);
  const model = { provider: 'verification', id: 'mock', name: 'Mock', api: 'openai-completions', reasoning: true, input: ['text'], contextWindow: 10000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const commands = new Map();
  const forbidden = () => { throw Error('BTW must not stop, mutate or delegate the main task'); };
  const pi = { on() {}, registerCommand: (name, command) => commands.set(name, command), registerTool: forbidden, sendUserMessage: forbidden, sendMessage: forbidden, appendEntry: forbidden, getThinkingLevel: () => 'low' };
  const ctx = { mode: 'tui', isIdle: () => false, waitForIdle: forbidden, abort: forbidden,
    sessionManager: { getBranch: () => parent }, ui: { notify: forbidden, setEditorText: forbidden } };
  let captured, sideState;
  installBtw(pi, {
    loadSettings: async () => ({ layout: 'right-pane', sidePaneRatio: 0.5 }),
    resolveModel: async () => ({ kind: 'selected', selected: { model } }),
    runFullscreen: async (current, run, options) => { assert.equal(options.layout, 'right-pane'); return run(current); },
    runThread: async ({ state, initialQuestion }) => {
      sideState = state;
      const result = await completeSideThreadTurn({
        thread: state.thread, model, question: initialQuestion, thinkingLevel: state.thinkingLevel,
        completeSimple: async (selected, context, options) => {
          captured = { context, options };
          assert.equal(selected, model);
          assert.equal(context.tools, undefined);
          return { role: 'assistant', content: [{ type: 'text', text: 'Side answer only.' }], api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: 1, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        },
      });
      assert.equal(result.kind, 'answered');
    },
  });
  await commands.get('btw').handler('Explain the current task.', ctx);
  assert.ok(captured);
  assert.match(sideState.thread.conversationContext, /Main task must continue/);
  assert.equal(sideState.thread.turns[0].answer, 'Side answer only.');
  assert.equal(JSON.stringify(parent), before);
  assert.equal(commands.size, 1, 'one user command, no model-facing delegation tool');
});

test('Windows Terminal bell and native BTW package/configuration are valid', () => {
  // Terminal preferences belong to the user; installation does not mutate them.
  const settings = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
  const installed = JSON.parse(readFileSync(join(root, 'npm/node_modules/@narumitw/pi-btw/package.json'), 'utf8')).version;
  assert.ok(settings.packages.some(p => (typeof p === 'string' ? p : p.source) === `npm:@narumitw/pi-btw@${installed}`));
  const btw = JSON.parse(readFileSync(join(root, 'pi-btw.json'), 'utf8'));
  assert.ok(['fullscreen', 'left-pane', 'right-pane'].includes(btw.layout));
  assert.ok(btw.sidePaneRatio >= 0.2 && btw.sidePaneRatio <= 0.8, 'dragging the divider remains a supported user preference');
});

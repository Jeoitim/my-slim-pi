import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const { installTerminalNotifications, confirmApprovalWithAlert } = await jiti.import(join(root, 'extensions/timrt-suite/terminal-notifications.ts'));
  const hooks = new Map(), commands = new Map(), writes = [];
  const events = new Map();
  const pi = { on: (name, fn) => hooks.set(name, fn), registerCommand: (name, command) => commands.set(name, command),
    events: { on(name, fn) { events.set(name, fn); return () => events.delete(name); }, emit(name, event) { events.get(name)?.(event); } } };
  let enabled = true;
  installTerminalNotifications(pi, { enabled: () => enabled, write: text => writes.push(text) });
  const ctx = { hasUI: true, ui: { notify() {} } };
  const start = title => hooks.get('ui_prompt_start')({ type: 'ui_prompt_start', kind: 'confirm', title }, ctx);
  const end = () => hooks.get('ui_prompt_end')({}, ctx);
  for (const title of ['选择主题', '权限模式（高风险删除需本次审批）', '子代理与后台模型设置', 'Model settings']) { start(title); end(); }
  assert.equal(writes.length, 0);
  start('自动审批不确定：批准本次操作？');
  start('自动审批不确定：批准本次操作？');
  assert.deepEqual(writes, ['\x07']);
  end();
  start('批准本次删除操作？'); end();
  assert.equal(writes.length, 2);
  enabled = false;
  start('Approve tool call'); end();
  assert.equal(writes.length, 2);
  enabled = true; ctx.hasUI = false;
  start('批准本次删除操作？'); end();
  assert.equal(writes.length, 2);
  ctx.hasUI = true;
  await commands.get('notify-test').handler('', ctx);
  assert.equal(writes.length, 3);
  hooks.get('ui_prompt_start')({ type: 'ui_prompt_start', kind: 'custom' }, ctx);
  ctx.ui.confirm = async () => true;
  assert.equal(await confirmApprovalWithAlert(pi, ctx, '批准本次删除操作？', 'fixture; no deletion executed'), true);
  assert.equal(writes.length, 4, 'an approval inside an already open BTW/custom overlay still rings');
  await confirmApprovalWithAlert(pi, ctx, '自动审批不确定：批准本次操作？', 'fixture');
  assert.equal(writes.length, 5, 'closing a nested approval resets notification deduplication');
  assert.ok(writes.every(text => text === '\x07'), 'only BEL reaches the terminal, never prompt text');
});

test('approval timeout aborts the real modal and never accepts a late approval', async () => {
  const { confirmApprovalWithAlert, selectApprovalWithAlert, APPROVAL_TIMEOUT_MS } = await jiti.import(join(root, 'extensions/timrt-suite/terminal-notifications.ts'));
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
      ? await confirmApprovalWithAlert(pi,ctx,'批准本次操作？','fixture',{timeout:10})
      : await selectApprovalWithAlert(pi,ctx,'审批本次操作',['approve','reject'],{timeout:10});
    assert.equal(result,kind==='confirm'?false:undefined);
    assert.equal(signal.aborted,true);assert.equal(closed,true);
    assert.equal(entries.length,1);assert.equal(notices.length,1);
    assert.equal(events.filter(([name])=>name==='timrt:approval-timeout').length,1);
    assert.ok(events.some(([name,event])=>name==='timrt:approval-wait' && event.phase==='end'));
  }
});

test('approval cancellation closes its timer; pre-aborted requests never open a dialog', async () => {
  const {confirmApprovalWithAlert}=await jiti.import(join(root,'extensions/timrt-suite/terminal-notifications.ts'));
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
  const {confirmApprovalWithAlert}=await jiti.import(join(root,'extensions/timrt-suite/terminal-notifications.ts'));
  let resolveDialog,options,message;
  const events=[];
  const pi={events:{emit:(name)=>events.push(name)},appendEntry(){throw Error('ASK must not expire');}};
  const ctx={hasUI:true,ui:{notify(){throw Error('ASK must not expire');},confirm:async(_title,body,opts)=>{options=opts;message=body;return new Promise(resolve=>{resolveDialog=resolve;});}}};
  let settled=false;
  const pending=confirmApprovalWithAlert(pi,ctx,'ASK：批准本次工具调用？','fixture',{timeout:0}).then(value=>{settled=true;return value;});
  await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(settled,false);assert.equal(options.timeout,undefined);assert.equal(options.signal.aborted,false);
  assert.match(message,/无等待超时/);assert.doesNotMatch(message,/90 秒/);
  resolveDialog(true);assert.equal(await pending,true);
  assert.equal(events.includes('timrt:approval-timeout'),false);
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
  assert.ok(settings.packages.some(p => (typeof p === 'string' ? p : p.source) === 'npm:@narumitw/pi-btw@0.61.2'));
  const btw = JSON.parse(readFileSync(join(root, 'pi-btw.json'), 'utf8'));
  assert.ok(['fullscreen', 'left-pane', 'right-pane'].includes(btw.layout));
  assert.ok(btw.sidePaneRatio >= 0.2 && btw.sidePaneRatio <= 0.8, 'dragging the divider remains a supported user preference');
});

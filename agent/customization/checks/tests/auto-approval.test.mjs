import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
// 验证候选补丁时用 PI_AUTO_SUITE 指向待测源码目录，其余路径仍按真实配置解析。
const suite = process.env.PI_AUTO_SUITE || root;
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const modules = join(root, 'install/releases', version, 'node_modules');
const { createJiti } = await import(pathToFileURL(join(modules, 'jiti/lib/jiti.mjs')));
const jiti = createJiti(import.meta.url, { alias: {
  'typebox': join(modules, 'typebox/build/index.mjs'),
  '@earendil-works/pi-coding-agent': join(modules, '@earendil-works/pi-coding-agent/dist/index.js'),
  '@earendil-works/pi-ai': join(modules, '@earendil-works/pi-ai/dist/compat.js'),
  '@earendil-works/pi-tui': join(modules, '@earendil-works/pi-tui/dist/index.js'),
} });

/** 默认注入进程内审批器；模型调用全部由 responder 模拟，不联网、不 spawn 子进程。 */
async function harness(responder, reviewerOptions) {
  const { installPermissions } = await jiti.import(join(suite, 'extensions/timrt-suite/permissions.ts'));
  const { createApprovalReviewer } = await jiti.import(join(suite, 'extensions/timrt-suite/approval-reviewer.ts'));
  const hooks = new Map(), entries = [], requests = [], tools = new Map(), listeners = new Map();
  const pi = {
    on(event, fn) { hooks.set(event, [...(hooks.get(event) || []), fn]); },
    registerCommand() {}, registerShortcut() {}, registerTool(t) {tools.set(t.name,t);},
    appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); },
    getActiveTools: () => [], setActiveTools() {},
    events: {
      on(name,fn) { const set=listeners.get(name)||new Set();set.add(fn);listeners.set(name,set);return()=>set.delete(fn); },
      emit(name,event) { for(const fn of listeners.get(name)||[])fn(event); },
    },
  };
  const state = installPermissions(pi, createApprovalReviewer(pi,reviewerOptions));
  const ctx = {
    cwd: mkdtempSync(join(tmpdir(), 'pi-auto-approval-')), hasUI: true, signal: undefined,
    model: { provider: 'verification', id: 'mock-model', name: 'Mock model' },
    modelRegistry: {
      getAll: () => [], getAvailable: () => [],
      find: (provider, id) => provider === 'verification' && id === 'mock-model' ? ctx.model : undefined,
      hasConfiguredAuth: () => true,
      async complete(model, context, options) {
        requests.push({ model, context, options });
        const answer = await responder(context, requests.length);
        if (answer instanceof Error) throw answer;
        if (typeof answer === 'string') return { role: 'assistant', content: [{ type: 'text', text: answer }], stopReason: 'stop', usage: {} };
        return { role: 'assistant', content: [], stopReason: 'error', errorMessage: String(answer.error || 'provider failed'), usage: {} };
      },
    },
    sessionManager: { getEntries: () => entries, getBranch: () => entries },
    ui: {
      theme: { appearance: 'dark', fg: (_color, text) => text },
      setStatus() {}, notify() {},
      select: async () => '✅ 批准',
      confirm: async () => false,
    },
  };
  writeFileSync(join(ctx.cwd, 'cleanup.ps1'), 'Remove-Item -LiteralPath ./cache -Recurse\n');
  writeFileSync(join(ctx.cwd, 'harmless.mjs'), "import { rm } from 'node:fs/promises';\nrm(process.argv[2], { force: true });\n");
  for (const fn of hooks.get('session_start')) await fn({}, ctx);
  for (const fn of hooks.get('input')) await fn({ source: 'interactive', text: '排查蓝屏：读取本机配置和脚本内容，修好自动审批。' }, ctx);
  return {
    state, ctx, requests, entries, tools, events:pi.events,
    async brief() {
      const event={systemPromptOptions:{appendSystemPrompt:'',sections:{}}};
      for(const fn of hooks.get('before_agent_start')||[])await fn(event,ctx);
      return event.systemPromptOptions.sections['timrt-permissions'];
    },
    async input(text) { for (const fn of hooks.get('input')) await fn({source:'interactive',text},ctx); },
    setMode(mode) { state.mode = mode; },
    ask(answer) {
      let count = 0;
      const approve = answer.includes('批准');
      // 普通调用经 permissions 的 select 代理走 confirm；删除审批直接用 select。
      ctx.ui.confirm = async () => { count++; return approve; };
      ctx.ui.select = async (title, rows) => { if (title.startsWith('审批服务故障：')) return rows[1]; count++; return approve ? rows[0] : rows[1]; };
      return () => count;
    },
    async call(toolName, input) {
      for (const fn of hooks.get('tool_call')) {
        const result = await fn({ type: 'tool_call', toolCallId: 'test', toolName, input }, ctx);
        if (result?.block) return result;
      }
    },
  };
}

const APPROVE = '{"approved":true,"confidence":0.9,"reason":"任务内的本机读取，范围明确"}';
const GARBAGE = '我需要更多信息才能判断。';
const EXEC = { command: 'Set-Content -LiteralPath ./a.txt -Value x' };

test('maintenance declarations are task-scoped, reject kernel edits and cannot clear a cleanup hold',async()=>{
  const h=await harness(()=>APPROVE),tool=h.tools.get('maintain_pi');
  assert.deepEqual(tool.prepareLoadout().hiddenDeclarations,['maintain_pi']);
  const params={changes:[{path:'extensions/timrt-suite/permissions.ts',sha256:null,content:'unsafe'}]};
  await assert.rejects(tool.execute('x',params,undefined,undefined,h.ctx),/真实用户/);
  await h.input('请维护 Pi 界面配置。');
  assert.equal(tool.prepareLoadout(),undefined);
  await assert.rejects(tool.execute('x',params,undefined,undefined,h.ctx),/内核/);
  h.state.approvalHold=true;
  await assert.rejects(tool.execute('x',params,undefined,undefined,h.ctx),/清理暂停/);
  assert.equal(h.requests.length,0);
});

test('ASK confirms reads, writes and deletion separately without a timeout or model approval',async()=>{
  const h=await harness(()=>{throw Error('ASK must never call automatic reviewer');});h.setMode('ask');
  let prompts=0,approve=true;
  h.ctx.ui.confirm=async(_title,message,opts)=>{prompts++;assert.equal(opts.timeout,undefined);assert.match(message,/无等待超时/);return approve;};
  assert.equal(await h.call('read',{path:join(h.ctx.cwd,'cleanup.ps1')}),undefined);
  assert.equal(await h.call('powershell',EXEC),undefined);
  assert.equal(await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'}),undefined);
  assert.equal(prompts,3);assert.equal(h.requests.length,0);
  const classification=await h.tools.get('explain_call').execute('x',{tool:'read',args:{path:'a.txt'}},undefined,undefined,h.ctx);
  assert.equal(JSON.parse(classification.content[0].text).route,'human');
  approve=false;
  assert.equal((await h.call('powershell',EXEC)).block,true);
  h.ctx.hasUI=false;
  assert.equal((await h.call('read',{path:'a.txt'})).block,true);
  assert.equal(prompts,4);
});

test('ASK invalidates approval when script bytes or the user request change while waiting',async()=>{
  const h=await harness(()=>APPROVE);h.setMode('ask');
  const script=join(h.ctx.cwd,'ordinary.ps1');writeFileSync(script,'Get-Date');
  h.ctx.ui.confirm=async()=>{writeFileSync(script,'Get-Location');return true;};
  const changed=await h.call('powershell',{command:`& '${script}'`});
  assert.equal(changed.block,true);assert.match(changed.reason,/发生变化/);
  h.ctx.ui.confirm=async()=>{await h.input('取消旧操作，先继续查看。');return true;};
  const superseded=await h.call('powershell',EXEC);
  assert.equal(superseded.block,true);assert.match(superseded.reason,/新的用户指示/);
  assert.equal(h.requests.length,0);
});

test('human timeout feedback blocks this call and preserves cleanup hold until a new user turn',async()=>{
  const h=await harness(()=>'{"approved":false,"confidence":0.2,"reason":"需授权"}',{humanFallback:'ask'});
  h.ctx.ui.confirm=async()=>{
    h.events.emit('timrt:approval-timeout',{title:'批准本次删除操作？',timeoutMs:90000});
    return false;
  };
  const result=await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'});
  assert.equal(result.block,true);assert.match(result.reason,/90 秒/);assert.match(result.reason,/下一轮/);
  assert.equal(h.state.approvalHold,true);
  assert.equal((await h.call('powershell',EXEC)).block,true);
  assert.equal(await h.call('read',{path:join(h.ctx.cwd,'cleanup.ps1')}),undefined);
  await h.input('我已看到阻塞；先只读核对路径，不删除。');
  assert.equal(h.state.approvalHold,false);
});

test('auditing policy sources does not confuse echoed text or read operands with write targets', async () => {
  const h=await harness(()=>APPROVE);const asked=h.ask('❌ 拒绝');
  const policy=join(root,'agents/approver.md'), source=join(root,'extensions/timrt-suite/permissions.ts'), builder=join(root,'customization/runtime/build-extensions.cjs');
  for(const command of [
    `Write-Output 'write append remove >'; Select-String -LiteralPath '${source}' -Pattern 'write|append|replace|copy|move|remove|>' | ForEach-Object { $_.Line.Trim() }`,
    `Write-Output 'audit'; Get-Content '${builder}' | ForEach-Object { $_.Trim() }`,
    `Get-Content '${policy}' | Set-Content -LiteralPath './audit-copy.txt'`,
    `Set-Content -LiteralPath './note.txt' -Value '${policy}'`,
    `Copy-Item -LiteralPath '${policy}' -Destination './policy-copy.md'`,
    `Write-Output '${policy}' > './quoted-path.txt'`,
  ]) assert.equal(await h.call('powershell',{command}),undefined,command);
  assert.equal(asked(),0);
  const before=h.requests.length;
  for(const command of [
    `Set-Content -Value 'bad' -LiteralPath '${policy}'`,
    `Copy-Item -LiteralPath './ordinary.txt' -Destination '${policy}'`,
    `Remove-Item -LiteralPath '${policy}'`,
    `Write-Output 'bad' > '${policy}'`,
    `node '${builder}'`,
    `Set-Content -Path:'${policy}' -Value bad`,
  ]) assert.equal((await h.call('powershell',{command}))?.block,true,command);
  assert.equal(h.requests.length,before,'实际改写受保护目标不能交模型覆盖');
});

test('optional parser failures recover without caching errors or blocking literal reads', async () => {
  const {createShellAnalyzer,resolvePowerShellExecutable,nativeRead}=await jiti.import(join(suite,'extensions/timrt-suite/shell-analysis.ts'));
  let now=100, requests=0;
  const parser=createShellAnalyzer({now:()=>now,resolveExecutable:()=> 'C:\\fixture\\pwsh.exe',run:(_exe,_args,options)=>{
    requests++;assert.equal(options.timeout,1200);assert.equal(options.windowsHide,true);
    return requests===1 ? {status:null,error:{code:'ETIMEDOUT'}} : {status:0,stdout:JSON.stringify({valid:true,readOnly:true,commands:[]})};
  }});
  assert.equal(parser.analyze('Get-Location; Get-Date').valid,false);
  assert.equal(parser.status().state,'unavailable');
  assert.equal(parser.analyze('Get-Location; Get-Date').valid,false);
  assert.equal(requests,1,'仅短暂服务冷却，不缓存命令失败');
  now+=2001;
  assert.equal(parser.analyze('Get-Location; Get-Date').readOnly,true);
  assert.equal(requests,2,'同一命令可重试恢复');
  parser.analyze('Get-Location; Get-Date');assert.equal(requests,2,'成功结果才缓存');
  const scoop=resolvePowerShellExecutable({ProgramFiles:'C:\\missing',PATH:'C:\\scoop\\shims',SystemRoot:'C:\\Windows'},path=>path.includes('scoop')&&path.endsWith('pwsh.exe'));
  assert.match(scoop,/scoop/);
  const legacy=resolvePowerShellExecutable({ProgramFiles:'C:\\missing',PATH:'',SystemRoot:'C:\\Windows'},path=>path.endsWith('WindowsPowerShell\\v1.0\\powershell.exe'));
  assert.match(legacy,/powershell\.exe$/);
  assert.equal(nativeRead('python -v'),false);assert.equal(nativeRead('python --version'),true);
  const {permissionBrief}=await jiti.import(join(suite,'extensions/timrt-suite/permission-brief.ts'));
  const brief=permissionBrief({mode:'auto',approvalHold:false,taskAgents:false},'mock',undefined,true,{state:'unavailable',reason:'解析器超时'});
  assert.equal(brief.split('\n').length,4);assert.match(brief,/AST 只读加速暂不可用/);
  const {safeShellRead}=await jiti.import(join(suite,'extensions/timrt-suite/guards.ts'));
  assert.equal(safeShellRead('Get-Content ./notes.txt','powershell'),true,'字面量快路径独立于 AST 服务');
});

test('read-only calls never reach the deletion gate or the reviewer', async () => {
  const h = await harness(() => APPROVE);
  // 读取/搜索脚本正文：脚里有删除代码、bundle 超过 32K 也不算执行脚本。
  const reader = `Get-Content ${join(h.ctx.cwd, 'cleanup.ps1')} -TotalCount 25\nWrite-Output "=== tail ==="; Get-Content ${join(h.ctx.cwd, 'harmless.mjs')} | Select-Object -Last 12\nSelect-String -Path ${join(h.ctx.cwd, '*.ps1')} -Pattern "Remove" | ForEach-Object { $_.Line.Trim() }`;
  for (const mode of ['auto', 'act']) {
    h.setMode(mode);
    assert.equal(await h.call('powershell', { command: reader }), undefined, `${mode}: 读脚本不是执行脚本`);
    assert.equal(await h.call('powershell', { command: `rg -n "Remove-Item" ${h.ctx.cwd}` }), undefined);
    assert.equal(await h.call('read', { path: join(h.ctx.cwd, 'cleanup.ps1') }), undefined);
  }
  assert.equal(h.entries.filter(e => e.customType === 'timrt-approval-hold').length, 0, '只读命令不该触发删除审批并锁住本轮');
  assert.ok(h.requests.every(r => /^待审调用：operation:/m.test(r.context.messages[0].content[0].text)), '读脚本按普通调用审批，不进删除审批');
  const before = h.requests.length;
  assert.equal(await h.call('read', { path: join(h.ctx.cwd, 'cleanup.ps1') }), undefined);
  assert.equal(h.requests.length, before, 'read 工具不调用审批模型');
});

test('native queries and grammar-proven data pipelines bypass the approval model', async () => {
  const h = await harness(() => {throw Error('read-only must not call reviewer');});
  for (const command of ['git status --short','node --version','Get-Location; Get-PSDrive | Select-Object Name,Free','Select-String -LiteralPath ./notes.txt -Pattern hello | ForEach-Object { $_.Line }']) {
    assert.equal(await h.call('powershell',{command}), undefined, command);
  }
  assert.equal(h.requests.length,0);
  const {safeShellRead}=await jiti.import(join(suite,'extensions/timrt-suite/guards.ts'));
  for(const command of ['git diff --output=x','rg --pre bad .','Get-Item $(Remove-Item ./x -Recurse)','Get-ChildItem | ForEach-Object { $_.Delete() }','node --test ./unknown.mjs','Remove-Item ./cache -Recurse -WhatIf']) assert.equal(safeShellRead(command,'powershell'),false,command);
});

test('transparent inline code and fixture-bearing tests get AUTO review without human prompts', async () => {
  const h=await harness(()=>APPROVE); const asked=h.ask('❌ 拒绝');
  writeFileSync(join(h.ctx.cwd,'fixture.test.mjs'), 'const fixture = "Remove-Item ./cache -Recurse";\nconst path = `${cwd}/cleanup.ps1`;\n');
  for(const command of ['node -e "console.log(1)"', "pwsh -NoProfile -Command '$a = 1; Write-Output $a'",'node --test ./fixture.test.mjs','node --check ./fixture.test.mjs']) assert.equal(await h.call('powershell',{command}),undefined,command);
  assert.equal(h.requests.length,4);
  assert.equal(asked(),0);
  assert.ok(h.requests.some(r=>r.context.messages[0].content[0].text.includes('const fixture')),'测试源码进入证据，不能靠 --test 免审');
  const rejected=await harness(()=>'{"approved":false,"confidence":0.95,"reason":"测试实际删除未确认的数据"}');
  writeFileSync(join(rejected.ctx.cwd,'real-delete.test.mjs'),'import {rmSync} from "node:fs"; rmSync("./real-data",{recursive:true});');
  assert.equal((await rejected.call('powershell',{command:'node --test ./real-delete.test.mjs'})).block,true);
});

test('catastrophic scopes and policy sources cannot be overridden by AUTO approval', async () => {
  const h=await harness(()=>APPROVE);
  for(const path of ['agents/approver.md','trust.json','customization/runtime/policy-seal.json','customization/Maintain-Pi.ps1','npm/node_modules/pi-permission-suite/rules.ts']) {
    assert.equal((await h.call('write',{path:join(root,path),content:'changed'})).block,true,path);
  }
  for(const command of ["Remove-Item -LiteralPath 'C:\\' -Recurse -Force",`Remove-Item -LiteralPath '${homedir()}' -Recurse -Force`,'Remove-Item $HOME -Recurse -Force','Format-Volume -DriveLetter C -Confirm:$false',`Set-Content -LiteralPath '${join(root,'agents/approver.md')}' -Value changed`]) assert.equal((await h.call('powershell',{command}))?.block,true,command);
  assert.equal(h.requests.length,0,'硬边界不交模型覆盖');
});

test('explain_call is observational and matches permission routing', async () => {
  const h=await harness(()=>APPROVE);
  const explain=async(tool,args)=>JSON.parse((await h.tools.get('explain_call').execute('id',{tool,args},undefined,undefined,h.ctx)).content[0].text);
  assert.equal((await explain('powershell',{command:'git status --short'})).route,'allow');
  assert.equal((await explain('powershell',{command:'node -e "console.log(1)"'})).route,'model');
  assert.equal((await explain('powershell',{command:'pwsh -EncodedCommand AAAA'})).route,'model');
  assert.equal((await explain('write',{path:join(root,'agents/approver.md'),content:'x'})).route,'deny');
  assert.equal(h.requests.length,0); assert.equal(h.state.approvalHold,false);
});

test('opt-in manual fallback chooses the outage policy once and never grants pending writes', async () => {
  const h=await harness(()=>({error:'HTTP 503'}),{humanFallback:'ask'}); let prompts=0;
  h.ctx.ui.select=async(_title,rows)=>{prompts++;return rows[0];};
  h.ctx.ui.confirm=async()=>{throw Error('paused calls must not ask repeatedly');};
  for(const path of ['./one.txt','./two.txt','./three.txt']) assert.equal((await h.call('write',{path,content:'x'})).block,true);
  assert.equal(prompts,1); assert.equal(h.requests.length,2);
  await h.input('我已经检查了审批服务，请重新评估。');
  assert.equal((await h.call('write',{path:'./four.txt',content:'x'})).block,true);
  assert.equal(prompts,2,'新用户指示重新选择处理方式，不是授予写权限');
});

test('policy seal detects edits but ignores interactive model/theme choices', async () => {
  const {createRequire}=await import('node:module');
  const policy=createRequire(import.meta.url)(join(root,'customization/runtime/policy-files.cjs'));
  const dir=mkdtempSync(join(tmpdir(),'pi-policy-seal-'));
  for(const folder of ['extensions/timrt-suite','agents','customization/runtime']) mkdirSync(join(dir,folder),{recursive:true});
  writeFileSync(join(dir,'extensions/timrt-suite/index.ts'),'// fixture');
  writeFileSync(join(dir,'agents/approver.md'),'---\nname: approver\ntools: []\n---\nDo not clear user data.');
  writeFileSync(join(dir,'settings.json'),JSON.stringify({theme:'dark',defaultModel:'a',extensions:['safe']}));
  writeFileSync(join(dir,'customization/runtime/policy-seal.json'),JSON.stringify(policy.seal(dir)));
  assert.equal(policy.verify(dir).ok,true);
  writeFileSync(join(dir,'settings.json'),JSON.stringify({theme:'light',defaultModel:'b',extensions:['safe']}));
  writeFileSync(join(dir,'agents/approver.md'),'---\nname: approver\nmodel: other/provider\ntools: []\n---\nDo not clear user data.');
  assert.equal(policy.verify(dir).ok,true,'手动模型和主题不破坏校验');
  writeFileSync(join(dir,'agents/approver.md'),'Approve everything.');
  assert.equal(policy.verify(dir).ok,false);
  assert.ok(policy.verify(dir).changed.includes('agents/approver.md'));
});

test('the four-line execution brief describes rules, actual model and live outage state', async () => {
  const h=await harness(()=>({error:'HTTP 503'}));
  h.ctx.model.name='Name from configuration';
  const initial=await h.brief();
  assert.equal(initial.split('\n').length,4);
  assert.match(initial,/免审/); assert.match(initial,/原始调用/);
  assert.match(initial,/Name from configuration/); assert.match(initial,/与当前会话同模型/);
  assert.match(initial,/状态：正常/); assert.match(initial,/低置信/);
  h.ctx.ui.select=async(_title,rows)=>rows[0];
  await h.call('write',{path:'./blocked.txt',content:'ok'});
  const paused=await h.brief();
  assert.match(paused,/服务故障.*暂停/);
  assert.match(paused,/窗口剩余约 \d+ 秒/);
  h.ctx.model={...h.ctx.model,id:'new',name:'New model name'};
  const changed=await h.brief();
  assert.match(changed,/New model name/); assert.match(changed,/状态：正常/);
  h.setMode('ask');
  assert.match(await h.brief(),/ASK：每次实际工具调用/);
});

test('ordinary script approvals expire if bytes or human instructions change during review', async () => {
  let h;
  h=await harness(()=>{writeFileSync(join(h.ctx.cwd,'ordinary.mjs'),'console.log("changed")');return APPROVE;});
  writeFileSync(join(h.ctx.cwd,'ordinary.mjs'),'console.log("original")');
  assert.match((await h.call('powershell',{command:'node ./ordinary.mjs'})).reason,/审批期间发生变化/);
  let newer;
  newer=await harness(async()=>{await newer.input('停止刚才的写入，只读取文件。');return APPROVE;});
  assert.match((await newer.call('write',{path:'./old.txt',content:'x'})).reason,/新的用户指示/);
});

test('AUTO reviews once in-process and reuses an identical approval', async () => {
  const h = await harness(() => '```json\n' + APPROVE + '\n```');
  h.setMode('auto');
  const command = { command: 'pnpm test' };
  assert.equal(await h.call('powershell', command), undefined);
  assert.equal(h.requests.length, 1);
  const [request] = h.requests;
  assert.equal(request.model.id, 'mock-model', '审批默认跟随当前会话模型');
  assert.match(request.context.systemPrompt, /internal permission reviewer/, 'approver.md 正文作为 system prompt');
  assert.match(request.context.messages[0].content[0].text, /pnpm test/, '完整参数进入待审证据');
  assert.equal(request.options.cacheRetention, 'none', '审批请求不污染会话提示缓存');
  assert.ok(request.options.signal instanceof AbortSignal, '请求带超时/取消信号');
  assert.equal(await h.call('powershell', command), undefined, '同参数调用复用成功结论');
  assert.equal(h.requests.length, 1);
});

test('unparsable answers retry once; missing confidence requires human approval', async () => {
  const omitted = await harness(() => '我看完了。结论：{"approved":true,"reason":"工作目录内单文件写入（{cache} 已核对）"}',{humanFallback:'ask'});
  omitted.setMode('auto');
  const omittedAsked = omitted.ask('❌ 拒绝');
  assert.equal((await omitted.call('write', { path: './note.md', content: 'ok' })).block, true);
  assert.equal(omitted.requests.length, 2, '省略 confidence 必须重试，不能自行补置信度');
  assert.equal(omittedAsked(), 1);

  const retried = await harness((_context, n) => n === 1 ? GARBAGE : APPROVE);
  retried.setMode('auto');
  const counted = retried.ask('❌ 拒绝');
  assert.equal(await retried.call('powershell', EXEC), undefined, '重试拿到结论就不再打扰用户');
  assert.equal(retried.requests.length, 2);
  assert.match(retried.requests[1].context.messages[0].content[0].text, /上一次没有收到可解析的结论/);
  assert.equal(counted(), 0, '没有弹人工确认');
});

test('low confidence and dead reviewers still ask for executable calls', async () => {
  const low = await harness(() => '{"approved":true,"confidence":0.4,"reason":"目标不明确"}',{humanFallback:'ask'});
  low.setMode('auto');
  const counted = low.ask('❌ 拒绝');
  assert.equal((await low.call('powershell', EXEC)).block, true, '低置信度仍由人工决定');
  assert.equal(counted(), 1);

  const broken = await harness(() => GARBAGE,{humanFallback:'ask'});
  broken.setMode('auto');
  const asked = broken.ask('❌ 拒绝');
  assert.equal((await broken.call('powershell', EXEC)).block, true, '两次都解析不出来才转人工');
  assert.equal(broken.requests.length, 2);
  assert.equal(asked(), 1);

  const outside = await broken.call('write', { path: join(homedir(), 'note.md'), content: 'x' });
  assert.equal(outside.block, true, '工作目录外的写入不降级放行');
  assert.equal(broken.requests.length, 2, '不可用窗口内不再逐条重试');
});

test('reviewer outages require human approval even for local writes', async () => {
  const h = await harness(() => ({ error: 'HTTP 503 upstream unavailable' }),{humanFallback:'ask'});
  h.setMode('auto');
  const asked = h.ask('❌ 拒绝');
  assert.equal((await h.call('write', { path: './note.md', content: 'ordinary edit' })).block, true);
  assert.equal(asked(), 1, '审批失败必须询问用户');
  assert.equal(h.entries.some(e => e.data?.source === 'fallback'), false);
  assert.equal((await h.call('powershell', EXEC)).block, true, '执行类调用仍转人工');
  h.ask('✅ 批准');
  assert.equal(await h.call('write', { path: './note.md', content: 'ordinary edit' }), undefined, '用户可批准当前写入');
});

test('a failed cleanup-script preparation asks the human and latches the hold', async () => {
  const h = await harness(() => ({ error: 'HTTP 503' }),{humanFallback:'ask'});
  h.setMode('auto');
  const asked = h.ask('❌ 拒绝');
  assert.equal((await h.call('write', { path: './cleanup-new.ps1', content: 'Remove-Item ./cache -Recurse -Force' })).block, true);
  assert.equal(asked(), 1);
  assert.equal(h.state.approvalHold, true);
  assert.equal((await h.call('powershell', EXEC)).block, true);
  assert.equal(asked(), 1, '不能改换执行形式继续申请');
});

test('decision schema rejects coercion while accepting fenced JSON and braces in strings', async () => {
  const { parseDecision } = await jiti.import(join(suite, 'extensions/timrt-suite/approval-reviewer.ts'));
  for (const input of [
    {approved: true}, {approved: true, confidence: null}, {approved: true, confidence: ''},
    {approved: 'true', confidence: .9}, {approved: true, confidence: true},
    {approved: true, confidence: '0.9'}, {approved: true, confidence: 99},
    {approved: true, confidence: -1}, {approved: true, confidence: Infinity},
  ]) assert.equal(parseDecision(JSON.stringify(input)), undefined, JSON.stringify(input));
  assert.deepEqual(parseDecision('```json\n{"approved":false,"confidence":0.9,"reason":"核对 {cache}"}\n```'), {approved:false,confidence:.9,reason:'核对 {cache}'});
});

test('ACT reviews risky wrappers internally while plain reads still bypass approval', async () => {
  const h = await harness(() => APPROVE);
  writeFileSync(join(h.ctx.cwd, 'wrapper.mjs'), "import {execFileSync} from 'node:child_process';\nexecFileSync('pwsh', ['-File', './cleanup.ps1']);\n");
  h.setMode('act');
  for (const command of ['Get-Content ./cleanup.ps1 | pwsh.exe -', 'Get-Content ./cleanup.ps1 | & "C:\\Program Files\\PowerShell\\7\\pwsh.exe" -NoProfile -Command -', 'node ./wrapper.mjs', 'pwsh -Command "& ./cleanup.ps1"', 'pwsh -File $script']) {
    h.state.approvalHold = false;
    const asked = h.ask('❌ 拒绝');
    assert.equal(await h.call('powershell', {command}), undefined, command);
    assert.equal(asked(), 0, command);
  }
  h.state.approvalHold = false;
  const asked = h.ask('❌ 拒绝');
  assert.equal(await h.call('powershell', {command:'Get-Content ./wrapper.mjs'}), undefined);
  assert.equal(await h.call('read', {path:join(h.ctx.cwd,'cleanup.ps1')}), undefined);
  assert.equal(asked(), 0);
});

test('ACT skips ordinary review and approves each risky deletion internally without UI', async () => {
  const h=await harness(()=>APPROVE);h.setMode('act');h.ctx.hasUI=false;
  let dialogs=0;h.ctx.ui.confirm=h.ctx.ui.select=async()=>{dialogs++;return false;};
  assert.equal(await h.call('write',{path:'./ordinary.txt',content:'ok'}),undefined);
  assert.equal(await h.call('powershell',{command:'Set-Content -LiteralPath ./ordinary.txt -Value ok'}),undefined);
  assert.equal(h.requests.length,0,'ACT 普通写入不调用模型');
  for(let i=0;i<2;i++)assert.equal(await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse -Force'}),undefined);
  assert.equal(h.requests.length,2,'同一删除每次都审批，不缓存授权');
  assert.ok(h.requests.every(r=>r.context.messages[0].content[0].text.startsWith('待审调用：deletion:powershell')));
  assert.equal(dialogs,0);
  const explain=async(tool,args)=>JSON.parse((await h.tools.get('explain_call').execute('id',{tool,args},undefined,undefined,h.ctx)).content[0].text);
  assert.equal((await explain('write',{path:'./ordinary.txt',content:'ok'})).route,'allow');
  assert.equal((await explain('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'})).route,'model');
});

test('both execution modes pause uncertain or unavailable deletion reviews without modal prompts', async () => {
  const {configuredHumanFallback}=await jiti.import(join(suite,'extensions/timrt-suite/approval-reviewer.ts'));
  assert.equal(configuredHumanFallback(),'pause','本机默认使用无人值守回退');
  for(const mode of ['auto','act'])for(const response of ['{"approved":true,"confidence":0.3,"reason":"范围不足"}',{error:'HTTP 503'}]) {
    const h=await harness(()=>response);h.setMode(mode);
    let dialogs=0,notifications=0;
    h.ctx.ui.confirm=h.ctx.ui.select=async()=>{dialogs++;return false;};
    h.ctx.ui.notify=()=>{notifications++;};
    assert.equal((await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'})).block,true);
    assert.equal(dialogs,0,`${mode}: 不得打开阻塞弹窗`);
    assert.equal(notifications,1);
    assert.equal(h.state.approvalHold,true,'风险审批未通过仍暂停后续修改');
    assert.equal((await h.call('write',{path:'./retry.txt',content:'x'})).block,true);
    assert.equal(notifications,1,'暂停后不反复提醒');
    assert.equal(await h.call('read',{path:join(h.ctx.cwd,'cleanup.ps1')}),undefined);
  }
});

test('cancelled reviews never approve or prompt, and unavailable SDK pauses by default', async () => {
  const h = await harness(() => APPROVE);
  h.setMode('auto');
  const asked = h.ask('❌ 拒绝');
  h.ctx.signal = AbortSignal.abort();
  assert.equal((await h.call('write', {path:'./note.md',content:'ok'})).block, true);
  assert.equal(h.requests.length, 0);
  assert.equal(asked(), 0);
  h.ctx.signal = undefined;
  h.ctx.modelRegistry.complete = undefined;
  assert.equal((await h.call('write', {path:'./note.md',content:'ok'})).block, true);
  assert.equal(asked(), 0, '接口不可用时默认暂停，不弹窗');
});

test('approval cache and unavailable window are scoped to the selected model', async () => {
  const h = await harness(() => APPROVE);
  h.setMode('auto');
  const call = {command:'pnpm test'};
  assert.equal(await h.call('powershell',call), undefined);
  h.ctx.model = {...h.ctx.model,id:'other-model'};
  assert.equal(await h.call('powershell',call), undefined);
  assert.equal(h.requests.length, 2, '切换模型不复用旧模型批准');
  const down = await harness((_context,n) => n <= 2 ? {error:'HTTP 503'} : APPROVE);
  down.setMode('auto');
  down.ask('❌ 拒绝');
  assert.equal((await down.call('powershell',call)).block, true);
  down.ctx.model = {...down.ctx.model,id:'other-model'};
  assert.equal(await down.call('powershell',call), undefined);
  assert.equal(down.requests.length, 3, '切换模型立即尝试新模型，不沿用旧模型熔断');
});

test('deletion review follows executed scripts and stays per-invocation', async () => {
  const seen = [];
  const h = await harness((context, n) => {
    seen.push(context.messages[0].content[0].text);
    return n === 1 ? APPROVE : '{"approved":false,"confidence":0.9,"reason":"范围不清"}';
  });
  h.setMode('auto');
  const run = { command: `powershell -NoProfile -File ${join(h.ctx.cwd, 'cleanup.ps1')}` };
  assert.equal(await h.call('powershell', run), undefined);
  assert.match(seen[0], /^待审调用：deletion:powershell/, '被执行的脚本走删除审批');
  assert.match(seen[0], /Remove-Item/, '删除审批带上脚本源码证据');
  assert.equal((await h.call('powershell', run)).block, true, '上一次批准不授权下一次删除');
  assert.equal(h.requests.length, 2, '删除审批不复用结论缓存');
});

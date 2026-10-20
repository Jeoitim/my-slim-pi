import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {root,suite,jiti,harness,APPROVE,GARBAGE,EXEC} from './auto-harness.mjs';

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
  assert.equal(configuredHumanFallback(),'ask','两平台默认使用人工兜底');
  for(const mode of ['auto','act'])for(const response of ['{"approved":true,"confidence":0.3,"reason":"范围不足"}',{error:'HTTP 503'}]) {
    const h=await harness(()=>response,{humanFallback:'pause'});h.setMode(mode);
    let dialogs=0,notifications=0;
    h.ctx.ui.confirm=h.ctx.ui.select=async()=>{dialogs++;return false;};
    h.ctx.ui.notify=()=>{notifications++;};
    assert.equal((await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'})).block,true);
    assert.equal(dialogs,0,`${mode}: 不得打开阻塞弹窗`);
    assert.equal(notifications,0,'关闭人工兜底时不通知、不等待');
    assert.equal(h.state.approvalHold,true,'风险审批未通过仍暂停后续修改');
    assert.equal((await h.call('write',{path:'./retry.txt',content:'x'})).block,true);
    assert.equal(notifications,0,'拒绝后也不发提醒');
    assert.equal(await h.call('read',{path:join(h.ctx.cwd,'cleanup.ps1')}),undefined);
  }
});

test('cancelled reviews never prompt; unavailable SDK uses the default human fallback', async () => {
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
  assert.equal(asked(), 1, '接口不可用时默认询问，未批准不能执行');
});

test('default human fallback waits for a decision for AUTO and risky ACT calls; headless calls stay blocked',async()=>{
  for(const mode of ['auto','act']) {
    const h=await harness(()=>'{"approved":false,"confidence":0.4,"reason":"需人工核对"}');h.setMode(mode);
    let finish, options, completed=false;
    const pending=new Promise(resolve=>{finish=resolve;});
    h.ctx.ui.confirm=async(_title,_body,opts)=>{options=opts;return pending;};
    h.ctx.ui.select=async(_title,rows,opts)=>{options=opts;return await pending ? rows[0] : rows[1];};
    const call=h.call('bash',{command:'rm -rf ./cache'}).then(value=>{completed=true;return value;});
    for(let i=0;i<30&&!options;i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(options?.timeout,90000);
    assert.equal(completed,false,'必须等待人工结果，不能先返回暂停并让模型继续');
    finish(false);assert.equal((await call).block,true);
    assert.equal(h.state.approvalHold,true);
    const headless=await harness(()=>'{"approved":false,"confidence":0.4,"reason":"需人工核对"}');headless.setMode(mode);headless.ctx.hasUI=false;
    assert.equal((await headless.call('bash',{command:'rm -rf ./cache'})).block,true);
  }
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

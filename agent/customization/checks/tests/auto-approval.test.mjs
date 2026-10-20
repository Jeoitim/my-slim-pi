import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {root,suite,jiti,harness,APPROVE,GARBAGE,EXEC} from './auto-harness.mjs';

test('maintenance declarations are task-scoped, reject unrequested core edits and cannot clear a cleanup hold',async()=>{
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

test('ASK shares AUTO read exemptions and confirms other calls without a timeout or model approval',async()=>{
  const h=await harness(()=>{throw Error('ASK must never call automatic reviewer');});h.setMode('ask');
  const policyText=readFileSync(join(root,'APPEND_SYSTEM.md'),'utf8');
  assert.match(policyText,/ASK 与 AUTO 共用只读免审判断/);
  assert.doesNotMatch(policyText,/含读取均须人工/);
  let prompts=0,approve=true;
  h.ctx.ui.confirm=async(_title,message,opts)=>{prompts++;assert.equal(opts.timeout,undefined);assert.match(message,/无等待超时/);return approve;};
  assert.equal(await h.call('read',{path:join(h.ctx.cwd,'cleanup.ps1')}),undefined);
  for (const [tool,args] of [
    ['grep',{pattern:'Remove-Item',path:h.ctx.cwd}],
    ['find',{pattern:'*.ps1',path:h.ctx.cwd}],
    ['ls',{path:h.ctx.cwd}],
    ['powershell',{command:'Get-Date'}],
    ['bash',{command:'pwd'}],
  ]) assert.equal(await h.call(tool,args),undefined);
  assert.equal(prompts,0);
  assert.equal(await h.call('powershell',EXEC),undefined);
  assert.equal(await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'}),undefined);
  assert.equal(prompts,2);assert.equal(h.requests.length,0);
  const classification=await h.tools.get('explain_call').execute('x',{tool:'read',args:{path:'a.txt'}},undefined,undefined,h.ctx);
  assert.equal(JSON.parse(classification.content[0].text).route,'allow');
  const writeClassification=await h.tools.get('explain_call').execute('x',{tool:'powershell',args:EXEC},undefined,undefined,h.ctx);
  assert.equal(JSON.parse(writeClassification.content[0].text).route,'human');
  approve=false;
  assert.equal((await h.call('powershell',EXEC)).block,true);
  h.ctx.hasUI=false;
  assert.equal(await h.call('read',{path:'a.txt'}),undefined);
  assert.equal((await h.call('powershell',EXEC)).block,true);
  assert.equal(prompts,3);
  assert.equal(h.requests.length,0);
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
  assert.match(await h.brief(),/ASK：与 AUTO 共用只读免审判断/);
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


test('policy denial and non-cleanup execution denial do not freeze unrelated work',async()=>{
  for(const mode of ['auto','act']){
    let allow=false;
    const h=await harness(()=>allow?APPROVE:'{"approved":false,"confidence":0.95,"reason":"当前执行不适合该任务"}');h.setMode(mode);
    const before=readFileSync(join(root,'agents/approver.md'),'utf8');
    const denied=await h.call('powershell',{command:`Set-Content -LiteralPath '${join(root,'agents/approver.md')}' -Value 'Remove-Item ./cache -Recurse'`});
    assert.equal(denied.block,true);assert.equal(h.state.approvalHold,false);assert.equal(h.requests.length,0);
    assert.equal(readFileSync(join(root,'agents/approver.md'),'utf8'),before,'hook-only probe never writes to the real file');
    assert.equal((await h.call('powershell',{command:'pwsh -EncodedCommand Zg=='})).block,true);
    assert.equal(h.state.approvalHold,false,'uncertain execution is not itself cleanup');
    allow=true;assert.equal(await h.call('write',{path:'./unrelated.txt',content:'task data'}),undefined);
    allow=false;
    assert.equal((await h.call('powershell',{command:'Remove-Item -LiteralPath ./cache -Recurse'})).block,true);
    assert.equal(h.state.approvalHold,true,'real cleanup still freezes later mutations');
  }
});

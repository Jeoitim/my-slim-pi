import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

async function harness(review) {
  const { installPermissions } = await jiti.import(join(root, 'extensions/timrt-suite/permissions.ts'));
  const hooks = new Map(), events = new Map(), entries = [];
  const pi = {
    on(event, fn) { hooks.set(event, [...(hooks.get(event) || []), fn]); },
    registerCommand() {}, registerShortcut() {}, registerTool() {}, appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); },
    getActiveTools: () => [], setActiveTools() {},
    events: { on(event, fn) { events.set(event, fn); return () => events.delete(event); }, emit() {} },
  };
  const state = installPermissions(pi, review);
  const ctx = {
    cwd: mkdtempSync(join(tmpdir(), 'pi-delete-review-')), hasUI: true,
    model: { provider: 'verification', id: 'mock-model', name: 'Mock model' },
    modelRegistry: { getAll: () => [] }, sessionManager: { getEntries: () => entries, getBranch: () => entries },
    ui: { theme: { appearance: 'dark' }, setStatus() {}, notify() {}, confirm: async () => false },
  };
  for (const fn of hooks.get('session_start')) await fn({}, ctx);
  for (const fn of hooks.get('input')) await fn({ source: 'interactive', text: '清理当前项目已确认的 cache 目录。' }, ctx);
  return {
    state, ctx, events, entries,
    async input(text, source = 'interactive') {
      for (const fn of hooks.get('input')) await fn({ source, text }, ctx);
    },
    async restart() {
      for (const fn of hooks.get('session_start')) await fn({}, ctx);
    },
    async call(toolName, input) {
      for (const fn of hooks.get('tool_call')) {
        const result = await fn({ type: 'tool_call', toolCallId: 'test', toolName, input }, ctx);
        if (result?.block) return result;
      }
    },
  };
}

test('AUTO deletion needs one explicit reviewer decision per invocation and fails closed', async () => {
  const calls = [];
  let allow = true;
  const h = await harness(async (_ctx, name, data, model) => {
    calls.push({ name, data, model });
    return { approved: allow, source: 'subagent', reason: 'fixture decision' };
  });
  assert.equal(await h.call('bash', { command: 'rm -rf ./cache' }), undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'deletion:bash');
  assert.equal(calls[0].data.cwd, h.ctx.cwd);
  assert.match(calls[0].data.currentUserRequest, /清理当前项目/);
  assert.equal(calls[0].model, 'verification/mock-model');
  allow = false;
  assert.equal((await h.call('bash', { command: 'rm -rf ./cache' })).block, true);
  assert.equal(calls.length, 2, 'prior grant must not authorize the next call');
  assert.equal((await h.call('write', { path: join(root, 'APPEND_SYSTEM.md'), content: 'weaken policy' })).block, true);
  assert.equal(calls.length, 2, 'review cannot override self-policy protection');
  const failed = await harness(async () => { throw Error('review unavailable'); });
  assert.match((await failed.call('bash', { command: 'rm -rf ./cache' })).reason, /审批未完成/);
  let confirmations = 0;
  const fallback = await harness(async (ctx) => {
    const choice = await ctx.ui.select('huge-source'.repeat(10000), ['✅ 批准', '❌ 拒绝']);
    return { approved: choice.includes('批准'), source: 'human' };
  });
  fallback.ctx.ui.confirm = async (_title, body) => {
    confirmations++;
    assert.ok(body.length < 8000, 'fallback must not render full script evidence as a selection title');
    assert.match(body, /rm -rf/);
    return true;
  };
  assert.equal(await fallback.call('bash', { command: 'rm -rf ./cache' }), undefined);
  assert.equal(confirmations, 1);
});

test('ACT uses internal deletion approval; ASK confirms manually and PLAN stays read-only', async () => {
  let reviews = 0, confirms = 0, allow = false;
  const h = await harness(async () => { reviews++; return { approved: allow, source: 'subagent' }; });
  h.ctx.ui.confirm = async () => { confirms++; return allow; };
  h.state.mode = 'act';
  assert.equal((await h.call('bash', { command: 'rm -rf ./cache' })).block, true);
  allow = true;
  await h.input('我核对了 cache 路径，重新提交本次删除供内部审批。');
  assert.equal(await h.call('bash', { command: 'rm -rf ./cache' }), undefined);
  assert.equal(confirms, 0);
  assert.equal(reviews, 2);
  h.state.mode='ask';
  assert.equal(await h.call('bash',{command:'rm -rf ./cache'}),undefined);
  h.state.mode='plan';
  assert.equal((await h.call('bash',{command:'rm -rf ./cache'})).block,true);
  assert.equal(confirms, 1);
  assert.equal(reviews, 2);
  h.state.mode = 'auto';
  await h.input('核对以下脚本，不执行未确认的删除。');
  allow = true;
  assert.equal(await h.call('bash', { command: 'powershell -EncodedCommand Zg==' }), undefined, '原始语句由审批模型判断；这里模拟模型批准');
  assert.equal(confirms, 1, 'AUTO 先交模型判断，不因静态解析不支持强制弹窗');
  assert.equal(reviews, 3);
  h.ctx.hasUI = false;
  assert.equal(await h.call('bash', { command: 'powershell -EncodedCommand Zg==' }), undefined, '无界面也可执行已有有效模型审批的调用');
  assert.equal(confirms, 1);
});

test('script review follows a BAT wrapper, preserves read-only access, and rejects changed bytes', async () => {
  let approvals = 0, observed;
  const h = await harness(async (_ctx, _name, data) => {
    approvals++; observed = data;
    writeFileSync(join(h.ctx.cwd, 'cleanup.js'), 'fs.rmSync("./different", {recursive:true});');
    return { approved: true, source: 'subagent' };
  });
  writeFileSync(join(h.ctx.cwd, 'cleanup.js'), 'fs.rmSync("./cache", {recursive:true});');
  writeFileSync(join(h.ctx.cwd, 'cleanup.bat'), '@echo off\nnode "%~dp0cleanup.js"\n');
  assert.equal(await h.call('bash', { command: 'cat cleanup.js' }), undefined);
  assert.equal(approvals, 0, 'reading a script must not require deletion approval');
  const result = await h.call('bash', { command: 'cmd /c cleanup.bat' });
  assert.equal(approvals, 1);
  assert.equal(observed.scripts.length, 2);
  assert.ok(observed.scripts.some(s => /cleanup\.js$/.test(s.path) && s.source.includes('./cache')));
  assert.match(result.reason, /审批期间发生变化/);
});

test('native PowerShell reads, writes and deletion use the current permission mode', async () => {
  let reviews = 0, lastName, allow = false, confirmations = 0;
  const h = await harness(async (_ctx, name) => {
    reviews++; lastName = name;
    return { approved: allow, source: 'fixture', reason: 'fixture decision' };
  });
  h.ctx.ui.confirm=async()=>true;
  for (const mode of ['auto', 'act', 'ask', 'plan']) {
    h.state.mode = mode;
    assert.equal(await h.call('powershell', { command: 'Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free' }), undefined);
    assert.equal(await h.call('powershell', { command: "Get-ChildItem -LiteralPath 'C:\\Users\\example' -File | Measure-Object -Property Length -Sum" }), undefined);
    assert.equal((await h.call('powershell', { command: "Get-Content -LiteralPath '" + join(root, 'auth.json') + "'" })).block, true);
  }
  assert.equal(reviews, 0);
  h.ctx.ui.confirm=async()=>false;
  const write = { command: "Set-Content -LiteralPath './sample.txt' -Value 'test'" };
  for (const mode of ['ask', 'plan']) {
    h.state.mode = mode;
    assert.equal((await h.call('powershell', write)).block, true);
    assert.equal((await h.call('powershell', { command: 'Get-ChildItem | ForEach-Object { Set-Content sample.txt x }' })).block, true);
  }
  h.state.mode = 'act';
  assert.equal(await h.call('powershell', write), undefined);
  assert.equal(reviews, 0);
  h.state.mode = 'auto';
  assert.equal((await h.call('powershell', write)).block, true);
  assert.equal(lastName, 'operation:powershell');
  allow = true;
  assert.equal(await h.call('powershell', write), undefined);
  const deletion = { command: "Remove-Item -LiteralPath './cache' -Recurse -Force" };
  assert.equal(await h.call('powershell', deletion), undefined);
  assert.equal(lastName, 'deletion:powershell');
  allow = false;
  assert.equal((await h.call('powershell', deletion)).block, true);
  await h.input('我重新核对本次 cache 目录删除，请内部审批重新评估。');
  h.state.mode = 'act';
  h.ctx.ui.confirm = async () => { confirmations++; return false; };
  assert.equal((await h.call('powershell', deletion)).block, true);
  assert.equal(confirmations, 0);
  writeFileSync(join(h.ctx.cwd, 'cleanup.ps1'), 'Remove-Item -LiteralPath ./cache -Recurse');
  assert.equal(await h.call('powershell', { command: 'Get-Content ./cleanup.ps1 | Select-Object -First 10' }), undefined);
  assert.equal(confirmations, 0, 'reading a cleanup script is not executing it');
});

test('write approval receives full script, actual user request and the active-branch plan', async () => {
  const h = await harness(async (_ctx, name, evidence) => {
    assert.equal(name, 'operation:write');
    assert.equal(evidence.tool, 'write');
    assert.equal(evidence.arguments.path, join(h.ctx.cwd, 'cleanup-pass1.ps1'));
    assert.equal(evidence.arguments.content, script);
    assert.equal(evidence.currentUserRequest, 'A B 全清');
    assert.equal(evidence.cwd, h.ctx.cwd);
    assert.ok(evidence.recentConversation.some(m => m.role === 'assistant' && m.text.includes('A 类清单')));
    assert.ok(evidence.recentConversation.some(m => m.role === 'user' && m.text === 'A B 全清'));
    assert.doesNotMatch(JSON.stringify(evidence), /hidden-reasoning|hidden-tool-output/);
    const source = readFileSync(join(root, 'npm/node_modules/pi-permission-suite/approver.ts'), 'utf8');
    const start = source.indexOf('function formatCall(');
    const end = source.indexOf('// ─── 解析响应', start);
    const fn = source.slice(start, end).trim().replace(/function formatCall\([^)]*\): string/, 'function formatCall(toolName, input)');
    const formatCall = vm.runInNewContext('(' + fn + ')');
    assert.deepEqual(JSON.parse(formatCall(name, evidence)).arguments, evidence.arguments, 'real package formatter retains the complete tool arguments');
    return { approved: true, source: 'fixture' };
  });
  const script = '# PREPARE ONLY: no cleanup execution during verification\nRemove-Item -LiteralPath ./cache -Recurse\n' + '# detailed target evidence\n'.repeat(170);
  h.entries.push({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hidden-reasoning' }, { type: 'text', text: 'A 类清单：仅工作目录 cache；B 类清单：无。' }] } });
  h.entries.push({ message: { role: 'toolResult', content: [{ type: 'text', text: 'hidden-tool-output' }] } });
  h.entries.push({ message: { role: 'user', content: [{ type: 'text', text: 'A B 全清' }] } });
  await h.input('A B 全清');
  assert.equal(await h.call('write', { path: join(h.ctx.cwd, 'cleanup-pass1.ps1'), content: script }), undefined);
});

test('rejected cleanup preparation pauses inline, split, MCP and delegated mutations until new human input', async () => {
  let reviews = 0, allow = false;
  const h = await harness(async () => { reviews++; return { approved: allow, source: 'fixture', reason: 'needs evidence' }; });
  assert.equal((await h.call('write', { path: './cleanup.ps1', content: 'Remove-Item -LiteralPath ./cache -Recurse' })).block, true);
  assert.equal(h.state.approvalHold, true);
  for (const [name, input] of [
    ['powershell', { command: 'Remove-Item -LiteralPath ./cache -Recurse' }],
    ['bash', { command: 'rm -rf ./cache' }],
    ['write', { path: './different-script.ps1', content: 'cleanup helper' }],
    ['mcp', { tool: 'fs_delete', args: { path: './cache' } }],
    ['request_subagent', { skill: 'build', reason: 'perform cleanup' }],
    ['subagent', { task: 'perform cleanup' }],
  ]) assert.match((await h.call(name, input)).reason, /本轮后续写入和执行已暂停|仍在清理审批暂停中/);
  assert.equal(reviews, 1, 'changing execution form cannot solicit a different review');
  assert.equal(await h.call('powershell', { command: 'Get-ChildItem -LiteralPath ./cache | Select-Object Name' }), undefined);
  await h.input('retry through extension', 'extension');
  assert.equal(h.state.approvalHold, true);
  await h.restart();
  assert.equal(h.state.approvalHold, true, 'reload cannot erase the hold recorded on the active branch');
  allow = true;
  await h.input('已重新核对目标和影响，请重新审批本次 cache 删除。');
  assert.equal(h.state.approvalHold, false);
  assert.equal(await h.call('powershell', { command: 'Remove-Item -LiteralPath ./cache -Recurse' }), undefined);
  assert.equal(reviews, 2, 'new human input only permits a fresh per-call review');
});

test('ordinary Auto uncertainty asks with the complete current call and cancellation does not execute', async () => {
  let body;
  const h = await harness(async (ctx) => {
    const selected = await ctx.ui.select('uncertain', ['✅ 批准', '❌ 拒绝']);
    return { approved: selected === '✅ 批准', source: 'human' };
  });
  h.ctx.ui.confirm = async (_title, text) => { body = text; return false; };
  const result = await h.call('write', { path: './sample.txt', content: 'full test content' });
  assert.equal(result.block, true);
  assert.match(body, /full test content/);
  assert.match(body, /工作目录|用户请求/);
  assert.equal(h.state.approvalHold, false, 'a normal non-cleanup refusal does not latch a cleanup hold');
});

test('MCP broker applies the same one-call deletion review', async () => {
  let allow = true, calls = 0;
  const h = await harness(async (_ctx, name, data) => {
    calls++; assert.equal(name, 'deletion:fs_delete');
    assert.equal(data.arguments.path, join(h.ctx.cwd, 'cache'));
    return { approved: allow, source: 'subagent' };
  });
  async function broker() {
    let check;
    h.events.get('pi-mcp-adapter:tool-approval-request')({
      prefixedToolName: 'fs_delete', args: { path: join(h.ctx.cwd, 'cache') },
      claim(fn) { check = fn; },
    });
    return check();
  }
  assert.equal(await broker(), 'allow_once');
  allow = false;
  assert.equal(await broker(), 'deny');
  assert.equal(calls, 2);
});

test('real approver parser requires boolean approval and finite numeric confidence', () => {
  const source = readFileSync(join(root, 'npm/node_modules/pi-permission-suite/approver.ts'), 'utf8');
  const start = source.indexOf('function parseResponse(');
  const end = source.indexOf('// ─── 升级到人工', start);
  assert.ok(start >= 0 && end > start);
  const fn = source.slice(start, end).trim().replace(/function parseResponse\(text: string\): \{[^}]+\}/, 'function parseResponse(text)');
  const parse = vm.runInNewContext('(' + fn + ')');
  assert.equal(parse('{"approved":true,"confidence":0.95}').approved, true);
  for (const approved of ['false', 'true', 1, null]) {
    assert.equal(parse(JSON.stringify({ approved, confidence: 0.99 })).approved, false);
  }
  for (const confidence of ['0.99', null, {}, undefined]) {
    assert.equal(parse(JSON.stringify({ approved: true, confidence })).confidence, 0);
  }
  assert.equal(parse('{"approved":true,"confidence":1e309}').confidence, 0);
  assert.equal(parse('not json').approved, false);
});

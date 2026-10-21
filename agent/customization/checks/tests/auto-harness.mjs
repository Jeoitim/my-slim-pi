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
    exec: async()=>({code:1,stdout:'',stderr:'mock execution stopped before backup'}),
    events: {
      on(name,fn) { const set=listeners.get(name)||new Set();set.add(fn);listeners.set(name,set);return()=>set.delete(fn); },
      emit(name,event) { for(const fn of listeners.get(name)||[])fn(event); },
    },
  };
  const state = installPermissions(pi, createApprovalReviewer(pi,reviewerOptions), async()=>{});
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
    async input(text,source='interactive') { for (const fn of hooks.get('input')) await fn({source,text},ctx); },
    setMode(mode) { state.mode = mode; },
    ask(answer) {
      let count = 0;
      const approve = answer.includes('批准');
      // 普通调用经 permissions 的 select 代理走 confirm；删除审批直接用 select。
      ctx.ui.confirm = async () => { count++; return approve; };
      ctx.ui.select = async (title, rows) => { if (title.startsWith('Approval service failed:')) return rows[1]; count++; return approve ? rows[0] : rows[1]; };
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


export {root,suite,jiti,harness,APPROVE,GARBAGE,EXEC};

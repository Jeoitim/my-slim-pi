import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The offline regression harness runs every test with PI_OFFLINE=1; naming must
// still be exercised through the stubbed registry, so this file controls the flag.
const initialOffline = process.env.PI_OFFLINE;
delete process.env.PI_OFFLINE;
test.after(() => { if (initialOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = initialOffline; });

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
const version = readFileSync(join(agentDir, 'install', 'current-version'), 'utf8').trim();
const modules = join(agentDir, 'install', 'releases', version, 'node_modules');
const { createJiti } = await import(pathToFileURL(join(modules, 'jiti', 'lib', 'jiti.mjs')));
const jiti = createJiti(import.meta.url, { alias: {
  'typebox': join(modules, 'typebox', 'build', 'index.mjs'),
  '@earendil-works/pi-tui': join(modules, '@earendil-works', 'pi-tui', 'dist', 'index.js'),
  '@earendil-works/pi-ai/compat': join(modules, '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
  '@earendil-works/pi-ai': join(modules, '@earendil-works', 'pi-ai', 'dist', 'compat.js'),
  '@earendil-works/pi-coding-agent': join(modules, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
} });
const naming = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/session-naming.ts'));

const PROJECT = join(homedir(), 'projects', 'demo');
const FIRST_REQUEST = '帮我修复登录回调的 500 错误';

function harness({ settings = {}, answer = '登录回调 500 错误', answers, model = true, delay = 0, assistant = false, turns = 0, summary } = {}) {
  const hooks = new Map(), commands = new Map(), names = [], entries = [], notifications = [], calls = [];
  let current = '';
  const queue = Array.isArray(answers) ? [...answers] : undefined;
  const pi = {
    on(event, handler) { const list = hooks.get(event) || []; list.push(handler); hooks.set(event, list); },
    registerCommand(name, command) { commands.set(name, command); },
    getSettings: () => settings,
    getSessionName: () => current || undefined,
    setSessionName(name) { current = name; names.push(name); },
    appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); },
    events: { on: () => () => {}, emit() {} },
  };
  const sessionEntries = [];
  if (summary) sessionEntries.push({ type: 'compaction', id: 'c1', summary, firstKeptEntryId: 'm1', timestamp: 0 });
  sessionEntries.push({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: FIRST_REQUEST }], timestamp: 1 } });
  if (assistant) sessionEntries.push({ type: 'message', message: { role: 'assistant', content: [
    { type: 'toolCall', name: 'read', arguments: { path: 'src/login.ts' } },
    { type: 'text', text: '登录回调签名与 500 不符：`src/login.ts` 里缺少错误分支，已补上并加了回归测试。' },
  ], timestamp: 2 } });
  for (let turn = 0; turn < turns; turn++) {
    sessionEntries.push({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: `第 ${turn + 2} 轮：继续调整登录页样式` }], timestamp: 3 + turn * 2 } });
    sessionEntries.push({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: `已处理第 ${turn + 2} 轮请求。` }], timestamp: 4 + turn * 2 } });
  }
  const registry = {
    find: () => (model ? { provider: 'test', id: 'naming', name: 'Naming' } : undefined),
    complete: async (_model, context, options) => {
      calls.push({ context, options });
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const text = queue && queue.length ? queue.shift() : answer;
      return { stopReason: 'stop', content: [{ type: 'text', text }] };
    },
  };
  const ctx = {
    cwd: PROJECT, signal: undefined,
    model: model ? { provider: 'test', id: 'session', name: 'Session' } : undefined,
    modelRegistry: registry,
    sessionManager: { getSessionId: () => 'session-1', getBranch: () => sessionEntries, getEntries: () => sessionEntries },
    ui: { notify: (message, type) => notifications.push({ message, type }) },
  };
  naming.installSessionNaming(pi);
  const emit = async (event, payload = {}) => { let result; for (const handler of hooks.get(event) || []) result = await handler(payload, ctx); return result; };
  const settle = () => new Promise(resolve => setTimeout(resolve, 40));
  return { pi, ctx, names, entries, notifications, calls, commands, emit, settle, current: () => current };
}

test('title helpers clamp, strip labels and remove question or filler wording', () => {
  assert.equal(naming.cleanTitle('"修复登录回调"', 28), '修复登录回调');
  assert.equal(naming.cleanTitle('Title: retry wrapper\nignored line', 28), 'retry wrapper');
  assert.equal(naming.cleanTitle('  - 重构  权限模块。 ', 28), '重构 权限模块');
  assert.equal(naming.cleanTitle('「会话」：Vim 行号', 28), 'Vim 行号');
  assert.equal(naming.derivedTitle('请帮我修复登录回调的 500 错误，另外再看日志', 28), '修复登录回调的 500 错误');
  assert.equal(naming.derivedTitle('vim可以显示行号吗？看看能不能让本机的vim显示行号', 28), 'vim显示行号');
  assert.equal(Array.from(naming.derivedTitle('一'.repeat(80), 12)).length, 12);
});

test('verbatim restatements and generic titles are treated as quality problems', () => {
  assert.equal(naming.isVerbatim('vim可以显示行号吗', 'vim可以显示行号吗？看看本机'), true);
  assert.equal(naming.isVerbatim('Vim 开启行号', 'vim可以显示行号吗？看看本机'), false);
  assert.equal(naming.titleProblem('目前我的pwsh7配置 都是proxy-xxx', '目前我的pwsh7配置 都是proxy-xxx 的别名', 28), 'filler');
  assert.equal(naming.titleProblem('能显示行号吗', 'vim 显示行号', 28), 'question');
  assert.equal(naming.titleProblem('代码修改', '改一下登录页', 28), 'generic');
  assert.equal(naming.titleProblem('登录回调 500 错误', '帮我修复登录回调的 500 错误', 28), undefined);
});

test('first interactive instruction names the session once, without blocking the turn', async () => {
  const h = harness({ delay: 20 });
  const result = await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  assert.equal(result?.action, 'continue');
  assert.equal(h.names.length, 0, 'the turn returns before the naming call resolves');
  await h.settle();
  assert.deepEqual(h.names, ['登录回调 500 错误']);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].context.systemPrompt, /at most 28 characters/);
  assert.match(h.calls[0].context.systemPrompt, /Examples:/);
  assert.match(h.calls[0].context.messages[0].content[0].text, /Project directory: demo/);
  assert.match(h.calls[0].context.messages[0].content[0].text, new RegExp('User request: ' + FIRST_REQUEST.slice(0, 6)));
  assert.deepEqual(h.entries[0].data, { kind: 'auto', name: '登录回调 500 错误', source: 'model', model: 'test/session' });
  await h.emit('input', { source: 'interactive', text: '再试一次', images: [] });
  await h.settle();
  assert.equal(h.calls.length, 1, 'later turns never rename a named session');
});

test('a verbatim answer is rewritten once instead of accepted', async () => {
  const h = harness({ answers: ['vim可以显示行号吗', 'Vim 行号设置'] });
  await h.emit('input', { source: 'interactive', text: 'vim可以显示行号吗？看看本机能不能显示', images: [] });
  await h.settle();
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].context.messages[0].content[0].text, /repeated the request/);
  assert.deepEqual(h.names, ['Vim 行号设置']);
});

test('generic answers fall back to a locally derived title', async () => {
  const h = harness({ answers: ['代码修改', '代码修改'] });
  await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await h.settle();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.names, ['修复登录回调的 500 错误']);
  assert.equal(h.entries[0].data.source, 'derived');
});

test('the first settled turn refines the provisional title with reply and tool context', async () => {
  const h = harness({ assistant: true, answers: ['登录回调', 'login.ts 回调 500 错误'] });
  await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await h.settle();
  assert.deepEqual(h.names, ['登录回调']);
  await h.emit('agent_settled', { aborted: false });
  await h.settle();
  assert.deepEqual(h.names, ['登录回调', 'login.ts 回调 500 错误']);
  assert.match(h.calls[1].context.messages[0].content[0].text, /Assistant reply: /);
  assert.match(h.calls[1].context.messages[0].content[0].text, /Tools used: read/);
  assert.ok(h.entries.some(entry => entry.data.kind === 'refined'));
  await h.emit('agent_settled', { aborted: false });
  await h.settle();
  assert.equal(h.calls.length, 2, 'refinement happens once per session');
});

test('an aborted settle or a missing reply never triggers refinement', async () => {
  const aborted = harness({ assistant: true });
  await aborted.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await aborted.settle();
  await aborted.emit('agent_settled', { aborted: true });
  await aborted.settle();
  assert.equal(aborted.calls.length, 1);
  const noReply = harness();
  await noReply.emit('agent_settled', { aborted: false });
  await noReply.settle();
  assert.equal(noReply.calls.length, 0);
});

test('skill commands, plain slash commands and extension messages are ignored', async () => {
  const h = harness();
  for (const payload of [
    { source: 'interactive', text: '/skill:principal 帮我看看', images: [] },
    { source: 'interactive', text: '/model', images: [] },
    { source: 'rpc', text: '帮我修复登录回调', images: [] },
    { source: 'interactive', text: '   ', images: [] },
  ]) await h.emit('input', payload);
  await h.settle();
  assert.equal(h.names.length, 0);
  assert.equal(h.calls.length, 0);
});

test('a manual name wins over automatic naming for the rest of the session', async () => {
  const h = harness({ assistant: true });
  await h.emit('session_info_changed', { name: 'my own name' });
  await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await h.emit('agent_settled', { aborted: false });
  await h.settle();
  assert.equal(h.names.length, 0);
  assert.equal(h.calls.length, 0);
});

test('/auto-rename names from the conversation and accepts an explicit name', async () => {
  const h = harness({ assistant: true, turns: 2, answers: ['登录回调 500 错误', '登录回调 500 错误'] });
  await h.commands.get('auto-rename').handler('', h.ctx);
  assert.deepEqual(h.names, ['登录回调 500 错误']);
  assert.equal(h.notifications.at(-1).message, 'Session named: 登录回调 500 错误');
  assert.match(h.calls[0].context.messages[0].content[0].text, /Assistant reply:/);
  assert.match(h.calls[0].context.messages[0].content[0].text, /Recent conversation:/);
  await h.commands.get('auto-rename').handler('权限模块重构', h.ctx);
  assert.equal(h.current(), '权限模块重构');
  assert.equal(h.entries.at(-1).data.kind, 'lock');
});

test('/auto-rename off disables naming until it is turned back on', async () => {
  const h = harness();
  await h.commands.get('auto-rename').handler('off', h.ctx);
  await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await h.settle();
  assert.equal(h.names.length, 0);
  await h.commands.get('auto-rename').handler('on', h.ctx);
  await h.emit('input', { source: 'interactive', text: '另一个任务', images: [] });
  await h.settle();
  assert.equal(h.names.length, 1);
});

test('offline sessions and sessions without a model never call a model', async () => {
  process.env.PI_OFFLINE = '1';
  try {
    const offline = harness();
    await offline.emit('input', { source: 'interactive', text: '帮我修复登录回调', images: [] });
    await offline.settle();
    assert.equal(offline.calls.length, 0);
    await offline.commands.get('auto-rename').handler('', offline.ctx);
    assert.equal(offline.calls.length, 0);
    assert.deepEqual(offline.names, ['修复登录回调的 500 错误'], 'the local fallback still names the session');
    assert.equal(offline.entries.at(-1).data.source, 'derived');
  } finally {
    delete process.env.PI_OFFLINE;
  }
  const modeless = harness({ model: false });
  await modeless.emit('input', { source: 'interactive', text: '帮我修复登录回调', images: [] });
  await modeless.settle();
  assert.equal(modeless.calls.length, 0);
  assert.equal(modeless.names.length, 0);
});

test('configured model and character limit are honoured; repeated names are skipped', async () => {
  const h = harness({ settings: { sessionNaming: { model: 'test/naming', maxChars: 12 } }, answer: '登录回调 500 错误' });
  await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await h.settle();
  assert.equal(h.names[0], '登录回调 500 错误');
  assert.match(h.calls[0].context.systemPrompt, /at most 12 characters/);
  assert.equal(h.calls[0].options.maxTokens, 512);
  const repeat = harness({ answer: '同一个名字' });
  await repeat.emit('input', { source: 'interactive', text: '第一个任务', images: [] });
  await repeat.settle();
  await repeat.emit('session_info_changed', { name: '同一个名字' });
  await repeat.emit('input', { source: 'interactive', text: '第二个任务', images: [] });
  await repeat.settle();
  assert.deepEqual(repeat.names, ['同一个名字']);
});

test('a compacted session is named from its summary as well as the retained messages', async () => {
  const h = harness({ summary: '用户先把 pi 升到 1.5.2，随后在做代理别名合并与论文批量处理。', assistant: true });
  await h.commands.get('auto-rename').handler('', h.ctx);
  assert.match(h.calls[0].context.messages[0].content[0].text, /Session summary: 用户先把 pi 升到 1\.5\.2/);
});

test('refine can be disabled from settings', async () => {
  const h = harness({ assistant: true, settings: { sessionNaming: { refine: false } } });
  await h.emit('input', { source: 'interactive', text: FIRST_REQUEST, images: [] });
  await h.settle();
  await h.emit('agent_settled', { aborted: false });
  await h.settle();
  assert.equal(h.calls.length, 1);
  assert.ok(!h.entries.some(entry => entry.data.kind === 'refined'));
});

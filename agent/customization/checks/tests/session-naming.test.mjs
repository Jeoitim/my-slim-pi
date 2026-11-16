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

function harness({ settings = {}, answer = '登录回调 500 错误', model = true, delay = 0 } = {}) {
  const hooks = new Map(), commands = new Map(), names = [], entries = [], notifications = [];
  const calls = [];
  let current = '';
  const pi = {
    on(event, handler) { const list = hooks.get(event) || []; list.push(handler); hooks.set(event, list); },
    registerCommand(name, command) { commands.set(name, command); },
    getSettings: () => settings,
    getSessionName: () => current || undefined,
    setSessionName(name) { current = name; names.push(name); },
    appendEntry(customType, data) { entries.push({ type: 'custom', customType, data }); },
    events: { on: () => () => {}, emit() {} },
  };
  const sessionEntries = [{ type: 'message', message: { role: 'user', content: [{ type: 'text', text: '帮我修复登录回调的 500 错误' }], timestamp: 1 } }];
  const registry = {
    find: () => model ? { provider: 'test', id: 'naming', name: 'Naming' } : undefined,
    complete: async (_model, context, options) => { calls.push({ context, options }); if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return { stopReason: 'stop', content: [{ type: 'text', text: answer }] }; },
  };
  const ctx = {
    cwd: homedir(), signal: undefined,
    model: model ? { provider: 'test', id: 'session', name: 'Session' } : undefined,
    modelRegistry: registry,
    sessionManager: { getSessionId: () => 'session-1', getBranch: () => sessionEntries, getEntries: () => sessionEntries },
    ui: { notify: (message, type) => notifications.push({ message, type }) },
  };
  naming.installSessionNaming(pi);
  const emit = async (event, payload) => { let result; for (const handler of hooks.get(event) || []) result = await handler(payload, ctx); return result; };
  const settle = () => new Promise(resolve => setTimeout(resolve, 30));
  return { pi, ctx, names, entries, notifications, calls, commands, emit, settle, current: () => current };
}

test('title helpers clamp, strip quotes and remove polite prefixes', () => {
  assert.equal(naming.cleanTitle('"修复登录回调"', 28), '修复登录回调');
  assert.equal(naming.cleanTitle('Title: retry wrapper\nignored line', 28), 'retry wrapper');
  assert.equal(naming.cleanTitle('  - 重构  权限模块。 ', 28), '重构 权限模块');
  assert.equal(naming.heuristicTitle('请帮我修复登录回调的 500 错误，另外再看日志', 28), '修复登录回调的 500 错误');
  assert.equal(naming.heuristicTitle('please add a retry wrapper for the upload job and tests', 20), 'add a retry wrapper');
  assert.equal(Array.from(naming.heuristicTitle('一'.repeat(80), 12)).length, 12);
});

test('first interactive instruction names the session once, without blocking the turn', async () => {
  const h = harness({ delay: 20 });
  const result = await h.emit('input', { source: 'interactive', text: '帮我修复登录回调的 500 错误', images: [] });
  assert.equal(result?.action, 'continue');
  assert.equal(h.names.length, 0, 'the turn returns before the naming call resolves');
  await h.settle();
  assert.deepEqual(h.names, ['登录回调 500 错误']);
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].context.systemPrompt, /at most 28 characters/);
  assert.match(h.calls[0].context.messages[0].content[0].text, /First user request: 帮我修复登录回调/);
  assert.equal(h.entries[0].data.kind, 'auto');
  await h.emit('input', { source: 'interactive', text: '再试一次', images: [] });
  await h.settle();
  assert.equal(h.names.length, 1, 'later turns never rename a named session');
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
  const h = harness();
  await h.emit('session_info_changed', { name: 'my own name' });
  await h.emit('input', { source: 'interactive', text: '帮我修复登录回调的 500 错误', images: [] });
  await h.settle();
  assert.equal(h.names.length, 0);
  assert.equal(h.calls.length, 0);
});

test('/auto-rename names from the conversation and accepts an explicit name', async () => {
  const h = harness();
  await h.commands.get('auto-rename').handler('', h.ctx);
  assert.deepEqual(h.names, ['登录回调 500 错误']);
  assert.equal(h.notifications.at(-1).message, 'Session named: 登录回调 500 错误');
  assert.match(h.calls[0].context.messages[0].content[0].text, /First user request: 帮我修复登录回调/);
  await h.commands.get('auto-rename').handler('权限模块重构', h.ctx);
  assert.equal(h.current(), '权限模块重构');
  assert.equal(h.entries.at(-1).data.kind, 'lock');
});

test('/auto-rename off disables naming until it is turned back on', async () => {
  const h = harness();
  await h.commands.get('auto-rename').handler('off', h.ctx);
  await h.emit('input', { source: 'interactive', text: '帮我修复登录回调的 500 错误', images: [] });
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
  await h.emit('input', { source: 'interactive', text: '帮我修复登录回调的 500 错误', images: [] });
  await h.settle();
  assert.equal(h.names[0], '登录回调 500 错误');
  assert.match(h.calls[0].context.systemPrompt, /at most 12 characters/);
  assert.equal(h.calls[0].options.maxTokens, 48);
  const repeat = harness({ answer: '同一个名字' });
  await repeat.emit('input', { source: 'interactive', text: '第一个任务', images: [] });
  await repeat.settle();
  await repeat.emit('session_info_changed', { name: '同一个名字' });
  await repeat.emit('input', { source: 'interactive', text: '第二个任务', images: [] });
  await repeat.settle();
  assert.deepEqual(repeat.names, ['同一个名字']);
});

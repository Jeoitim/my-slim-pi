import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
process.env.PI_OFFLINE = '1';
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const sdk = await import(pathToFileURL(join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/index.js')));
const { initTheme } = await import(pathToFileURL(join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js')));
initTheme('claude-warm');
const started = performance.now();
const loader = new sdk.DefaultResourceLoader({ cwd: homedir(), agentDir: root, noContextFiles: true });
await loader.reload();
console.log('Loader ms:', Math.round(performance.now() - started));
console.log('Extension errors:', JSON.stringify(loader.getExtensions().errors));
console.log('Theme diagnostics:', JSON.stringify(loader.getThemes().diagnostics));
console.log('Skills:', loader.getSkills().skills.map(s => s.name).join(', '));
assert.equal(loader.getExtensions().errors.length, 0);
assert.equal(loader.getThemes().diagnostics.length, 0);
assert.ok(loader.getSkills().skills.some(s => s.name === 'pi-maintenance' && s.filePath.replaceAll('\\', '/').endsWith('/skills/pi-maintenance/SKILL.md')), 'native loader discovers the local maintenance skill');
assert.equal(loader.getSkills().diagnostics.length, 0);
const { session } = await sdk.createAgentSession({ cwd: homedir(), agentDir: root, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(homedir()) });
const errors = [];
session.extensionRunner.onError(e => { errors.push(e); console.log('Runtime error:', JSON.stringify(e)); });
try {
  await session.bindExtensions({ mode: 'json' });
  const ui = session.extensionRunner.getUIContext();
  session.extensionRunner.setUIContext(new Proxy(ui, { get(target, key) { if (key === 'notify') return (message, type) => console.log('UI', type, message); if (key === 'select') return async (title, rows, ...args) => { console.log('Selection required:', title); return target.select(title, rows, ...args); }; return Reflect.get(target, key); } }), 'json');
  await new Promise(r => setTimeout(r, 50));
  console.log('Active tools:', JSON.stringify(session.getActiveToolNames()));
  assert.ok(session.extensionRunner.getCommand('btw'), 'native BTW package command is registered');
  assert.ok(session.extensionRunner.getCommand('notify-test'), 'terminal reminder check is registered');
  assert.ok(session.getActiveToolNames().includes('powershell'), 'native PowerShell is active');
  assert.ok(!session.getActiveToolNames().includes('bash'), 'WSL Bash is not a default tool');
  assert.ok(!session.getActiveToolNames().some(n => /^(?:subagent|subagents_enable|set_approval_mode|replace_match|move|copy|edit)$/.test(n)));
  assert.ok(session.getActiveToolNames().includes('replace'));
  await session.extensionRunner.emitInput('帮我修复普通开发问题，读取需要的 Principal build 技能。', undefined, 'interactive');
  assert.ok(!session.getAllTools().some(t => t.name === 'subagent'));
  const policy = readFileSync(join(root, 'APPEND_SYSTEM.md'), 'utf8');
  const before = await session.extensionRunner.emitBeforeAgentStart({ messageType: 'user', prompt: '普通开发验证，不调用模型' }, { cwd: homedir(), selectedTools: session.getActiveToolNames(), appendSystemPrompt: policy });
  assert.ok(!before.systemPromptOptions.forceSystemPrompt, 'preserve structured system prompt caching');
  assert.match(before.systemPromptOptions.sections['timrt-permissions'], /默认当前会话/);
  assert.doesNotMatch(policy, /界面中的模型名称|name.*id/);
  console.log('Structured behavioral policy contains no TUI naming rule: OK');
  const deletionModeCommand = session.extensionRunner.getCommand('approval-mode');
  const deletionModeHandler = deletionModeCommand.handler || deletionModeCommand.command?.handler;
  await deletionModeHandler('plan', session.extensionRunner.createContext());
  const nativeRead = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-powershell-read', toolName: 'powershell', input: { command: 'Get-PSDrive | Select-Object Name,Used,Free' } });
  assert.ok(!nativeRead?.block, 'PLAN allows a literal PowerShell read pipeline');
  const nativeDelete = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-powershell-delete', toolName: 'powershell', input: { command: "Remove-Item -LiteralPath './cache' -Recurse" } });
  assert.ok(nativeDelete?.block, 'PLAN blocks native PowerShell deletion');
  for (const command of ['rm -rf ./cache', 'Remove-Item -Recurse ./cache', 'find . -name x -delete', 'python -c "import shutil; shutil.rmtree(\'cache\')"', 'git clean -fd', 'for f in *.tmp; do rm "$f"; done']) {
    const blocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-delete', toolName: 'bash', input: { command } });
    assert.ok(blocked?.block, command);
  }
  await deletionModeHandler('auto', session.extensionRunner.createContext());
  const readonly = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-read', toolName: 'read', input: { path: 'README.md' } });
  assert.ok(!readonly?.block);
  const modeBlocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-escalation', toolName: 'set_approval_mode', input: { mode: 'act' } });
  assert.ok(modeBlocked?.block);
  const ctx = session.extensionRunner.createToolContext('verification', undefined);
  const recall = session.extensionRunner.getToolDefinition('memory_search');
  const memory = await recall.execute('verify-memory', { query: 'timrt', limit: 3 }, undefined, undefined, ctx);
  assert.ok(!memory.isError, JSON.stringify(memory.content));
  console.log('Memory recall: OK');
  const memoryOwner = { role: 'assistant', content: [{ type: 'toolCall', id: 'verification', name: 'memory', arguments: { action: 'search', query: 'timrt' } }], api: 'openai-completions', provider: 'verification', model: 'verification', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() };
  memoryOwner.content[0].id = 'memory-verification';
  session.agent.state.messages.push(memoryOwner); session.sessionManager.appendMessage(memoryOwner);
  const memoryCtx = session.extensionRunner.createToolContext('memory-verification', undefined);
  const gateway = await session.extensionRunner.getToolDefinition('memory').execute('check-memory-gateway', { action: 'search', query: 'timrt' }, undefined, undefined, memoryCtx);
  assert.equal(gateway.isError === true, memory.details?.success === false, JSON.stringify(gateway.content));
  console.log('Memory gateway nested recall: OK');
  const temp = mkdtempSync(join(tmpdir(), 'pi-hashline-check-'));
  const target = join(temp, 'sample.txt');
  writeFileSync(target, 'alpha\nbeta\ngamma\n');
  const read = session.extensionRunner.getToolDefinition('read');
  const anchored = await read.execute('check-anchor-read', { path: target }, undefined, undefined, ctx);
  const anchoredText = anchored.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  console.log('Anchored read:', anchoredText.slice(0, 180));
  const anchor = anchoredText.match(/([a-zA-Z0-9]{4})\|beta/)?.[1] || anchoredText.match(/([a-zA-Z0-9]{4})[^\n]*beta/)?.[1];
  assert.ok(anchor, 'anchored read emits a four-character line anchor');
  writeFileSync(target, 'alpha\nbeta changed by another writer\ngamma\n');
  let stale;
  try { stale = await session.extensionRunner.getToolDefinition('replace').execute('check-stale', { path: target, remove_from: anchor, remove_to: anchor, text: 'replacement' }, undefined, undefined, ctx); }
  catch (error) { stale = { isError: true, content: [{ text: error.message }] }; }
  assert.ok(stale.isError || /stale|mismatch|changed|anchor/i.test(JSON.stringify(stale.content)));
  assert.match(readFileSync(target, 'utf8'), /beta changed by another writer/);
  console.log('Stale anchor rejected without modifying the file: OK');
  const fresh = await read.execute('check-fresh', { path: target }, undefined, undefined, ctx);
  const freshText = fresh.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  const freshAnchor = freshText.match(/([a-zA-Z0-9]{4})[^\n]*beta changed/)?.[1];
  assert.ok(freshAnchor);
  const replaced = await session.extensionRunner.getToolDefinition('replace').execute('check-valid-replace', { path: target, remove_from: freshAnchor, remove_to: freshAnchor, text: 'beta safely replaced' }, undefined, undefined, ctx);
  assert.ok(!replaced.isError, JSON.stringify(replaced.content));
  assert.equal(readFileSync(target, 'utf8'), 'alpha\nbeta safely replaced\ngamma\n');
  console.log('Fresh anchors allow the intended single-line edit: OK');
  const modeCommand = session.extensionRunner.getCommand('approval-mode');
  const handler = modeCommand.handler || modeCommand.command?.handler;
  assert.ok(handler, 'permission command is registered');
  await handler('plan', session.extensionRunner.createContext());
  const deniedWrite = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-plan-write', toolName: 'write', input: { path: target, content: 'no' } });
  assert.ok(deniedWrite?.block);
  await handler('auto', session.extensionRunner.createContext());
  console.log('PLAN blocks writes; user command restores AUTO: OK');
  const status = await session.extensionRunner.getToolDefinition('mcp').execute('check-lazy-status', {}, undefined, undefined, ctx);
  const statusText = status.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  console.log('MCP before use:', statusText.slice(0, 350));
  if (process.argv.includes('--auto-review')) {
    const blocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-auto-review', toolName: 'write', input: { path: target, content: 'scoped local test file' } });
    console.log('Auto approval outcome:', blocked || 'approved');
    assert.ok(!blocked?.block, 'tool-free internal Auto reviewer approves a scoped local edit');
  }
  if (process.argv.includes('--live-web') || process.argv.includes('--live-brave')) {
    const liveProvider = process.argv.includes('--live-brave') ? 'brave' : 'exa-mcp';
    const assistant = { role: 'assistant', content: [{ type: 'toolCall', id: 'verification', name: 'web', arguments: {} }], api: 'openai-completions', provider: 'verification', model: 'verification', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() };
    session.agent.state.messages.push(assistant); session.sessionManager.appendMessage(assistant);
    const result = await session.extensionRunner.getToolDefinition('web').execute('check-web', { action: 'search', query: 'site:pi.dev coding agent themes', provider: liveProvider }, undefined, undefined, ctx);
    console.log('Web route:', result.details?.provider, 'isError:', result.isError || false);
    const text = result.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
    console.log('Web preview:', text.slice(0, 220));
    assert.ok(!result.isError && /https?:/.test(text));
    assert.equal(result.details.provider, liveProvider);
  }
  if (process.argv.includes('--load-subagents')) {
    // Load/register only. Do not call subagent or start any child/model run.
    await session.extensionRunner.emitInput('请使用子代理协助检查，当前验证只加载组件，不执行子任务。', undefined, 'interactive');
    assert.ok(session.getAllTools().some(t => t.name === 'subagent'), 'manual request loads package');
    console.log('Manual subagent registration: OK (no child run)');
    await session.extensionRunner.emitInput('现在继续普通开发。', undefined, 'interactive');
    assert.ok(!session.getActiveToolNames().some(n => /^(?:subagent|subagents_enable|subagent_supervisor)$/.test(n)));
    const blocked = await session.extensionRunner.emitToolCall({ type: 'tool_call', toolCallId: 'check-subagent', toolName: 'subagent', input: {} });
    assert.ok(blocked?.block);
  }
  assert.equal(errors.length, 0);
  console.log('Component integration checks passed.');
} finally {
  await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' });
  session.dispose();
}

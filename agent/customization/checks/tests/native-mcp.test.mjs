import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Explicit isolated AgentRoot only: never fall back to the user's installation.
const root = process.env.PI_CODING_AGENT_DIR;
if (!root) throw Error('Set PI_CODING_AGENT_DIR to an isolated test installation.');
mkdirSync(join(root, 'cache'), { recursive: true });
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const modules = join(root, 'install/releases', version, 'node_modules');
const host = join(modules, '@earendil-works/pi-coding-agent/dist');
const sdk = await import(pathToFileURL(join(host, 'index.js')));
const { createMcpExtension } = sdk;
const { createInMemoryTransportPair } = await import(pathToFileURL(join(modules, '@earendil-works/pi-mcp/dist/transports/in-memory.js')));
const { initTheme } = await import(pathToFileURL(join(host, 'modes/interactive/theme/theme.js')));
initTheme('claude-warm');
const { createJiti } = await import(pathToFileURL(join(modules, 'jiti/lib/jiti.mjs')));
const jiti = createJiti(import.meta.url, { alias: {
  typebox: join(modules, 'typebox/build/index.mjs'),
  '@earendil-works/pi-coding-agent': join(host, 'index.js'),
  '@earendil-works/pi-ai': join(modules, '@earendil-works/pi-ai/dist/compat.js'),
  '@earendil-works/pi-tui': join(modules, '@earendil-works/pi-tui/dist/index.js'),
} });
const { installPermissions } = await jiti.import(join(root, 'extensions/timrt-suite/permissions.ts'));
const { EXA_TOOLS, executeExa, exaReadPolicy } = await jiti.import(join(root, 'extensions/timrt-suite/native-exa.ts'));
const { runWeb } = await jiti.import(join(root, 'extensions/timrt-suite/web-route.ts'));
const exaConfig = JSON.parse(readFileSync(join(root, 'mcp.json'), 'utf8')).mcpServers.exa;

test('native MCP readiness, real nested pipeline, four modes and untrusted hints', async () => {
  const cwd = mkdtempSync(join(root, 'cache/native-mcp-'));
  const calls = [], reviews = [], hooks = [];
  let allow = true, failure = false, paid = 0;
  const transport = () => {
    const { client, server } = createInMemoryTransportPair();
    server.onMessage(async message => {
      if (!('id' in message)) return;
      let result;
      if (message.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'offline-fixture', version: '1' } };
      else if (message.method === 'tools/list') result = { tools: ['web_search_exa', 'web_fetch_exa', 'delete_file', 'unknown_read'].map(name => ({ name, description: 'Offline test tool', inputSchema: { type: 'object', additionalProperties: true }, annotations: { readOnlyHint: true } })) };
      else if (message.method === 'tools/call') {
        calls.push(message.params.name);
        if (message.params.arguments?.query === 'cancel') return;
        result = failure ? { isError: true, content: [{ type: 'text', text: 'rate limited' }] } : { content: [{ type: 'text', text: 'Docs https://pi.dev/docs' }] };
      }
      else result = {};
      await server.send({ jsonrpc: '2.0', id: message.id, result });
    });
    void server.start(); return client;
  };
  let state;
  const factory = pi => {
    pi.on('tool_call', e => { hooks.push({ name: e.toolName, parent: e.parentToolCallId }); });
    state = installPermissions(pi, async (_ctx, name) => { reviews.push(name); return { approved: allow, source: 'fixture' }; });
    pi.registerTool({ name: 'web', label: 'Web fixture', description: 'Offline web router', parameters: { type: 'object', additionalProperties: true }, reachesTools: () => EXA_TOOLS,
      async execute(_id, params, signal, _update, ctx) {
        const answer = await runWeb(params, { keys: { tavily: 'fixture-only' }, mcp: (action, input, sig) => executeExa(ctx, action, input, sig), post: async () => { paid++; return { results: [{ title: 'fallback', url: 'https://pi.dev', content: 'docs' }] }; } }, signal);
        return { content: [{ type: 'text', text: answer.text }] };
      },
    });
  };
  const mcp = createMcpExtension({ loadConfig: () => ({ servers: [{ name: 'exa', source: join(root, 'mcp.json'), scope: 'global', config: { ...exaConfig, exposure: 'deferred', toolExposure: {} } }], errors: [] }), createTransport: transport });
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir: root, noExtensions: true, noSkills: true, noContextFiles: true, extensionFactories: [mcp, sdk.createToolSearchExtension(), sdk.createCodemodeExtension(), factory] });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await sdk.createAgentSession({ cwd, agentDir: root, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(cwd) });
  try {
    await session.bindExtensions({ mode: 'json', onError: e => { throw Error(JSON.stringify(e)); } });
    const runner = session.extensionRunner;
    const assistant = { role: 'assistant', content: [{ type: 'toolCall', id: 'fixture-parent', name: 'web', arguments: {} }], api: 'openai-completions', provider: 'fixture', model: 'fixture', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() };
    session.agent.state.messages.push(assistant); session.sessionManager.appendMessage(assistant);
    const context = runner.createToolContext('fixture-parent');
    const mode = value => runner.getCommand('approval-mode').handler(value, runner.createCommandContext());
    const invoke = (name, args = {}) => context.executeTool(name, args);
    const search = { action: 'search', query: 'official docs' };
    // First wrapper call races connection: reachesTools must wait and register the tools.
    let result = await invoke('web', search);
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.deepEqual(calls, ['web_search_exa'], JSON.stringify({result, hooks, tools: session.getAllTools().map(t => t.name)}));
    assert.equal(reviews.length, 0, 'AUTO does not review the trusted read twice');
    assert.ok(hooks.some(h => h.name === EXA_TOOLS[0] && h.parent), 'native nested call reaches real tool_call hooks');
    assert.ok(!session.getActiveToolNames().some(n => n.startsWith('mcp__')), 'deferred schemas are not default declarations');
    for (const value of ['act', 'plan']) {
      await mode(value);
      assert.equal((await invoke(EXA_TOOLS[1], { urls: ['https://pi.dev'] })).isError, false);
    }
    const before = calls.length;
    assert.equal((await invoke('mcp__exa__unknown_read')).isError, true, 'PLAN rejects unverified readOnlyHint');
    assert.equal((await invoke('mcp__exa__delete_file', { path: join(cwd, 'cache') })).isError, true);
    assert.equal(calls.length, before, 'denied calls never reach server');
    const codeParent = { ...assistant, content: [{ type: 'toolCall', id: 'fixture-codemode', name: 'codemode', arguments: {} }] };
    session.agent.state.messages.push(codeParent); session.sessionManager.appendMessage(codeParent);
    const nestedBefore = hooks.filter(h => h.name === 'mcp__exa__unknown_read').length;
    const codeResult = await runner.getToolDefinition('codemode').execute('fixture-codemode', { code: 'text(await tools.mcp__exa__unknown_read({}));' }, undefined, undefined, runner.createToolContext('fixture-codemode'));
    assert.equal(hooks.filter(h => h.name === 'mcp__exa__unknown_read').length, nestedBefore + 1, 'actual codemode executor reaches permission hooks: ' + JSON.stringify(codeResult));
    assert.equal(calls.length, before, 'codemode cannot evade PLAN');
    await mode('auto'); allow = false;
    assert.equal((await invoke('mcp__exa__unknown_read')).isError, true);
    assert.equal(reviews.length, 1);
    await mode('ask');
    assert.equal((await invoke(EXA_TOOLS[0], { query: 'docs' })).isError, true, 'ASK without UI cannot execute');
    assert.equal(calls.length, before);
    const baseUi = runner.getUIContext(); let confirmations = 0;
    runner.setUIContext(new Proxy(baseUi, { get: (target, key) => key === 'confirm' ? async () => { confirmations++; return true; } : Reflect.get(target, key) }), 'tui');
    assert.equal((await invoke(EXA_TOOLS[0], { query: 'docs' })).isError, false);
    assert.equal((await invoke(EXA_TOOLS[0], { query: 'docs' })).isError, false);
    assert.equal(confirmations, 2, 'ASK confirms each native call independently');
    runner.setUIContext(baseUi, 'json');
    await mode('auto');
    failure = true;
    result = await invoke('web', search);
    assert.equal(result.isError, false); assert.equal(paid, 1, 'actual server errors retain serial fallback');
    failure = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    result = await context.executeTool('web', { ...search, query: 'cancel' }, { signal: controller.signal });
    clearTimeout(timer);
    assert.equal(result.isError, true); assert.equal(paid, 1, 'cancellation never spends fallback credits');
    // A project can reuse the name; this must revoke the read-only exemption.
    mkdirSync(join(cwd, '.pi')); writeFileSync(join(cwd, '.pi/mcp.json'), JSON.stringify({ mcpServers: { exa: { url: 'https://untrusted.invalid/mcp' } } }));
    result = await invoke('web', search);
    assert.equal(result.isError, true, 'nested permission denial stops web');
    assert.equal(paid, 1, 'denial cannot trigger paid fallback');
    assert.equal(state.mode, 'auto');
  } finally { await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); session.dispose(); }
});

test('Exa exemption requires pinned configuration and rejects lookalikes', () => {
  const dir = mkdtempSync(join(root, 'cache/exa-provenance-'));
  const project = join(dir, 'project'); mkdirSync(project);
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { exa: exaConfig } }));
  const policy = exaReadPolicy(dir, project);
  assert.equal(policy.readOnly(EXA_TOOLS[0], project), true);
  assert.equal(policy.readOnly('mcp__exa__delete_file', project), false);
  assert.equal(policy.readOnly('mcp__other__web_search_exa', project), false);
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { exa: { url: 'https://untrusted.invalid' } } }));
  assert.equal(policy.readOnly(EXA_TOOLS[0], project), false);
  assert.equal(exaReadPolicy(dir, project).readOnly(EXA_TOOLS[0], project), false);
});

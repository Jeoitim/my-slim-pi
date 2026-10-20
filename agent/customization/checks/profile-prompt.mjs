// Captures a fresh request using a local fake provider. No network/model request is sent.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
process.env.PI_OFFLINE = '1';
process.env.PI_HASHLINE_DIR ??= join(root, 'pi-hashline-edit-pro');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const modules = join(root, 'install/releases', version, 'node_modules');
const sdk = await import(pathToFileURL(join(modules, '@earendil-works/pi-coding-agent/dist/index.js')));
const ai = await import(pathToFileURL(join(modules, '@earendil-works/pi-ai/dist/compat.js')));
const { initTheme } = await import(pathToFileURL(join(modules, '@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js')));
initTheme('claude-warm');
const prompt = process.argv.find(a => a.startsWith('--prompt='))?.slice(9) || 'hello';
const tag = process.argv.find(a => a.startsWith('--tag='))?.slice(6) || 'current';
let captured;
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const model = { id: 'audit', name: 'Offline prompt audit', provider: 'timrt-context-audit', api: 'openai-completions', input: ['text'], reasoning: false, contextWindow: 1000000, maxTokens: 100, cost: zero.cost };
if (process.argv.includes('--dynamic-model')) model.compat = { supportsMidConvoSystemMessages: true, supportsMidConvoToolAdditions: true };
const capture = pi => pi.registerProvider('timrt-context-audit', { baseUrl: 'http://127.0.0.1:1', apiKey: 'capture-only', api: 'openai-completions', models: [model], streamSimple: (_model, context) => {
  captured = context;
  const stream = ai.createAssistantMessageEventStream();
  const message = { role: 'assistant', content: [{ type: 'text', text: 'offline audit' }], api: model.api, provider: model.provider, model: model.id, usage: structuredClone(zero), stopReason: 'stop', timestamp: Date.now() };
  queueMicrotask(() => { stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: 'stop', message }); stream.end(); });
  return stream;
} });
const loader = new sdk.DefaultResourceLoader({ cwd: homedir(), agentDir: root, extensionFactories: [capture, sdk.createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) })] });
await loader.reload();
if (loader.getExtensions().errors.length) throw Error(JSON.stringify(loader.getExtensions().errors));
const { session } = await sdk.createAgentSession({ model, cwd: homedir(), agentDir: root, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(homedir()) });
try {
  await session.bindExtensions({ mode: 'json' });
  const resolved = session.extensionRunner.createContext().modelRegistry.find('timrt-context-audit', 'audit');
  if (!resolved) throw Error('Offline model was not registered');
  await session.setModel(resolved);
  await session.prompt(prompt);
  if (!captured) throw Error('No request captured: ' + JSON.stringify(session.agent.state.messages.filter(m => m.role === 'assistant').map(m => ({ error: m.errorMessage, provider: m.provider, model: m.model }))));
  const sections = {};
  const tools = new Map();
  let conversationChars = 0;
  for (const m of captured.messages || []) {
    if (m.role === 'system') {
      Object.assign(sections, Object.fromEntries(Object.entries(m.sections || {}).filter(([, v]) => typeof v === 'string')));
      if (typeof m.content === 'string' && m.content) sections.opaque = m.content;
      for (const t of m.toolsAdded || []) tools.set(t.name, t);
      for (const n of m.toolsRemoved || []) tools.delete(n);
    } else conversationChars += JSON.stringify(m.content).length;
  }
  if (captured.systemPrompt) sections.legacy = captured.systemPrompt;
  for (const t of captured.tools || []) tools.set(t.name, t);
  const result = { tag, prompt, measuredAt: new Date().toISOString(), noNetwork: true, mcpConnections: "disabled for offline sampling; excludes live server section", sections: Object.entries(sections).map(([name, text]) => ({ name, chars: text.length })), tools: [...tools.values()].map(t => ({ name: t.name, chars: JSON.stringify(t).length })), contextFiles: loader.getAgentsFiles().agentsFiles.map(f => ({ path: f.path, chars: f.content.length, claudeMemoryChars: f.content.match(/<claude-mem-context>[\s\S]*?<\/claude-mem-context>/g)?.reduce((n, s) => n + s.length, 0) || 0 })), conversationChars };
  result.systemChars = result.sections.reduce((n, s) => n + s.chars, 0);
  result.toolSchemaChars = result.tools.reduce((n, t) => n + t.chars, 0);
  result.totalChars = result.systemChars + result.toolSchemaChars + conversationChars;
  console.log(JSON.stringify(result, null, 2));
} finally { await new Promise(r => setTimeout(r, 100)); await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'exit' }); session.dispose(); }

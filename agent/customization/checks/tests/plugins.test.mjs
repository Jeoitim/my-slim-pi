import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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

test('rounded composer fits narrow and wide terminals without wrapping metrics', async () => {
  const { frame, usageOf } = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/composer.ts'));
  const { visibleWidth } = await jiti.import(join(modules, '@earendil-works/pi-tui/dist/index.js'));
  for (const width of [4, 20, 40, 60, 80, 120, 180]) {
    const line = frame(width, ' ◷ 5s · DeepSeek Pro · ✦ max ', ' ◈ AUTO ', s => s, true);
    assert.equal(visibleWidth(line), width);
    assert.ok(line.startsWith('╭') && line.endsWith('╮'));
  }
  const u = usageOf([{ type: 'message', message: { role: 'assistant', usage: { input: 1000, output: 200, cacheRead: 8000, cost: { total: .1 } } } }, { type: 'usage', usage: { input: 300, output: 20, cost: { total: .02 } } }]);
  assert.equal(u.input, 1300); assert.equal(u.output, 220); assert.equal(u.cacheRead, 8000); assert.ok(Math.abs(u.cost - .12) < 1e-12);
});

test('composer displays model name verbatim and permission colors stay distinct', async () => {
  const { installComposer } = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/composer.ts'));
  const { permissionBadge } = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/permissions.ts'));
  const { visibleWidth } = await jiti.import(join(modules, '@earendil-works/pi-tui/dist/index.js'));
  for (const appearance of ['light', 'dark']) assert.equal(new Set(['auto', 'act', 'ask', 'plan'].map(m => permissionBadge(m, appearance).match(/\x1b\[38;2;[^m]+m/)[0])).size, 4);
  const hooks = new Map(); let editor,headerKeys;
  const theme = { name: 'test', appearance: 'dark', fg: (_c, s) => s };
  const tui = { terminal: { rows: 30, columns: 120, write() {} }, requestRender() {}, queryTerminalColors: async () => ({}) };
  const ctx = { cwd: homedir(), model: { id: 'wrong-id', name: 'DeepSeek V4.1 Flash', reasoning: true, contextWindow: 1000000, cost: {} }, getContextUsage: () => ({ percent: 2, contextWindow: 1000000 }), sessionManager: { getBranch: () => [] }, ui: { theme, getAllThemes: () => [], setHeader() {}, setFooter(factory) { factory(tui, theme, { onBranchChange: () => () => {}, getGitBranch: () => null }); }, setEditorComponent(factory) { editor = factory(tui, { borderColor: s => s }, { matches: () => false }); } } };
  const pi = { on(e, fn) { const list = hooks.get(e) || []; list.push(fn); hooks.set(e, list); }, registerCommand() {}, getThinkingLevel: () => 'high', events: { on: () => () => {}, emit() {} } };
  installComposer(pi, { mode: 'auto', taskAgents: false }, keys=>{headerKeys=keys;});
  for (const fn of hooks.get('session_start')) await fn({}, ctx);
  await new Promise(r => setTimeout(r, 10));
  assert.ok(headerKeys,'the public editor factory supplies header keybindings');
  editor.setText('中文输入 🙂');
  for (const width of [40, 80, 120]) {
    const lines = editor.render(width);
    assert.ok(lines.every(l => visibleWidth(l) <= width));
    assert.ok(lines.some(l => l.includes('中文输入')));
  }
  const lines = editor.render(120);
  assert.match(lines[0], /DeepSeek V4\.1 Flash/);
  assert.doesNotMatch(lines[0], /wrong-id/);
  assert.ok(lines[1].startsWith('│') && lines[1].endsWith('│'));
  for (const fn of hooks.get('session_shutdown')) await fn({}, ctx);
});

test('delegation consent is an explicit semantic reviewer result, not a text matcher', async () => {
  const { parseDecision } = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/approval-reviewer.ts'));
  for(const taskAgentAuthorization of ['grant','revoke','unchanged']) {
    assert.equal(parseDecision(JSON.stringify({approved:true,confidence:1,reason:'fixture',taskAgentAuthorization})).taskAgentAuthorization,taskAgentAuthorization);
  }
  assert.equal(parseDecision('{"approved":true,"confidence":1,"reason":"use subagents"}').taskAgentAuthorization,undefined);
});

test('bulk deletion is detected across common shells, scripts and SQL for approval', async () => {
  const { deletionRisk, scriptDeletionRisk } = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/guards.ts'));
  for (const s of ['rm -rf cache', 'rm *.log', 'rm a.txt b.txt', 'rm a; rm b', 'Remove-Item -Recurse cache', 'Get-ChildItem | Remove-Item', 'shutil.rmtree(path)', 'fs.rmSync(path, {recursive:true})', 'fs.promises.rm(path,{recursive:true})', 'for p in paths: os.unlink(p)', 'git clean -fd', 'robocopy a b /MIR', 'DELETE FROM records', 'find . -delete']) assert.equal(deletionRisk(s), true, s);
  for (const s of ['git status --short', 'rg delete src', 'rm one.tmp', 'Remove-Item -LiteralPath one.tmp', 'npm test']) assert.equal(deletionRisk(s), false, s);
  const dir = mkdtempSync(join(tmpdir(), 'pi-deletion-policy-'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(dir, 'cleanup.py'), 'import shutil\nshutil.rmtree("cache")\n');
  assert.equal(scriptDeletionRisk('python cleanup.py', dir), true);
});

test('PowerShell literal reads cannot hide execution in expressions or pipeline stages', async () => {
  const { safeShellRead } = await jiti.import(join(agentDir, 'extensions/my-slim-pi-suite/guards.ts'));
  for (const command of [
    "Get-ChildItem -LiteralPath 'C:\\Users\\example' -Force",
    'Get-PSDrive | Select-Object Name,Used,Free | ConvertTo-Json',
  ]) assert.equal(safeShellRead(command, 'powershell'), true, command);
  for (const command of [
    'Get-Item $(Set-Content x y)',
    'Get-ChildItem | ForEach-Object { Remove-Item $_ -Recurse }',
    'Get-Location; Set-Content x y',
    'Get-Content file.txt > other.txt',
    'Get-ChildItem | Out-File out.txt',
    'Get-ChildItem | & pwsh -Command x',
    'Get-Content *.json',
    'Get-Location || Set-Content x y',
    'Get-ChildItem |',
  ]) assert.equal(safeShellRead(command, 'powershell'), false, command);
});

test('Hermes can create, revise and reload a reusable skill in isolated storage', async () => {
  const { SkillStore } = await jiti.import(join(agentDir, 'npm', 'node_modules', 'pi-hermes-memory', 'src', 'store', 'skill-store.ts'));
  const root = mkdtempSync(join(tmpdir(), 'pi-skill-verification-'));
  const options = { globalSkillsDir: join(root, 'skills'), piGlobalSkillsDir: join(root, 'pi-skills'), legacySkillsDir: join(root, 'legacy'), migrationSentinelPath: join(root, 'migration-marker'), projectSkillsDir: null };
  const store = new SkillStore(options);
  const created = await store.create('verify-web-cache', 'Use when checking native search content storage.', '## Procedure\n1. Verify free search.\n\n## Verification\n1. Confirm source URLs.', 'global');
  assert.equal(created.success, true, created.error);
  const patched = await store.patch('global:verify-web-cache', 'Verification', '1. Confirm source URLs.\n2. Check fallback only runs when needed.');
  assert.equal(patched.success, true, patched.error);
  const reopened = new SkillStore(options);
  const saved = await reopened.loadSkill('global:verify-web-cache');
  assert.ok(saved);
  assert.match(readFileSync(join(root, 'skills', 'verify-web-cache', 'SKILL.md'), 'utf8'), /Check fallback only runs/);
});

test('Chinese correction rules recognize explicit steering without flagging ordinary questions', async () => {
  const { isCorrection } = await jiti.import(join(agentDir, 'npm', 'node_modules', 'pi-hermes-memory', 'src', 'handlers', 'correction-detector.ts'));
  const config = JSON.parse(readFileSync(join(agentDir, 'hermes-memory-config.json'), 'utf8'));
  assert.equal(isCorrection('以后不要增加重复的工具', config), true);
  assert.equal(isCorrection('我说的是使用现成插件', config), true);
  assert.equal(isCorrection('今天可以使用什么搜索服务？', config), false);
});

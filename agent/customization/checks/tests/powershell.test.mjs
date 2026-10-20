import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent');
const version = readFileSync(join(root, 'install/current-version'), 'utf8').trim();
const sdk = join(root, 'install/releases', version, 'node_modules/@earendil-works/pi-coding-agent/dist');

test('configured native Bash runs Linux commands with POSIX paths and UTF-8', {skip:process.platform!=='linux'},async()=>{
  const {createBashToolDefinition}=await import(pathToFileURL(join(sdk,'core/tools/bash.js')));
  const cwd=mkdtempSync(join(tmpdir(),'pi-native-bash-')),tool=createBashToolDefinition(cwd);
  const result=await tool.execute('native-bash-check',{command:'printf "中文写入\\n" > ./原生验证.txt; pwd; cat ./原生验证.txt',timeout:20});
  assert.ok(!result.isError);assert.equal(readFileSync(join(cwd,'原生验证.txt'),'utf8').trim(),'中文写入');
  assert.ok(result.content.some(c=>c.type==='text' && c.text.includes(cwd)));
});

test('configured native PowerShell tool runs pwsh 7 with Windows paths and UTF-8', { skip: process.platform !== 'win32' }, async () => {
  const { getPowerShellConfig } = await import(pathToFileURL(join(sdk, 'utils/shell.js')));
  const config = getPowerShellConfig();
  assert.match(config.shell, /pwsh\.exe$/i);
  assert.ok(config.args.includes('-NoProfile') && config.args.includes('-NonInteractive'));
  const { createPowerShellToolDefinition } = await import(pathToFileURL(join(sdk, 'core/tools/powershell.js')));
  const cwd = mkdtempSync(join(tmpdir(), 'pi-native-pwsh-'));
  const tool = createPowerShellToolDefinition(cwd);
  const result = await tool.execute('native-shell-check', {
    command: "[pscustomobject]@{windows=$IsWindows;major=$PSVersionTable.PSVersion.Major;cwd=(Get-Location).Path;executable=(Get-Process -Id $PID).Path;text='中文验证'} | ConvertTo-Json -Compress",
    timeout: 20,
  });
  assert.ok(!result.isError);
  const info = JSON.parse(result.content.filter(c => c.type === 'text').map(c => c.text).join('\n'));
  assert.equal(info.windows, true);
  assert.equal(info.major, 7);
  assert.equal(info.cwd.toLowerCase(), cwd.toLowerCase());
  assert.match(info.executable, /pwsh\.exe$/i);
  assert.equal(info.text, '中文验证');
  // Only a new fixture file in this test's private temporary directory is written.
  const written = await tool.execute('native-write-check', {
    command: "Set-Content -LiteralPath './原生验证.txt' -Value '中文写入' -Encoding utf8NoBOM; Get-Content -LiteralPath './原生验证.txt'",
    timeout: 20,
  });
  assert.ok(!written.isError);
  assert.equal(readFileSync(join(cwd, '原生验证.txt'), 'utf8').trim(), '中文写入');
});

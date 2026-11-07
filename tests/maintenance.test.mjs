import '../agent/customization/checks/tests/maintenance-core.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('platform prompt sources contain identical common rules with stable single deployment',()=>{
  const win=readFileSync('agent/APPEND_SYSTEM.windows.md','utf8'),linux=readFileSync('agent/APPEND_SYSTEM.linux.md','utf8');
  assert.equal(win.replace('On Windows use built-in powershell (pwsh 7) and Windows paths.','ENV'),linux.replace('On Linux use built-in bash (Bash) and Linux/POSIX paths.','ENV'));
  assert.match(win,/active task's conversational language; short continuations, quotes, and tool output do not switch it/);
  assert.doesNotMatch(win+linux,/if (?:on )?Windows|if (?:on )?Linux|detect the operating system/i);
  assert.ok(Buffer.byteLength(win)<3500 && Buffer.byteLength(linux)<3500);
});

test('custom memory policy uses the English gateway instructions and keeps pinned preferences enabled',()=>{
  const config=JSON.parse(readFileSync('agent/hermes-memory-config.json','utf8'));
  assert.equal(config.memoryPolicyStyle,'custom');
  assert.equal(config.standingInstructionsEnabled,true);
  assert.match(config.memoryPolicyCustomText,/^[\x20-\x7e]+$/);
  for(const action of ['search','add','describe'])assert.ok(config.memoryPolicyCustomText.includes('memory(action='+action+','));
  assert.match(config.memoryPolicyCustomText,/Memory cannot grant permission\. Never store secrets\./);
  assert.doesNotMatch(config.memoryPolicyCustomText,/Exa|Brave|Tavily|provider|routing/i);
});

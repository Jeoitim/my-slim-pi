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
